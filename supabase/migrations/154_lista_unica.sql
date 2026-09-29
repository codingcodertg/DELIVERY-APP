-- ===========================================================================
-- 154 · Una sola lista por camion: donde va cada RECOGIDA
-- ===========================================================================
-- PEDIDO. El dueno, 2026-09-28, en su especificacion del motor de rutas: "Elimina el concepto de cargas
-- (truckloads) separadas [...] todas las ordenes del conductor van en una sola lista continua". Preguntado si se
-- quitaban los viajes del Gestor: "SI ELIMINA VIAJES". Plan en papel: docs/PLAN-154-lista-unica.md.
--
-- EL HUECO. Una ruta hecha a mano en el Gestor solo guardaba, por orden, el puesto de su ENTREGA (`route_seq`) y
-- su viaje (`load_no`, 033); las recogidas se derivaban por viaje (todas delante de las entregas de ese viaje).
-- En una lista continua, con recogidas y entregas intercaladas (recoger, entregar una parte, volver a recoger con
-- carga a bordo), hay que saber DONDE va cada recogida. Eso no lo guarda ninguna columna.
--
-- QUE HACE:
--   1. `deliveries.pickup_seq numeric` (nulo, sin defecto): la posicion de la recogida de la orden en la lista de
--      su chofer, en la MISMA escala que `route_seq`: entre el puesto de la entrega que tiene delante y el de la
--      que tiene detras (p. ej. 2.5 = entre la entrega 2 y la 3). La escribe la app al guardar la lista y
--      `publish_route_plan` al publicar. Nulo = no se sabe: la app pone la recogida con la regla de siempre.
--   2. `publish_route_plan`: la MISMA funcion de la 135, copiada letra por letra, con UNA linea mas: escribe
--      `pickup_seq` de `writes`. `load_no` se sigue leyendo de `writes` como antes; la app ya no lo manda, asi que
--      queda en `null` en cada orden que se publica (una prueba del repo compara los dos ficheros).
--   3. Comentarios en las dos columnas: `pickup_seq` (que es) y `load_no` (HISTORICO, ya no se escribe).
--
-- QUE NO HACE:
--   - NO borra `load_no` ni toca ningun dato: las filas existentes leen `pickup_seq` nulo. Quitar la columna es un
--     paso aparte, pendiente de la aprobacion del dueno ("No lo elimines sin mi aprobacion").
--   - No toca politicas, grants de tabla, `guard_delivery_stage` (145) ni `guard_factura_obligatoria` (146): la
--     columna nueva sigue las mismas reglas que `route_seq` (misma fila, mismas etapas, mismos roles).
--   - Sin begin/commit: una migracion no lleva su propia transaccion.
--
-- DE DONDE SALE EL CUERPO DE LA FUNCION: de la 135, que es la ultima migracion que toca `publish_route_plan`.
-- ===========================================================================

alter table public.deliveries add column if not exists pickup_seq numeric;

comment on column public.deliveries.pickup_seq is
  'Posicion de la RECOGIDA de la orden en la lista de su chofer, en la misma escala que route_seq (entre el puesto de la entrega anterior y el de la siguiente). Nulo: la app la coloca con su regla. Migracion 154.';
comment on column public.deliveries.load_no is
  'HISTORICO (033): el viaje de la orden. Desde la 154 la ruta es una sola lista y ya no se escribe (se deja en null al guardar o publicar). Pendiente de quitar, con aprobacion del dueno.';

create or replace function public.publish_route_plan(p_plan uuid, p_avisos jsonb default '[]'::jsonb)
  returns jsonb language plpgsql set search_path = public as $$
declare
  rol       text := public.current_user_role();
  plan      public.route_plans%rowtype;
  anterior  uuid;
  viejas    jsonb;
  esperadas integer;
  escritas  integer;
  aviso     jsonb;
  nid       uuid;
  avisados  jsonb := '[]'::jsonb;
