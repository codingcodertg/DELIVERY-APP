-- 250: Clientes — asociaciones con aprobación: varias a la vez, desde la edición, y el vendedor también propone
-- (2026-11-05).
--
-- El dueño: «POSIBLE TO ASSOCIATE MULTIPLE PEOPLE TO A CLIENT, AND HAS TO GO TO APPROVAL SO YES ONLY ON EDIT AND SALES
-- PEOPLE CAN DO IT AS WELL». Y luego: «el vendedor solo encuentra clientes de su(s) tienda(s)».
--
-- Que habia (249): `erp.customer_associations`, que solo escribe quien edita directo (erp.es_admin_de_clientes()).
--
-- Que hace:
--  1. `erp.customer_requests` admite una clase nueva, 'asociacion': una propuesta de AÑADIR o QUITAR un par. `customer_id`
--     es la fila desde cuya edición se propuso; `payload` = {op: 'add'|'remove', company, other, account,
--     associated_customer}. Esa clase SOLO entra por erp.propone_asociaciones (una politica restrictiva cierra el insert
--     directo), y no se corrige ni se aprueba como alta (las funciones de la 242 la rechazan).
--  2. Las tiendas de quien mira, como en Clientes (217/241): el codigo de `profiles.store`, mas las de `visible_stores`
--     si tiene alguna (si esta vacia NO significa «todas» aqui). Una empresa es «de mis tiendas» si ALGUNA de sus filas
--     esta en una de ellas. El admin de Clientes, todas.
--  3. erp.busca_clientes_para_asociar(p_q): una fila por EMPRESA (no archivada del todo) que casa por cuenta, cuenta
--     unificada o contacto; el no admin solo ve las de sus tiendas.
--  4. erp.propone_asociaciones(p_customer, p_add uuid[], p_remove bigint[], p_nota): quien edita (admin, gerente,
--     vendedor: erp.customers_can_write()) y ve la fila. El admin aplica directo (la tabla y su historial, 249). Los
--     demas crean una solicitud por cada cambio (pendiente), y el no admin no puede proponer una empresa fuera de sus
--     tiendas. Sin repetir: ni un par que ya existe, ni una propuesta igual que siga abierta.
--  5. erp.aprueba_asociacion(p_id, p_nota): solo admin, desde 'pending' o 'review'; aplica el cambio. El historial de la
--     249 (associate/dissociate, en las dos empresas) lleva ahora la solicitud, quien la pidio, su nota y la del admin.
--     Rechazar es erp.rechaza_solicitud_de_cliente (242), que ahora apunta tambien estas en el historial ('rejected').
--  6. erp.asociaciones_pendientes(p_company): las propuestas abiertas de una empresa (por cualquiera de los dos lados),
--     para pintar «pendiente de aprobación» en la ficha.
--  7. Los avisos (243) nombran la clase: «New association request».
--
-- Sin begin/commit propios: el ensayo con ROLLBACK envuelve el fichero.
-- Para deshacer: drop function erp.propone_asociaciones(bigint, uuid[], bigint[], text), erp.aprueba_asociacion(bigint,
-- text), erp.busca_clientes_para_asociar(text), erp.asociaciones_pendientes(uuid), erp.empresa_en_mis_tiendas(uuid),
-- erp.mis_tiendas_de_clientes(); drop policy "customer requests no asociacion directa"; borrar las solicitudes
-- 'asociacion' y reponer customer_requests_kind/_payload de la 221; volver a crear las funciones de la 242/243 y el
-- disparador de historial de la 249; borrar la fila del registro.

do $pre$
begin
  if to_regclass('erp.customer_associations') is null then raise exception '250: falta erp.customer_associations; aplica primero la 249'; end if;
  if to_regprocedure('erp.revisa_solicitud_de_cliente(bigint, text)') is null then raise exception '250: aplica primero la 242'; end if;
  if to_regprocedure('erp.avisa_solicitud_de_cliente()') is null then raise exception '250: aplica primero la 243'; end if;
end $pre$;

