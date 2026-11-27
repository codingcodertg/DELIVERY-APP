-- ---------------------------------------------------------------------------
-- 356 · Las fallas de los crons quedan en «Fallas de la app» (auditoría lote 2, 2026-11-27)
-- ---------------------------------------------------------------------------
-- POR QUÉ. La base marca un cron como «succeeded» en cuanto pg_net SALE la petición; nadie mira el código HTTP que
-- vuelve. Evidencia del 27 nov: cron.job_run_details tenía fallas «job startup timeout» (tt-clockin, rc-comms,
-- rc-choferes, gmail-indeed) y public.app_errors estaba VACÍA: ninguna falla llegó a la pantalla ni a nadie.
--
-- QUÉ AÑADE, y solo esto:
--   · public.cron_peticiones: el número de cada petición de pg_net → la ruta que la pidió. pg_net guarda la respuesta
--     pero no la URL, y sin esta tabla una respuesta 500 no diría de qué cron es. llama_cron la llena (ver abajo).
--   · public.cron_revision_fallas: la marca de la última revisión (una sola fila), para que cada corrida mire solo
--     lo nuevo y ninguna falla se cuente dos veces.
--   · public.revisa_fallas_de_cron(): cada 15 minutos mira dos fuentes y llama a public.registrar_falla (origen 'cron',
--     app 'cron') UNA vez por grupo (trabajo o ruta + tipo de falla), con el conteo en el mensaje:
--       - cron.job_run_details con status = 'failed' (p. ej. «job startup timeout»; el trabajo ni llegó a salir);
--       - net._http_response con status_code >= 400, timed_out o error_msg (la respuesta de la ruta salió mal).
--     Huella = 16 hex de md5(trabajo + tipo): la misma falla del mismo trabajo cae siempre en la misma fila del día.
--   · llama_cron: igual que la 343, más una línea que guarda la ruta de cada petición en cron_peticiones.
--   · pg_cron: «revisa-fallas-de-cron» cada 15 minutos.
--
-- CÓMO SE MIDE (y sus límites):
--   · Ventana sin solape: (marca anterior, ahora - 2 min]. El margen de 2 minutos evita perder una corrida que termina
--     justo al revisar. La ventana nunca pasa de 2 horas (un cron caído no inunda la pantalla al volver).
--   · registrar_falla cuenta «veces» de 1 en 1, así que un grupo de 5 fallas entra como UNA llamada con «(x5 en 15 min)»
--     en el mensaje. Así no se llama miles de veces y el tope por hora de registrar_falla no se come las demás fallas.
--   · Los topes de registrar_falla para origen no-cliente (100 por persona o sin persona, y 1000 en total por hora) se
--     aplican también a los crons. Las fallas de cron van sin persona: con los crons actuales (5 trabajos, uno cada
--     2 a 15 minutos) caben de sobra; si algún día pasan de 100 por hora, el exceso se descarta en silencio.
--
-- Sin begin/commit propios: quien aplica envuelve el fichero en una transacción (como 352, 353).
-- Idempotente: create table/function con «if not exists» / «or replace», y el cron se desprograma si ya existe.
-- SIN APLICAR. Hasta que el orquestador lo aplique, llama_cron sigue igual que en la 343 y nada se registra.
--
-- Para deshacer (a mano, en una transacción propia):
--   select cron.unschedule('revisa-fallas-de-cron');
--   (y volver a crear llama_cron como en la 343)
--   drop function if exists public.revisa_fallas_de_cron();
--   drop table if exists public.cron_peticiones;
--   drop table if exists public.cron_revision_fallas;
--   delete from public.schema_migrations where name = '356_revisa_fallas_de_cron.sql';
-- ---------------------------------------------------------------------------

create table if not exists public.cron_peticiones (
  request_id  bigint primary key,
  ruta        text not null,
  created_at  timestamptz not null default now()
);
alter table public.cron_peticiones enable row level security;
-- Sin políticas a propósito: solo postgres (la función de cron y llama_cron) la leen o escriben.
revoke all on table public.cron_peticiones from public, anon, authenticated;

