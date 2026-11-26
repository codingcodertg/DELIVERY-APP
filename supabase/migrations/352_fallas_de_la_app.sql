-- ---------------------------------------------------------------------------
-- 352 · Fallas de la app: la propia app registra dónde falla (sin servicio de terceros)
-- ---------------------------------------------------------------------------
-- PEDIDO. El dueño, 2026-11-25: «quiero que la misma app tenga su crash detection y que sepa dónde falla para poder
-- mejorarlo». Este fichero crea el sitio donde caen esas fallas; la captura (navegador, servidor, cron) va en el código.
--
-- QUÉ AÑADE, y solo esto:
--   · public.app_errors: una fila por falla AGRUPADA. La huella (origen + ruta + primera línea del mensaje + primer marco
--     de la pila) dice «es la misma falla»; `veces` y `ultima_vez` cuentan cuántas veces pasó ese día.
--   · public.registrar_falla(...): la única puerta de escritura. Es SECURITY DEFINER: el usuario sale de `auth.uid()`,
--     nunca de lo que mande el cliente (solo la llave de servicio puede pasar p_usuario, para las fallas del servidor).
--     Agrupa por huella dentro del mismo día y frena: como mucho 50 filas por usuario y hora (y 300 sin usuario por hora);
--     lo que pase del tope se descarta en silencio, sin error, para que una falla que se repite no tumbe nada.
--   · Retención: un cron diario borra lo que tenga más de 60 días.
--   · RLS: leer solo el admin (public.is_admin(), el mismo de las tablas de administración); escribir solo por la función;
--     ni UPDATE ni DELETE para clientes.
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
  app         text not null,
  ruta        text not null,
  mensaje     text not null check (char_length(mensaje) <= 500),
  pila        text check (pila is null or char_length(pila) <= 4000),
  componente  text,
  user_id     uuid references auth.users (id) on delete set null,
  rol         text,
  version     text,
  navegador   text check (navegador is null or char_length(navegador) <= 300),
  escritorio  boolean not null default false,
  huella      text not null,
  veces       integer not null default 1,
  ultima_vez  timestamptz not null default now(),
  -- Los usuarios distintos que tuvieron esta falla ese día (tope 200): para el «usuarios afectados» de la pantalla.
  usuarios    uuid[] not null default '{}'
);

create index if not exists app_errors_huella_idx on public.app_errors (huella);
create index if not exists app_errors_created_at_desc_idx on public.app_errors (created_at desc);

alter table public.app_errors enable row level security;

drop policy if exists app_errors_insert_propia on public.app_errors;
create policy app_errors_insert_propia on public.app_errors
  for insert to authenticated
  with check (user_id is null or user_id = auth.uid());

drop policy if exists app_errors_select_admin on public.app_errors;
create policy app_errors_select_admin on public.app_errors
  for select to authenticated
  using (public.is_admin());

-- Sin políticas de UPDATE ni DELETE: ni el admin borra desde la app. Y anon no toca la tabla.
revoke all on table public.app_errors from anon;
revoke update, delete, truncate on table public.app_errors from authenticated;

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
  v_usuario uuid := case when auth.role() = 'service_role' then p_usuario else auth.uid() end;
  v_id      uuid;
  v_tope    integer;
begin
  -- Entradas sin sentido: se descartan, nunca se lanza un error hacia quien falla.
  if p_origen not in ('cliente', 'servidor', 'accion', 'api', 'cron') or coalesce(p_mensaje, '') = '' or coalesce(p_huella, '') = '' then
    return;
  end if;

  -- Freno: por usuario y hora (o, sin usuario, un tope global de servidor). Lo que pase se descarta sin ruido.
  v_tope := case when v_usuario is null then 300 else 50 end;
  if (select count(*) from public.app_errors
       where user_id is not distinct from v_usuario
         and created_at > now() - interval '1 hour') >= v_tope then
    return;
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
             when v_usuario is null or v_usuario = any (usuarios) or cardinality(usuarios) >= 200 then usuarios
             else array_append(usuarios, v_usuario)
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
      v_usuario,
      left(p_rol, 40),
      left(p_version, 40),
      left(p_navegador, 300),
      coalesce(p_escritorio, false),
      p_huella,
      case when v_usuario is null then '{}'::uuid[] else array[v_usuario] end
    );
  end if;
end $$;

revoke all on function public.registrar_falla(text, text, text, text, text, text, text, text, text, boolean, text, uuid)
  from public, anon;
grant execute on function public.registrar_falla(text, text, text, text, text, text, text, text, text, boolean, text, uuid)
  to authenticated, service_role;

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
end $$;
-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('352_fallas_de_la_app.sql', 'c6d7056308e85952de1661f4e5a527dafbba76c4ab30541408d85f90bc469509') on conflict (name) do nothing;