-- ---------------------------------------------------------------------------
-- 1. La clase 'asociacion'
-- ---------------------------------------------------------------------------
alter table erp.customer_requests drop constraint if exists customer_requests_kind;
alter table erp.customer_requests add constraint customer_requests_kind check (kind in ('alta', 'edicion', 'asociacion'));
alter table erp.customer_requests drop constraint if exists customer_requests_payload;
alter table erp.customer_requests add constraint customer_requests_payload check (
  jsonb_typeof(payload) = 'object'
  and ((kind = 'alta' and length(btrim(coalesce(payload->>'account', ''))) > 0)
    or (kind = 'edicion' and customer_id is not null and payload <> '{}'::jsonb)
    or (kind = 'asociacion' and customer_id is not null and payload->>'op' in ('add', 'remove')
        and payload ? 'company' and payload ? 'other')));

drop policy if exists "customer requests no asociacion directa" on erp.customer_requests;
create policy "customer requests no asociacion directa" on erp.customer_requests as restrictive for insert to authenticated
  with check (kind <> 'asociacion');

-- ---------------------------------------------------------------------------
-- 2. Las tiendas de quien mira
-- ---------------------------------------------------------------------------
create or replace function erp.mis_tiendas_de_clientes()
  returns text[] language sql stable security definer set search_path = public, erp as $$
  select coalesce((
    select array_remove(array(
      select distinct x from unnest(
        array[erp.customers_codigo_de_tienda(p.store)]
        || coalesce(array(select erp.customers_codigo_de_tienda(v) from unnest(coalesce(p.visible_stores, '{}')) v), '{}')
      ) x where x is not null), null)
    from public.profiles p where p.id = auth.uid()
  ), '{}');
$$;

create or replace function erp.empresa_en_mis_tiendas(p_company uuid)
  returns boolean language sql stable security definer set search_path = public, erp as $$
  select erp.es_admin_de_clientes()
      or exists (select 1 from erp.customers c
                  where c.company_id = p_company
                    and upper(btrim(coalesce(c.store, ''))) = any (erp.mis_tiendas_de_clientes()));
$$;

-- ---------------------------------------------------------------------------
-- 3. El buscador
-- ---------------------------------------------------------------------------
create or replace function erp.busca_clientes_para_asociar(p_q text)
  returns table (company_id uuid, account text, stores text[], crm_type text)
  language sql stable security definer set search_path = public, erp as $$
  with yo as (select erp.es_admin_de_clientes() as admin, erp.mis_tiendas_de_clientes() as tiendas),
  casan as (
    select distinct c.company_id
      from erp.customers c, yo
     where public.has_customers_access()
       and erp.customers_can_write()
       and length(btrim(coalesce(p_q, ''))) >= 2
       and c.company_id is not null
       and c.archived_at is null
       and (c.account ilike '%' || btrim(p_q) || '%'
            or coalesce(c.unified_account, '') ilike '%' || btrim(p_q) || '%'
            or coalesce(c.contact_name, '') ilike '%' || btrim(p_q) || '%'
            or coalesce(c.phone, '') ilike '%' || btrim(p_q) || '%')
       and (yo.admin or exists (select 1 from erp.customers m
                                 where m.company_id = c.company_id
                                   and upper(btrim(coalesce(m.store, ''))) = any (yo.tiendas)))
  )
  select k.company_id,
         (array_agg(c.account order by c.id))[1],
         array_agg(distinct c.store) filter (where c.store is not null),
         (array_agg(coalesce(nullif(btrim(c.crm_type_group), ''), nullif(btrim(c.crm_type_store), '')) order by c.id)
            filter (where coalesce(nullif(btrim(c.crm_type_group), ''), nullif(btrim(c.crm_type_store), '')) is not null))[1]
    from casan k join erp.customers c on c.company_id = k.company_id and c.archived_at is null
   group by k.company_id
   order by 2
   limit 30;
$$;

-- ---------------------------------------------------------------------------
-- 4. Proponer (o, el admin, aplicar)
-- ---------------------------------------------------------------------------
create or replace function erp.propone_asociaciones(p_customer bigint, p_add uuid[] default '{}', p_remove bigint[] default '{}', p_nota text default null)
  returns jsonb language plpgsql security definer set search_path = pg_catalog, public, erp, pg_temp as $$
