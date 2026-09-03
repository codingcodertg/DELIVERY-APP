-- 099 · RLS por FILA en public.profiles (D-179, auditoría A-2a + A-3)
--
-- Hasta hoy profiles tenía `auth write profiles` = ALL USING true CHECK true: cualquier
-- autenticado podía EDITAR y BORRAR la fila de cualquier otro. Medido en la auditoría (matriz
-- rol × acción, con ROLLBACK): un vendedor editaba el full_name del ADMIN, se auto-otorgaba
-- `permissions`/`store`/`username`, y —sobre un perfil poco referenciado— lo borraba, con
-- cascada a 27 FKs (horas, nómina, capturas). Los guard_* protegían columnas de rol/acceso,
-- NO la fila, y dejaban tres columnas privilegiadas sin guard: permissions, store, username.
--
-- Esta migración cierra las dos cosas a la vez:
--   1. RLS por fila: cada quien su propia fila; cualquiera si es admin. DELETE para NADIE
--      desde cliente (el borrado real va por service-role sobre auth.users, con cascada).
--   2. Un guard NUEVO para las tres columnas privilegiadas que quedaban sin él. No se tocan
--      los cuatro guard_* existentes (role/recruiting/timetracker/clockin): añadir es más
--      seguro que reescribir.
--
-- Lo que NO se rompe, trazado en docs/PLAN-A-2a-profiles-rls.md: handle_new_user
-- (SECURITY DEFINER, salta RLS), el diálogo de Usuarios (admin → is_admin() pasa), editar el
-- propio nombre, y las listas de los 4 módulos (el SELECT sigue amplio). El residuo de que
-- todos leen username/permissions queda como A-2g, aparte (una vista, para no romper el
-- diálogo de admin ni el gating de capacidades que lee me.permissions).

-- ---------------------------------------------------------------------------
-- Helper, en el mismo idioma que los guard_* (que usan current_user_role() = 'admin')
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
  returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.current_user_role() = 'admin', false);
$$;

-- ---------------------------------------------------------------------------
-- Las cuatro políticas, una por comando (fuera el ALL USING true)
-- ---------------------------------------------------------------------------
drop policy if exists "auth write profiles" on public.profiles;
drop policy if exists "auth read profiles"  on public.profiles;

-- LECTURA amplia, como hoy: las listas de los 4 módulos y el gating de capacidades la
-- necesitan. (El residuo username/permissions es A-2g.)
create policy "profiles select" on public.profiles
  for select to authenticated
  using (true);

-- INSERT: solo la propia fila. El alta real la hace handle_new_user (SECURITY DEFINER, salta
-- RLS), así que esto no la afecta; solo cierra el INSERT arbitrario de terceros.
create policy "profiles insert self" on public.profiles
  for insert to authenticated
  with check ((select auth.uid()) = id);

-- UPDATE: tu propia fila, o cualquiera si eres admin. Qué columnas puede tocar un no-admin de
-- SU fila lo restringe el guard de abajo, no esta política (RLS no filtra por columna).
create policy "profiles update self or admin" on public.profiles
  for update to authenticated
  using      ((select auth.uid()) = id or (select public.is_admin()))
  with check ((select auth.uid()) = id or (select public.is_admin()));

-- DELETE: sin política → denegado para 'authenticated'. El borrado va por service-role sobre
-- auth.users (profiles_id_fkey ON DELETE CASCADE). Ningún camino de cliente borra profiles.

-- ---------------------------------------------------------------------------
-- Guard para las columnas privilegiadas sin guardián (A-3 + store + username)
-- ---------------------------------------------------------------------------
create or replace function public.guard_profile_privileged_columns()
  returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Solo un admin cambia permissions/store/username. Un no-admin editando SU fila puede
  -- tocar full_name/avatar_url/active_session_id y nada más. Mismo patrón que guard_role_change.
  if coalesce(public.current_user_role(), 'sales') <> 'admin'
     and auth.uid() is not null
     and ( NEW.permissions is distinct from OLD.permissions
        or NEW.store       is distinct from OLD.store
        or NEW.username    is distinct from OLD.username ) then
    raise exception 'Only an admin can change permissions, store or username';
  end if;
  return NEW;
end $$;

drop trigger if exists profiles_guard_privileged on public.profiles;
create trigger profiles_guard_privileged
  before update on public.profiles
  for each row execute function public.guard_profile_privileged_columns();
