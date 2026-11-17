-- ===========================================================================
-- 320 · Monitoreo de seguridad: eventos, alertas y bloqueos automáticos
-- ===========================================================================
-- QUÉ AÑADE. Tres tablas y tres RPC de admin:
--   · public.sec_events  — rastro de eventos (auth, api_denied, export, admin, ...). Solo lo escribe el servidor
--                          con la llave de servicio. NUNCA contiene contraseñas ni valores personales: el
--                          identificador de un login fallido llega ya como hash SHA-256 del navegador.
--   · public.sec_alerts  — lo que los detectores encontraron (cron /api/cron/seguridad). El admin la marca vista
--                          o cerrada desde el panel (RPC seguridad_marca_alerta).
--   · public.sec_blocks  — bloqueos activos por IP (o por usuario/dispositivo). Los pone el cron (origen 'auto') o
--                          el admin (origen 'admin', RPC seguridad_bloquea_ip). Se quitan con seguridad_quita_bloqueo.
-- RLS: lectura solo para admin (is_admin()). Ninguna escritura directa desde el navegador: el servidor escribe con
-- la llave de servicio (salta la RLS) y el admin solo cambia estado/bloqueos por las RPC de abajo.
-- Retención: purga_seguridad() borra eventos de más de 180 días, bloqueos vencidos y contadores del limitador de más de
-- 1 día (rate_limits, 282). Se programa con pg_cron SOLO si existe la función llama_cron_del_hub (migración 319, en
-- otra rama) para el cron de detectores; la purga se programa siempre que pg_cron exista.
--
-- Sin begin/commit propios. Para deshacer:
--   select cron.unschedule('seguridad-monitoreo'); select cron.unschedule('seguridad-purga');  -- si estaban
--   alter publication supabase_realtime drop table public.sec_alerts;
--   drop function if exists public.seguridad_quita_bloqueo(bigint), public.seguridad_bloquea_ip(text, int, text),
--     public.seguridad_marca_alerta(bigint, text), public.purga_seguridad();
--   drop table if exists public.sec_blocks, public.sec_alerts, public.sec_events;
--   delete from public.schema_migrations where name = '320_monitoreo_de_seguridad.sql';

-- ---------------------------------------------------------------------------
-- 1. Eventos
-- ---------------------------------------------------------------------------
create table if not exists public.sec_events (
  id          bigserial primary key,
  ts          timestamptz not null default now(),
  categoria   text not null check (categoria in ('auth','api_denied','export','admin','device','ratelimit','upload','cron','impersonation')),
  severidad   smallint not null default 1 check (severidad between 1 and 5),
  usuario_id  uuid,
  rol         text,
  ip          inet,
  ip_pais     text,
  ua_hash     text,
  device_id   text,
  metodo      text,
  ruta        text,
  estado      int,
  objetivo_tipo text,
  objetivo_id   text,
  filas       int,
  meta        jsonb
);

create index if not exists sec_events_ts_idx        on public.sec_events (ts desc);
create index if not exists sec_events_categoria_idx on public.sec_events (categoria, ts);
create index if not exists sec_events_ip_idx        on public.sec_events (ip, ts);
create index if not exists sec_events_usuario_idx   on public.sec_events (usuario_id, ts);

-- ---------------------------------------------------------------------------
-- 2. Alertas
-- ---------------------------------------------------------------------------
create table if not exists public.sec_alerts (
  id          bigserial primary key,
  creada_en   timestamptz not null default now(),
  detector    text not null,
  severidad   smallint not null check (severidad between 1 and 5),
  usuario_id  uuid,
  ip          inet,
  -- Clave del asunto (un usuario, una IP, un identificador hasheado...). La usa la deduplicación de una hora.
  sujeto      text,
  resumen     text not null,
  estado      text not null default 'abierta' check (estado in ('abierta','vista','cerrada')),
  vista_por   uuid,
  cerrada_en  timestamptz,
  accion      jsonb
);

create index if not exists sec_alerts_estado_idx on public.sec_alerts (estado, creada_en desc);
create index if not exists sec_alerts_dedup_idx  on public.sec_alerts (detector, sujeto, creada_en desc);

-- ---------------------------------------------------------------------------
-- 3. Bloqueos
-- ---------------------------------------------------------------------------
create table if not exists public.sec_blocks (
  id          bigserial primary key,
  alcance     text not null check (alcance in ('usuario','ip','dispositivo')),
  valor       text not null,
  motivo      text,
  hasta       timestamptz not null,
  origen      text not null check (origen in ('auto','admin')),
  creado_por  uuid,
  creado_en   timestamptz not null default now()
);

