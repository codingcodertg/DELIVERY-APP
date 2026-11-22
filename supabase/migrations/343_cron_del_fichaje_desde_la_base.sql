-- 343 · El cron del fichaje (Time Tracker) y el del buzón de Indeed también salen de la base.
--
-- Por qué (D-1131, 2026-11-22): igual que los de RingCentral (342). Los workflows programados de GitHub corren cada 6–8
-- horas: `tt-cron` (pensado para cada 2 minutos: avisos de turno, almuerzo y el cierre automático de las 8 PM) corrió el
-- 22 nov a las 03:34, 11:54 y 18:44 UTC y nada más; `outlook-indeed` (cada 15 minutos), a las 03:31, 12:00 y 19:43.
--
-- Qué cambia:
--   · `llama_cron` deja pasar, además de `/api/cron/...`, la ruta del cron del fichaje (lista cerrada, no un patrón).
--   · pg_cron: `tt-clockin` cada 2 minutos y `outlook-indeed` cada 15.
--   · Limpieza diaria del historial de corridas de pg_cron (más de 1,000 filas al día con estos horarios).
-- Las rutas aceptan el boleto de un solo uso de la 342 (`cron-boleto.ts`) además del CRON_SECRET.
--
-- Vuelta atrás:
--   select cron.unschedule('tt-clockin'); select cron.unschedule('outlook-indeed'); select cron.unschedule('limpia-historial-de-cron');
--   (y volver a crear `llama_cron` como en la 342)
--   delete from public.schema_migrations where name = '343_cron_del_fichaje_desde_la_base.sql';

create or replace function public.llama_cron(p_ruta text)
  returns void language plpgsql security definer set search_path = '' as $$
declare
  boleto text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  -- Solo rutas de cron de esta app: la función no sirve para llamar a otra parte.
  if p_ruta !~ '^/api/cron/[a-z0-9/-]+$' and p_ruta <> '/timetracker/clock-in/api/cron' then
    raise exception 'llama_cron: ruta no permitida' using errcode = '22023';
  end if;
  delete from public.cron_tickets where created_at < now() - interval '1 hour';
  insert into public.cron_tickets (token, ruta) values (boleto, p_ruta);
  perform net.http_get(
    url := 'https://rtg-hub.vercel.app' || p_ruta,
    headers := jsonb_build_object('Authorization', 'Bearer boleto:' || boleto),
    timeout_milliseconds := 60000
  );
end $$;
revoke all on function public.llama_cron(text) from public, anon, authenticated;

select cron.schedule('tt-clockin', '*/2 * * * *', $cron$select public.llama_cron('/timetracker/clock-in/api/cron')$cron$);
select cron.schedule('outlook-indeed', '3-59/15 * * * *', $cron$select public.llama_cron('/api/cron/outlook-indeed')$cron$);
select cron.schedule('limpia-historial-de-cron', '20 9 * * *', $cron$delete from cron.job_run_details where end_time < now() - interval '2 days'$cron$);
-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('343_cron_del_fichaje_desde_la_base.sql', 'f044de42a5271034cb2f9299faa31c19f0f125ed58558935056efc083e378dcd') on conflict (name) do nothing;
