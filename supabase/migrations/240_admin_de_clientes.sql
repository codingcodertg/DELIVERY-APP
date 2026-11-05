-- 240: Admin SOLO de Clientes (profiles.customers_role), sin tocar el role del hub.
--
-- El dueño (2026-11-04): «dale permiso de admin a Nick solo para la app de Clientes». Hasta hoy «admin de Clientes» era
-- `profiles.role = 'admin'`, que lo hace admin en TODAS las apps. Esto anade un rol dentro de la app, como
-- `recruiting_role` (055):
--   1. `profiles.customers_role` (null o 'admin'). Solo un admin del hub lo cambia (guardia de profiles, 131).
--   2. `erp.es_admin_de_clientes()`: admin del hub, o customers_role = 'admin' Y con la casilla «customers». Quitar la
--      casilla lo deja sin nada, como a cualquiera.
--   3. Donde la base decia «admin» para Clientes, ahora dice es_admin_de_clientes():
--      - erp.customers_ve_la_fila: ve todas las tiendas (217).
--      - «customers update (admin)» (221) y «customers delete (admin)» (180).
--      - «customer requests read own or admin» (216): lee todas las solicitudes.
--      - aprueba/rechaza solicitud y aprueba edicion (216/221): se reescriben desde el catalogo cambiando SOLO la linea
--        de la puerta (`if not public.is_admin() then`), para no copiar a mano cuerpos largos que ya corren.
-- has_customers_access() y customers_can_write() no cambian: el admin de Clientes ya necesita la casilla, y con ella
-- (siendo gerente o vendedor) ya entraba y escribia.
--
-- Sin begin/commit propios. Para deshacer: volver a crear las politicas con public.is_admin(), reemplazar en las tres
-- funciones `erp.es_admin_de_clientes()` por `public.is_admin()`, customers_ve_la_fila como en la 217, el guardia como en
-- la 131, drop function erp.es_admin_de_clientes(); alter table public.profiles drop column customers_role.

-- 1. La columna -----------------------------------------------------------------------------------------------------
alter table public.profiles add column if not exists customers_role text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_customers_role_check') then
    alter table public.profiles add constraint profiles_customers_role_check check (customers_role is null or customers_role = 'admin');
  end if;
end $$;

-- El guardia de profiles (131) + customers_role: un no-admin no se lo pone a si mismo.
create or replace function public.guard_profile_privileged_columns()
  returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Solo un admin cambia permissions/store/username/erp_role/title/title_color/visible_stores/customers_role. Un
  -- no-admin editando SU fila puede tocar full_name/avatar_url/active_session_id y nada mas. Mismo
  -- patron que guard_role_change.
  if coalesce(public.current_user_role(), 'sales') <> 'admin'
     and auth.uid() is not null
     and ( NEW.permissions    is distinct from OLD.permissions
        or NEW.store          is distinct from OLD.store
        or NEW.username       is distinct from OLD.username
        or NEW.erp_role       is distinct from OLD.erp_role
        or NEW.title          is distinct from OLD.title
        or NEW.title_color    is distinct from OLD.title_color
        or NEW.visible_stores is distinct from OLD.visible_stores
        or NEW.customers_role is distinct from OLD.customers_role ) then
    raise exception 'Only an admin can change permissions, store, username, erp_role, title, visible_stores or customers_role';
  end if;
  return NEW;
end $$;

-- 2. Quien es admin de Clientes ---------------------------------------------------------------------------------------
create or replace function erp.es_admin_de_clientes()
  returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select role = 'admin' or (customers_role = 'admin' and 'customers' = any(coalesce(module_access, '{}')))
    from public.profiles where id = auth.uid()
  ), false);
$$;
revoke execute on function erp.es_admin_de_clientes() from public, anon;
grant  execute on function erp.es_admin_de_clientes() to authenticated;

-- 3a. Ve todas las tiendas (217 + customers_role) --------------------------------------------------------------------
create or replace function erp.customers_ve_la_fila(p_rep uuid, p_creador uuid, p_store text)
  returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select case
      when p.role = 'admin' or (p.customers_role = 'admin' and 'customers' = any(coalesce(p.module_access, '{}'))) then true
      else (
        upper(btrim(coalesce(p_store, ''))) = erp.customers_codigo_de_tienda(p.store)
        or (p.role = 'sales' and (p_rep = auth.uid() or p_creador = auth.uid()))
      )
    end
    from public.profiles p where p.id = auth.uid()
  ), false);