create index if not exists sec_blocks_activos_idx on public.sec_blocks (alcance, valor, hasta);

-- ---------------------------------------------------------------------------
-- 4. RLS: solo admin lee. Nadie escribe directo (ni anon ni authenticated).
-- ---------------------------------------------------------------------------
alter table public.sec_events enable row level security;
alter table public.sec_alerts enable row level security;
alter table public.sec_blocks enable row level security;

revoke all on public.sec_events, public.sec_alerts, public.sec_blocks from anon;
revoke insert, update, delete, truncate on public.sec_events, public.sec_alerts, public.sec_blocks from authenticated;
grant select on public.sec_events, public.sec_alerts, public.sec_blocks to authenticated;

drop policy if exists "sec_events admin lee" on public.sec_events;
create policy "sec_events admin lee" on public.sec_events for select to authenticated using (public.is_admin());

drop policy if exists "sec_alerts admin lee" on public.sec_alerts;
create policy "sec_alerts admin lee" on public.sec_alerts for select to authenticated using (public.is_admin());

drop policy if exists "sec_blocks admin lee" on public.sec_blocks;
create policy "sec_blocks admin lee" on public.sec_blocks for select to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------------
-- 5. RPC de admin (security definer, con comprobación de rol dentro)
-- ---------------------------------------------------------------------------
-- Marca una alerta: 'vista' (guarda quién) o 'cerrada' (guarda cuándo) o 'abierta' (la reabre).
create or replace function public.seguridad_marca_alerta(p_id bigint, p_estado text)
  returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then
    raise exception 'solo un admin cambia las alertas de seguridad' using errcode = '42501';
  end if;
  if p_estado not in ('abierta','vista','cerrada') then
    raise exception 'estado invalido' using errcode = '22023';
  end if;
  update public.sec_alerts set
    estado = p_estado,
    vista_por = case when p_estado = 'vista' then auth.uid() else vista_por end,
    cerrada_en = case when p_estado = 'cerrada' then now() else null end
  where id = p_id;
  return found;
end $$;

-- Bloquea una IP durante N horas (1..168) desde el panel. Devuelve el id del bloqueo.
create or replace function public.seguridad_bloquea_ip(p_ip text, p_horas int, p_motivo text)
  returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare nuevo bigint;
begin
  if not public.is_admin() then
    raise exception 'solo un admin bloquea IPs' using errcode = '42501';
  end if;
  if p_ip is null or btrim(p_ip) = '' then
    raise exception 'IP vacia' using errcode = '22023';
  end if;
  if p_horas is null or p_horas < 1 or p_horas > 168 then
    raise exception 'horas fuera de 1..168' using errcode = '22023';
  end if;
  insert into public.sec_blocks (alcance, valor, motivo, hasta, origen, creado_por)
    values ('ip', btrim(p_ip), left(coalesce(p_motivo, 'Bloqueo manual'), 300), now() + make_interval(hours => p_horas), 'admin', auth.uid())
    returning id into nuevo;
  return nuevo;
end $$;

-- Quita un bloqueo (el de la IP, o cualquiera).
create or replace function public.seguridad_quita_bloqueo(p_id bigint)
  returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then
    raise exception 'solo un admin quita bloqueos' using errcode = '42501';
  end if;
  delete from public.sec_blocks where id = p_id;
  return found;
end $$;

