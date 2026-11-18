-- ===========================================================================
-- 325 · KPIs de almacén: una lectura por tienda y mes (merma, ventas y fichajes)
-- ===========================================================================
-- PEDIDO. La reunión con el dueño: una vista «KPIs de almacén» para el gerente y el supervisor de almacén, con un
-- selector de tienda y de mes. Tres de sus cuatro números salen de datos que la sesión del almacén NO puede leer:
--   · Ventas: erp.sales_history no tiene política de SELECT para usuarios comunes (solo el gate restrictivo de ERP), así
--     que la lectura directa devuelve cero filas para cualquiera que no sea del módulo ERP.
--   · Fichajes: clockin.time_entries solo deja leer lo propio o a los managers de la compañía de fichaje.
-- Esta función lee las dos cosas con SECURITY DEFINER, PERO solo devuelve TOTALES de una tienda y un mes, y solo a
-- gerencia: la misma regla que «Reportes (gerentes)» (veLosReportes), comprobada EN SQL antes de leer nada, y además la
-- tienda debe ser de quien pide (public.warehouse_ops_in_store). El personal de merma (scrap_only) no pasa. Ningún nombre
-- de empleado ni fichaje individual sale de aquí.
--
-- QUÉ DEVUELVE (jsonb):
--   merma_valor    suma de warehouse_reports.total_loss de merma (kind = 'scrap') de la tienda cuyo día de rotura
--                  (broken_on, o si no el día de Texas en que se reportó) cae en el rango. Es el precio de VENTA congelado
--                  (migración 272), así que es «merma a precio de venta».
--   merma_filas    cuántos reportes de merma entraron.
--   ventas         suma de erp.sales_history.net_sales de la tienda (erp.stores, por nombre) en el rango; NULL si la tienda
--                  no existe en ERP o no hay ninguna fila de ventas en el rango («sin datos de ventas», nunca un cero).
--   ventas_filas   cuántas filas de ventas con monto entraron.
--   ventas_hasta   el último día de venta que hay en el ERP para esa tienda (para ver si el mes está completo).
--   turnos         entradas de fichaje del mes (por día de Texas) del personal de almacén de la tienda (profiles.store con
--                  nivel de almacén), incluidas las que quedaron abiertas.
--   turnos_bien    de esos, las cerradas por la propia persona: con salida fichada, no automática (auto_closed) y no
--                  corregida a mano (manual).
--   horas          horas cerradas del mes (salida menos entrada, menos la comida), redondeadas a 2 decimales.
--   personas       cuántas personas del personal de almacén fichan en el mes.
--
-- QUÉ CAMBIA. Una función nueva; no se toca ninguna tabla, ninguna política ni ningún dato.
-- Se APLICA AL FUSIONAR, con migrate-status antes y después (regla del proyecto). Hasta entonces la pantalla avisa que
-- faltan la merma, las ventas y los fichajes, y solo se ve el KPI de listas a tiempo (ese sale de tablas que ya se leen).
-- ===========================================================================

create or replace function public.warehouse_ops_kpi_almacen_mes(p_store text, p_desde date, p_hasta date)
  returns jsonb
  language plpgsql stable security definer set search_path = public, erp, clockin
as $$
declare
  v_nivel      text;
  v_role       text;
  v_recruiting text;
  v_perms      text[];
  v_erp        text;
  v_merma      numeric := 0;
  v_merma_n    integer := 0;
  v_ventas     numeric := 0;
  v_ventas_n   integer := 0;
  v_ventas_hi  date;
  v_turnos     integer := 0;
  v_bien       integer := 0;
  v_horas      numeric := 0;
  v_personas   integer := 0;
  v_ok         boolean;
