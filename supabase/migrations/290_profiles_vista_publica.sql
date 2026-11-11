-- 290: profiles — vista pública segura (revisión de seguridad, M1 · fase 1 de 2) (2026-11-10).
--
-- Hallazgo: `public.profiles` tiene `SELECT using (true)`, así que cualquier autenticado lee TODO de todos, incluidas
-- columnas sensibles (`permissions`, `username`, `active_session_id`). Se cierra sin romper que el nombre se vea en toda
-- la app, en DOS fases para no dejar ventana:
--   · FASE 1 (esta, 290): crear la vista pública `perfiles_publicos` (solo lectura, sin columnas sensibles). INOFENSIVA:
--     la tabla sigue abierta, así que todo sigue funcionando; solo deja lista la vista para que el código la use.
--   · FASE 2 (291): cerrar la lectura de la tabla a propia fila + admin/RR. HH. Se aplica DESPUÉS de desplegar el código
--     que ya lee la vista, y se verifica en vivo; si algo falla, se revierte solo la 291.
--
-- La vista corre con los permisos del dueño (no `security_invoker`), así cualquier autenticado la lee aunque la tabla
-- quede cerrada en la fase 2. Es de SOLO LECTURA (revoca todo, concede solo select): una vista sobre UNA tabla es
-- auto-actualizable y corre como dueño, así que sin esto se podría ESCRIBIR en `profiles` saltándose la RLS.
--
-- Additive. 237 y todo lo anterior intactas. Para deshacer: `drop view if exists public.perfiles_publicos;` +
--   `delete from public.schema_migrations where name = '290_profiles_vista_publica.sql';`

create or replace view public.perfiles_publicos
  with (security_barrier = true) as
  select id, full_name, avatar_url, created_at, role, store, visible_stores,
         module_access, recruiting_role, timetracker_role, erp_role, customers_role, warehouse_ops_role,
         title, title_color, language, left_at
    from public.profiles;

-- SOLO LECTURA (crítico): sin esto, al ser auto-actualizable y correr como dueño, authenticated podría escribir en
-- `profiles` a través de la vista saltándose la RLS (cambiarse su propio rol/permisos).
revoke all on public.perfiles_publicos from public, anon, authenticated, service_role;
grant select on public.perfiles_publicos to authenticated, service_role;

-- ===========================================================================
-- Autocomprobacion (solo la vista; la tabla se cierra en la 291)
-- ===========================================================================
do $chk$
declare v text;
begin
  if not exists (select 1 from information_schema.views where table_schema='public' and table_name='perfiles_publicos') then
    raise exception '290: falta la vista perfiles_publicos';
  end if;
  if not has_table_privilege('authenticated', 'public.perfiles_publicos', 'select') then
    raise exception '290: authenticated no puede leer perfiles_publicos';
  end if;
  if has_table_privilege('authenticated', 'public.perfiles_publicos', 'UPDATE')
     or has_table_privilege('authenticated', 'public.perfiles_publicos', 'INSERT')
     or has_table_privilege('authenticated', 'public.perfiles_publicos', 'DELETE') then
    raise exception '290: la vista perfiles_publicos no debe ser escribible por authenticated';
  end if;
  for v in select column_name from information_schema.columns where table_schema='public' and table_name='perfiles_publicos' loop
    if v in ('permissions', 'username', 'active_session_id') then
      raise exception '290: la vista perfiles_publicos no debe exponer la columna sensible %', v;
    end if;
  end loop;
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('290_profiles_vista_publica.sql', '9ec1b2c96ba208e8766f4adce67a7e45132e75de2747df1136ebb0c89fe1ea4b') on conflict (name) do nothing;