revoke all on function public.seguridad_marca_alerta(bigint, text) from public, anon;
revoke all on function public.seguridad_bloquea_ip(text, int, text) from public, anon;
revoke all on function public.seguridad_quita_bloqueo(bigint) from public, anon;
grant execute on function public.seguridad_marca_alerta(bigint, text) to authenticated;
grant execute on function public.seguridad_bloquea_ip(text, int, text) to authenticated;
grant execute on function public.seguridad_quita_bloqueo(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Retención
-- ---------------------------------------------------------------------------
create or replace function public.purga_seguridad()
  returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare e int := 0; b int := 0; r int := 0;
begin
  delete from public.sec_events where ts < now() - interval '180 days';
  get diagnostics e = row_count;
  delete from public.sec_blocks where hasta < now();
  get diagnostics b = row_count;
  -- Contadores del limitador (282): solo sirven durante su ventana.
  delete from public.rate_limits where window_start < now() - interval '1 day';
  get diagnostics r = row_count;
  return jsonb_build_object('eventos', e, 'bloqueos', b, 'contadores', r);
end $$;
revoke all on function public.purga_seguridad() from public, anon, authenticated;
grant execute on function public.purga_seguridad() to service_role;

-- ---------------------------------------------------------------------------
-- 7. Tiempo real: las alertas llegan al panel en vivo
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sec_alerts') then
    alter publication supabase_realtime add table public.sec_alerts;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 8. Programación (solo si pg_cron está y, para los detectores, si existe llama_cron_del_hub de la 319).
--    Si no existe, no se crea nada: el cron de detectores se programa cuando llegue la 319.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'seguridad-purga') then
      perform cron.unschedule('seguridad-purga');
    end if;
    perform cron.schedule('seguridad-purga', '17 3 * * *', $cmd$select public.purga_seguridad()$cmd$);
    if exists (select 1 from pg_proc where proname = 'llama_cron_del_hub') then
      if exists (select 1 from cron.job where jobname = 'seguridad-monitoreo') then
        perform cron.unschedule('seguridad-monitoreo');
      end if;
      perform cron.schedule('seguridad-monitoreo', '*/5 * * * *', $cmd$select public.llama_cron_del_hub('/api/cron/seguridad')$cmd$);
    end if;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 8b. Cambios de privilegio escritos por la BASE, no por el navegador.
-- Un trigger en profiles registra en sec_events (categoria 'admin') cada cambio de rol, nivel o permiso. Lo escribe
-- la base misma (security definer): el navegador no puede falsificarlo ni saltárselo con un insert directo. El
-- detector «admin-nuevo» lee SOLO estas filas. Si el trigger falla, se avisa pero NO se bloquea el cambio del perfil.
-- ---------------------------------------------------------------------------
create or replace function public.seguridad_registra_cambio_de_perfil()
  returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  campo text;
  antes text;
  despues text;
  campos text[] := array['role','recruiting_role','timetracker_role','erp_role','customers_role','module_access','permissions'];
begin
  foreach campo in array campos loop
    antes := to_jsonb(old) ->> campo;
    despues := to_jsonb(new) ->> campo;
    if antes is distinct from despues then
      begin
        insert into public.sec_events (categoria, severidad, usuario_id, objetivo_tipo, objetivo_id, metodo, meta)
        values (
          'admin',
          case when campo = 'role' and despues = 'admin' then 5 when campo = 'role' then 3 else 2 end,
          auth.uid(),
          'usuario',
          new.id::text,
          'perfil',
          case when campo in ('role','recruiting_role','timetracker_role','erp_role','customers_role')
            then jsonb_build_object('campo', campo, 'antes', antes, 'despues', despues)
            else jsonb_build_object('campo', campo)
          end
        );
      exception when others then
        raise warning 'seguridad: no se pudo registrar el cambio de % en %: %', campo, new.id, sqlerrm;
      end;
    end if;
  end loop;
  return new;
end $$;
revoke all on function public.seguridad_registra_cambio_de_perfil() from public, anon, authenticated;

drop trigger if exists seguridad_cambio_de_perfil on public.profiles;
create trigger seguridad_cambio_de_perfil
  after update of role, recruiting_role, timetracker_role, erp_role, customers_role, module_access, permissions
  on public.profiles
  for each row execute function public.seguridad_registra_cambio_de_perfil();

-- ===========================================================================
-- Autocomprobación
-- ===========================================================================
do $chk$
declare t text;
begin
  foreach t in array array['sec_events', 'sec_alerts', 'sec_blocks'] loop
    if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = t and rowsecurity) then
      raise exception '320: % no tiene RLS', t;
    end if;
  end loop;
  if has_table_privilege('authenticated', 'public.sec_events', 'insert') or has_table_privilege('authenticated', 'public.sec_alerts', 'update')
     or has_table_privilege('authenticated', 'public.sec_blocks', 'delete') then
    raise exception '320: authenticated no debe poder escribir directo en las tablas de seguridad';
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sec_alerts') then
    raise exception '320: sec_alerts no esta en la publicacion de tiempo real';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'seguridad_cambio_de_perfil' and tgrelid = 'public.profiles'::regclass) then
    raise exception '320: falta el trigger de cambios de perfil';
  end if;
  if has_function_privilege('anon', 'public.seguridad_bloquea_ip(text, int, text)', 'execute')
     or has_function_privilege('anon', 'public.purga_seguridad()', 'execute') then
    raise exception '320: anon no debe ejecutar las RPC de seguridad';
  end if;
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('320_monitoreo_de_seguridad.sql', '97f2ad589c0b9934983b90232101ced237eea33c2c1ab5323db9f49bb618a640') on conflict (name) do nothing;
