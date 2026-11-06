-- 265: Warehouse Ops: niveles por persona (profiles.warehouse_ops_role) y secciones permitidas (2026-11-06).
--
-- El dueno (2026-11-06): «ahorita vamos a hacer permisos para el warehouse app. francis tiene acceso mismo que admin a
-- todo, y los de warehouse por ahora solo veran la parte de scrap solamente». Y despues: «activaselos» y
-- «francis solo pharr»: Francis hace todo lo que hace un admin, pero SOLO en su tienda, como en el resto del hub.
--
-- Hasta hoy la app no tenia escalafon: quien tenia la casilla 'warehouse_ops' llenaba los siete reportes, y «admin»
-- era profiles.role = 'admin' (admin de TODO el hub). Esto anade un rol dentro de la app, como recruiting_role (055),
-- erp_role (101) o customers_role (241):
--
--   admin        todo, en todas las tiendas (lo que ve un admin del hub), sin tocar su rol ni sus tiendas del hub.
--   store_admin  lo mismo que admin, pero solo en SUS tiendas (profiles.store / visible_stores): ve, corrige y
--                registra reportes de esas tiendas y de ninguna otra. La tienda NO se escribe aqui: sale de su
--                asignacion del hub, asi que cambiarle la tienda en Usuarios lo mueve tambien en esta app.
--   full         los siete reportes; ve segun su rol del hub, exactamente como antes de esta migracion.
--   scrap_only   solo la merma: llena merma y ve SUS reportes de merma. Nada mas.
--   (null)       manda el rol del hub: 'warehouse' = scrap_only; los demas = full.
-- El admin del hub es 'admin' siempre. Sin la casilla del modulo no hay nivel (quitar la casilla lo deja sin nada).
--
-- Que hace:
--   1. profiles.warehouse_ops_role + su check. Solo un admin del hub lo cambia (guardia de profiles, 241 + una linea).
--   2. public.warehouse_ops_level_of(uuid) / warehouse_ops_level(): el nivel efectivo.
--      public.warehouse_ops_kinds_of(text): los tipos de reporte que abre cada nivel. ES EL UNICO SITIO que dice que
--      scrap_only es solo 'scrap': para abrirle otra seccion se reemplaza esa funcion (y SECCIONES en
--      src/lib/almacen-ops/nivel.ts).
--   3. public.warehouse_ops_can_see (RLS de warehouse_reports, 247) con niveles.
--      public.warehouse_ops_can_manage(tienda): quien corrige una merma; la usan las dos funciones de correccion de
--      la 263, que se vuelven a crear con SOLO la puerta cambiada.
--   4. Guardia de escritura: un trigger BEFORE INSERT en warehouse_reports rechaza un tipo que el nivel de quien
--      llama no abre, y al store_admin un reporte de una tienda que no es suya. Va en la tabla y no dentro de warehouse_ops_file_report para que una migracion futura que
--      reescriba esa funcion no pueda perder la puerta.
--   5. Activa a la gente real:
--        - Francis Lestarpe (usuario 'flestarpe'): casilla + nivel 'store_admin' (su tienda del hub: RDZ Pharr).
--        - Todo perfil con role = 'warehouse' que no se haya ido: casilla + nivel 'scrap_only'.
--      No crea cuentas.
--
-- ORDEN: se puede aplicar antes o despues de desplegar la pantalla nueva.
--   - Pantalla vieja + esta migracion: el personal de almacen ve las siete tarjetas, pero la base le rechaza las seis
--     que no son merma al enviar (error visible, nada se guarda). Francis ya ve y corrige todo lo de su tienda.
--   - Pantalla nueva sin esta migracion: lee warehouse_ops_role con tolerancia (si la columna no existe, manda el rol
--     del hub) y no rompe; pero nadie de almacen tiene aun la casilla, Francis sigue como gerente de su tienda, y el
--     selector de nivel en Usuarios avisa que no pudo guardar.
--   Lo corto: aplicarla justo despues del merge, como siempre.
--
-- Sin begin/commit propios. Para deshacer:
--   drop trigger if exists warehouse_reports_guard_kind on public.warehouse_reports;
--   drop function if exists public.guard_warehouse_report_kind();
--   volver a correr warehouse_ops_can_see de la 247 y las dos funciones de correccion de la 263;
--   drop function if exists public.warehouse_ops_can_manage(text);
--   drop function if exists public.warehouse_ops_level(); drop function if exists public.warehouse_ops_level_of(uuid);
--   drop function if exists public.warehouse_ops_kinds_of(text);
--   el guardia de profiles como en la 241; alter table public.profiles drop column warehouse_ops_role;
--   (y, si se quiere, quitar 'warehouse_ops' de module_access a los perfiles con role = 'warehouse');
--   delete from public.schema_migrations where name = '265_warehouse_ops_niveles.sql';