declare
  fila erp.customers%rowtype;
  admin boolean := erp.es_admin_de_clientes();
  otra uuid;
  par erp.customer_associations%rowtype;
  nombre text;
  aplicadas int := 0;
  pedidas bigint[] := '{}';
  nuevo bigint;
  par_id bigint;
  nota text := nullif(btrim(coalesce(p_nota, '')), '');
begin
  if not (public.has_customers_access() and erp.customers_can_write()) then
    raise exception 'You can''t change associations' using errcode = '42501';
  end if;
  select * into fila from erp.customers where id = p_customer;
  if not found or not erp.customers_ve_la_fila(fila.rep_id, fila.created_by, fila.store) then
    raise exception 'Customer not found' using errcode = 'P0002';
  end if;
  if fila.company_id is null then raise exception 'Customer has no company' using errcode = '22023'; end if;

  foreach otra in array coalesce(p_add, '{}') loop
    if otra is null or otra = fila.company_id then raise exception 'A customer can''t be associated with itself' using errcode = '22023'; end if;
    if not exists (select 1 from erp.customers c where c.company_id = otra) then raise exception 'Customer not found' using errcode = 'P0002'; end if;
    if not admin and not erp.empresa_en_mis_tiendas(otra) then
      raise exception 'You can only associate customers of your store(s)' using errcode = '42501';
    end if;
    if exists (select 1 from erp.customer_associations x
                where least(x.company_a, x.company_b) = least(fila.company_id, otra)
                  and greatest(x.company_a, x.company_b) = greatest(fila.company_id, otra)) then
      raise exception 'They are already associated' using errcode = '23505';
    end if;
    if exists (select 1 from erp.customer_requests r
                where r.kind = 'asociacion' and r.status in ('pending', 'review') and r.payload->>'op' = 'add'
                  and least((r.payload->>'company')::uuid, (r.payload->>'other')::uuid) = least(fila.company_id, otra)
                  and greatest((r.payload->>'company')::uuid, (r.payload->>'other')::uuid) = greatest(fila.company_id, otra)) then
      raise exception 'That association is already waiting for approval' using errcode = '23505';
    end if;
    if admin then
      insert into erp.customer_associations (company_a, company_b) values (fila.company_id, otra);
      aplicadas := aplicadas + 1;
    else
      select c.account into nombre from erp.customers c where c.company_id = otra order by (c.archived_at is not null), c.id limit 1;
      insert into erp.customer_requests (requested_by, stores, kind, customer_id, payload, note)
        values (auth.uid(), array[coalesce(fila.store, '?')], 'asociacion', fila.id,
                jsonb_build_object('op', 'add', 'company', fila.company_id, 'other', otra, 'account', fila.account, 'associated_customer', nombre),
                nota)
        returning id into nuevo;
      pedidas := pedidas || nuevo;
    end if;
  end loop;

  foreach par_id in array coalesce(p_remove, '{}') loop
    select * into par from erp.customer_associations where id = par_id;
    if not found or fila.company_id not in (par.company_a, par.company_b) then
      raise exception 'Association not found' using errcode = 'P0002';
    end if;
    otra := case when par.company_a = fila.company_id then par.company_b else par.company_a end;
    if admin then
      delete from erp.customer_associations where id = par.id;
      aplicadas := aplicadas + 1;
    else
      if exists (select 1 from erp.customer_requests r
                  where r.kind = 'asociacion' and r.status in ('pending', 'review') and r.payload->>'op' = 'remove'
                    and least((r.payload->>'company')::uuid, (r.payload->>'other')::uuid) = least(fila.company_id, otra)
                    and greatest((r.payload->>'company')::uuid, (r.payload->>'other')::uuid) = greatest(fila.company_id, otra)) then
        raise exception 'That removal is already waiting for approval' using errcode = '23505';
      end if;
      select c.account into nombre from erp.customers c where c.company_id = otra order by (c.archived_at is not null), c.id limit 1;
      insert into erp.customer_requests (requested_by, stores, kind, customer_id, payload, note)
        values (auth.uid(), array[coalesce(fila.store, '?')], 'asociacion', fila.id,
                jsonb_build_object('op', 'remove', 'company', fila.company_id, 'other', otra, 'account', fila.account, 'associated_customer', nombre),
                nota)
        returning id into nuevo;
      pedidas := pedidas || nuevo;
    end if;
  end loop;

  return jsonb_build_object('applied', aplicadas, 'requests', to_jsonb(pedidas));
