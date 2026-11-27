-- ---------------------------------------------------------------------------
-- 353 · Purga diaria de las cachés de Google Maps (auditoría 2026-11-27, D-1205)
-- ---------------------------------------------------------------------------
-- POR QUÉ. route_opt_cache pesaba 97 MB (1.950 filas) el 27 nov y nunca se borraba: el TTL solo se mira al LEER
-- (src/lib/cache-google-servidor.ts), así que lo vencido se queda para siempre. Es lo que más pesa en la base y alarga
-- los respaldos.
--
-- QUÉ BORRA, cada día a las 9:40 UTC, y solo lo que ya no se usaría:
--   · route_opt_cache:   lo de más de 1 día (TTL de uso: 1 hora, TTL_RUTA_OPT_MS).
--   · distance_cache:    lo de más de 14 días (TTL de uso: 7 días, TTL_DISTANCIA_MS).
--   · places_cache:      lo de más de 14 días (TTL de uso: 7 días, TTL_PLACES_MS).
--   · travel_time_cache: SOLO las filas CON tráfico de más de 28 días (CADUCIDAD_DIAS.conTrafico). Las de SIN tráfico
--     NO se tocan: el reporte de choferes (src/lib/reportes-choferes/carga.ts) las lee sin mirar su edad para las
--     millas y minutos de días pasados. Pesan 1,6 MB.
-- geocode_cache tampoco se toca: no caduca (una dirección no se mueve).
--
-- El espacio: Postgres reusa lo borrado (autovacuum); el archivo no encoge solo. Si se quiere devolver los ~90 MB al
-- disco de una vez: `vacuum full public.route_opt_cache;` (bloquea la tabla unos segundos; la caché sigue funcionando
-- sin ella, solo pide de nuevo a Google).
--
-- Sin begin/commit propios: quien aplica envuelve el fichero. Idempotente (unschedule si ya existe).
-- SIN APLICAR hasta que el dueño dé el OK.
--
-- Para deshacer: select cron.unschedule('purga-caches-de-google');
--                delete from public.schema_migrations where name = '353_purga_de_caches.sql';
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from cron.job where jobname = 'purga-caches-de-google') then
    perform cron.unschedule('purga-caches-de-google');
  end if;
end $$;

select cron.schedule('purga-caches-de-google', '40 9 * * *', $cron$
  delete from public.route_opt_cache   where created_at < now() - interval '1 day';
  delete from public.distance_cache    where created_at < now() - interval '14 days';
  delete from public.places_cache      where created_at < now() - interval '14 days';
  delete from public.travel_time_cache where traffic and fetched_at < now() - interval '28 days';
$cron$);

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'purga-caches-de-google' and schedule = '40 9 * * *') then
    raise exception 'La 353 no programó purga-caches-de-google';
  end if;
end $$;
-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('353_purga_de_caches.sql', 'b73d12390972acca4350167119c8df11913b415ac154131002c7625a104106fe') on conflict (name) do nothing;
