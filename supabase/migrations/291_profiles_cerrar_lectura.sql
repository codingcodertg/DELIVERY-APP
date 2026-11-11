-- 291: profiles — cerrar la lectura de la tabla (revisión de seguridad, M1 · fase 2 de 2) (2026-11-10).
--
-- FASE 2 de M1 (ver 290). Se aplica DESPUÉS de que la vista `perfiles_publicos` (290) esté creada Y el código que lee
-- la vista esté desplegado. Cierra la lectura de `public.profiles` a: la propia fila, o admin (`is_admin()`), o RR. HH.
-- (`has_recruiting_access()`). Admin/RR. HH. siguen leyendo todo (sus paneles de usuarios/permisos necesitan
-- permissions/username); un usuario normal lee SU fila completa y, de los demás, solo lo público vía la vista.
--
-- ESTA es la fase con efecto en vivo: se verifica por rol justo después de aplicarla. REVERSIBLE al instante si algo
-- falla (vuelve la política abierta):
--   drop policy if exists "profiles select self or staff" on public.profiles;
--   create policy "profiles select" on public.profiles for select to authenticated using (true);
--   delete from public.schema_migrations where name = '291_profiles_cerrar_lectura.sql';

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
begin
  if exists (select 1 from pg_policies where schemaname='public' and tablename='profiles' and cmd='SELECT' and qual='true') then
    raise exception '291: profiles todavia tiene un SELECT abierto (using true)';
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='profiles' and cmd='SELECT') then
    raise exception '291: profiles se quedo sin politica de SELECT';
  end if;
  -- La vista de la 290 debe existir antes de cerrar la tabla (si no, se rompen las lecturas de otros).
  if not exists (select 1 from information_schema.views where table_schema='public' and table_name='perfiles_publicos') then
    raise exception '291: falta la vista perfiles_publicos (aplica la 290 primero)';
  end if;
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('291_profiles_cerrar_lectura.sql', '87acf5d1154ef4ffdd242ce20df7f3bf22bda8451407900d0af4d2d04eac1ff0') on conflict (name) do nothing;