end $$;

-- ---------------------------------------------------------------------------
-- 5. Aprobar; el historial con la solicitud
-- ---------------------------------------------------------------------------
create or replace function erp.aprueba_asociacion(p_id bigint, p_nota text default null)
  returns void language plpgsql security definer set search_path = pg_catalog, public, erp, pg_temp as $$
declare
  s erp.customer_requests%rowtype;
  a uuid;
  b uuid;
begin
  if not erp.es_admin_de_clientes() then raise exception 'solo el admin aprueba asociaciones' using errcode = '42501'; end if;
  select * into s from erp.customer_requests where id = p_id for update;
  if not found then raise exception 'solicitud % no existe', p_id; end if;
  if s.kind <> 'asociacion' then raise exception 'la solicitud % no es una asociacion', p_id; end if;
  if s.status not in ('pending', 'review') then raise exception 'la solicitud % ya esta %', p_id, s.status; end if;
  a := (s.payload->>'company')::uuid;
  b := (s.payload->>'other')::uuid;
  perform set_config('rtg.solicitud', p_id::text, true);
  perform set_config('rtg.solicitante', coalesce(s.requested_by::text, ''), true);
  perform set_config('rtg.nota', coalesce(s.note, ''), true);
  perform set_config('rtg.decision', coalesce(p_nota, ''), true);
  if s.payload->>'op' = 'add' then
    if not exists (select 1 from erp.customer_associations x
                    where least(x.company_a, x.company_b) = least(a, b) and greatest(x.company_a, x.company_b) = greatest(a, b)) then
      insert into erp.customer_associations (company_a, company_b) values (a, b);
    end if;
  else
    delete from erp.customer_associations x
     where least(x.company_a, x.company_b) = least(a, b) and greatest(x.company_a, x.company_b) = greatest(a, b);
  end if;
  perform set_config('rtg.solicitud', '', true);
  perform set_config('rtg.solicitante', '', true);
  perform set_config('rtg.nota', '', true);
  perform set_config('rtg.decision', '', true);
  update erp.customer_requests set status = 'approved', decided_by = auth.uid(), decided_at = now(),
    decision_note = nullif(btrim(coalesce(p_nota, '')), '') where id = p_id;
end $$;

create or replace function erp.customer_associations_historial()
  returns trigger language plpgsql security definer set search_path = pg_catalog, public, erp, pg_temp as $$
declare
  r erp.customer_associations;
  v_kind text;
  nombre_a text;
  nombre_b text;
  v_req bigint := nullif(current_setting('rtg.solicitud', true), '')::bigint;
  v_requested uuid := nullif(current_setting('rtg.solicitante', true), '')::uuid;
  v_nota text := nullif(current_setting('rtg.nota', true), '');
  v_decision text := nullif(current_setting('rtg.decision', true), '');
begin
  -- Lo que hace el juntar (249, 5) no es una decisión de nadie: no se apunta.
  if coalesce(current_setting('rtg.asociacion_al_juntar', true), '') = '1' then return null; end if;
  if tg_op = 'INSERT' then r := NEW; v_kind := 'associate'; else r := OLD; v_kind := 'dissociate'; end if;
  select c.account into nombre_a from erp.customers c where c.company_id = r.company_a order by (c.archived_at is not null), c.id limit 1;
  select c.account into nombre_b from erp.customers c where c.company_id = r.company_b order by (c.archived_at is not null), c.id limit 1;
  insert into erp.customer_history (customer_id, by, kind, after, note, request_id, requested_by, decision_note)
    select c.id, auth.uid(), v_kind, jsonb_build_object('associated_customer', nombre_b, 'associated_company', r.company_b),
           v_nota, v_req, v_requested, v_decision
      from erp.customers c where c.company_id = r.company_a;
  insert into erp.customer_history (customer_id, by, kind, after, note, request_id, requested_by, decision_note)
    select c.id, auth.uid(), v_kind, jsonb_build_object('associated_customer', nombre_a, 'associated_company', r.company_a),
           v_nota, v_req, v_requested, v_decision
      from erp.customers c where c.company_id = r.company_b;
  return null;
