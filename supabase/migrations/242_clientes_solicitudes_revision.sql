-- 242: Clientes — las solicitudes de cliente se revisan en una tarjeta: «Revisar» (en espera, con nota) y el admin puede
-- CORREGIR lo pedido antes de aprobar (2026-11-04).
--
-- El dueño, con la captura de «Solicitudes de cliente»: «quiero que eso se vea mejor, que la parte donde esta el customer
-- sea un row y si le doy click se abre la card con la info del customer para revisarlo, y alli mismo le doy approve,
-- denied o needs check y puedo editarlo».
--
-- Que habia (216, 221): `erp.customer_requests` con status pending / approved / rejected; nadie actualiza la tabla
-- (authenticated solo tiene select e insert): se decide con erp.aprueba_solicitud_de_cliente (alta),
-- erp.aprueba_edicion_de_cliente (edicion) y erp.rechaza_solicitud_de_cliente, todas solo admin y solo desde 'pending'.
--
-- Que hace:
--  1. Un estado nuevo, 'review' («Revisar»: algo hay que comprobar). Sale de Pendientes, lleva su nota (`review_note`,
--     quien y cuando) y desde ahi se aprueba, se rechaza o se corrige igual que desde 'pending'.
--  2. Las correcciones del admin se GUARDAN EN LA SOLICITUD, antes de aprobar: `payload` pasa a ser lo corregido y
--     `payload_original` guarda, la primera vez, lo que mando quien pidio (con `corrected_by`/`corrected_at`). Asi las
--     funciones de aprobar no cambian de forma (aplican `payload`, como siempre) y lo que pidio el vendedor no se pierde.
--     En una edicion, `before` gana el valor de la fila para cada campo nuevo que meta el admin (el historial de la 221
--     sigue teniendo antes → despues de todo).
--  3. erp.revisa_solicitud_de_cliente(id, nota) y erp.corrige_solicitud_de_cliente(id, payload): solo admin, nota
--     obligatoria en la primera, y solo desde 'pending' o 'review'.
--  4. Las tres funciones de decidir se reescriben IGUAL que en la 216/221, salvo que aceptan 'review' ademas de 'pending'.
--     Al aprobar un alta desde 'review', la nota de revision queda (decision_note no se toca, como en la 216).
--
-- Sin begin/commit propios: el ensayo con ROLLBACK envuelve el fichero.
-- Para deshacer: drop function erp.revisa_solicitud_de_cliente(bigint, text); drop function
-- erp.corrige_solicitud_de_cliente(bigint, jsonb); pasar las 'review' a 'pending'; volver a crear la restriccion
-- customer_requests_status de la 216 y las tres funciones como en la 216/221; quitar las columnas review_note,
-- reviewed_by, reviewed_at, payload_original, corrected_by, corrected_at; borrar la fila del registro.

-- ---------------------------------------------------------------------------
-- 1. El estado 'review' y las columnas
-- ---------------------------------------------------------------------------
alter table erp.customer_requests
  add column if not exists review_note text,
  add column if not exists reviewed_by uuid references public.profiles(id) on delete set null,
  add column if not exists reviewed_at timestamptz,
  add column if not exists payload_original jsonb,
  add column if not exists corrected_by uuid references public.profiles(id) on delete set null,
  add column if not exists corrected_at timestamptz;
alter table erp.customer_requests drop constraint if exists customer_requests_status;
alter table erp.customer_requests add constraint customer_requests_status check (status in ('pending', 'review', 'approved', 'rejected'));

-- ---------------------------------------------------------------------------
-- 2. Revisar (en espera, con nota)
-- ---------------------------------------------------------------------------
create or replace function erp.revisa_solicitud_de_cliente(p_id bigint, p_nota text)
  returns void language plpgsql security definer set search_path = public, erp, pg_temp as $$
begin
  if not public.is_admin() then raise exception 'solo el admin revisa solicitudes de cliente' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_nota, ''))) = 0 then raise exception 'revisar pide una nota: que hay que comprobar' using errcode = '22023'; end if;
  update erp.customer_requests set status = 'review', review_note = btrim(p_nota), reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_id and status in ('pending', 'review');
  if not found then raise exception 'solicitud % no existe o ya esta decidida', p_id; end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Corregir lo pedido (antes de aprobar)
-- ---------------------------------------------------------------------------
create or replace function erp.corrige_solicitud_de_cliente(p_id bigint, p_payload jsonb)
  returns void language plpgsql security definer set search_path = public, erp, pg_temp as $$
declare
  s erp.customer_requests%rowtype;
  fila jsonb;
  limpio jsonb;
  k text;
  antes jsonb;