create table if not exists public.cron_revision_fallas (
  id              smallint primary key default 1 check (id = 1),
  revisado_hasta  timestamptz not null
);
alter table public.cron_revision_fallas enable row level security;
revoke all on table public.cron_revision_fallas from public, anon, authenticated;

-- llama_cron: la definición VIVA (leída de pg_get_functiondef) era la de la 343; se conserva entera y se añade
-- solo el guardado del número de petición, que antes se tiraba con «perform».
create or replace function public.llama_cron(p_ruta text)
  returns void language plpgsql security definer set search_path = '' as $$
declare
  boleto text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_peticion bigint;
begin
  -- Solo rutas de cron de esta app: la función no sirve para llamar a otra parte.
  if p_ruta !~ '^/api/cron/[a-z0-9/-]+$' and p_ruta <> '/timetracker/clock-in/api/cron' then
    raise exception 'llama_cron: ruta no permitida' using errcode = '22023';
  end if;
  delete from public.cron_tickets where created_at < now() - interval '1 hour';
  insert into public.cron_tickets (token, ruta) values (boleto, p_ruta);
  v_peticion := net.http_get(
    url := 'https://rtg-hub.vercel.app' || p_ruta,
    headers := jsonb_build_object('Authorization', 'Bearer boleto:' || boleto),
    timeout_milliseconds := 60000
  );
  -- Para que la revisión de fallas sepa qué ruta pidió cada respuesta (pg_net no guarda la URL).
  insert into public.cron_peticiones (request_id, ruta) values (v_peticion, p_ruta);
end $$;
revoke all on function public.llama_cron(text) from public, anon, authenticated;

create or replace function public.revisa_fallas_de_cron()
  returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_desde   timestamptz;
  v_hasta   timestamptz := now() - interval '2 minutes';
  v_marca   timestamptz;
  v_n       integer := 0;
  r         record;
begin
  -- Marca de la última revisión. La primera vez empieza 15 minutos atrás; nunca más de 2 horas atrás.
  insert into public.cron_revision_fallas (id, revisado_hasta) values (1, now() - interval '15 minutes')
    on conflict (id) do nothing;
  select revisado_hasta into v_marca from public.cron_revision_fallas where id = 1 for update;
  v_desde := greatest(v_marca, now() - interval '2 hours');
  if v_hasta <= v_desde then
    return 0;
  end if;

  -- 1) Trabajos de pg_cron que terminaron en 'failed'. El nombre puede faltar si el trabajo ya se borró: se usa el número.
  for r in
    select x.nombre, x.motivo, count(*) as veces
      from (
        select coalesce(j.jobname, 'job ' || d.jobid::text) as nombre,
               left(coalesce(nullif(split_part(coalesce(d.return_message, ''), chr(10), 1), ''), 'fallo sin mensaje'), 200) as motivo
          from cron.job_run_details d
          left join cron.job j on j.jobid = d.jobid
         where d.status = 'failed'
           and coalesce(d.end_time, d.start_time) > v_desde
           and coalesce(d.end_time, d.start_time) <= v_hasta
      ) x
     group by x.nombre, x.motivo
  loop
    perform public.registrar_falla(
      'cron'::text, 'cron'::text, r.nombre::text,
      left(r.nombre || ': ' || r.motivo || case when r.veces > 1 then ' (x' || r.veces || ' en 15 min)' else '' end, 500),
      null::text, 'pg_cron'::text, null::text, null::text, null::text, false,
      left(md5('job|' || r.nombre || '|' || r.motivo), 16),
      null::uuid
    );
    v_n := v_n + 1;
  end loop;

  -- 2) Respuestas HTTP de las rutas de cron que salieron mal. La ruta viene de cron_peticiones; sin ella, «pg_net».
  --    El mensaje no lleva el cuerpo de la respuesta ni el boleto: solo el código o el error recortado.
  for r in
    select x.ruta, x.tipo, count(*) as veces
      from (
        select coalesce(p.ruta, 'pg_net') as ruta,
               case
                 when h.timed_out then 'sin respuesta (tiempo agotado)'
                 when h.error_msg is not null then 'error de red: '
                   || left(regexp_replace(regexp_replace(h.error_msg, 'Bearer\s+\S+', '[oculto]', 'gi'), 'boleto:\S+', '[oculto]', 'g'), 120)
                 else 'HTTP ' || h.status_code::text
               end as tipo
          from net._http_response h
          left join public.cron_peticiones p on p.request_id = h.id
         where h.created > v_desde
           and h.created <= v_hasta
           and (h.status_code >= 400 or h.timed_out or h.error_msg is not null)
      ) x
     group by x.ruta, x.tipo
  loop
    perform public.registrar_falla(
      'cron'::text, 'cron'::text, r.ruta::text,
      left(r.ruta || ': ' || r.tipo || case when r.veces > 1 then ' (x' || r.veces || ' en 15 min)' else '' end, 500),
      null::text, 'pg_net'::text, null::text, null::text, null::text, false,
      left(md5('http|' || r.ruta || '|' || r.tipo), 16),
      null::uuid
    );
    v_n := v_n + 1;
  end loop;

  -- Retención de la tabla de peticiones (la ventana nunca mira más de 2 horas atrás).
  delete from public.cron_peticiones where created_at < now() - interval '2 days';

  update public.cron_revision_fallas set revisado_hasta = v_hasta where id = 1;
  return v_n;
