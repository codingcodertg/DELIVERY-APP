-- 282: Rate limiting respaldado en Postgres para las rutas /api sensibles y las que gastan dinero (2026-11-10).
--
-- Revisión de seguridad que pidió el dueño. En vez de montar Redis/Upstash, el contador vive en la misma base: una
-- tabla por (cubo, ventana) y una RPC atómica que suma y dice si se pasó. El helper `src/lib/rate-limit.ts` la llama con
-- el cliente de servicio y FALLA ABIERTO si algo sale mal (un corte del limitador no puede tumbar el app).
--
-- Qué hace:
--   1. Tabla public.rate_limits (cubo, inicio de ventana, hits). RLS activa y SIN políticas: solo la RPC la toca.
--   2. check_rate_limit(p_bucket, p_max, p_window_seconds): upsert atómico del contador de la ventana actual; devuelve
--      {allowed, hits, limit, reset}. Security definer.
--
-- Las filas viejas se pueden limpiar luego con un cron (`delete from public.rate_limits where window_start < now() -
-- interval '1 day'`); no se agrega cron aquí.
--
-- No toca ninguna migración previa. Para deshacer:
--   drop function if exists public.check_rate_limit(text, int, int);
--   drop table if exists public.rate_limits;
--   delete from public.schema_migrations where name = '282_rate_limits.sql';

-- 1. La tabla del contador
create table if not exists public.rate_limits (
  bucket text not null,
  window_start timestamptz not null,
  hits int not null default 0,
  primary key (bucket, window_start)
);

-- 2. RLS activa y sin políticas: nadie la toca directo; solo la RPC de abajo (security definer).
alter table public.rate_limits enable row level security;
revoke all on public.rate_limits from anon;

-- 3. El contador atómico
create or replace function public.check_rate_limit(p_bucket text, p_max int, p_window_seconds int)
  returns jsonb
  language plpgsql volatile security definer set search_path = public as $$
declare
  w timestamptz;
  h int;
begin
  if p_bucket is null or btrim(p_bucket) = '' or p_window_seconds is null or p_window_seconds <= 0 or p_max is null or p_max < 0 then
    raise exception 'check_rate_limit: parametros invalidos' using errcode = '22023';
  end if;
  -- El inicio de la ventana actual (alineado al tamaño de la ventana).
  w := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into public.rate_limits (bucket, window_start, hits) values (p_bucket, w, 1)
    on conflict (bucket, window_start) do update set hits = public.rate_limits.hits + 1
    returning hits into h;
  return jsonb_build_object('allowed', h <= p_max, 'hits', h, 'limit', p_max, 'reset', extract(epoch from w) + p_window_seconds);
end $$;
revoke all on function public.check_rate_limit(text, int, int) from public;
grant execute on function public.check_rate_limit(text, int, int) to authenticated, anon;

-- ===========================================================================
-- Autocomprobacion
-- ===========================================================================
do $chk$
declare f text;
begin
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'rate_limits') then
    raise exception '282: falta la tabla rate_limits';
  end if;
  if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'rate_limits' and rowsecurity) then
    raise exception '282: la tabla rate_limits no tiene RLS';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'rate_limits') then
    raise exception '282: rate_limits no debe tener politicas (solo la RPC la toca)';
  end if;
  f := pg_get_functiondef('public.check_rate_limit(text, int, int)'::regprocedure);
  if position('on conflict (bucket, window_start)' in f) = 0 then
    raise exception '282: check_rate_limit no es atomica (falta el upsert)';
  end if;
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('282_rate_limits.sql', '8641ebaf1bb14151e4deb12c24c55a0437c2b08f499befa3ccf55c1cea4401c6') on conflict (name) do nothing;
