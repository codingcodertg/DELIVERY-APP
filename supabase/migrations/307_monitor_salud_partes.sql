-- 307: «Salud del sistema» deja de depender de una sola función gigante (2026-11-13).
--
-- Hallazgo (13 nov, 9:42–9:43 AM Central): `monitor_salud()` (300) hace todo en una sola llamada. Los registros de
-- Postgres muestran cinco «canceling statement due to statement timeout» en 30 segundos, justo a esa hora. El rol
-- `authenticated` tiene statement_timeout = 8 s, así que si la llamada tarda más, se cancela y TODAS las tarjetas
-- quedan en blanco a la vez. Además, esa función leía `pg_stat_statements` tres veces (cada lectura carga el texto de
-- todas las consultas desde disco) y ordenaba filas anchas que se pasaban a disco temporal (~6,6 MB escritos por
-- llamada). Con el presupuesto de Disk IO agotado, justo ahí se vuelve lenta.
--
-- Medido (solo lectura, mediana de 7 corridas, incluye ida y vuelta a la base):
--   · 3 lecturas de pg_stat_statements, como hoy: ~510 ms, con 843 bloques escritos a disco temporal por lectura.
--   · 1 sola lectura combinada, con work_mem de 64 MB: ~280 ms, sin disco temporal.
--   · storage.objects agregado por bucket (9.404 objetos): ~100 ms ida y vuelta; el tiempo de servidor es de 6 ms.
--
-- Qué hace esta migración (ADITIVA: no cambia tablas, ni datos, ni la función 300):
--   · cuatro funciones pequeñas, una por grupo de tarjetas, cada una con su propio chequeo de admin:
--       monitor_salud_escrituras()  → estadisticas_desde, wal_total, top 12 de escrituras (UNA sola lectura de
--                                     pg_stat_statements, con work_mem de 64 MB para no tocar disco temporal).
--       monitor_salud_archivos()    → archivos por bucket (total, 7 y 30 días).
--       monitor_salud_base()        → tamaño de la base, tablas grandes, conexiones, caché, tablas más movidas.
--       monitor_salud_revision()    → tres revisiones de seguridad baratas (sin RLS, SELECT abiertas, definer para anon).
--   · Si una falla por tiempo, las demás tarjetas siguen (la app las pide por separado).
--   · `monitor_salud()` (300) queda sin usar por la app; se puede borrar en una migración posterior.
--
-- Solo admin (`public.is_admin()`), SECURITY DEFINER con search_path fijo; anon no las ejecuta.

-- ===========================================================================
-- 1) Escrituras: una sola lectura de pg_stat_statements.
-- ===========================================================================
create or replace function public.monitor_salud_escrituras()
  returns jsonb language plpgsql stable security definer
  set search_path = public, extensions, pg_catalog
  set work_mem = '64MB' as $$
declare r jsonb;
begin
  if not public.is_admin() then
    raise exception 'monitor: solo el admin' using errcode = '42501';
  end if;

  with p as materialized (
    select s.queryid, s.calls, s.wal_bytes, s.total_exec_time, s.query
      from extensions.pg_stat_statements s
  )
  select jsonb_build_object(
    'estadisticas_desde', (select i.stats_reset from extensions.pg_stat_statements_info i),
    'wal_total', (select coalesce(sum(p.wal_bytes), 0) from p),
    'escrituras', coalesce((
      select jsonb_agg(x) from (
        select left(regexp_replace(p.query, '\s+', ' ', 'g'), 220) as consulta, p.calls, p.wal_bytes,
               round(p.total_exec_time)::bigint as ms
          from p
         where p.wal_bytes > 0
         order by p.wal_bytes desc limit 12) x), '[]'::jsonb)
  ) into r;
  return r;
end;
$$;

-- ===========================================================================
-- 2) Archivos por bucket.
-- ===========================================================================
create or replace function public.monitor_salud_archivos()
  returns jsonb language plpgsql stable security definer
  set search_path = public, extensions, pg_catalog as $$
declare r jsonb;
begin
  if not public.is_admin() then
    raise exception 'monitor: solo el admin' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(b order by b.bytes desc), '[]'::jsonb) into r from (
    select o.bucket_id as bucket, count(*) as archivos,
           coalesce(sum((o.metadata->>'size')::bigint), 0) as bytes,
           coalesce(sum((o.metadata->>'size')::bigint) filter (where o.created_at > now() - interval '7 days'), 0) as bytes_7d,
           coalesce(sum((o.metadata->>'size')::bigint) filter (where o.created_at > now() - interval '30 days'), 0) as bytes_30d
      from storage.objects o group by o.bucket_id) b;
  return r;
