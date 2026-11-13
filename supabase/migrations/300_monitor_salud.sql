-- 300: Central Hub Monitoring — «Salud del sistema» (2026-11-12).
--
-- El dueño: Supabase avisó «Your project is running out of Disk IO Budget». Para ver si vamos bien o hay que optimizar,
-- la app Central Hub Monitoring (antes Security) tiene una pantalla de salud. Esta migración le da DOS funciones, solo
-- para el admin del hub (`public.is_admin()`), que leen estadísticas del servidor que un usuario normal no puede ver:
--
--   · `monitor_salud()` → jsonb, SOLO LECTURA: tamaño de la base, tablas más grandes, archivos por bucket (y lo subido
--     en 7 y 30 días), las sentencias que más escriben (pg_stat_statements: llamadas y wal_bytes, desde su último
--     reinicio), conexiones en uso contra el máximo, aciertos de caché, tuplas muertas / último autovacuum de las tablas
--     más movidas, y tres revisiones baratas de seguridad (tablas de public sin RLS, políticas SELECT abiertas a
--     authenticated, funciones SECURITY DEFINER de public que anon puede ejecutar).
--   · `monitor_reiniciar_estadisticas()` → reinicia pg_stat_statements, para que la siguiente lectura mida el ritmo de
--     escrituras de AHORA (los números son acumulados desde el último reinicio).
--
-- Las dos son SECURITY DEFINER con search_path fijo; anon no las ejecuta. Additive: no cambia ninguna tabla.
-- 237/238/239 intactas.

create or replace function public.monitor_salud()
  returns jsonb language plpgsql stable security definer set search_path = public, extensions, pg_catalog as $$
declare
  r jsonb;
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
    'buckets', coalesce((
      select jsonb_agg(b order by b.bytes desc) from (
        select o.bucket_id as bucket, count(*) as archivos,
               coalesce(sum((o.metadata->>'size')::bigint), 0) as bytes,
               coalesce(sum((o.metadata->>'size')::bigint) filter (where o.created_at > now() - interval '7 days'), 0) as bytes_7d,
               coalesce(sum((o.metadata->>'size')::bigint) filter (where o.created_at > now() - interval '30 days'), 0) as bytes_30d
          from storage.objects o group by o.bucket_id) b), '[]'::jsonb),
    'estadisticas_desde', (select i.stats_reset from extensions.pg_stat_statements_info i),
    'escrituras', coalesce((
      select jsonb_agg(s order by s.wal_bytes desc) from (
        select left(regexp_replace(p.query, '\s+', ' ', 'g'), 220) as consulta, p.calls, p.wal_bytes,
               round(p.total_exec_time)::bigint as ms
          from extensions.pg_stat_statements p
         where p.wal_bytes > 0
         order by p.wal_bytes desc limit 12) s), '[]'::jsonb),
    'wal_total', (select coalesce(sum(p.wal_bytes), 0) from extensions.pg_stat_statements p),
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
         order by (s.n_tup_ins + s.n_tup_upd + s.n_tup_del) desc limit 8) m), '[]'::jsonb),
    'revision', jsonb_build_object(
      'sin_rls', (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
                   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
      'select_abiertas', (select count(*) from pg_policies p
                   where p.schemaname = 'public' and p.cmd in ('SELECT', 'ALL') and p.qual = 'true'
                     and ('authenticated' = any(p.roles) or 'public' = any(p.roles))),
      'definer_anon', (select count(*) from pg_proc f join pg_namespace n on n.oid = f.pronamespace
                   where n.nspname = 'public' and f.prosecdef and has_function_privilege('anon', f.oid, 'execute'))
    )
  ) into r;
  return r;
end;
$$;

create or replace function public.monitor_reiniciar_estadisticas()
  returns void language plpgsql security definer set search_path = public, extensions, pg_catalog as $$
begin
  if not public.is_admin() then
    raise exception 'monitor: solo el admin' using errcode = '42501';
  end if;
  perform extensions.pg_stat_statements_reset();
end;
$$;

revoke all on function public.monitor_salud() from public, anon;
revoke all on function public.monitor_reiniciar_estadisticas() from public, anon;
grant execute on function public.monitor_salud() to authenticated;
grant execute on function public.monitor_reiniciar_estadisticas() to authenticated;

-- ===========================================================================
-- Autocomprobacion
-- ===========================================================================
do $chk$
declare f text;
begin
  if has_function_privilege('anon', 'public.monitor_salud()', 'execute')
     or has_function_privilege('anon', 'public.monitor_reiniciar_estadisticas()', 'execute') then
    raise exception '300: anon no debe ejecutar las funciones del monitor';
  end if;
  f := pg_get_functiondef('public.monitor_salud()'::regprocedure);
  if position('public.is_admin()' in f) = 0 then
    raise exception '300: monitor_salud debe exigir admin';
  end if;
  f := pg_get_functiondef('public.monitor_reiniciar_estadisticas()'::regprocedure);
  if position('public.is_admin()' in f) = 0 then
    raise exception '300: monitor_reiniciar_estadisticas debe exigir admin';
  end if;
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('300_monitor_salud.sql', 'bb380b778e8cf7ab94780f3dbd1e2db93f50a9ce2cd53e705096761756af901d') on conflict (name) do nothing;