end $$;

-- Las funciones de la 242: un alta no se aprueba ni se corrige si es una asociación; rechazarla la apunta en el historial.
do $re$
declare
  f text;
  def text;
  viejo text := 'if s.status not in (''pending'', ''review'') then raise exception ''la solicitud % ya esta %'', p_id, s.status; end if;';
  nuevo text := 'if coalesce(s.kind, ''alta'') = ''asociacion'' then raise exception ''la solicitud % es una asociacion: usa erp.aprueba_asociacion'', p_id; end if; ' || viejo;
begin
  foreach f in array array['erp.aprueba_solicitud_de_cliente(bigint)', 'erp.corrige_solicitud_de_cliente(bigint, jsonb)'] loop
    def := pg_get_functiondef(f::regprocedure);
    if position('''asociacion''' in def) > 0 then continue; end if;
    if position(viejo in def) = 0 then raise exception '250: % no tiene la comprobacion de estado esperada', f; end if;
    execute replace(def, viejo, nuevo);
  end loop;

  def := pg_get_functiondef('erp.rechaza_solicitud_de_cliente(bigint, text)'::regprocedure);
  if position('''asociacion''' in def) = 0 then
    if position('if s.kind = ''edicion'' and s.customer_id is not null then' in def) = 0 then
      raise exception '250: rechaza_solicitud_de_cliente no tiene el historial esperado';
    end if;
    execute replace(def, 'if s.kind = ''edicion'' and s.customer_id is not null then',
                         'if s.kind in (''edicion'', ''asociacion'') and s.customer_id is not null then');
  end if;

  -- 7. Los avisos (243).
  def := pg_get_functiondef('erp.avisa_solicitud_de_cliente()'::regprocedure);
  if position('''asociacion''' in def) = 0 then
    foreach f in array array[
      'case when clase = ''edicion'' then ''📝 New edit request: ''',
      'case when clase = ''edicion'' then ''📝 Nueva solicitud de edición: ''',
      'case when clase = ''edicion'' then ''✅ Edit to ''',
      'case when clase = ''edicion'' then ''✅ Edición de ''',
      'if clase = ''edicion'' and NEW.customer_id is not null then'
    ] loop
      if position(f in def) = 0 then raise exception '250: el aviso de la 243 no tiene «%»', f; end if;
    end loop;
    def := replace(def, 'case when clase = ''edicion'' then ''📝 New edit request: ''',
                        'case when clase = ''asociacion'' then ''🤝 New association request: '' when clase = ''edicion'' then ''📝 New edit request: ''');
    def := replace(def, 'case when clase = ''edicion'' then ''📝 Nueva solicitud de edición: ''',
                        'case when clase = ''asociacion'' then ''🤝 Nueva solicitud de asociación: '' when clase = ''edicion'' then ''📝 Nueva solicitud de edición: ''');
    def := replace(def, 'case when clase = ''edicion'' then ''✅ Edit to ''',
                        'case when clase = ''asociacion'' then ''✅ Association for '' || cuenta || '' approved'' when clase = ''edicion'' then ''✅ Edit to ''');
    def := replace(def, 'case when clase = ''edicion'' then ''✅ Edición de ''',
                        'case when clase = ''asociacion'' then ''✅ Asociación de '' || cuenta || '' aprobada'' when clase = ''edicion'' then ''✅ Edición de ''');
    def := replace(def, 'if clase = ''edicion'' and NEW.customer_id is not null then',
                        'if clase in (''edicion'', ''asociacion'') and NEW.customer_id is not null then');
    execute def;
  end if;
end $re$;