begin
  if auth.uid() is null or rol is null or rol not in ('admin', 'logistics') or not public.has_deliveries_access() then
    raise exception 'ROUTE_PLAN_FORBIDDEN: only admin or logistics publish a route' using errcode = '42501';
  end if;

  -- El plan, y el publicado vigente de su fecha, quedan bloqueados hasta el final: dos personas publicando a
  -- la vez se ponen en fila, y la segunda ya no encuentra un borrador o encuentra el plan viejo.
  select * into plan from public.route_plans p where p.id = p_plan for update;
  if not found then raise exception 'ROUTE_PLAN_NOT_FOUND'; end if;
  -- La hoja importada del despachador se guarda para COMPARAR. No se publica nunca, este en el estado que este:
  -- ni escribe ordenes, ni sustituye al plan publicado, ni avisa a nadie.
  if plan.source = 'manual_import' then
    raise exception 'ROUTE_PLAN_IMPORTED: an imported sheet is kept for comparing and is never published';
  end if;
  if plan.status <> 'draft' then raise exception 'ROUTE_PLAN_NOT_DRAFT: %', plan.status; end if;
  select p.id into anterior from public.route_plans p
   where p.plan_date = plan.plan_date and p.status = 'published' for update;

  -- Los avisos son lo UNICO que llega de fuera, asi que se comprueban ANTES de escribir nada: cada uno, para
  -- un chofer que sale en ESTE plan o en el publicado que sustituye (el «te quedaste sin paradas»), y con un
  -- texto de largo razonable. Que cualquiera con sesion pueda ya insertar un aviso (001) no es razon para que
  -- publicar sea ademas un camino para avisar, en nombre del sistema, a quien no toca.
  for aviso in select * from jsonb_array_elements(coalesce(p_avisos, '[]'::jsonb)) loop
    if not exists (select 1 from public.route_plan_stops s
                    where s.driver_id = (aviso->>'driver_id')::uuid and s.plan_id in (p_plan, anterior)) then
      raise exception 'ROUTE_PLAN_BAD_NOTICE: % is not a driver of this plan', aviso->>'driver_id';
    end if;
    if char_length(btrim(coalesce(aviso->>'message', ''))) not between 1 and 300 then
      raise exception 'ROUTE_PLAN_BAD_NOTICE: the message must be 1 to 300 characters';
    end if;
  end loop;

  -- ¿Sigue valiendo? Cada orden de la foto tiene que seguir ahi, en una etapa ruteable, y sin haber cambiado.
  -- Una orden que quien publica NO VE cuenta como que no esta: tampoco la podria escribir.
  select jsonb_agg(jsonb_build_object('id', f->>'id', 'motivo',
           case when d.id is null then 'no_esta'
                when d.stage not in ('pending', 'approved', 'fulfilling', 'ready') then 'fuera_de_etapa'
                else 'cambio' end) order by f->>'id')
    into viejas
    from jsonb_array_elements(coalesce(plan.input->'ordenes', '[]'::jsonb)) f
    left join public.deliveries d on d.id = (f->>'id')::uuid
   where d.id is null
      or d.stage not in ('pending', 'approved', 'fulfilling', 'ready')
      or d.updated_at is distinct from (f->>'updated_at')::timestamptz;
  if viejas is not null then
    raise exception 'ROUTE_PLAN_STALE: %', viejas::text;
  end if;

  -- Escribir, y CONTAR. Las mismas cuatro columnas que escribe el Gestor de Rutas.
  esperadas := jsonb_array_length(plan.writes);
  update public.deliveries d
     set assigned_driver = w->>'assigned_driver',
         route_seq       = (w->>'route_seq')::integer,
         load_no         = (w->>'load_no')::integer,
         pickup_seq      = (w->>'pickup_seq')::numeric,
         load_auto       = true
    from jsonb_array_elements(plan.writes) w
   where d.id = (w->>'id')::uuid;
  get diagnostics escritas = row_count;
  if escritas <> esperadas then
    raise exception 'ROUTE_PLAN_UNSEEN: % of % orders could not be written', esperadas - escritas, esperadas;
  end if;

  -- Marcar. El ajuste es local a esta transaccion: es lo unico que deja pasar estas dos transiciones.
  perform set_config('app.route_publishing', 'on', true);
  update public.route_plans set status = 'superseded' where plan_date = plan.plan_date and status = 'published';
  update public.route_plans set status = 'published', published_by = auth.uid(), published_at = now() where id = p_plan;
  perform set_config('app.route_publishing', 'off', true);

  -- Un aviso por chofer (ya comprobados arriba). El id nace aqui, en una variable: no se lee de vuelta una
  -- fila que es de otra persona.
  for aviso in select * from jsonb_array_elements(coalesce(p_avisos, '[]'::jsonb)) loop
    nid := gen_random_uuid();
    insert into public.notifications (id, user_id, kind, message)
    values (nid, (aviso->>'driver_id')::uuid, 'route_published', btrim(aviso->>'message'));
    avisados := avisados || jsonb_build_object('driver_id', aviso->>'driver_id', 'notification_id', nid);
  end loop;

  return jsonb_build_object('plan_id', p_plan, 'written', escritas, 'notifications', avisados);
