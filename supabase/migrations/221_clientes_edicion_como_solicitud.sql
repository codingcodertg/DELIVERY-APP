-- 221: Clientes — la edicion de vendedor y gerente es una SOLICITUD que revisa el admin, y todo queda en el historial
-- del cliente (D-780, 2026-10-30).
--
-- El dueño: «el boton de edit tambien es request to edit y cuando alguien haga una edit y el admin lo revise debera
-- poder ver el valor anterior con el de ahora y hasta una opcion de nota por que se hizo la edicion y que todo eso
-- quede guardado en el historial del cliente».
--
-- Que hace:
--  1. `erp.customer_requests` (216) admite dos clases: `kind` = 'alta' (lo de siempre) o 'edicion'. Una edicion lleva
--     `customer_id` (la fila), `payload` (SOLO los campos que cambian, con el valor nuevo), `before` (los mismos campos
--     con el valor que vio quien pidio) y `note` (por que se pide; opcional).
--  2. `erp.customer_history`: el historial del cliente. Una fila por cambio: quien, cuando, que clase ('create', 'edit',
--     'archive', 'restore', 'approved', 'rejected'), los campos de antes y de despues, la nota y la solicitud de la que
--     salio. La escribe un disparador en erp.customers (cada UPDATE que cambie algo deja su fila con el diff de columnas)
--     y las funciones de aprobar/rechazar (la nota y el numero de solicitud viajan por `set_config('rtg.*')`).
--  3. Escribir en erp.customers por la tabla queda SOLO para el admin (`customers update (admin)`): vendedor y gerente ya
--     no editan directo; piden. El alta por solicitud (216) no cambia. Insertar directo sigue como estaba (`customers_can_write`,
--     que en pantalla solo usa el admin: el alta del vendedor y del gerente es solicitud desde D-743).
--  4. `erp.aprueba_edicion_de_cliente(p_id, p_nota)`: el admin aplica el `payload` sobre la fila (solo las columnas que
--     vienen) y la solicitud queda aprobada; el historial recibe la fila con `request_id`, la nota de quien pidio y la del
--     admin. `erp.rechaza_solicitud_de_cliente` (216) se reescribe para que, si es una edicion, tambien deje su fila en
--     el historial (kind 'rejected', con lo que se pedia).
--
-- Sin begin/commit propios: el ensayo con ROLLBACK envuelve el fichero.
-- Para deshacer: drop trigger customers_zz_historial on erp.customers; drop function erp.customers_historial();
-- drop function erp.aprueba_edicion_de_cliente(bigint, text); drop table erp.customer_history; devolver la politica
-- "customers update (writers)" de la 198; quitar las columnas kind, customer_id, before, note y la restriccion
-- customer_requests_payload de aqui (y reponer la de la 216); borrar la fila del registro.

-- ---------------------------------------------------------------------------
-- 1. La solicitud admite ediciones
-- ---------------------------------------------------------------------------
alter table erp.customer_requests
  add column if not exists kind text not null default 'alta',
  add column if not exists customer_id bigint references erp.customers(id) on delete cascade,
  add column if not exists before jsonb,
  add column if not exists note text;
alter table erp.customer_requests drop constraint if exists customer_requests_kind;
alter table erp.customer_requests add constraint customer_requests_kind check (kind in ('alta', 'edicion'));
alter table erp.customer_requests drop constraint if exists customer_requests_payload;
alter table erp.customer_requests add constraint customer_requests_payload check (
  jsonb_typeof(payload) = 'object'
  and ((kind = 'alta' and length(btrim(coalesce(payload->>'account', ''))) > 0)
    or (kind = 'edicion' and customer_id is not null and payload <> '{}'::jsonb))
);
create index if not exists customer_requests_por_cliente on erp.customer_requests (customer_id, created_at desc) where customer_id is not null;

-- ---------------------------------------------------------------------------
-- 2. El historial del cliente
-- ---------------------------------------------------------------------------
create table if not exists erp.customer_history (
  id            bigint generated always as identity primary key,
  customer_id   bigint not null references erp.customers(id) on delete cascade,
  at            timestamptz not null default now(),
  by            uuid references public.profiles(id) on delete set null,
  kind          text not null,
  before        jsonb,
  after         jsonb,
  note          text,
  request_id    bigint references erp.customer_requests(id) on delete set null,
  requested_by  uuid references public.profiles(id) on delete set null,
  decision_note text,
  constraint customer_history_kind check (kind in ('create', 'edit', 'archive', 'restore', 'approved', 'rejected'))
);
create index if not exists customer_history_por_cliente on erp.customer_history (customer_id, at desc);
revoke all on erp.customer_history from public, anon, authenticated;
grant select on erp.customer_history to authenticated;
alter table erp.customer_history enable row level security;
drop policy if exists "customer history gate" on erp.customer_history;
create policy "customer history gate" on erp.customer_history as restrictive for all to authenticated
  using ((select public.has_customers_access()));