-- ---------------------------------------------------------------------------
-- 1. La columna y su guardia
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists warehouse_ops_role text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_warehouse_ops_role_check') then
    alter table public.profiles add constraint profiles_warehouse_ops_role_check
      check (warehouse_ops_role is null or warehouse_ops_role in ('admin', 'store_admin', 'full', 'scrap_only'));
  end if;
end $$;

-- El guardia de profiles (241) + warehouse_ops_role: un no-admin no se lo pone a si mismo.
create or replace function public.guard_profile_privileged_columns()
  returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Solo un admin cambia permissions/store/username/erp_role/title/title_color/visible_stores/customers_role/
  -- warehouse_ops_role. Un no-admin editando SU fila puede tocar full_name/avatar_url/active_session_id y nada mas.
  -- Mismo patron que guard_role_change.
  if coalesce(public.current_user_role(), 'sales') <> 'admin'
     and auth.uid() is not null
     and ( NEW.permissions        is distinct from OLD.permissions
        or NEW.store              is distinct from OLD.store
        or NEW.username           is distinct from OLD.username
        or NEW.erp_role           is distinct from OLD.erp_role
        or NEW.title              is distinct from OLD.title
        or NEW.title_color        is distinct from OLD.title_color
        or NEW.visible_stores     is distinct from OLD.visible_stores
        or NEW.customers_role     is distinct from OLD.customers_role
        or NEW.warehouse_ops_role is distinct from OLD.warehouse_ops_role ) then
    raise exception 'Only an admin can change permissions, store, username, erp_role, title, visible_stores, customers_role or warehouse_ops_role';
  end if;
  return NEW;
end $$;

-- ---------------------------------------------------------------------------
-- 2. El nivel efectivo y lo que abre
-- ---------------------------------------------------------------------------
create or replace function public.warehouse_ops_level_of(p_uid uuid)
  returns text language sql stable security definer set search_path = public as $$
  select case
      when p.role = 'admin' then 'admin'
      when not ('warehouse_ops' = any(coalesce(p.module_access, '{}'))) then null
      when p.warehouse_ops_role is not null then p.warehouse_ops_role
      when p.role = 'warehouse' then 'scrap_only'
      else 'full'
    end
  from public.profiles p where p.id = p_uid;
$$;

create or replace function public.warehouse_ops_level()
  returns text language sql stable security definer set search_path = public as $$
  select public.warehouse_ops_level_of(auth.uid());
$$;

-- Los tipos de reporte que abre cada nivel. «Por ahora» scrap_only es solo merma: se amplia AQUI.
create or replace function public.warehouse_ops_kinds_of(p_level text)
  returns text[] language sql immutable set search_path = '' as $$
  select case p_level
    when 'scrap_only' then array['scrap']
    when 'admin' then array['incident', 'zone', 'insubordination', 'safety', 'maintenance', 'positive', 'scrap']
    when 'store_admin' then array['incident', 'zone', 'insubordination', 'safety', 'maintenance', 'positive', 'scrap']
    when 'full' then array['incident', 'zone', 'insubordination', 'safety', 'maintenance', 'positive', 'scrap']
    else array[]::text[]
  end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Quien ve un reporte (la misma regla que src/lib/almacen-ops/visibilidad.ts)
