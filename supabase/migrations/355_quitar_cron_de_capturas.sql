-- ---------------------------------------------------------------------------
-- 355 · Quitar el cron purge_old_timetracker_screenshots (job 1) (auditoría 2026-11-27, D-1205)
-- ---------------------------------------------------------------------------
-- POR QUÉ. El job 1 (`select timetracker.purge_old_screenshots('14 days')`, 3:00 UTC) falla todas las noches (las dos
-- últimas corridas, 26 y 27 nov, «failed»). Esa limpieza ya la hace la ruta de Vercel /api/cron/purga-capturas. Solo
-- ensucia el historial de cron y, cuando lleguen las alertas de cron, avisaría de una falla que no importa.
--
-- Se quita por NOMBRE, no por número. No borra la función timetracker.purge_old_screenshots.
-- Sin begin/commit propios. Idempotente. SIN APLICAR hasta que el dueño dé el OK.
--
-- Para deshacer: select cron.schedule('purge_old_timetracker_screenshots', '0 3 * * *',
--                  $c$ select timetracker.purge_old_screenshots('14 days'); $c$);
--                delete from public.schema_migrations where name = '355_quitar_cron_de_capturas.sql';
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from cron.job where jobname = 'purge_old_timetracker_screenshots') then
    perform cron.unschedule('purge_old_timetracker_screenshots');
  end if;
  if exists (select 1 from cron.job where jobname = 'purge_old_timetracker_screenshots') then
    raise exception 'La 355 no quitó purge_old_timetracker_screenshots';
  end if;
end $$;
-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('355_quitar_cron_de_capturas.sql', '1ec4bbc1cbe619489fb98a988bb7cfed0f761a7e8e1053f4cb5413e0c09bcf85') on conflict (name) do nothing;
