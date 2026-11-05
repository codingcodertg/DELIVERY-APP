-- 245: Clientes — el historial del cliente: las ordenes y cotizaciones unidas a su fila, y la actividad completa
-- (2026-11-05).
--
-- El dueño: «todo cambio, modificacion y hasta la creacion tiene que quedar en un historial de ACTIVIDAD, pero del
-- cliente. El historial PRINCIPAL va a ser de las entregas que se hicieron con ese cliente. Conecta Deliveries con
-- Customers, y hasta con el Quote Builder».
--
-- Que habia:
--  * `erp.customer_history` (221) con su disparador `customers_zz_historial`: alta, cada UPDATE (diff antes/despues),
--    archivar/desarchivar, y la edicion aprobada (rtg.solicitud); el rechazo lo escribe erp.rechaza_solicitud_de_cliente.
--    Como TODO cambio a erp.customers pasa por el disparador, las ediciones directas del admin, la asignacion de vendedor
--    en bloque y lo que hace erp.junta_clientes ya quedaban... pero como 'edit'/'archive' sin decir que eran.
--  * Lo que NO quedaba: «Revisar» (242) y la correccion del admin sobre una solicitud de edicion (242) no escribian nada;
--    el juntar no se distinguia; y las filas creadas ANTES de la 221 no tienen su 'create'.
--  * Las ordenes (`public.deliveries.account`) y las cotizaciones (`public.estimator_quotes.customer->>'company'`) solo
--    guardaban el NOMBRE de la cuenta, como texto. Ninguna apuntaba a una fila de Clientes.
--
-- Que hace:
--  1. erp.clave_de_cuenta(text) y erp.clave_de_tienda(text): las gemelas de `claveDeCuenta`/`claveDeTienda`
--     (src/lib/customers/tratos.ts). Nombre sin acentos, mayusculas, puntuacion ni sufijos (LLC, INC, CO, CORP...);
--     tienda como codigo (Entregas guarda «RDZ Brownsville», Clientes «BRO»).
--  2. erp.cliente_de_la_cuenta(cuenta, tienda): la fila VIVA (sin archivar) cuyo nombre es igual: la de la misma tienda
--     si hay exactamente una; si en esa tienda no hay ninguna, la unica de todas si hay exactamente una; si no, null.
--  3. `deliveries.customer_id` y `estimator_quotes.customer_id` (bigint, FK a erp.customers, on delete set null), con
--     disparadores que los ponen al crear y al cambiar la cuenta/tienda (Entregas: la cuenta elegida en el formulario;
--     Quote Builder: el cliente elegido en el buscador viaja en customer->>'customer_id' y manda; si no, el nombre de
--     la empresa). Los disparadores van con «zz» para correr DESPUES de los guards de cada tabla.
--  4. El relleno: solo coincidencias exactas por esa regla; lo ambiguo, lo archivado y las cuentas en blanco quedan null.
--     Con session_replication_role = replica, como la 177: un UPDATE masivo no debe pasar por los guards.
--  5. La actividad: clases nuevas 'merge', 'review', 'corrected' y 'rep' en customer_history; el disparador de la 221
--     marca 'merge' dentro de erp.junta_clientes (que ahora es un envoltorio que pone rtg.junta) y 'rep' cuando solo
--     cambia el vendedor; un disparador en customer_requests escribe «Revisar» y la correccion; y cada fila sin su
--     'create' recibe uno (con su fecha y autor, sin valores: no se sabe con que datos nacio).
--
-- Lo que ve cada uno: la pantalla lee deliveries y estimator_quotes con la sesion de quien mira, asi que su RLS decide
-- (nadie ve en Clientes una orden o cotizacion que no veria en su app). No se toca ninguna politica.
--
-- Sin begin/commit propios: el ensayo con ROLLBACK envuelve el fichero.
-- Para deshacer: drop trigger deliveries_zzz_cliente on public.deliveries; drop trigger estimator_quotes_zzz_cliente on
-- public.estimator_quotes; drop trigger customer_requests_zz_historial on erp.customer_requests; alter table
-- public.deliveries drop column customer_id; alter table public.estimator_quotes drop column customer_id; drop function
-- erp.junta_clientes(bigint, bigint); alter function erp.junta_clientes_189(bigint, bigint) rename to junta_clientes
-- (y volver a dar execute a authenticated); volver erp.customers_historial() y customer_history_kind a la 221; borrar
-- las filas 'create' con note = '245: alta anterior al historial'; drop de las funciones nuevas; borrar la fila del registro.

do $pre$
begin
  if to_regclass('erp.customer_history') is null then raise exception '245: falta erp.customer_history; aplica primero la 221'; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'erp' and table_name = 'customer_requests' and column_name = 'review_note') then
    raise exception '245: falta customer_requests.review_note; aplica primero la 242';
  end if;