begin
  -- PUERTA DE GERENCIA (la misma regla que `veLosReportes` en src/lib/almacen-ops/visibilidad.ts): admin y store_admin;
  -- RR. HH. admin/manager; y el nivel `full` solo si es gerente del hub o tiene el permiso de supervisor. El personal
  -- de merma (`scrap_only`) y el `full` sin cargo de gerente NO pasan. Va ANTES de leer nada.
  -- Sin fila de perfil no hay quién: se rechaza. Y cada término va con coalesce: en SQL «NULL o falso» da NULL, y un
  -- NULL en un `if not (...)` NO lanza, así que sin el coalesce la puerta se abriría con datos nulos.
  select p.role, p.recruiting_role, coalesce(p.permissions, '{}')
    into v_role, v_recruiting, v_perms
    from public.profiles p where p.id = auth.uid();
  if not found then
    raise exception 'warehouse_ops: sin perfil para esta sesión' using errcode = '42501';
  end if;
  v_nivel := public.warehouse_ops_level_of(auth.uid());
  v_ok := coalesce(v_role = 'admin', false)
       or coalesce(v_nivel in ('admin', 'store_admin'), false)
       or coalesce(v_recruiting in ('admin', 'manager'), false)
       or coalesce(v_nivel = 'full' and (coalesce(v_role = 'manager', false)
                                         or coalesce('warehouse_ops_supervisor' = any(v_perms), false)), false);
  if not coalesce(v_ok, false) then
    raise exception 'warehouse_ops: solo gerencia o supervisión de almacén ve estos KPI' using errcode = '42501';
  end if;

  if not public.warehouse_ops_in_store(p_store) then
    raise exception 'warehouse_ops: sin acceso a esa tienda' using errcode = '42501';
  end if;
  -- Solo meses completos: el primer día del mes y su último día. Un rango cualquiera daría cifras que no se pueden
  -- comparar con el objetivo mensual.
  if p_desde is null or p_hasta is null
     or p_desde <> date_trunc('month', p_desde)::date
     or p_hasta <> (date_trunc('month', p_desde) + interval '1 month - 1 day')::date then
    raise exception 'warehouse_ops: el rango debe ser un mes completo' using errcode = '22023';
  end if;

  -- Merma: el día que cuenta es el de la rotura; sin él, el día de Texas en que se reportó.
  select coalesce(sum(r.total_loss), 0), count(*)::int
    into v_merma, v_merma_n
    from public.warehouse_reports r
    where r.kind = 'scrap'
      and r.store = p_store
      and coalesce(r.broken_on, (r.created_at at time zone 'America/Chicago')::date) between p_desde and p_hasta;

  -- Ventas: la tienda de almacén se empareja con la de ERP por id o por nombre (warehouse_ops_erp_store_id, 274/303).
  v_erp := public.warehouse_ops_erp_store_id(p_store);
  if v_erp is not null then
    select coalesce(sum(s.net_sales), 0), count(s.net_sales)::int, max(s.sold_at)
      into v_ventas, v_ventas_n, v_ventas_hi
      from erp.sales_history s
      where s.store_id = v_erp
        and s.sold_at between p_desde and p_hasta;
  end if;

  -- Fichajes del personal de almacén de la tienda. Solo totales: ni nombres ni filas individuales salen de aquí.
  select count(*)::int,
         count(*) filter (where e.clock_out_at is not null and not e.auto_closed and not e.manual)::int,
         coalesce(sum(extract(epoch from (e.clock_out_at - e.clock_in_at)) / 3600.0
                      - coalesce(e.lunch_minutes, 0) / 60.0) filter (where e.clock_out_at is not null), 0),
         count(distinct e.employee_id)::int
    into v_turnos, v_bien, v_horas, v_personas
    from clockin.time_entries e
    join public.profiles p on p.id = e.employee_id
    where p.store = p_store
      and public.warehouse_ops_level_of(p.id) <> ''
      and (e.clock_in_at at time zone 'America/Chicago')::date between p_desde and p_hasta;

  -- Con menos de 3 personas el porcentaje de fichajes identifica a alguien: no se devuelve (null), igual que sin datos.
  return jsonb_build_object(
    'merma_valor',  round(v_merma, 2),
    'merma_filas',  v_merma_n,
    'ventas',       case when v_erp is null or v_ventas_n = 0 then null else round(v_ventas, 2) end,
    'ventas_filas', case when v_erp is null then 0 else v_ventas_n end,
    'ventas_hasta', case when v_erp is null then null else v_ventas_hi end,
    'turnos',       case when v_personas >= 3 then v_turnos else null end,
    'turnos_bien',  case when v_personas >= 3 then v_bien else null end,
    'horas',        case when v_personas >= 3 then round(v_horas, 2) else null end,
    'personas',     case when v_personas >= 3 then v_personas else null end
  );
end $$;

revoke all on function public.warehouse_ops_kpi_almacen_mes(text, date, date) from public, anon;
grant execute on function public.warehouse_ops_kpi_almacen_mes(text, date, date) to authenticated;

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('325_kpi_almacen.sql', 'b236a389be7add4ab68af60da8815675d35e917b49804ecd4bb5a3c28b9ba67a') on conflict (name) do nothing;
