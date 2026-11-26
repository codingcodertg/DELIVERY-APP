-- ---------------------------------------------------------------------------
-- 352 · Fallas de la app: la propia app registra dónde falla (sin servicio de terceros)
-- ---------------------------------------------------------------------------
-- PEDIDO. El dueño, 2026-11-25: «quiero que la misma app tenga su crash detection y que sepa dónde falla para poder
-- mejorarlo». Este fichero crea el sitio donde caen esas fallas; la captura (navegador, servidor, cron) va en el código.
--
-- QUÉ AÑADE, y solo esto:
--   · public.app_errors: una fila por falla AGRUPADA. La huella (origen + ruta + primera línea del mensaje + primer marco
--     de la pila) dice «es la misma falla»; `veces` y `ultima_vez` cuentan cuántas veces pasó ese día.
--   · public.registrar_falla(...): la ÚNICA puerta de escritura, y solo la puede ejecutar service_role. Quien la llama
--     (la ruta /api/fallas o el gancho de instrumentation.ts) pone el usuario y el rol que leyó de la SESIÓN en el
--     servidor; ningún cliente la llama directamente. La función valida el origen, el formato de la huella y, al
--     insertar, recorta cada texto a su tope.
--   · Frenos: las fallas que manda el navegador (origen 'cliente') cuentan 50 por usuario y hora. Las del servidor
--     (cualquier otro origen) cuentan aparte: 500 por hora en total. Así el spam de un cliente no tapa las fallas del
--     servidor, y al revés. Lo que pase del tope se descarta en silencio, sin error.
--   · Retención: un cron diario borra lo que tenga más de 60 días.
--   · RLS: leer solo el admin (public.is_admin(), el mismo de las tablas de administración). Ningún rol escribe la
--     tabla directamente: ni INSERT, ni UPDATE, ni DELETE para anon ni authenticated.
--
-- CÓMO LA APP SE COMPORTA SIN ESTA MIGRACIÓN (no aplicada todavía): /api/fallas responde 204 y no hace nada; la pantalla
-- «Fallas de la app» sale vacía con un aviso. Nada se rompe, y el aviso de error de la app sigue saliendo igual.
--
-- Sin begin/commit propios: quien aplica envuelve el fichero en una transacción (como 348, 350 y 351).
-- Idempotente: `create table if not exists`, `create or replace`, políticas con drop + create.
-- SIN APLICAR. Hasta que el dueño lo diga, no existe en la base.
--
-- Para deshacer (a mano, en una transacción propia):
--   select cron.unschedule('limpia-fallas-de-la-app');
--   drop function if exists public.registrar_falla(text, text, text, text, text, text, text, text, text, boolean, text, uuid);
--   drop table if exists public.app_errors;
--   delete from public.schema_migrations where name = '352_fallas_de_la_app.sql';
-- ---------------------------------------------------------------------------

create table if not exists public.app_errors (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  origen      text not null check (origen in ('cliente', 'servidor', 'accion', 'api', 'cron')),
  app         text not null check (char_length(app) <= 40),
  ruta        text not null check (char_length(ruta) <= 300),
  mensaje     text not null check (char_length(mensaje) <= 500),
  pila        text check (pila is null or char_length(pila) <= 4000),
  componente  text check (componente is null or char_length(componente) <= 120),
  user_id     uuid references auth.users (id) on delete set null,
  rol         text check (rol is null or char_length(rol) <= 40),
  version     text check (version is null or char_length(version) <= 40),
  navegador   text check (navegador is null or char_length(navegador) <= 300),
  escritorio  boolean not null default false,
  huella      text not null check (huella ~ '^[0-9a-f]{16}$'),
  veces       integer not null default 1,
  ultima_vez  timestamptz not null default now(),
  -- Los usuarios distintos que tuvieron esta falla ese día (tope 200): para el «usuarios afectados» de la pantalla.
  usuarios    uuid[] not null default '{}'
);

create index if not exists app_errors_huella_idx on public.app_errors (huella);
create index if not exists app_errors_created_at_desc_idx on public.app_errors (created_at desc);
create index if not exists app_errors_usuario_fecha_idx on public.app_errors (user_id, created_at desc);

alter table public.app_errors enable row level security;

-- Solo lectura para el admin. Ninguna política de escritura: la tabla la escribe registrar_falla y nadie más.
drop policy if exists app_errors_select_admin on public.app_errors;
drop policy if exists app_errors_insert_propia on public.app_errors;
create policy app_errors_select_admin on public.app_errors
  for select to authenticated
  using (public.is_admin());

revoke all on table public.app_errors from anon, authenticated;
grant select on table public.app_errors to authenticated;