-- ---------------------------------------------------------------------------
-- 6. Las propuestas abiertas de una empresa
-- ---------------------------------------------------------------------------
create or replace function erp.asociaciones_pendientes(p_company uuid)
  returns table (id bigint, op text, company_id uuid, account text, status text, requested_by uuid, created_at timestamptz)
  language sql stable security definer set search_path = pg_catalog, public, erp, pg_temp as $$
  select r.id, r.payload->>'op',
         case when (r.payload->>'company')::uuid = p_company then (r.payload->>'other')::uuid else (r.payload->>'company')::uuid end,
         case when (r.payload->>'company')::uuid = p_company then r.payload->>'associated_customer' else r.payload->>'account' end,
         r.status, r.requested_by, r.created_at
    from erp.customer_requests r
   where public.has_customers_access()
     and exists (select 1 from erp.customers c
                  where c.company_id = p_company and erp.customers_ve_la_fila(c.rep_id, c.created_by, c.store))
     and r.kind = 'asociacion' and r.status in ('pending', 'review')
     and p_company in ((r.payload->>'company')::uuid, (r.payload->>'other')::uuid)
   order by r.created_at, r.id;
$$;

revoke all on function erp.mis_tiendas_de_clientes() from public, anon;
revoke all on function erp.empresa_en_mis_tiendas(uuid) from public, anon;
revoke all on function erp.busca_clientes_para_asociar(text) from public, anon;
revoke all on function erp.propone_asociaciones(bigint, uuid[], bigint[], text) from public, anon;
revoke all on function erp.aprueba_asociacion(bigint, text) from public, anon;
revoke all on function erp.asociaciones_pendientes(uuid) from public, anon;
grant execute on function erp.mis_tiendas_de_clientes() to authenticated;
grant execute on function erp.empresa_en_mis_tiendas(uuid) to authenticated;
grant execute on function erp.busca_clientes_para_asociar(text) to authenticated;
grant execute on function erp.propone_asociaciones(bigint, uuid[], bigint[], text) to authenticated;
grant execute on function erp.aprueba_asociacion(bigint, text) to authenticated;
grant execute on function erp.asociaciones_pendientes(uuid) to authenticated;

-- ===========================================================================
-- Autocomprobacion (mira el catalogo)
-- ===========================================================================
do $chk$
declare f text;
begin
  if not exists (select 1 from pg_constraint where conname = 'customer_requests_kind' and pg_get_constraintdef(oid) like '%asociacion%') then
    raise exception '250: customer_requests_kind no admite asociacion';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'erp' and tablename = 'customer_requests' and policyname = 'customer requests no asociacion directa') then
    raise exception '250: falta la politica que cierra el insert directo';
  end if;
  foreach f in array array['erp.busca_clientes_para_asociar(text)', 'erp.propone_asociaciones(bigint, uuid[], bigint[], text)', 'erp.aprueba_asociacion(bigint, text)', 'erp.asociaciones_pendientes(uuid)'] loop
    if not (select prosecdef from pg_proc where oid = f::regprocedure) then raise exception '250: % no es security definer', f; end if;
    if has_function_privilege('anon', f, 'execute') then raise exception '250: anon ejecuta %', f; end if;
  end loop;
  if position('empresa_en_mis_tiendas' in pg_get_functiondef('erp.propone_asociaciones(bigint, uuid[], bigint[], text)'::regprocedure)) = 0 then
    raise exception '250: propone_asociaciones no mira las tiendas';
  end if;
  if position('''asociacion''' in pg_get_functiondef('erp.aprueba_solicitud_de_cliente(bigint)'::regprocedure)) = 0 then
    raise exception '250: aprueba_solicitud_de_cliente no rechaza asociaciones';
  end if;
  if position('''asociacion''' in pg_get_functiondef('erp.avisa_solicitud_de_cliente()'::regprocedure)) = 0 then
    raise exception '250: el aviso no nombra las asociaciones';
  end if;
end $chk$;
-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('250_asociaciones_con_aprobacion.sql', '589024ff99913b241215c67e65b8bc58932ddd9d5441f3c6ab08cd3a2b5d9c01') on conflict (name) do nothing;