--   - nivel admin: todo. nivel store_admin: todo lo de sus tiendas.
--   - tipos de RR. HH. (zone, insubordination, positive): RR. HH. (recruiting_role admin/manager), y el gerente de
--     tienda (role = 'manager') con nivel full, de ESA tienda. Nadie mas: ni el autor ni el empleado del reporte.
--   - los demas tipos:
--       nivel scrap_only: solo los SUYOS y solo de los tipos que su nivel abre (hoy: merma).
--       nivel full: el autor; y el gerente de tienda o el supervisor de almacen de esa tienda.
--   «Esa tienda» = profiles.store, o una de profiles.visible_stores.
-- ---------------------------------------------------------------------------
create or replace function public.warehouse_ops_can_see(r_kind text, r_store text, r_author uuid)
  returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select
      n.nivel = 'admin'
      or (n.nivel = 'store_admin' and t.mia)
      or (
        r_kind in ('zone', 'insubordination', 'positive')
        and (
          p.recruiting_role in ('admin', 'manager')
          or (n.nivel = 'full' and p.role = 'manager' and t.mia)
        )
      )
      or (
        r_kind not in ('zone', 'insubordination', 'positive')
        and (
          (n.nivel = 'scrap_only' and r_author = p.id and r_kind = any(public.warehouse_ops_kinds_of(n.nivel)))
          or (n.nivel = 'full' and (
            r_author = p.id
            or ((p.role = 'manager' or 'warehouse_ops_supervisor' = any(coalesce(p.permissions, '{}'))) and t.mia)
          ))
        )
      )
    from public.profiles p
      cross join lateral (select coalesce(public.warehouse_ops_level_of(p.id), '') as nivel) n
      cross join lateral (select (p.store = r_store or r_store = any(coalesce(p.visible_stores, '{}'))) is true as mia) t
    where p.id = auth.uid()
  ), false);
$$;

-- Quien corrige una merma de esa tienda (producto: 252; origen y CRMA: 263).
create or replace function public.warehouse_ops_can_manage(r_store text)
  returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select
      n.nivel = 'admin'
      or (n.nivel = 'store_admin' and t.mia)
      or (n.nivel = 'full' and t.mia
          and (p.role = 'manager' or 'warehouse_ops_supervisor' = any(coalesce(p.permissions, '{}'))))
    from public.profiles p
      cross join lateral (select coalesce(public.warehouse_ops_level_of(p.id), '') as nivel) n
      cross join lateral (select (p.store = r_store or r_store = any(coalesce(p.visible_stores, '{}'))) is true as mia) t
    where p.id = auth.uid()
  ), false);
$$;

-- Corregir el producto de una merma (la de la 263; solo cambia la puerta)
create or replace function public.warehouse_ops_edit_scrap_product(
  p_report uuid, p_product_id bigint, p_name text, p_cost numeric
) returns void
  language plpgsql volatile security definer set search_path = public, erp as $$
declare
  yo uuid := auth.uid();
  r record;
  prod record;
  v_nombre text;