end $pre$;

-- ---------------------------------------------------------------------------
-- 1. Las claves
-- ---------------------------------------------------------------------------
create or replace function erp.clave_de_cuenta(p text)
  returns text language sql immutable parallel safe set search_path = pg_catalog as $$
  select coalesce(string_agg(x.t, ' ' order by x.i), '')
    from regexp_split_to_table(
           regexp_replace(
             replace(lower(translate(coalesce(p, ''),
               'ÀÁÂÃÄÅàáâãäåÈÉÊËèéêëÌÍÎÏìíîïÒÓÔÕÖòóôõöÙÚÛÜùúûüÑñÇçÝýÿ',
               'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuNnCcYyy')), '&', ' and '),
             '[^a-z0-9 ]', ' ', 'g'),
           '[[:space:]]+') with ordinality as x(t, i)
   where x.t <> '' and x.t <> all (array['llc', 'inc', 'co', 'corp', 'ltd', 'company', 'the', 'lp', 'pllc']);
$$;

create or replace function erp.clave_de_tienda(p text)
  returns text language sql immutable parallel safe set search_path = pg_catalog as $$
  select case u
           when 'RDZ BROWNSVILLE' then 'BRO' when 'RDZ EDINBURG' then 'EDG' when 'RDZ MCALLEN' then 'MCA'
           when 'RDZ PHARR' then 'PHR' when 'RDZ WESLACO' then 'WES' when 'RDZ MISSION' then 'MIS'
           else u end
    from (select regexp_replace(upper(btrim(coalesce(p, ''))), '[[:space:]]+', ' ', 'g') as u) s;
$$;

create index if not exists customers_por_clave_de_cuenta on erp.customers (erp.clave_de_cuenta(account)) where archived_at is null;

-- ---------------------------------------------------------------------------
-- 2. La fila de una cuenta
-- ---------------------------------------------------------------------------
create or replace function erp.cliente_de_la_cuenta(p_cuenta text, p_tienda text)
  returns bigint language plpgsql stable security definer set search_path = pg_catalog, erp, pg_temp as $$
declare
  k text := erp.clave_de_cuenta(p_cuenta);
  t text := erp.clave_de_tienda(p_tienda);
  n_tienda int;
  id_tienda bigint;
  n_todas int;
  id_todas bigint;
begin
  if k = '' then return null; end if;
  select count(*) filter (where t <> '' and erp.clave_de_tienda(c.store) = t),
         min(c.id) filter (where t <> '' and erp.clave_de_tienda(c.store) = t),
         count(*), min(c.id)
    into n_tienda, id_tienda, n_todas, id_todas
    from erp.customers c
   where c.archived_at is null and erp.clave_de_cuenta(c.account) = k;
  if n_tienda = 1 then return id_tienda; end if;
  if n_tienda > 1 then return null; end if;
  if n_todas = 1 then return id_todas; end if;
  return null;