-- Se lee el historial de las filas que se pueden ver: la subconsulta corre con la RLS de erp.customers de quien mira.
drop policy if exists "customer history read visible rows" on erp.customer_history;
create policy "customer history read visible rows" on erp.customer_history as permissive for select to authenticated
  using (exists (select 1 from erp.customers c where c.id = customer_history.customer_id));

-- El disparador: cada UPDATE que cambie algo (fuera de updated_at/updated_by) deja el diff de columnas. La clase sale de
-- lo que cambio; y si una funcion de solicitud puso rtg.solicitud, la fila va como 'approved' con su numero y notas.
create or replace function erp.customers_historial()
  returns trigger language plpgsql security definer set search_path = public, erp, pg_temp as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_before jsonb := '{}'::jsonb;
  v_after jsonb := '{}'::jsonb;
  k text;
  v_kind text;
  v_req bigint;
  v_requested uuid;
begin
  if tg_op = 'INSERT' then
    insert into erp.customer_history (customer_id, by, kind, after, note)
      values (NEW.id, auth.uid(), 'create', to_jsonb(NEW) - 'updated_at' - 'updated_by' - 'created_at' - 'created_by', nullif(current_setting('rtg.nota', true), ''));
    return NEW;
  end if;
  v_old := to_jsonb(OLD) - 'updated_at' - 'updated_by';
  v_new := to_jsonb(NEW) - 'updated_at' - 'updated_by';
  for k in select key from jsonb_each(v_new) loop
    if v_new -> k is distinct from v_old -> k then
      v_before := v_before || jsonb_build_object(k, v_old -> k);
      v_after := v_after || jsonb_build_object(k, v_new -> k);
    end if;
  end loop;
  if v_after = '{}'::jsonb then return NEW; end if;
  v_req := nullif(current_setting('rtg.solicitud', true), '')::bigint;
  if v_req is not null then
    v_kind := 'approved';
    select requested_by into v_requested from erp.customer_requests where id = v_req;
  elsif OLD.archived_at is null and NEW.archived_at is not null then v_kind := 'archive';
  elsif OLD.archived_at is not null and NEW.archived_at is null then v_kind := 'restore';
  else v_kind := 'edit';
  end if;
  insert into erp.customer_history (customer_id, by, kind, before, after, note, request_id, requested_by, decision_note)
    values (NEW.id, auth.uid(), v_kind, v_before, v_after, nullif(current_setting('rtg.nota', true), ''), v_req, v_requested,
            nullif(current_setting('rtg.decision', true), ''));
  return NEW;
end $$;
drop trigger if exists customers_zz_historial on erp.customers;
create trigger customers_zz_historial after insert or update on erp.customers
  for each row execute function erp.customers_historial();

-- ---------------------------------------------------------------------------
-- 3. Por la tabla edita solo el admin
-- ---------------------------------------------------------------------------
drop policy if exists "customers update (writers)" on erp.customers;
drop policy if exists "customers update (admin)" on erp.customers;
create policy "customers update (admin)" on erp.customers as permissive for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- 4. Aprobar una edicion; rechazar deja historial
-- ---------------------------------------------------------------------------
create or replace function erp.aprueba_edicion_de_cliente(p_id bigint, p_nota text default null)
  returns void language plpgsql security definer set search_path = public, erp, pg_temp as $$
declare
  s erp.customer_requests%rowtype;
  r erp.customers%rowtype;