begin
  select * into r from public.warehouse_reports where id = p_report and kind = 'scrap';
  if r.id is null then raise exception 'warehouse_ops: reporte desconocido'; end if;
  if yo is null or not public.warehouse_ops_can_manage(r.store) then
    raise exception 'warehouse_ops: solo el gerente de la tienda corrige la merma' using errcode = '42501';
  end if;
  if p_product_id is not null then
    select pp.id, pp.sku, pp.name, pp.cost into prod from erp.products pp where pp.id = p_product_id;
    if prod.id is null then raise exception 'warehouse_ops: producto desconocido'; end if;
    update public.warehouse_reports set product_id = prod.id, product_sku = prod.sku, product_name = prod.name,
        unit_cost = prod.cost, total_loss = public.warehouse_ops_scrap_loss(prod.cost, coalesce(damaged_pieces, case when scrap_type = 'sample' then 0 else total_pieces end), return_type, crma),
        product_not_in_catalog = false, edited_by = yo, edited_at = now()
      where id = p_report;
  else
    v_nombre := left(btrim(coalesce(p_name, '')), 200);
    if length(v_nombre) < 2 then raise exception 'warehouse_ops: falta el producto'; end if;
    if p_cost is not null and (p_cost < 0 or p_cost > 100000) then raise exception 'warehouse_ops: costo no valido'; end if;
    update public.warehouse_reports set product_id = null, product_sku = null, product_name = v_nombre,
        unit_cost = round(p_cost, 2), total_loss = public.warehouse_ops_scrap_loss(round(p_cost, 2), coalesce(damaged_pieces, case when scrap_type = 'sample' then 0 else total_pieces end), return_type, crma),
        product_not_in_catalog = true, edited_by = yo, edited_at = now()
      where id = p_report;
  end if;
end $$;

-- Corregir el origen y el CRMA de una merma (la de la 263; solo cambia la puerta)
create or replace function public.warehouse_ops_edit_scrap_origin(
  p_report uuid, p_return_type text, p_crma text
) returns void
  language plpgsql volatile security definer set search_path = public as $$
declare
  yo uuid := auth.uid();
  r record;
  v_origen text := coalesce(nullif(p_return_type, ''), 'internal');
  v_crma text := nullif(left(btrim(coalesce(p_crma, '')), 100), '');
begin
  select * into r from public.warehouse_reports where id = p_report and kind = 'scrap';
  if r.id is null then raise exception 'warehouse_ops: reporte desconocido'; end if;
  if yo is null or not public.warehouse_ops_can_manage(r.store) then
    raise exception 'warehouse_ops: solo el gerente de la tienda corrige la merma' using errcode = '42501';
  end if;
  if v_origen not in ('internal', 'customer_return') then
    raise exception 'warehouse_ops: origen de la merma no valido';
  end if;
  if v_origen <> 'customer_return' then v_crma := null; end if;
  update public.warehouse_reports set return_type = v_origen, crma = v_crma,
      total_loss = public.warehouse_ops_scrap_loss(unit_cost, coalesce(damaged_pieces, case when scrap_type = 'sample' then 0 else total_pieces end), v_origen, v_crma),
      edited_by = yo, edited_at = now()
    where id = p_report;
end $$;

-- ---------------------------------------------------------------------------
-- 4. El guardia de escritura: nadie registra un tipo que su nivel no abre
--   warehouse_ops_file_report es security definer, pero auth.uid() sigue siendo quien llama. Sin sesion (llave de
--   servicio, SQL a mano) no se mete: ahi no hay a quien preguntarle el nivel.
-- ---------------------------------------------------------------------------
create or replace function public.guard_warehouse_report_kind()
  returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return NEW; end if;
  if not (NEW.kind = any(public.warehouse_ops_kinds_of(public.warehouse_ops_level()))) then
    raise exception 'warehouse_ops: tu nivel no permite este reporte (%)', NEW.kind using errcode = '42501';
  end if;
  -- El admin «solo en sus tiendas» tampoco registra en otra tienda.
  if public.warehouse_ops_level() = 'store_admin' and not exists (
       select 1 from public.profiles p where p.id = auth.uid()
         and (p.store = NEW.store or NEW.store = any(coalesce(p.visible_stores, '{}')))) then
    raise exception 'warehouse_ops: solo puedes registrar reportes de tu tienda (%)', NEW.store using errcode = '42501';
  end if;
  return NEW;
end $$;

drop trigger if exists warehouse_reports_guard_kind on public.warehouse_reports;
create trigger warehouse_reports_guard_kind before insert on public.warehouse_reports
  for each row execute function public.guard_warehouse_report_kind();