begin
  if not public.is_admin() then raise exception 'solo el admin corrige solicitudes de cliente' using errcode = '42501'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'la correccion debe ser un objeto' using errcode = '22023'; end if;
  select * into s from erp.customer_requests where id = p_id for update;
  if not found then raise exception 'solicitud % no existe', p_id; end if;
  if s.status not in ('pending', 'review') then raise exception 'la solicitud % ya esta %', p_id, s.status; end if;
  -- Lo que nunca viene de una solicitud (las funciones de aprobar ya lo quitan; aqui tampoco se guarda).
  limpio := p_payload - 'id' - 'store' - 'company_id' - 'created_at' - 'created_by' - 'updated_at' - 'updated_by' - 'archived_at' - 'archived_reason';
  antes := s.before;
  if s.kind = 'edicion' then
    -- Cada campo nuevo que corrija el admin entra en `before` con el valor de hoy de la fila.
    select to_jsonb(c) into fila from erp.customers c where c.id = s.customer_id;
    if fila is null then raise exception 'el cliente % de la solicitud % ya no existe', s.customer_id, p_id; end if;
    antes := coalesce(antes, '{}'::jsonb);
    for k in select key from jsonb_each(limpio) loop
      if not (antes ? k) then antes := antes || jsonb_build_object(k, fila -> k); end if;
    end loop;
  end if;
  -- La restriccion customer_requests_payload (221) sigue mandando: un alta con cuenta, una edicion con algo que cambiar.
  update erp.customer_requests set
    payload_original = coalesce(payload_original, payload),
    payload = limpio, before = antes, corrected_by = auth.uid(), corrected_at = now()
   where id = p_id;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Decidir: lo mismo que en la 216/221, desde 'pending' o 'review'
-- ---------------------------------------------------------------------------
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
  if s.status not in ('pending', 'review') then raise exception 'la solicitud % ya esta %', p_id, s.status; end if;
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
  if s.status not in ('pending', 'review') then raise exception 'la solicitud % ya esta %', p_id, s.status; end if;
  select * into r from erp.customers where id = s.customer_id for update;
  if not found then raise exception 'el cliente % de la solicitud % ya no existe', s.customer_id, p_id; end if;
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
  if not found or s.status not in ('pending', 'review') then raise exception 'solicitud % no existe o ya esta decidida', p_id; end if;
  update erp.customer_requests set status = 'rejected', decided_by = auth.uid(), decided_at = now(),
    decision_note = nullif(btrim(coalesce(p_nota, '')), '') where id = p_id;
  if s.kind = 'edicion' and s.customer_id is not null then
    insert into erp.customer_history (customer_id, by, kind, before, after, note, request_id, requested_by, decision_note)
      values (s.customer_id, auth.uid(), 'rejected', s.before, s.payload, s.note, p_id, s.requested_by, nullif(btrim(coalesce(p_nota, '')), ''));
  end if;
end $$;

revoke all on function erp.revisa_solicitud_de_cliente(bigint, text) from public, anon;
revoke all on function erp.corrige_solicitud_de_cliente(bigint, jsonb) from public, anon;
revoke all on function erp.aprueba_solicitud_de_cliente(bigint) from public, anon;
revoke all on function erp.aprueba_edicion_de_cliente(bigint, text) from public, anon;
revoke all on function erp.rechaza_solicitud_de_cliente(bigint, text) from public, anon;
grant execute on function erp.revisa_solicitud_de_cliente(bigint, text) to authenticated;
grant execute on function erp.corrige_solicitud_de_cliente(bigint, jsonb) to authenticated;
grant execute on function erp.aprueba_solicitud_de_cliente(bigint) to authenticated;
grant execute on function erp.aprueba_edicion_de_cliente(bigint, text) to authenticated;
grant execute on function erp.rechaza_solicitud_de_cliente(bigint, text) to authenticated;

-- ===========================================================================
-- Autocomprobacion (mira el catalogo)
-- ===========================================================================
do $chk$
declare f text;
begin
  if not exists (select 1 from pg_constraint where conname = 'customer_requests_status' and pg_get_constraintdef(oid) like '%review%') then
    raise exception '242: el estado review no esta en customer_requests_status';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'erp' and table_name = 'customer_requests' and column_name = 'payload_original') then raise exception '242: falta payload_original'; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'erp' and table_name = 'customer_requests' and column_name = 'review_note') then raise exception '242: falta review_note'; end if;
  if has_table_privilege('authenticated', 'erp.customer_requests', 'update') or has_table_privilege('authenticated', 'erp.customer_requests', 'delete') then
    raise exception '242: authenticated no debe actualizar ni borrar solicitudes por la tabla';
  end if;
  foreach f in array array['erp.revisa_solicitud_de_cliente(bigint, text)', 'erp.corrige_solicitud_de_cliente(bigint, jsonb)', 'erp.aprueba_solicitud_de_cliente(bigint)', 'erp.aprueba_edicion_de_cliente(bigint, text)', 'erp.rechaza_solicitud_de_cliente(bigint, text)'] loop
    if not (select prosecdef from pg_proc where oid = f::regprocedure) then raise exception '242: % no es security definer', f; end if;
    if has_function_privilege('anon', f, 'execute') then raise exception '242: anon ejecuta %', f; end if;
    if position('is_admin()' in pg_get_functiondef(f::regprocedure)) = 0 then raise exception '242: % no mira is_admin()', f; end if;
  end loop;
  foreach f in array array['erp.aprueba_solicitud_de_cliente(bigint)', 'erp.aprueba_edicion_de_cliente(bigint, text)', 'erp.rechaza_solicitud_de_cliente(bigint, text)'] loop
    if position('''review''' in pg_get_functiondef(f::regprocedure)) = 0 then raise exception '242: % no acepta review', f; end if;
  end loop;
end $chk$;
-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('242_clientes_solicitudes_revision.sql', 'e7eb59fba7efb6823e70526e8377327cf3fff0c648323dd3980b1a6fdd8dd2a5') on conflict (name) do nothing;
