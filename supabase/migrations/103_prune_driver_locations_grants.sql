-- 103 · G-32 (D-199): cerrar la ejecucion publica de prune_driver_locations.
--
-- La funcion (043:59) es security definer y nacio con el EXECUTE por defecto de
-- Postgres: anon y authenticated podian llamarla por rpc con keep_days = 0 y vaciar
-- los recorridos de los choferes, sin respaldo (F-3). Medido en produccion el
-- 2026-09-05 con has_function_privilege: anon true, authenticated true.
--
-- Solo el servicio (el cron de poda, G-23) debe ejecutarla. Mismo patron que 077 y 078.
-- No toca datos ni la RLS de la tabla. Reversion:
--   grant execute on function public.prune_driver_locations(int) to anon, authenticated;

revoke execute on function public.prune_driver_locations(int) from public, anon, authenticated;
grant  execute on function public.prune_driver_locations(int) to service_role;

-- @ledger-below
insert into public.schema_migrations (name, checksum)
  values ('103_prune_driver_locations_grants.sql', '0ba42962f9aca538f5e56222b124757a7e17e15a29928b424b2ee841359d32be') on conflict (name) do nothing;