begin
  if not public.is_admin() then raise exception 'solo el admin aprueba ediciones de cliente' using errcode = '42501'; end if;
  select * into s from erp.customer_requests where id = p_id for update;
  if not found then raise exception 'solicitud % no existe', p_id; end if;
  if s.kind <> 'edicion' then raise exception 'la solicitud % no es una edicion', p_id; end if;
  if s.status <> 'pending' then raise exception 'la solicitud % ya esta %', p_id, s.status; end if;
  select * into r from erp.customers where id = s.customer_id for update;
  if not found then raise exception 'el cliente % de la solicitud % ya no existe', s.customer_id, p_id; end if;
  -- El payload SOLO trae lo que cambia: se funde sobre la fila y se escriben las columnas editables (las de la 216).
  r := jsonb_populate_record(r, s.payload - 'id' - 'store' - 'company_id' - 'created_at' - 'created_by' - 'updated_at' - 'updated_by' - 'archived_at' - 'archived_reason');
  perform set_config('rtg.solicitud', p_id::text, true);
  perform set_config('rtg.nota', coalesce(s.note, ''), true);
  perform set_config('rtg.decision', coalesce(p_nota, ''), true);
  update erp.customers set
    account = btrim(r.account), unified_account = r.unified_account, house_no = r.house_no, added_batch = r.added_batch,
    qb_status = r.qb_status, activity_status = r.activity_status, status_store = r.status_store, status_group = r.status_group,
    history_store = r.history_store, history_group = r.history_group, rep_history = r.rep_history, rep_qb = r.rep_qb,
    rep_store = r.rep_store, contact_name = r.contact_name, contact_title = r.contact_title, address = r.address,
    phone = r.phone, email = r.email, credit_limit = r.credit_limit, euler_limit = r.euler_limit, terms = r.terms,
    account_no = r.account_no, notes = r.notes, crm_type_store = r.crm_type_store, crm_type_group = r.crm_type_group,
    associated_with = r.associated_with, contacts = coalesce(r.contacts, '[]'::jsonb), tax_terms = r.tax_terms,
    website = r.website, socials = coalesce(r.socials, '{}'::jsonb), rep_id = r.rep_id
   where id = s.customer_id;
  perform set_config('rtg.solicitud', '', true);
  perform set_config('rtg.nota', '', true);
  perform set_config('rtg.decision', '', true);
  update erp.customer_requests set status = 'approved', decided_by = auth.uid(), decided_at = now(),
    decision_note = nullif(btrim(coalesce(p_nota, '')), '') where id = p_id;
end $$;

create or replace function erp.rechaza_solicitud_de_cliente(p_id bigint, p_nota text default null)
  returns void language plpgsql security definer set search_path = public, erp, pg_temp as $$
declare
  s erp.customer_requests%rowtype;
begin
  if not public.is_admin() then raise exception 'solo el admin rechaza solicitudes de cliente' using errcode = '42501'; end if;
  select * into s from erp.customer_requests where id = p_id for update;
  if not found or s.status <> 'pending' then raise exception 'solicitud % no existe o ya esta decidida', p_id; end if;
  update erp.customer_requests set status = 'rejected', decided_by = auth.uid(), decided_at = now(),
    decision_note = nullif(btrim(coalesce(p_nota, '')), '') where id = p_id;
  if s.kind = 'edicion' and s.customer_id is not null then
    insert into erp.customer_history (customer_id, by, kind, before, after, note, request_id, requested_by, decision_note)
      values (s.customer_id, auth.uid(), 'rejected', s.before, s.payload, s.note, p_id, s.requested_by, nullif(btrim(coalesce(p_nota, '')), ''));
  end if;
end $$;

revoke all on function erp.aprueba_edicion_de_cliente(bigint, text) from public, anon;
grant execute on function erp.aprueba_edicion_de_cliente(bigint, text) to authenticated;
revoke all on function erp.rechaza_solicitud_de_cliente(bigint, text) from public, anon;
grant execute on function erp.rechaza_solicitud_de_cliente(bigint, text) to authenticated;

-- ===========================================================================
-- Autocomprobacion (mira el catalogo)
-- ===========================================================================
do $chk$
declare n integer;
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'erp' and table_name = 'customer_requests' and column_name = 'kind') then raise exception '221: falta kind'; end if;
  if not exists (select 1 from pg_tables where schemaname = 'erp' and tablename = 'customer_history') then raise exception '221: falta customer_history'; end if;
  if not exists (select 1 from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'erp' and c.relname = 'customer_history' and c.relrowsecurity) then raise exception '221: customer_history sin RLS'; end if;
  if has_table_privilege('authenticated', 'erp.customer_history', 'insert') or has_table_privilege('authenticated', 'erp.customer_history', 'update') or has_table_privilege('authenticated', 'erp.customer_history', 'delete') then
    raise exception '221: authenticated no debe escribir el historial por la tabla';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'erp.customers'::regclass and tgname = 'customers_zz_historial') then raise exception '221: falta el disparador'; end if;
  select count(*) into n from pg_policies where schemaname = 'erp' and tablename = 'customers' and cmd = 'UPDATE';
  if n <> 1 then raise exception '221: customers debe tener 1 politica de UPDATE, tiene %', n; end if;
  if exists (select 1 from pg_policies where schemaname = 'erp' and tablename = 'customers' and policyname = 'customers update (writers)') then raise exception '221: sigue la politica de la 198'; end if;
  if not exists (select 1 from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'erp' and p.proname = 'aprueba_edicion_de_cliente' and p.prosecdef) then raise exception '221: aprobar edicion no es security definer'; end if;
  if has_function_privilege('anon', 'erp.aprueba_edicion_de_cliente(bigint, text)', 'execute') then raise exception '221: anon aprueba'; end if;
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum)
  values ('221_clientes_edicion_como_solicitud.sql', '24cc10820f329b2f43a9b4cc71e2e2b9fe69cac34789e93517afb9a110009e0a') on conflict (name) do nothing;
