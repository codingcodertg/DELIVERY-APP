-- 304: la purga de capturas del Time Tracker deja de ser ejecutable por usuarios con sesión, y pasa a leer sus candidatas
-- de storage.objects (solo servicio).
--
-- Hallazgo (auditoría, 13 nov): timetracker.purge_old_screenshots(interval) es SECURITY DEFINER y no tiene chequeo de
-- rol. 303 le quitó `public` y `anon`, pero `authenticated` la conservó: cualquier empleado con sesión podía borrar las
-- capturas de todo el equipo (las políticas de storage no aplican dentro de una función SECURITY DEFINER).
--
-- Quién la necesita: el cron de pg_cron (corre como `postgres`, que no depende de este permiso) y el servidor con la
-- llave de servicio. Ninguna pantalla ni ruta la llama con `.rpc(...)` (comprobado en src/). La purga que sigue en uso
-- es la ruta /api/cron/purga-capturas, que usa la función nueva de abajo.
--
-- 1) Permisos: `purge_old_screenshots` queda solo para service_role. No cambia su cuerpo ni la programación de pg_cron.
-- 2) `timetracker.capturas_vencidas(corte, limite)`: lista las capturas vencidas DESDE storage.objects (el created_at
--    del objeto manda, no una fila escribible por el empleado), solo con forma `<uid>/<session>/<archivo>`, filtrada
--    antes del LIMIT: una ruta rara no ocupa sitio ni puede dejar a las demás sin purgar. Solo service_role.
-- 3) CHECK NOT VALID en timetracker.screenshots: una fila nueva solo puede tener `path` que empiece por su propio
--    `employee_uid/`. Las filas que ya existen no se revisan (NOT VALID); al medir el 12 nov, las 6.789 con ruta cumplían.
--
-- Para deshacer, ver el bloque comentado al final.

-- 1) Permisos de la función antigua.
revoke execute on function timetracker.purge_old_screenshots(interval) from public, anon, authenticated;
grant execute on function timetracker.purge_old_screenshots(interval) to service_role;

-- 2) Candidatas desde storage.objects.
create or replace function timetracker.capturas_vencidas(corte timestamptz, limite integer default 500)
returns table (name text, created_at timestamptz)
language sql
stable
security definer
set search_path = storage, pg_temp
as $$
  select o.name::text, o.created_at
  from storage.objects o
  where o.bucket_id = 'timetracker-screenshots'
    and o.created_at < corte
    and o.name ~ '^[^/]+/[^/]+/[^/]+$'
    and o.name !~ '(\.\.|\\|^/|")'
  order by o.created_at asc
  limit least(greatest(limite, 1), 1000);
$$;

revoke all on function timetracker.capturas_vencidas(timestamptz, integer) from public, anon, authenticated;
grant execute on function timetracker.capturas_vencidas(timestamptz, integer) to service_role;

-- 3) La ruta de una fila es de su propio empleado (las filas existentes no se revisan: NOT VALID).
alter table timetracker.screenshots drop constraint if exists screenshots_path_es_del_empleado;
alter table timetracker.screenshots
  add constraint screenshots_path_es_del_empleado
  check (path is null or (employee_uid is not null and left(path, length(employee_uid::text) + 1) = employee_uid::text || '/'))
  not valid;

-- Verificación: si algo de lo anterior no se aplicó, la migración falla y no queda registrada.
do $chk$
begin
  if has_function_privilege('authenticated', 'timetracker.purge_old_screenshots(interval)', 'EXECUTE') then
    raise exception '304: authenticated sigue pudiendo ejecutar timetracker.purge_old_screenshots';
  end if;
  if has_function_privilege('anon', 'timetracker.purge_old_screenshots(interval)', 'EXECUTE') then
    raise exception '304: anon sigue pudiendo ejecutar timetracker.purge_old_screenshots';
  end if;
  if has_function_privilege('public', 'timetracker.purge_old_screenshots(interval)', 'EXECUTE') then
    raise exception '304: public sigue pudiendo ejecutar timetracker.purge_old_screenshots';
  end if;
  if not has_function_privilege('service_role', 'timetracker.purge_old_screenshots(interval)', 'EXECUTE') then
    raise exception '304: service_role perdió EXECUTE sobre timetracker.purge_old_screenshots';
  end if;
  if has_function_privilege('authenticated', 'timetracker.capturas_vencidas(timestamptz, integer)', 'EXECUTE')
     or has_function_privilege('anon', 'timetracker.capturas_vencidas(timestamptz, integer)', 'EXECUTE') then
    raise exception '304: capturas_vencidas debe ser solo de service_role';
  end if;
  if not has_function_privilege('service_role', 'timetracker.capturas_vencidas(timestamptz, integer)', 'EXECUTE') then
    raise exception '304: service_role no puede ejecutar capturas_vencidas';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'screenshots_path_es_del_empleado' and convalidated = false) then
    raise exception '304: falta el CHECK screenshots_path_es_del_empleado';
  end if;
end
$chk$;

-- Para deshacer (no ejecutar en el flujo normal):
-- grant execute on function timetracker.purge_old_screenshots(interval) to public, anon, authenticated;
-- drop function if exists timetracker.capturas_vencidas(timestamptz, integer);
-- alter table timetracker.screenshots drop constraint if exists screenshots_path_es_del_empleado;
-- delete from public.schema_migrations where name = '304_timetracker_purga_solo_servidor.sql';

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('304_timetracker_purga_solo_servidor.sql', '7595b6c06a0ef5edf934ee80a61951bbf1561c1cacf72e005c0f5502f14cdc85') on conflict (name) do nothing;