$$;

-- 3b. Politicas ----------------------------------------------------------------------------------------------------
drop policy if exists "customers update (admin)" on erp.customers;
create policy "customers update (admin)" on erp.customers as permissive for update to authenticated
  using ((select erp.es_admin_de_clientes())) with check ((select erp.es_admin_de_clientes()));
drop policy if exists "customers delete (admin)" on erp.customers;
create policy "customers delete (admin)" on erp.customers as permissive for delete to authenticated
  using ((select erp.es_admin_de_clientes()));
drop policy if exists "customer requests read own or admin" on erp.customer_requests;
create policy "customer requests read own or admin" on erp.customer_requests as permissive for select to authenticated
  using (requested_by = (select auth.uid()) or (select erp.es_admin_de_clientes()));

-- 3c. Las funciones de decidir: solo cambia la puerta ----------------------------------------------------------------
do $re$
declare
  f text;
  def text;
begin
  foreach f in array array[
    'erp.aprueba_solicitud_de_cliente(bigint)',
    'erp.rechaza_solicitud_de_cliente(bigint, text)',
    'erp.aprueba_edicion_de_cliente(bigint, text)'
  ] loop
    def := pg_get_functiondef(f::regprocedure);
    if position('if not public.is_admin() then' in def) = 0 then
      raise exception '240: % no tiene la puerta esperada (if not public.is_admin() then)', f;
    end if;
    execute replace(def, 'if not public.is_admin() then', 'if not erp.es_admin_de_clientes() then');
  end loop;
end $re$;

-- ===========================================================================
-- Autocomprobacion (mira el catalogo)
-- ===========================================================================
do $chk$
declare f text;
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'customers_role') then
    raise exception '240: falta profiles.customers_role';
  end if;
  if position('customers_role' in pg_get_functiondef('public.guard_profile_privileged_columns()'::regprocedure)) = 0 then
    raise exception '240: el guardia de profiles no protege customers_role (seria autoservicio)';
  end if;
  if position('visible_stores' in pg_get_functiondef('public.guard_profile_privileged_columns()'::regprocedure)) = 0 then
    raise exception '240: el guardia de profiles perdio visible_stores';
  end if;
  if position('customers_role' in pg_get_functiondef('erp.customers_ve_la_fila(uuid, uuid, text)'::regprocedure)) = 0 then
    raise exception '240: customers_ve_la_fila no conoce customers_role';
  end if;
  foreach f in array array[
    'erp.aprueba_solicitud_de_cliente(bigint)',
    'erp.rechaza_solicitud_de_cliente(bigint, text)',
    'erp.aprueba_edicion_de_cliente(bigint, text)'
  ] loop
    if position('erp.es_admin_de_clientes()' in pg_get_functiondef(f::regprocedure)) = 0
       or position('public.is_admin()' in pg_get_functiondef(f::regprocedure)) > 0 then
      raise exception '240: % no quedo con la puerta nueva', f;
    end if;
    if not (select p.prosecdef from pg_proc p where p.oid = f::regprocedure) then
      raise exception '240: % dejo de ser security definer', f;
    end if;
    if has_function_privilege('anon', f, 'execute') then raise exception '240: anon ejecuta %', f; end if;
  end loop;
  if has_function_privilege('anon', 'erp.es_admin_de_clientes()', 'execute') then raise exception '240: anon ejecuta es_admin_de_clientes'; end if;
  if not exists (select 1 from pg_policies where schemaname = 'erp' and tablename = 'customers' and policyname = 'customers update (admin)'
                   and qual like '%es_admin_de_clientes%') then
    raise exception '240: la politica de update no usa es_admin_de_clientes';
  end if;
  if (select count(*) from public.profiles where customers_role is not null) > 0 then
    raise exception '240: nadie deberia nacer con customers_role';
  end if;
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('240_admin_de_clientes.sql', 'a9301fba5a1d383491020be55c63f6e850a2c10f93a427fc693d87bbb4e0d5ab') on conflict (name) do nothing;
