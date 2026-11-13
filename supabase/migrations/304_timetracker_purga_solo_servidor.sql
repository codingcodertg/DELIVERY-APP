-- 304: la purga de capturas del Time Tracker deja de ser ejecutable por usuarios con sesión.
--
-- Hallazgo (auditoría, 13 nov): timetracker.purge_old_screenshots(interval) es SECURITY DEFINER y no tiene chequeo de
-- rol. 303 le quitó `public` y `anon`, pero `authenticated` la conservó: cualquier empleado con sesión podía borrar las
-- capturas de todo el equipo (las políticas de storage no aplican dentro de una función SECURITY DEFINER).
--
-- Quién la necesita: el cron de pg_cron (corre como `postgres`, que no depende de este permiso) y el servidor con la
-- llave de servicio. Ninguna pantalla ni ruta la llama con `.rpc(...)` (comprobado en src/). La purga que sigue en uso
-- es la ruta /api/cron/purga-capturas, que no usa esta función.
--
-- Solo permisos. No cambia la función ni su programación de pg_cron. Para deshacer, ver el bloque comentado al final.

revoke execute on function timetracker.purge_old_screenshots(interval) from public, anon, authenticated;
grant execute on function timetracker.purge_old_screenshots(interval) to service_role;

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
end
$chk$;

-- Para deshacer (no ejecutar en el flujo normal):
-- grant execute on function timetracker.purge_old_screenshots(interval) to public, anon, authenticated;
-- delete from public.schema_migrations where name = '304_timetracker_purga_solo_servidor.sql';

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('304_timetracker_purga_solo_servidor.sql', '0aa385f81d9635b2ba024dfbe3df24ab070e3b057291f9ac46a1a2fe519d2142') on conflict (name) do nothing;