end $$;
revoke all on function erp.cliente_de_la_cuenta(text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Las columnas y sus disparadores
-- ---------------------------------------------------------------------------
alter table public.deliveries add column if not exists customer_id bigint references erp.customers(id) on delete set null;
create index if not exists deliveries_por_cliente on public.deliveries (customer_id, created_at desc) where customer_id is not null;
alter table public.estimator_quotes add column if not exists customer_id bigint references erp.customers(id) on delete set null;
create index if not exists estimator_quotes_por_cliente on public.estimator_quotes (customer_id, created_at desc) where customer_id is not null;

create or replace function public.deliveries_cliente()
  returns trigger language plpgsql security definer set search_path = pg_catalog, public, erp, pg_temp as $$
begin
  -- Al crear, siempre por la cuenta: una orden copiada de otra no hereda un cliente que ya no es el suyo.
  if tg_op = 'INSERT' then
    NEW.customer_id := erp.cliente_de_la_cuenta(NEW.account, NEW.store);
  elsif (NEW.account is distinct from OLD.account or NEW.store is distinct from OLD.store)
        and NEW.customer_id is not distinct from OLD.customer_id then
    NEW.customer_id := erp.cliente_de_la_cuenta(NEW.account, NEW.store);
  end if;
  return NEW;
end $$;
drop trigger if exists deliveries_zzz_cliente on public.deliveries;
create trigger deliveries_zzz_cliente before insert or update on public.deliveries
  for each row execute function public.deliveries_cliente();

-- La cotizacion: el cliente ELEGIDO (customer->>'customer_id', si existe y esta vivo) manda; si no, el nombre de la
-- empresa en la tienda de la cotizacion. Se recalcula cuando cambia el bloque del cliente o la tienda.
create or replace function public.estimator_quotes_cliente()
  returns trigger language plpgsql security definer set search_path = pg_catalog, public, erp, pg_temp as $$
declare
  elegido bigint;
begin
  if tg_op = 'UPDATE' and NEW.customer is not distinct from OLD.customer and NEW.store is not distinct from OLD.store then
    return NEW;
  end if;
  if coalesce(NEW.customer->>'customer_id', '') ~ '^[0-9]{1,18}$' then
    select c.id into elegido from erp.customers c where c.id = (NEW.customer->>'customer_id')::bigint and c.archived_at is null;
  end if;
  NEW.customer_id := coalesce(elegido, erp.cliente_de_la_cuenta(NEW.customer->>'company', NEW.store));
  return NEW;
end $$;
drop trigger if exists estimator_quotes_zzz_cliente on public.estimator_quotes;
create trigger estimator_quotes_zzz_cliente before insert or update on public.estimator_quotes
  for each row execute function public.estimator_quotes_cliente();

revoke all on function public.deliveries_cliente() from public, anon, authenticated;
revoke all on function public.estimator_quotes_cliente() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. El relleno (solo lo exacto; sin pasar por guards ni disparadores)
-- ---------------------------------------------------------------------------
set local session_replication_role = replica;
update public.deliveries d set customer_id = x.cid
  from (select id, erp.cliente_de_la_cuenta(account, store) as cid from public.deliveries
         where customer_id is null and nullif(btrim(account), '') is not null) x
 where d.id = x.id and x.cid is not null;
update public.estimator_quotes q set customer_id = x.cid
  from (select e.id,
               coalesce((select c.id from erp.customers c
                          where coalesce(e.customer->>'customer_id', '') ~ '^[0-9]{1,18}$'
                            and c.id = (e.customer->>'customer_id')::bigint and c.archived_at is null),
                        erp.cliente_de_la_cuenta(e.customer->>'company', e.store)) as cid
          from public.estimator_quotes e where e.customer_id is null) x
 where q.id = x.id and x.cid is not null;
set local session_replication_role = origin;

-- ---------------------------------------------------------------------------
-- 5. La actividad
-- ---------------------------------------------------------------------------
alter table erp.customer_history drop constraint if exists customer_history_kind;
alter table erp.customer_history add constraint customer_history_kind
  check (kind in ('create', 'edit', 'archive', 'restore', 'approved', 'rejected', 'merge', 'review', 'corrected', 'rep'));

-- 5a. El disparador de la 221, igual salvo: 'merge' dentro de erp.junta_clientes y 'rep' si solo cambia el vendedor.
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
  v_junta text := nullif(current_setting('rtg.junta', true), '');
  v_nota text := nullif(current_setting('rtg.nota', true), '');
begin
  if tg_op = 'INSERT' then
    insert into erp.customer_history (customer_id, by, kind, after, note)
      values (NEW.id, auth.uid(), 'create', to_jsonb(NEW) - 'updated_at' - 'updated_by' - 'created_at' - 'created_by', v_nota);
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
  elsif v_junta is not null then
    v_kind := 'merge';
    v_nota := coalesce(v_nota, 'Juntar #' || replace(v_junta, ',', ' + #'));
  elsif OLD.archived_at is null and NEW.archived_at is not null then v_kind := 'archive';
  elsif OLD.archived_at is not null and NEW.archived_at is null then v_kind := 'restore';
  elsif (select array_agg(x order by x) from jsonb_object_keys(v_after) x) = array['rep_id'] then v_kind := 'rep';
  else v_kind := 'edit';
  end if;
  insert into erp.customer_history (customer_id, by, kind, before, after, note, request_id, requested_by, decision_note)
    values (NEW.id, auth.uid(), v_kind, v_before, v_after, v_nota, v_req, v_requested,
            nullif(current_setting('rtg.decision', true), ''));
  return NEW;
end $$;

-- 5b. erp.junta_clientes: la de la 189 pasa a llamarse junta_clientes_189 y la de siempre la envuelve poniendo
-- rtg.junta, para que el disparador sepa que lo que cambia es un juntar. Misma firma: la pantalla no cambia.
do $ren$
begin
  if to_regprocedure('erp.junta_clientes_189(bigint, bigint)') is null then
    alter function erp.junta_clientes(bigint, bigint) rename to junta_clientes_189;
  end if;
end $ren$;
revoke all on function erp.junta_clientes_189(bigint, bigint) from public, anon, authenticated;

create or replace function erp.junta_clientes(p_a bigint, p_b bigint)
  returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  destino uuid;
begin
  perform set_config('rtg.junta', coalesce(p_a::text, '?') || ',' || coalesce(p_b::text, '?'), true);
  destino := erp.junta_clientes_189(p_a, p_b);
  perform set_config('rtg.junta', '', true);
  return destino;
end $$;
revoke execute on function erp.junta_clientes(bigint, bigint) from public, anon;
grant execute on function erp.junta_clientes(bigint, bigint) to authenticated;

-- 5c. «Revisar» y la correccion de una solicitud de edicion (242) quedan en el historial de su fila.
create or replace function erp.customer_requests_historial()
  returns trigger language plpgsql security definer set search_path = public, erp, pg_temp as $$
begin
  if NEW.kind <> 'edicion' or NEW.customer_id is null then return NEW; end if;
  if NEW.status = 'review' and (OLD.status is distinct from 'review' or NEW.review_note is distinct from OLD.review_note) then
    insert into erp.customer_history (customer_id, by, kind, before, after, note, request_id, requested_by, decision_note)
      values (NEW.customer_id, auth.uid(), 'review', NEW.before, NEW.payload, NEW.note, NEW.id, NEW.requested_by, NEW.review_note);
  end if;
  if NEW.payload is distinct from OLD.payload and NEW.status in ('pending', 'review') then
    insert into erp.customer_history (customer_id, by, kind, before, after, note, request_id, requested_by)
      values (NEW.customer_id, auth.uid(), 'corrected', OLD.payload, NEW.payload, NEW.note, NEW.id, NEW.requested_by);
  end if;
  return NEW;
end $$;
drop trigger if exists customer_requests_zz_historial on erp.customer_requests;
create trigger customer_requests_zz_historial after update on erp.customer_requests
  for each row execute function erp.customer_requests_historial();
revoke all on function erp.customer_requests_historial() from public, anon, authenticated;

-- 5d. Las filas de antes de la 221: su 'create', con la fecha y el autor que guarda la fila, sin valores.
insert into erp.customer_history (customer_id, at, by, kind, after, note)
  select c.id, c.created_at,
         case when exists (select 1 from public.profiles p where p.id = c.created_by) then c.created_by end,
         'create', null, '245: alta anterior al historial'
    from erp.customers c
   where not exists (select 1 from erp.customer_history h where h.customer_id = c.id and h.kind = 'create');

-- ===========================================================================
-- Autocomprobacion (mira el catalogo y las claves)
-- ===========================================================================
do $chk$
begin
  if erp.clave_de_cuenta('AIDEN JETT, LLC') <> erp.clave_de_cuenta('aiden  jett') then raise exception '245: la clave no quita LLC/puntuacion'; end if;
  if erp.clave_de_cuenta('Peña & Co.') <> 'pena and' then raise exception '245: la clave no quita acentos/& (%)', erp.clave_de_cuenta('Peña & Co.'); end if;
  if erp.clave_de_tienda('RDZ Brownsville') <> 'BRO' or erp.clave_de_tienda(' bro ') <> 'BRO' then raise exception '245: clave de tienda'; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'deliveries' and column_name = 'customer_id') then raise exception '245: falta deliveries.customer_id'; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'estimator_quotes' and column_name = 'customer_id') then raise exception '245: falta estimator_quotes.customer_id'; end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.deliveries'::regclass and tgname = 'deliveries_zzz_cliente') then raise exception '245: falta el disparador de deliveries'; end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.estimator_quotes'::regclass and tgname = 'estimator_quotes_zzz_cliente') then raise exception '245: falta el disparador de estimator_quotes'; end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'erp.customer_requests'::regclass and tgname = 'customer_requests_zz_historial') then raise exception '245: falta el disparador de solicitudes'; end if;
  if position('rtg.junta' in pg_get_functiondef('erp.customers_historial()'::regprocedure)) = 0 then raise exception '245: el historial no mira rtg.junta'; end if;
  if position('junta_clientes_189' in pg_get_functiondef('erp.junta_clientes(bigint, bigint)'::regprocedure)) = 0 then raise exception '245: junta_clientes no envuelve a la 189'; end if;
  if has_function_privilege('authenticated', 'erp.junta_clientes_189(bigint, bigint)', 'execute') then raise exception '245: authenticated no debe llamar a junta_clientes_189'; end if;
  if has_function_privilege('anon', 'erp.junta_clientes(bigint, bigint)', 'execute') then raise exception '245: anon ejecuta junta_clientes'; end if;
  if exists (select 1 from erp.customers c where not exists (select 1 from erp.customer_history h where h.customer_id = c.id and h.kind = 'create')) then
    raise exception '245: quedan filas sin su create';
  end if;
end $chk$;
-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('245_historial_del_cliente.sql', '2934737e6ded8ae52fae3b1c9100916ee34d00f44079ed335220443a913a2aa2') on conflict (name) do nothing;
