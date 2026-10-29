-- 216: Clientes — el alta de un cliente por vendedor o gerente es una SOLICITUD que aprueba el admin (D-NEXT, 2026-10-29).
--
-- El dueño: «nuevo cliente no es que lo agregan, es que ellos ponen la info y llenan un formulario, pero para ellos y
-- para manager ellos deben mandar eso como request para que el admin lo apruebe».
--
-- Que hay:
--   1. erp.customer_requests: una fila por solicitud. `stores` (las tiendas marcadas en el alta, D-664), `payload` (los
--      campos del formulario, con los mismos nombres que las columnas de erp.customers; sin store ni company_id),
--      `status` pending / approved / rejected, quien la pidio y quien la decidio.
--   2. RLS: quien puede escribir clientes (customers_can_write: admin, gerente, vendedor con el modulo) INSERTA la suya;
--      LEE las suyas; el admin las lee todas. Nadie actualiza ni borra por la tabla: se decide con las funciones.
--   3. erp.aprueba_solicitud_de_cliente(id): solo admin. Crea UNA fila de erp.customers por tienda de `stores`, todas de
--      la misma empresa nueva (company_id), con created_by = quien pidio (asi el vendedor abre lo suyo, 215), y marca la
--      solicitud approved con los ids creados. Si una cuenta ya existe en una tienda, la sentencia entera falla y se dice.
--   4. erp.rechaza_solicitud_de_cliente(id, nota): solo admin. Marca rejected con la nota.
-- El aviso al admin no va aqui: la pantalla manda ademas una solicitud de ayuda (/api/help, D-311), que es el canal que
-- el admin ya mira. Sin begin/commit propios.
-- Para deshacer: drop function ... (las dos); drop table erp.customer_requests; borrar la fila del registro.

create table if not exists erp.customer_requests (
  id            bigint generated always as identity primary key,
  requested_by  uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  stores        text[] not null,
  payload       jsonb not null,
  status        text not null default 'pending',
  created_at    timestamptz not null default now(),
  decided_by    uuid references public.profiles(id) on delete set null,
  decided_at    timestamptz,
  decision_note text,
  created_ids   bigint[],
  constraint customer_requests_status check (status in ('pending', 'approved', 'rejected')),
  constraint customer_requests_stores check (cardinality(stores) >= 1),
  constraint customer_requests_payload check (jsonb_typeof(payload) = 'object' and length(btrim(coalesce(payload->>'account', ''))) > 0),
  constraint customer_requests_tamano check (pg_column_size(payload) < 65536)
);
create index if not exists customer_requests_pending on erp.customer_requests (status, created_at desc);

revoke all on erp.customer_requests from public, anon, authenticated;
grant select, insert on erp.customer_requests to authenticated;
alter table erp.customer_requests enable row level security;

drop policy if exists "customer requests gate" on erp.customer_requests;
create policy "customer requests gate" on erp.customer_requests as restrictive for all to authenticated
  using ((select public.has_customers_access())) with check ((select public.has_customers_access()));
drop policy if exists "customer requests read own or admin" on erp.customer_requests;
create policy "customer requests read own or admin" on erp.customer_requests as permissive for select to authenticated
  using (requested_by = (select auth.uid()) or (select public.is_admin()));
drop policy if exists "customer requests insert own (writers)" on erp.customer_requests;
create policy "customer requests insert own (writers)" on erp.customer_requests as permissive for insert to authenticated
  with check (requested_by = (select auth.uid()) and status = 'pending' and (select erp.customers_can_write()));

create or replace function erp.aprueba_solicitud_de_cliente(p_id bigint)
  returns bigint[] language plpgsql security definer set search_path = public, erp as $$
declare
  s erp.customer_requests%rowtype;
  r erp.customers%rowtype;
  tienda text;
  nuevo_id bigint;
  ids bigint[] := '{}';
  empresa uuid := gen_random_uuid();