end $$;
revoke all on function public.revisa_fallas_de_cron() from public, anon, authenticated;

-- Cada 15 minutos. Idempotente: si ya existe, se desprograma y se vuelve a programar.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'revisa-fallas-de-cron') then
    perform cron.unschedule('revisa-fallas-de-cron');
  end if;
end $$;

select cron.schedule('revisa-fallas-de-cron', '*/15 * * * *', $cron$select public.revisa_fallas_de_cron()$cron$);

-- Comprobación: si algo de lo anterior no quedó como se decidió, la migración falla aquí.
do $$
begin
  if to_regprocedure('public.revisa_fallas_de_cron()') is null then
    raise exception 'La 356 no creó public.revisa_fallas_de_cron';
  end if;
  if not exists (select 1 from pg_proc where oid = 'public.revisa_fallas_de_cron()'::regprocedure and prosecdef
                  and coalesce(array_to_string(proconfig, ','), '') like '%search_path=%') then
    raise exception 'La 356: revisa_fallas_de_cron debe ser SECURITY DEFINER con search_path fijo';
  end if;
  if not exists (select 1 from pg_proc where oid = 'public.llama_cron(text)'::regprocedure and prosecdef) then
    raise exception 'La 356 dejó llama_cron sin SECURITY DEFINER';
  end if;
  if has_function_privilege('anon', 'public.revisa_fallas_de_cron()', 'execute')
     or has_function_privilege('authenticated', 'public.revisa_fallas_de_cron()', 'execute') then
    raise exception 'La 356 dejó revisa_fallas_de_cron ejecutable por anon o authenticated';
  end if;
  if not exists (select 1 from pg_class where relname = 'cron_peticiones' and relrowsecurity) then
    raise exception 'La 356 no activó RLS en cron_peticiones';
  end if;
  if not exists (select 1 from cron.job where jobname = 'revisa-fallas-de-cron' and schedule = '*/15 * * * *') then
    raise exception 'La 356 no programó revisa-fallas-de-cron cada 15 minutos';
  end if;
end $$;
-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('356_revisa_fallas_de_cron.sql', '2dc52b5aac45e06b46ffae30714d81645113429878bff98d5adb75b1661f8718') on conflict (name) do nothing;