create or replace function public.registrar_falla(
  p_origen     text,
  p_app        text,
  p_ruta       text,
  p_mensaje    text,
  p_pila       text,
  p_componente text,
  p_rol        text,
  p_version    text,
  p_navegador  text,
  p_escritorio boolean,
  p_huella     text,
  p_usuario    uuid default null
) returns void
  language plpgsql security definer set search_path = public as $$
declare
  v_id      uuid;
  v_cliente integer;
  v_servidor integer;
begin
  -- Validación: lo que no cumple se descarta, nunca se lanza un error hacia quien falla.
  if p_origen is null or p_origen not in ('cliente', 'servidor', 'accion', 'api', 'cron') then return; end if;
  if coalesce(p_mensaje, '') = '' then return; end if;
  if p_huella is null or p_huella !~ '^[0-9a-f]{16}$' then return; end if;

  -- Frenos, por separado. Cliente: 50 por usuario y hora. Servidor: 500 por hora en total.
  if p_origen = 'cliente' then
    if p_usuario is null then return; end if;
    select count(*) into v_cliente from public.app_errors
     where origen = 'cliente' and user_id = p_usuario and created_at > now() - interval '1 hour';
    if v_cliente >= 50 then return; end if;
  else
    select count(*) into v_servidor from public.app_errors
     where origen <> 'cliente' and created_at > now() - interval '1 hour';
    if v_servidor >= 500 then return; end if;
  end if;

  -- Misma falla, mismo día: se cuenta, no se duplica.
  select id into v_id
    from public.app_errors
   where huella = p_huella
     and created_at >= date_trunc('day', now())
   order by created_at desc
   limit 1;

  if v_id is not null then
    update public.app_errors
       set veces = veces + 1,
           ultima_vez = now(),
           usuarios = case
             when p_usuario is null or p_usuario = any (usuarios) or cardinality(usuarios) >= 200 then usuarios
             else array_append(usuarios, p_usuario)
           end
     where id = v_id;
  else
    insert into public.app_errors (origen, app, ruta, mensaje, pila, componente, user_id, rol, version, navegador,
                                   escritorio, huella, usuarios)
    values (
      p_origen,
      left(coalesce(nullif(p_app, ''), 'deliveries'), 40),
      left(coalesce(nullif(p_ruta, ''), '/'), 300),
      left(p_mensaje, 500),
      left(p_pila, 4000),
      left(p_componente, 120),
      p_usuario,
      left(p_rol, 40),
      left(p_version, 40),
      left(p_navegador, 300),
      coalesce(p_escritorio, false),
      p_huella,
      case when p_usuario is null then '{}'::uuid[] else array[p_usuario] end
    );
  end if;
end $$;

-- Un único camino de escritura: solo service_role (la ruta /api/fallas y el gancho del servidor, con la llave de servicio).
revoke all on function public.registrar_falla(text, text, text, text, text, text, text, text, text, boolean, text, uuid)
  from public, anon, authenticated;
grant execute on function public.registrar_falla(text, text, text, text, text, text, text, text, text, boolean, text, uuid)
  to service_role;

-- Retención: cada día a las 9:30 (hora de la base), se borra lo que tenga más de 60 días.
select cron.schedule('limpia-fallas-de-la-app', '30 9 * * *', $cron$delete from public.app_errors where created_at < now() - interval '60 days'$cron$);

-- Comprobación: el fichero entero tiene que dejar la tabla, sus columnas clave y la función. Si algo falta, falla aquí.
do $$
declare
  faltan text[];
begin
  select array_agg(c) into faltan
    from unnest(array['origen', 'app', 'ruta', 'mensaje', 'pila', 'huella', 'veces', 'ultima_vez', 'usuarios', 'escritorio']) as c
   where not exists (
     select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'app_errors' and column_name = c
   );
  if faltan is not null then
    raise exception 'La 352 no dejó las columnas de app_errors: %', faltan;
  end if;
  if not exists (select 1 from pg_class where relname = 'app_errors' and relrowsecurity) then
    raise exception 'La 352 no activó RLS en app_errors';
  end if;
  if to_regprocedure('public.registrar_falla(text,text,text,text,text,text,text,text,text,boolean,text,uuid)') is null then
    raise exception 'La 352 no creó public.registrar_falla';
  end if;
  if has_table_privilege('authenticated', 'public.app_errors', 'INSERT') then
    raise exception 'La 352 dejó INSERT directo a authenticated en app_errors';
  end if;
end $$;
-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('352_fallas_de_la_app.sql', 'd5a936e228a371c4c8d7e62ca6213187f1d6ee7080931ca2cad7c10a3c146343') on conflict (name) do nothing;
