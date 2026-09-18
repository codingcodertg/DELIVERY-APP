-- ===========================================================================
-- 134 · El chofer lee SUS paradas del plan publicado (D-NEXT)
-- ===========================================================================
-- Plan: docs/PLAN-134-chofer-lee-sus-paradas.md (opcion (b), sola).
--
-- QUE HACE: una funcion, `my_published_stops(p_date)`, que devuelve las paradas de QUIEN LLAMA en el plan
-- `published` de esa fecha. Nada mas. CERO politicas nuevas, ningun grant de tabla, ninguna tabla tocada.
--
-- POR QUE UNA FUNCION Y NO UNA POLITICA. El chofer no debe poder leer `route_plans`: la fila lleva `input` (todas
-- las ordenes del dia, con las coordenadas de todos los clientes), `writes` y `result` — leer el plan es leer el
-- dia entero de la empresa. Y por la politica de paradas de la 133 («se ven las paradas de los planes que se
-- ven») quien ve el plan ve las paradas de TODOS los choferes. Asi que no se le abre ninguna de las dos tablas:
-- se le da una sola puerta, que filtra por `auth.uid()` DENTRO y devuelve columnas elegidas a mano. Una politica
-- mas se sumaria por OR a las que hay; una funcion no se suma a nada.
--
-- ES `security definer` A PROPOSITO — lee dos tablas que quien llama no puede leer. Por eso:
--   · `search_path` fijo;
--   · exige `auth.uid()` no nulo, y el filtro por chofer NO es un parametro: no hay forma de pedir las de otro;
--   · columnas explicitas: ni `input`, ni `writes`, ni `result`, ni nada de `route_plans` salvo la version y
--     cuando se publico;
--   · `revoke` de public y anon; `execute` solo para `authenticated`.
-- Un no-chofer que la llame recibe SUS cero filas: no es un error, y no revela nada.
--
-- NO devuelve minutos de retraso ni de espera: las horas del plan son una ESTIMACION que nadie ha contrastado
-- todavia con la realidad, y al chofer se le ensenan como tal (decision del orquestador por delegacion, 2026-09-18).
--
-- Sin begin/commit: una migracion no lleva su propia transaccion.
-- ===========================================================================

create or replace function public.my_published_stops(p_date date)
  returns table (
    plan_version  integer,
    published_at  timestamptz,
    seq           integer,
    kind          text,
    delivery_id   uuid,
    order_ref     text,
    label         text,
    place         text,
    window_start  integer,
    window_end    integer,
    is_hard       boolean,
    eta           integer,
    etd           integer,
    load_after    numeric
  )
  language sql stable security definer set search_path = public as $$
  select p.version, p.published_at, s.seq, s.kind, s.delivery_id, s.order_ref, s.label, s.place,
         s.window_start, s.window_end, s.is_hard, s.eta, s.etd, s.load_after
    from public.route_plans p
    join public.route_plan_stops s on s.plan_id = p.id
   where (select auth.uid()) is not null
     and p.plan_date = p_date
     and p.status = 'published'
     and s.driver_id = (select auth.uid())
   order by s.seq;
$$;

revoke execute on function public.my_published_stops(date) from public, anon;
grant  execute on function public.my_published_stops(date) to authenticated;

-- ---------------------------------------------------------------------------
-- Autocomprobacion (sobrevive a re-aplicar el fichero: mira la definicion, no cuenta filas)
-- ---------------------------------------------------------------------------
do $$
declare
  f record;
begin
  select p.prosecdef, p.proconfig, p.provolatile, pg_get_function_result(p.oid) as devuelve, pg_get_functiondef(p.oid) as def
    into f from pg_proc p where p.oid = 'public.my_published_stops(date)'::regprocedure;

  if not f.prosecdef then raise exception '134: my_published_stops debe ser security definer'; end if;
  if f.proconfig is null or not ('search_path=public' = any (f.proconfig)) then
    raise exception '134: my_published_stops debe fijar search_path = public';
  end if;
  if has_function_privilege('anon', 'public.my_published_stops(date)', 'execute') then
    raise exception '134: anon no debe poder ejecutar my_published_stops';
  end if;
  if not has_function_privilege('authenticated', 'public.my_published_stops(date)', 'execute') then
    raise exception '134: authenticated debe poder ejecutar my_published_stops';
  end if;
  -- Lo que NO debe salir nunca por esta puerta.
  if f.devuelve ~* '\m(input|writes|result|params|driver_id|driver_name|lat|lng)\M' then
    raise exception '134: my_published_stops devuelve una columna que no debe: %', f.devuelve;
  end if;
  -- El filtro por quien llama esta en el cuerpo, y el estado es published.
  if f.def !~ 's\.driver_id = \(select auth\.uid\(\)\)' or f.def !~ 'p\.status = ''published''' then
    raise exception '134: my_published_stops perdio el filtro por chofer o por estado';
  end if;
  -- Y esta migracion no le abrio `route_plans` al chofer: la politica de la 133 sigue sin nombrarlo.
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename in ('route_plans', 'route_plan_stops')
              and (coalesce(qual, '') ~ '''driver''' or coalesce(with_check, '') ~ '''driver''')) then
    raise exception '134: ninguna politica de route_plans / route_plan_stops debe nombrar a driver';
  end if;
end $$;

-- ===========================================================================
-- Reversion
-- ===========================================================================
--   drop function if exists public.my_published_stops(date);
-- No borra datos. «Mi ruta» sigue funcionando: no depende de esto para saber que ordenes lleva.

-- ===========================================================================
-- Ensayo por rol, con ROLLBACK
-- ===========================================================================
-- Con un plan `published` de <fecha> con paradas de dos choferes (A y B), y un borrador posterior de la misma fecha.
-- ANTES, como postgres: total := count(*) de paradas del publicado; de_A := las de driver_id = A.  (de_A < total)
--   1  chofer A: select * from my_published_stops(<fecha>)            -> de_A filas — MENOS que `total`; ninguna de B
--   2  chofer A: las columnas devueltas                                -> las 14 de arriba; ni input/writes/result ni driver_id
--   3  chofer A: select de route_plans / route_plan_stops              -> 0 filas (no cambio)
--   4  chofer A: my_published_stops(<fecha sin publicado>)             -> 0 filas
--   5  con SOLO un borrador para la fecha                              -> 0 filas
--   6  tras publicar otro plan (el viejo pasa a superseded)            -> las suyas del NUEVO; ninguna del viejo
--   7  chofer B                                                        -> las de B, no las de A
--   8  logistica / admin / ventas / almacen llamandola                 -> 0 filas (no son driver_id de ninguna parada); sin error
--   9  anon                                                            -> permission denied for function
--  10  parada con driver_id null (perfil borrado)                      -> no sale para nadie
--  11  re-aplicar la 134                                               -> sin error
--  12  pg_policies de las dos tablas, antes y despues                  -> identicas (3 + 4, ninguna ALL)

-- @ledger-below
insert into public.schema_migrations (name, checksum)
  values ('134_my_published_stops.sql', '79a2b0af564c566dbe1bdb34dfb23850ced41a024a43da8e319f03186c0f3bbe') on conflict (name) do nothing;
