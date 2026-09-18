-- ===========================================================================
-- 135 · Una hoja importada no se publica, tampoco llamando a la funcion a mano
-- ===========================================================================
-- QUE HACE: reemplaza `publish_route_plan` por la MISMA funcion de la 133, con UNA comprobacion mas: si el plan
-- es `source = 'manual_import'`, excepcion `ROUTE_PLAN_IMPORTED` antes de mirar nada mas. Nada mas cambia: ni una
-- tabla, ni una politica, ni un grant, ni un disparador.
--
-- POR QUE. La hoja del despachador se importa como un plan `manual_import` para compararla con el del motor. El
-- codigo ya impide publicarla (va con `writes` vacio, queda descartada al momento, y la ruta de publicar la
-- rechaza), pero eso es codigo: entre guardarla y descartarla es un borrador, y quien llamara a esta funcion
-- directamente con su id la publicaria — no escribiria ordenes, pero SUSTITUIRIA al plan publicado de ese dia.
-- Esto lo cierra en la base, que es donde vale para todos los caminos.
--
-- DE DONDE SALE EL CUERPO. `create or replace` reemplaza la funcion ENTERA, asi que se parte de la definicion
-- vigente: la de la 133, que es la ultima migracion que toca este objeto. Esta copiada letra por letra; una
-- prueba del repo compara los dos ficheros y exige que la UNICA diferencia sea el bloque nuevo.
--
-- Sigue siendo SECURITY INVOKER (no se declara `security definer`): corre como quien llama, con su RLS y el
-- guard de `deliveries`. Mismos grants. Sin begin/commit: una migracion no lleva su propia transaccion.
-- ===========================================================================

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
-- Autocomprobacion (mira la definicion: sobrevive a re-aplicar el fichero)
-- ===========================================================================
do $comprueba$
declare
  f record;
begin
  select p.prosecdef, pg_get_functiondef(p.oid) as def
    into f from pg_proc p where p.oid = 'public.publish_route_plan(uuid, jsonb)'::regprocedure;

  if f.prosecdef then raise exception '135: publish_route_plan NO debe ser security definer'; end if;
  if position('ROUTE_PLAN_IMPORTED' in f.def) = 0 or position('plan.source = ''manual_import''' in f.def) = 0 then
    raise exception '135: falta el rechazo de las hojas importadas';
  end if;
  -- Lo que ya hacia, sigue dentro: reemplazar la funcion entera no se llevo nada por delante.
  if position('ROUTE_PLAN_FORBIDDEN' in f.def) = 0 or position('ROUTE_PLAN_NOT_DRAFT' in f.def) = 0
     or position('ROUTE_PLAN_BAD_NOTICE' in f.def) = 0 or position('ROUTE_PLAN_STALE' in f.def) = 0
     or position('ROUTE_PLAN_UNSEEN' in f.def) = 0 or position('for update' in f.def) = 0 then
    raise exception '135: a publish_route_plan le falta una de las comprobaciones de la 133';
  end if;
  -- El rechazo va ANTES de escribir nada.
  if position('ROUTE_PLAN_IMPORTED' in f.def) > position('update public.deliveries' in f.def) then
    raise exception '135: el rechazo de las hojas importadas tiene que ir antes de escribir';
  end if;
  if has_function_privilege('anon', 'public.publish_route_plan(uuid, jsonb)', 'execute') then
    raise exception '135: anon no debe poder ejecutar publish_route_plan';
  end if;
  if not has_function_privilege('authenticated', 'public.publish_route_plan(uuid, jsonb)', 'execute') then
    raise exception '135: authenticated debe poder ejecutar publish_route_plan';
  end if;
end $comprueba$;

-- ===========================================================================
-- Reversion
-- ===========================================================================
-- Volver a aplicar SOLO el bloque `create or replace function public.publish_route_plan ... end $$;` de la
-- 133_route_plans.sql (con sus dos lineas de revoke/grant). No borra datos.

-- ===========================================================================
-- Ensayo, con ROLLBACK
-- ===========================================================================
-- Como logistica, con tres borradores de una fecha con ordenes ruteables:
--   1  publish_route_plan(<borrador manual_import>)        -> ROUTE_PLAN_IMPORTED; NADA escrito: ninguna orden cambia,
--                                                             el plan sigue en draft, el publicado vigente sigue publicado, 0 avisos
--   2  lo mismo con el plan ya `discarded`                 -> ROUTE_PLAN_IMPORTED (el rechazo no depende del estado)
--   3  publish_route_plan(<borrador engine>)               -> publica como antes: written = N, published, el anterior superseded
--   4  publish_route_plan(<borrador manual_edit>)          -> publica como antes
--   5  gerente / almacen / ventas / chofer                 -> ROUTE_PLAN_FORBIDDEN, como antes (va antes que el rechazo nuevo)
--   6  re-aplicar la 135                                   -> sin error
--   7  prosecdef de la funcion, antes y despues            -> false y false

-- @ledger-below
insert into public.schema_migrations (name, checksum)
  values ('135_no_publicar_hoja_importada.sql', 'b73aa82f6bf218527c490e44dc35f1304273e464d1548a4f4460d3a012fb5242') on conflict (name) do nothing;