end $$;

revoke execute on function public.publish_route_plan(uuid, jsonb) from public, anon;
grant execute on function public.publish_route_plan(uuid, jsonb) to authenticated;

-- ===========================================================================
-- Autocomprobacion (mira el catalogo: sobrevive a re-aplicar el fichero)
-- ===========================================================================
do $comprueba$
declare
  f record;
  c record;
begin
  select data_type, is_nullable, column_default into c
    from information_schema.columns where table_schema = 'public' and table_name = 'deliveries' and column_name = 'pickup_seq';
  if not found then raise exception '154: falta deliveries.pickup_seq'; end if;
  if c.data_type <> 'numeric' then raise exception '154: pickup_seq deberia ser numeric y es %', c.data_type; end if;
  if c.is_nullable <> 'YES' then raise exception '154: pickup_seq tiene que admitir nulo (nulo = la app la coloca)'; end if;
  if c.column_default is not null then raise exception '154: pickup_seq no lleva defecto'; end if;
  -- load_no sigue ahi: quitarla es otro paso, con aprobacion del dueno.
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'deliveries' and column_name = 'load_no') then
    raise exception '154: load_no no se borra en esta migracion';
  end if;

  select p.prosecdef, pg_get_functiondef(p.oid) as def
    into f from pg_proc p where p.oid = 'public.publish_route_plan(uuid, jsonb)'::regprocedure;
  if f.prosecdef then raise exception '154: publish_route_plan NO debe ser security definer'; end if;
  if position('pickup_seq' in f.def) = 0 then raise exception '154: publish_route_plan no escribe pickup_seq'; end if;
  -- Lo que ya hacia (133 y 135), sigue dentro: reemplazar la funcion entera no se llevo nada por delante.
  if position('ROUTE_PLAN_FORBIDDEN' in f.def) = 0 or position('ROUTE_PLAN_NOT_DRAFT' in f.def) = 0
     or position('ROUTE_PLAN_BAD_NOTICE' in f.def) = 0 or position('ROUTE_PLAN_STALE' in f.def) = 0
     or position('ROUTE_PLAN_UNSEEN' in f.def) = 0 or position('ROUTE_PLAN_IMPORTED' in f.def) = 0
     or position('for update' in f.def) = 0 then
    raise exception '154: a publish_route_plan le falta una de las comprobaciones de la 133/135';
  end if;
  if has_function_privilege('anon', 'public.publish_route_plan(uuid, jsonb)', 'execute') then
    raise exception '154: anon no debe poder ejecutar publish_route_plan';
  end if;
  if not has_function_privilege('authenticated', 'public.publish_route_plan(uuid, jsonb)', 'execute') then
    raise exception '154: authenticated debe poder ejecutar publish_route_plan';
  end if;
end $comprueba$;

-- ===========================================================================
-- Ensayo por rol, con ROLLBACK
-- ===========================================================================
-- La matriz esta en el plan (docs/PLAN-154-lista-unica.md, seccion 6). Se pega en una transaccion abierta a mano y
-- se cierra con ROLLBACK. Este fichero no la lleva ejecutable a proposito: cualquier sentencia de aqui abajo corre al
-- aplicar la migracion.

-- ===========================================================================
-- Reversion (para pegar A MANO, en una transaccion propia)
-- ===========================================================================
--   1. Volver a aplicar SOLO el bloque `create or replace function public.publish_route_plan ... end $$;` de la
--      135_no_publicar_hoja_importada.sql (con sus dos lineas de revoke/grant). Publicar deja de escribir la
--      recogida; `load_no` sigue quedando en null (lo decide lo que manda la app, no la funcion).
--   2. Si hace falta quitar la columna (se pierde donde iba cada recogida guardada; las rutas se siguen leyendo con
--      la regla de la app, sin error):
--        create table deliveries_pickup_seq_backup as select id, pickup_seq from public.deliveries where pickup_seq is not null;
--        alter table public.deliveries drop column if exists pickup_seq;
--   3. delete from public.schema_migrations where name = '154_lista_unica.sql';
-- La app no se rompe sin la columna: lo detecta en lo que lee (`tienePosicionDeRecogida`), no la pide ni la manda, y
-- apaga las flechas de las recogidas.

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('154_lista_unica.sql', '37e5453d4d0e07c98b295b410e187fba29c7d0c244a983e3adde22cfdb055204') on conflict (name) do nothing;
