-- 287: profiles — vista pública segura + bloquear la lectura de la tabla (revisión de seguridad, M1) (2026-11-10).
--
-- Hallazgo: `public.profiles` tenía `SELECT using (true)`, así que CUALQUIER autenticado leía TODO de todos, incluidas
-- columnas sensibles: `permissions` (capacidades), `username` (con qué entra) y `active_session_id` (su sesión activa).
-- La escritura ya estaba bien (propia fila + admin). Cerramos la LECTURA sensible sin romper que el nombre se vea en
-- toda la app.
--
-- Cómo:
--   1. Vista `public.perfiles_publicos`: todas las columnas de display/lógica MENOS las sensibles (sin permissions,
--      username ni active_session_id). Corre con los permisos del dueño (no `security_invoker`), así cualquier
--      autenticado la lee aunque la tabla quede cerrada. Es de SOLO LECTURA y solo campos no sensibles.
--   2. `profiles` SELECT se cierra a: la propia fila, o admin (`is_admin()`), o RR. HH. (`has_recruiting_access()`).
--      Admin/RR. HH. siguen leyendo todo (sus paneles de usuarios/permisos necesitan permissions/username). Un usuario
--      normal lee SU fila completa (para sus permisos) y, de los demás, solo lo público vía la vista.
--
-- La app: las lecturas de OTROS para mostrar nombre/rol pasan a `perfiles_publicos`; las propias y las de admin/RR. HH.
-- siguen en `profiles`. Las funciones security-definer y el service-role (createAdminClient) NO se ven afectadas
-- (corren como dueño / bypass RLS).
--
-- Additive/correctivo. 237/280-286 intactas. Para deshacer:
--   drop view if exists public.perfiles_publicos;
--   drop policy if exists "profiles select self or staff" on public.profiles;
--   create policy "profiles select" on public.profiles for select to authenticated using (true);
--   delete from public.schema_migrations where name = '287_profiles_vista_publica.sql';

-- 1. La vista pública (sin columnas sensibles).
create or replace view public.perfiles_publicos
  with (security_barrier = true) as
  select id, full_name, avatar_url, created_at, role, store,
         recruiting_role, module_access, timetracker_role, erp_role, customers_role, warehouse_ops_role,
         title, title_color, language, visible_stores, left_at
    from public.profiles;
-- SOLO LECTURA (crítico): una vista sobre UNA tabla es auto-actualizable en Postgres, y como corre como dueño
-- (bypassa RLS), cualquier INSERT/UPDATE/DELETE sobre la vista dejaría a `authenticated` escribir en `profiles`
-- (cambiarse su propio rol/permisos) saltándose la RLS. Se revoca TODO y se concede SOLO select.
revoke all on public.perfiles_publicos from public, anon, authenticated, service_role;
grant select on public.perfiles_publicos to authenticated, service_role;

-- 2. Cerrar la lectura de la tabla: propia fila, o admin, o RR. HH.
drop policy if exists "profiles select" on public.profiles;
drop policy if exists "profiles select self or staff" on public.profiles;
create policy "profiles select self or staff" on public.profiles for select to authenticated
  using (
    (select auth.uid()) = id
    or (select public.is_admin())
    or (select public.has_recruiting_access())
  );

-- ===========================================================================
-- Autocomprobacion
-- ===========================================================================
do $chk$
declare v text;
begin
  -- La tabla ya NO tiene un SELECT abierto.
  if exists (select 1 from pg_policies where schemaname='public' and tablename='profiles' and cmd='SELECT' and qual='true') then
    raise exception '287: profiles todavia tiene un SELECT abierto (using true)';
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='profiles' and cmd='SELECT') then
    raise exception '287: profiles se quedo sin politica de SELECT';
  end if;
  -- La vista existe, authenticated la puede leer, y NO expone columnas sensibles.
  if not exists (select 1 from information_schema.views where table_schema='public' and table_name='perfiles_publicos') then
    raise exception '287: falta la vista perfiles_publicos';
  end if;
  if not has_table_privilege('authenticated', 'public.perfiles_publicos', 'select') then
    raise exception '287: authenticated no puede leer perfiles_publicos';
  end if;
  -- La vista NO debe ser escribible (si no, se saltaría la RLS de profiles al correr como dueño).
  if has_table_privilege('authenticated', 'public.perfiles_publicos', 'UPDATE')
     or has_table_privilege('authenticated', 'public.perfiles_publicos', 'INSERT')
     or has_table_privilege('authenticated', 'public.perfiles_publicos', 'DELETE') then
    raise exception '287: la vista perfiles_publicos no debe ser escribible por authenticated';
  end if;
  for v in select column_name from information_schema.columns where table_schema='public' and table_name='perfiles_publicos' loop
    if v in ('permissions', 'username', 'active_session_id') then
      raise exception '287: la vista perfiles_publicos no debe exponer la columna sensible %', v;
    end if;
  end loop;
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('287_profiles_vista_publica.sql', '57f5323a2e61c4fd6dd000a76cd5fe1dab065c6e60ee3475eccd24ee5758b72a') on conflict (name) do nothing;