begin
  if not public.is_admin() then raise exception 'solo el admin aprueba solicitudes de cliente' using errcode = '42501'; end if;
  select * into s from erp.customer_requests where id = p_id for update;
  if not found then raise exception 'solicitud % no existe', p_id; end if;
  if s.status <> 'pending' then raise exception 'la solicitud % ya esta %', p_id, s.status; end if;
  r := jsonb_populate_record(null::erp.customers, s.payload - 'id' - 'store' - 'company_id' - 'created_at' - 'created_by' - 'updated_at' - 'updated_by' - 'archived_at' - 'archived_reason');
  foreach tienda in array s.stores loop
    insert into erp.customers (
      store, account, company_id, created_by, source,
      unified_account, house_no, added_batch, qb_status, activity_status, status_store, status_group, history_store, history_group,
      rep_history, rep_qb, rep_store, contact_name, contact_title, address, phone, email, credit_limit, euler_limit, terms,
      account_no, notes, crm_type_store, crm_type_group, associated_with, contacts, tax_terms, website, socials, rep_id
    ) values (
      tienda, btrim(r.account), empresa, s.requested_by, 'solicitud ' || p_id,
      r.unified_account, r.house_no, r.added_batch, r.qb_status, r.activity_status, r.status_store, r.status_group, r.history_store, r.history_group,
      r.rep_history, r.rep_qb, r.rep_store, r.contact_name, r.contact_title, r.address, r.phone, r.email, r.credit_limit, r.euler_limit, r.terms,
      r.account_no, r.notes, r.crm_type_store, r.crm_type_group, r.associated_with, coalesce(r.contacts, '[]'::jsonb), r.tax_terms, r.website, coalesce(r.socials, '{}'::jsonb), r.rep_id
    ) returning id into nuevo_id;
    -- El disparador customers_touch pone created_by = quien aprueba; aqui manda quien pidio (asi abre lo suyo, 215).
    update erp.customers set created_by = s.requested_by where id = nuevo_id;
    ids := ids || nuevo_id;
  end loop;
  update erp.customer_requests set status = 'approved', decided_by = auth.uid(), decided_at = now(), created_ids = ids where id = p_id;
  return ids;
end $$;

create or replace function erp.rechaza_solicitud_de_cliente(p_id bigint, p_nota text default null)
  returns void language plpgsql security definer set search_path = public, erp as $$
begin
  if not public.is_admin() then raise exception 'solo el admin rechaza solicitudes de cliente' using errcode = '42501'; end if;
  update erp.customer_requests set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = nullif(btrim(coalesce(p_nota, '')), '')
   where id = p_id and status = 'pending';
  if not found then raise exception 'solicitud % no existe o ya esta decidida', p_id; end if;
end $$;

revoke all on function erp.aprueba_solicitud_de_cliente(bigint) from public, anon;
revoke all on function erp.rechaza_solicitud_de_cliente(bigint, text) from public, anon;
grant execute on function erp.aprueba_solicitud_de_cliente(bigint) to authenticated;
grant execute on function erp.rechaza_solicitud_de_cliente(bigint, text) to authenticated;

-- ===========================================================================
-- Autocomprobacion (mira el catalogo)
-- ===========================================================================
do $chk$
declare n integer;
begin
  if not exists (select 1 from pg_tables where schemaname = 'erp' and tablename = 'customer_requests') then raise exception '216: falta la tabla'; end if;
  if not exists (select 1 from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'erp' and c.relname = 'customer_requests' and c.relrowsecurity) then
    raise exception '216: customer_requests sin RLS';
  end if;
  select count(*) into n from pg_policies where schemaname = 'erp' and tablename = 'customer_requests';
  if n <> 3 then raise exception '216: customer_requests debe tener 3 politicas, tiene %', n; end if;
  if has_table_privilege('authenticated', 'erp.customer_requests', 'update') or has_table_privilege('authenticated', 'erp.customer_requests', 'delete') then
    raise exception '216: authenticated no debe actualizar ni borrar solicitudes por la tabla';
  end if;
  if has_table_privilege('anon', 'erp.customer_requests', 'select') then raise exception '216: anon lee solicitudes'; end if;
  if not exists (select 1 from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'erp' and p.proname = 'aprueba_solicitud_de_cliente' and p.prosecdef) then
    raise exception '216: aprobar no es security definer';
  end if;
  if has_function_privilege('anon', 'erp.aprueba_solicitud_de_cliente(bigint)', 'execute') then raise exception '216: anon aprueba'; end if;
  if not exists (select 1 from pg_proc where proname = 'is_admin') then raise exception '216: falta public.is_admin()'; end if;
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum)
  values ('216_solicitudes_de_cliente.sql', 'a59a14c57c4a8193a7cb9dd8d3f98b825dc1fbe58a52b00343fc058980d3634a') on conflict (name) do nothing;
