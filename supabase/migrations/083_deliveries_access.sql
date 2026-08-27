-- 083: los datos de Entregas dejan de estar abiertos a cualquiera con sesión.
--
-- Encontrado explicando por qué la tarjeta no basta. Las seis tablas de Entregas
-- tenían su política de lectura Y la de escritura en `using (true)`: no preguntaban
-- quién eres. Se comprobó haciéndose pasar por Alberto Garza —empleado de fichaje,
-- module_access = {clockin}, sin tarjeta de Entregas— y la base le devolvió 892
-- eventos, 90 entregas, 36 perfiles y 13 turnos. Con la de escritura abierta también
-- podía cambiarlos.
--
-- No es que hubiera pasado; es que nada lo impedía, y lo mismo valía para cualquier
-- cuenta futura. Recruiting y clock-in ya lo hacían bien: por eso Alberto NO puede
-- leer sus datos.
--
-- ---------------------------------------------------------------------------
-- Entregas pasa a otorgarse, como los demás módulos
-- ---------------------------------------------------------------------------
-- Esto revierte D-054 y D-057, que la trataban como implícita para todo el mundo.
-- La razón de entonces —todos entraban por Entregas— dejó de ser cierta en cuanto
-- hubo cuatro módulos y diez personas que solo fichan.
--
-- `profiles.role` NO cambia: sigue decidiendo QUÉ ve dentro quien entra (un chofer
-- solo lo suyo, almacén ciertas etapas). Lo que se añade es SI entra.

create or replace function public.has_deliveries_access()
  returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select role = 'admin' or 'deliveries' = any(coalesce(module_access, '{}'))
    from public.profiles where id = auth.uid()
  ), false);
$$;

revoke execute on function public.has_deliveries_access() from public, anon;

-- Reparto inicial: NADIE pierde acceso hoy por esta migración, salvo quien solo
-- tiene fichaje o time tracker — que es exactamente la regla pedida ("cada quien
-- solo la app a la que se le dio acceso"). Los usuarios originales de Entregas son
-- los que no tienen ningún otro módulo: choferes, almacén, ventas, contabilidad.
update public.profiles
   set module_access = array_append(coalesce(module_access, '{}'), 'deliveries')
 where not ('deliveries' = any(coalesce(module_access, '{}')))
   and not (
     coalesce(array_length(module_access, 1), 0) > 0
     and module_access <@ array['clockin', 'timetracker']
   );

-- ---------------------------------------------------------------------------
-- Las políticas preguntan
-- ---------------------------------------------------------------------------
-- Envueltas en (select ...) desde el principio, por lo de 080: si no, el helper se
-- ejecuta una vez por fila y `deliveries` es la tabla más leída de la app.

-- La de lectura de `deliveries` ya distinguía por rol (chofer: las suyas; almacén:
-- ciertas etapas; el resto: todas). Eso se conserva tal cual y se le antepone el
-- acceso al módulo: primero SI entras, luego QUÉ ves.
alter policy "auth read deliveries" on public.deliveries
  using (
    (select public.has_deliveries_access())
    and (
      is_training
      or case (select p.role from public.profiles p where p.id = (select auth.uid()))
           when 'driver' then (created_by = (select auth.uid())
                               or assigned_driver = (select p.full_name from public.profiles p where p.id = (select auth.uid())))
           when 'warehouse' then (stage = any (array['approved','fulfilling','ready','picked_up','delivered']))
           else true
         end
    )
  );

alter policy "auth write deliveries" on public.deliveries
  using ((select public.has_deliveries_access()))
  with check ((select public.has_deliveries_access()));

alter policy "auth read order_events"  on public.order_events  using ((select public.has_deliveries_access()));
alter policy "auth write order_events" on public.order_events  using ((select public.has_deliveries_access()))
  with check ((select public.has_deliveries_access()));

alter policy "auth read driver_shifts"  on public.driver_shifts  using ((select public.has_deliveries_access()));
alter policy "auth write driver_shifts" on public.driver_shifts  using ((select public.has_deliveries_access()))
  with check ((select public.has_deliveries_access()));

alter policy "auth read driver_availability"  on public.driver_availability  using ((select public.has_deliveries_access()));
alter policy "auth write driver_availability" on public.driver_availability  using ((select public.has_deliveries_access()))
  with check ((select public.has_deliveries_access()));

alter policy "auth read driver_incidents"  on public.driver_incidents  using ((select public.has_deliveries_access()));
alter policy "auth write driver_incidents" on public.driver_incidents  using ((select public.has_deliveries_access()))
  with check ((select public.has_deliveries_access()));

alter policy "auth read settings"  on public.settings  using ((select public.has_deliveries_access()));
alter policy "auth write settings" on public.settings  using ((select public.has_deliveries_access()))
  with check ((select public.has_deliveries_access()));

-- `public.profiles` se deja abierta a propósito, y conviene decir por qué en vez de
-- que parezca un olvido: la vista clockin.profiles (077) es security_invoker, o sea
-- que se ejecuta como quien pregunta, y los layouts de recruiting y timetracker leen
-- esta tabla para saber quién eres. Cerrarla por acceso a Entregas dejaría a la
-- cuadrilla de fichaje sin poder entrar a su propia app. Lo que expone son nombres,
-- roles y tienda de 36 compañeros — no direcciones de clientes. Merece su propia
-- regla por módulo, que es un cambio aparte y más delicado.