end;
$$;

-- ===========================================================================
-- 3) Base: tamaño, tablas, conexiones, caché, tablas más movidas.
-- ===========================================================================
create or replace function public.monitor_salud_base()
  returns jsonb language plpgsql stable security definer
  set search_path = public, extensions, pg_catalog as $$
declare r jsonb;
begin
  if not public.is_admin() then
    raise exception 'monitor: solo el admin' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'generado', now(),
    'db_bytes', pg_database_size(current_database()),
    'tablas', coalesce((
      select jsonb_agg(t order by t.bytes desc) from (
        select n.nspname || '.' || c.relname as nombre, pg_total_relation_size(c.oid) as bytes
          from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where c.relkind = 'r' and n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
         order by pg_total_relation_size(c.oid) desc limit 10) t), '[]'::jsonb),
    'conexiones', (select count(*) from pg_stat_activity),
    'conexiones_max', current_setting('max_connections')::int,
    'cache_aciertos', (
      select round(100.0 * sum(d.blks_hit) / nullif(sum(d.blks_hit) + sum(d.blks_read), 0), 2)
        from pg_stat_database d where d.datname = current_database()),
    'movidas', coalesce((
      select jsonb_agg(m order by m.cambios desc) from (
        select s.schemaname || '.' || s.relname as tabla, (s.n_tup_ins + s.n_tup_upd + s.n_tup_del) as cambios,
               s.n_dead_tup as muertas, s.last_autovacuum
          from pg_stat_user_tables s
         order by (s.n_tup_ins + s.n_tup_upd + s.n_tup_del) desc limit 8) m), '[]'::jsonb)
  ) into r;
  return r;
end;
$$;

-- ===========================================================================
-- 4) Revisión rápida de seguridad.
-- ===========================================================================
create or replace function public.monitor_salud_revision()
  returns jsonb language plpgsql stable security definer
  set search_path = public, extensions, pg_catalog as $$
declare r jsonb;
begin
  if not public.is_admin() then
    raise exception 'monitor: solo el admin' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'sin_rls', (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
                 where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
    'select_abiertas', (select count(*) from pg_policies p
                 where p.schemaname = 'public' and p.cmd in ('SELECT', 'ALL') and p.qual = 'true'
                   and ('authenticated' = any(p.roles) or 'public' = any(p.roles))),
    'definer_anon', (select count(*) from pg_proc f join pg_namespace n on n.oid = f.pronamespace
                 where n.nspname = 'public' and f.prosecdef and has_function_privilege('anon', f.oid, 'execute'))
  ) into r;
  return r;
end;
$$;

-- ===========================================================================
-- Permisos: solo `authenticated` (el admin lo filtra is_admin) y service_role; nunca anon ni public.
-- ===========================================================================
revoke all on function public.monitor_salud_escrituras() from public, anon;
revoke all on function public.monitor_salud_archivos() from public, anon;
revoke all on function public.monitor_salud_base() from public, anon;
revoke all on function public.monitor_salud_revision() from public, anon;
grant execute on function public.monitor_salud_escrituras() to authenticated;
grant execute on function public.monitor_salud_archivos() to authenticated;
grant execute on function public.monitor_salud_base() to authenticated;
grant execute on function public.monitor_salud_revision() to authenticated;

-- ===========================================================================
-- Autocomprobacion
-- ===========================================================================
do $chk$
declare f text; nombre text;
begin
  foreach nombre in array array[
    'public.monitor_salud_escrituras()', 'public.monitor_salud_archivos()',
    'public.monitor_salud_base()', 'public.monitor_salud_revision()'] loop
    if has_function_privilege('anon', nombre, 'execute') then
      raise exception '307: anon no debe ejecutar %', nombre;
    end if;
    f := pg_get_functiondef(nombre::regprocedure);
    if position('public.is_admin()' in f) = 0 then
      raise exception '307: % debe exigir admin', nombre;
    end if;
  end loop;
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('307_monitor_salud_partes.sql', '14390da2ce955e77ad5e8dfb8b41964e8c070e3fa4d6e6ffc1e3c7fbd1c20a01') on conflict (name) do nothing;