revoke all on function public.warehouse_ops_level_of(uuid) from public, anon, authenticated;
revoke all on function public.warehouse_ops_kinds_of(text) from public, anon;
grant execute on function public.warehouse_ops_kinds_of(text) to authenticated;
revoke all on function public.warehouse_ops_level() from public, anon;
grant execute on function public.warehouse_ops_level() to authenticated;
revoke all on function public.warehouse_ops_can_see(text, text, uuid) from public, anon;
grant execute on function public.warehouse_ops_can_see(text, text, uuid) to authenticated;
revoke all on function public.warehouse_ops_can_manage(text) from public, anon;
grant execute on function public.warehouse_ops_can_manage(text) to authenticated;
revoke all on function public.guard_warehouse_report_kind() from public, anon, authenticated;
revoke all on function public.warehouse_ops_edit_scrap_product(uuid, bigint, text, numeric) from public, anon;
grant execute on function public.warehouse_ops_edit_scrap_product(uuid, bigint, text, numeric) to authenticated;
revoke all on function public.warehouse_ops_edit_scrap_origin(uuid, text, text) from public, anon;
grant execute on function public.warehouse_ops_edit_scrap_origin(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Activar a la gente real («activaselos»)
-- ---------------------------------------------------------------------------
-- Francis Lestarpe: admin dentro de Warehouse Ops, SOLO en su tienda («francis solo pharr»). La tienda no se escribe
-- aqui: el nivel 'store_admin' la toma de profiles.store / visible_stores (hoy RDZ Pharr). Su rol del hub (manager) y
-- su tienda NO se tocan: en las demas apps sigue igual.
-- Para abrirle todas las tiendas: warehouse_ops_role = 'admin' (o el selector de nivel en Usuarios).
do $francis$
declare n int;
begin
  select count(*) into n from public.profiles where username = 'flestarpe';
  if n <> 1 then raise exception '265: se esperaba UN perfil con usuario flestarpe (Francis Lestarpe) y hay %', n; end if;
  update public.profiles
     set warehouse_ops_role = 'store_admin',
         module_access = case when 'warehouse_ops' = any(coalesce(module_access, '{}')) then module_access
                              else array_append(coalesce(module_access, '{}'), 'warehouse_ops') end
   where username = 'flestarpe'
     and (warehouse_ops_role is distinct from 'store_admin' or not ('warehouse_ops' = any(coalesce(module_access, '{}'))));
end $francis$;

-- El personal de almacen con cuenta (rol 'warehouse' del hub, sin baja): la casilla y «solo merma».
-- No pisa un nivel que un admin ya haya escrito a mano.
update public.profiles
   set warehouse_ops_role = coalesce(warehouse_ops_role, 'scrap_only'),
       module_access = case when 'warehouse_ops' = any(coalesce(module_access, '{}')) then module_access
                            else array_append(coalesce(module_access, '{}'), 'warehouse_ops') end
 where role = 'warehouse' and left_at is null
   and (warehouse_ops_role is null or not ('warehouse_ops' = any(coalesce(module_access, '{}'))));

-- ===========================================================================
-- Autocomprobacion (mira el catalogo y las filas)
-- ===========================================================================
do $chk$
declare
  g text := pg_get_functiondef('public.guard_profile_privileged_columns()'::regprocedure);
  f text;
  def text;
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'warehouse_ops_role') then
    raise exception '265: falta profiles.warehouse_ops_role';
  end if;
  if position('warehouse_ops_role' in g) = 0 then raise exception '265: el guardia de profiles no protege warehouse_ops_role (seria autoservicio)'; end if;
  if position('customers_role' in g) = 0 or position('visible_stores' in g) = 0 or position('erp_role' in g) = 0 then
    raise exception '265: el guardia de profiles perdio una columna de la 241';
  end if;
  -- Lo que abre cada nivel
  if public.warehouse_ops_kinds_of('scrap_only') is distinct from array['scrap'] then raise exception '265: scrap_only no es solo merma'; end if;
  if cardinality(public.warehouse_ops_kinds_of('admin')) <> 7 or cardinality(public.warehouse_ops_kinds_of('store_admin')) <> 7
     or cardinality(public.warehouse_ops_kinds_of('full')) <> 7 or cardinality(public.warehouse_ops_kinds_of(null)) <> 0
     or cardinality(public.warehouse_ops_kinds_of('otro')) <> 0 then
    raise exception '265: warehouse_ops_kinds_of no abre lo acordado';
  end if;
  -- La gente real
  if (select public.warehouse_ops_level_of(id) from public.profiles where username = 'flestarpe') is distinct from 'store_admin' then
    raise exception '265: Francis no quedo como admin de Warehouse Ops en su tienda';
  end if;
  if (select store is null and coalesce(cardinality(visible_stores), 0) = 0 from public.profiles where username = 'flestarpe') then
    raise exception '265: Francis no tiene tienda asignada: como store_admin no veria nada';
  end if;
  if position('store_admin' in pg_get_functiondef('public.guard_warehouse_report_kind()'::regprocedure)) = 0 then
    raise exception '265: el guardia no limita la tienda del store_admin';
  end if;
  if (select role from public.profiles where username = 'flestarpe') = 'admin' then
    raise exception '265: Francis no debe ser admin del hub';
  end if;
  if exists (select 1 from public.profiles where role = 'warehouse' and left_at is null
               and public.warehouse_ops_level_of(id) is null) then
    raise exception '265: queda personal de almacen sin Warehouse Ops';
  end if;
  if exists (select 1 from public.profiles where role = 'admin' and public.warehouse_ops_level_of(id) is distinct from 'admin') then
    raise exception '265: un admin del hub dejo de ser admin de Warehouse Ops';
  end if;
  if exists (select 1 from public.profiles where role <> 'admin' and not ('warehouse_ops' = any(coalesce(module_access, '{}')))
               and public.warehouse_ops_level_of(id) is not null) then
    raise exception '265: alguien sin la casilla tiene nivel';
  end if;
  -- Las puertas
  if not exists (select 1 from pg_trigger where tgrelid = 'public.warehouse_reports'::regclass and tgname = 'warehouse_reports_guard_kind' and not tgisinternal) then
    raise exception '265: falta el guardia de tipo en warehouse_reports';
  end if;
  foreach f in array array[
    'public.warehouse_ops_edit_scrap_product(uuid, bigint, text, numeric)',
    'public.warehouse_ops_edit_scrap_origin(uuid, text, text)'
  ] loop
    def := pg_get_functiondef(f::regprocedure);
    if position('warehouse_ops_can_manage(r.store)' in def) = 0 or position('p.role = ''admin''' in def) > 0
       or position('warehouse_ops_scrap_loss' in def) = 0 then
      raise exception '265: % no quedo con la puerta nueva o perdio la cuenta de la 263', f;
    end if;
    if not (select p.prosecdef from pg_proc p where p.oid = f::regprocedure) then raise exception '265: % dejo de ser security definer', f; end if;
  end loop;
  foreach f in array array[
    'public.warehouse_ops_level()', 'public.warehouse_ops_level_of(uuid)', 'public.warehouse_ops_kinds_of(text)',
    'public.warehouse_ops_can_see(text, text, uuid)', 'public.warehouse_ops_can_manage(text)',
    'public.warehouse_ops_edit_scrap_product(uuid, bigint, text, numeric)',
    'public.warehouse_ops_edit_scrap_origin(uuid, text, text)', 'public.guard_warehouse_report_kind()'
  ] loop
    if has_function_privilege('anon', f, 'execute') then raise exception '265: anon ejecuta %', f; end if;
  end loop;
  if has_function_privilege('authenticated', 'public.warehouse_ops_level_of(uuid)', 'execute') then
    raise exception '265: authenticated puede preguntar el nivel de otra persona';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'warehouse_reports' and cmd <> 'SELECT') then
    raise exception '265: warehouse_reports no debe tener politicas de escritura';
  end if;
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('265_warehouse_ops_niveles.sql', '97eb2b412ff09121b384451befc0f391021678eb12749ce22c5edaacc79863ce') on conflict (name) do nothing;
