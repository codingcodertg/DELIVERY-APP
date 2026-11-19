-- 334: Permiso de gerente en Operaciones de Almacen (2026-11-19).
--
-- El dueno: un empleado con rol del hub «accounting» debe tener, dentro de Operaciones de Almacen y en SU tienda, lo mismo
-- que un gerente (rol «manager»). El rol del hub NO cambia (ese rol manda los permisos de las demas apps). Se da con un
-- permiso por persona nuevo, `warehouse_ops_manager` (profiles.permissions). El permiso de SUPERVISOR (warehouse_ops_supervisor)
-- sigue siendo otro firmante: un gerente firma «gerente», un supervisor firma «supervisor», y nadie llena los dos.
--
-- Que cambia (ADITIVO; create or replace; no se tocan los .sql anteriores):
--   1. Funcion NUEVA warehouse_ops_es_gerente(uuid): true si ese perfil tiene role = 'manager' O el permiso
--      'warehouse_ops_manager'. Es la UNICA prueba de gerente de la app. Sin grant para public, anon ni authenticated: solo
--      la llaman las funciones de esta misma migracion (security definer, dueno de la base).
--   2. Se redefinen las seis funciones que probaban role = 'manager'. Cada una parte de su ULTIMA definicion (el comentario
--      sobre cada bloque dice de que migracion sale) y solo cambia la prueba de gerente:
--        warehouse_ops_can_manage(text)                  (265): p.role = 'manager' -> warehouse_ops_es_gerente(p.id)
--        warehouse_ops_can_see(text, text, uuid)         (324): dos veces p.role = 'manager' -> warehouse_ops_es_gerente(p.id)
--        warehouse_ops_can_sign_slot(text)               (293): p.role = 'manager' -> warehouse_ops_es_gerente(p.id)
--        warehouse_ops_can_start_approval(text)          (297): p.role = 'manager' -> warehouse_ops_es_gerente(p.id)
--        warehouse_ops_firmante_valido(uuid, text)       (293): p.role = 'manager' -> warehouse_ops_es_gerente(p.id)
--                                                        (aqui p.id = p_user: valida a ESA persona, no a auth.uid())
--        warehouse_ops_kpi_almacen_mes(text, date, date) (327): v_role = 'manager' -> warehouse_ops_es_gerente(auth.uid())
--                                                        (v_role sigue sirviendo para la prueba de admin)
--      NO cambia en ninguna: la prueba de RR. HH. (recruiting_role in ('admin','manager')), que es del modulo de RR. HH.;
--      las firmas (el gerente firma solo «gerente», el supervisor solo «supervisor», la misma persona no firma los dos,
--      salvo el admin del hub); la puerta de KPI; los grants, security definer y search_path.
--   3. Otras funciones, politicas o disparadores de la area de almacen que prueben el rol de gerente: se revisaron todos
--      (ver el reporte de la migracion). Ninguno mas tiene esa prueba en su ultima definicion.
--
-- Para deshacer: volver a crear las seis funciones con su ultima definicion (265, 324, 293, 297, 293, 327) y quitar el
-- helper: drop function public.warehouse_ops_es_gerente(uuid); delete from public.schema_migrations where name = '334_warehouse_ops_permiso_de_gerente.sql';

-- ---------------------------------------------------------------------------
-- 1. El helper: es gerente de Operaciones de Almacen (rol manager o el permiso por persona)
-- ---------------------------------------------------------------------------
create or replace function public.warehouse_ops_es_gerente(p_uid uuid)
  returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((
    select p.role = 'manager' or 'warehouse_ops_manager' = any(coalesce(p.permissions, '{}'))
    from public.profiles p where p.id = p_uid
  ), false);
$$;
revoke all on function public.warehouse_ops_es_gerente(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Las seis funciones, redefinidas (cuerpo de su ultima version; cambia solo la prueba de gerente)
-- ---------------------------------------------------------------------------

-- Ultima definicion: 265_warehouse_ops_niveles.sql
create or replace function public.warehouse_ops_can_manage(r_store text)
  returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select
      n.nivel = 'admin'
      or (n.nivel = 'store_admin' and t.mia)
      or (n.nivel = 'full' and t.mia
          and (public.warehouse_ops_es_gerente(p.id) or 'warehouse_ops_supervisor' = any(coalesce(p.permissions, '{}'))))
    from public.profiles p
      cross join lateral (select coalesce(public.warehouse_ops_level_of(p.id), '') as nivel) n
      cross join lateral (select (p.store = r_store or r_store = any(coalesce(p.visible_stores, '{}'))) is true as mia) t
    where p.id = auth.uid()
  ), false);
$$;
revoke all on function public.warehouse_ops_can_manage(text) from public, anon;
grant execute on function public.warehouse_ops_can_manage(text) to authenticated;

-- Ultima definicion: 324_warehouse_associate.sql
create or replace function public.warehouse_ops_can_see(r_kind text, r_store text, r_author uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce((
    select
      n.nivel = 'admin'
      or (n.nivel = 'store_admin' and t.mia)
      or (
        r_kind in ('zone', 'insubordination', 'positive')
        and (
          p.recruiting_role in ('admin', 'manager')
          or (n.nivel = 'full' and public.warehouse_ops_es_gerente(p.id) and t.mia)
        )
      )
      or (
        r_kind not in ('zone', 'insubordination', 'positive')
        and (
          (n.nivel = 'scrap_only' and r_author = p.id and r_kind = any(public.warehouse_ops_kinds_of(n.nivel)))
          or (n.nivel = 'full' and (
            r_author = p.id
            or ((public.warehouse_ops_es_gerente(p.id) or 'warehouse_ops_supervisor' = any(coalesce(p.permissions, '{}'))) and t.mia)
          ))
        )
      )
    from public.profiles p
      cross join lateral (select coalesce(public.warehouse_ops_level_of(p.id), '') as nivel) n
      cross join lateral (select (p.store = r_store or r_store = any(coalesce(p.visible_stores, '{}'))) is true as mia) t
    where p.id = auth.uid()
  ), false);
$function$;
revoke all on function public.warehouse_ops_can_see(text, text, uuid) from public, anon;
grant execute on function public.warehouse_ops_can_see(text, text, uuid) to authenticated;

-- Ultima definicion: 293_firma_por_papel.sql
create or replace function public.warehouse_ops_can_sign_slot(p_slot text)
  returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((
    select p.role = 'admin'
        or (p_slot = 'gerente' and public.warehouse_ops_es_gerente(p.id))
        or (p_slot = 'supervisor' and 'warehouse_ops_supervisor' = any(coalesce(p.permissions, '{}')))
    from public.profiles p where p.id = auth.uid()
  ), false);
$$;
revoke all on function public.warehouse_ops_can_sign_slot(text) from public, anon;
grant execute on function public.warehouse_ops_can_sign_slot(text) to authenticated;

-- Ultima definicion: 297_merma_gerente_inicia_historial_borrar.sql
create or replace function public.warehouse_ops_can_start_approval(r_store text)
  returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select
      n.nivel = 'admin'
      or (n.nivel = 'store_admin' and t.mia)
      or (n.nivel = 'full' and t.mia and public.warehouse_ops_es_gerente(p.id))
    from public.profiles p
      cross join lateral (select coalesce(public.warehouse_ops_level_of(p.id), '') as nivel) n
      cross join lateral (select (p.store = r_store or r_store = any(coalesce(p.visible_stores, '{}'))) is true as mia) t
    where p.id = auth.uid()
  ), false);
$$;
revoke all on function public.warehouse_ops_can_start_approval(text) from public, anon;
grant execute on function public.warehouse_ops_can_start_approval(text) to authenticated;

-- Ultima definicion: 293_firma_por_papel.sql
create or replace function public.warehouse_ops_firmante_valido(p_user uuid, p_slot text)
  returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((
    select p.role = 'admin'
        or (p_slot = 'gerente' and public.warehouse_ops_es_gerente(p.id))
        or (p_slot = 'supervisor' and 'warehouse_ops_supervisor' = any(coalesce(p.permissions, '{}')))
    from public.profiles p where p.id = p_user
  ), false);
$$;
revoke all on function public.warehouse_ops_firmante_valido(uuid, text) from public, anon, authenticated;

-- Ultima definicion: 327_merma_rechazo.sql
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
       or coalesce(v_nivel = 'full' and (coalesce(public.warehouse_ops_es_gerente(auth.uid()), false)
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
      and r.rejected_at is null  -- 327: la merma rechazada (sigue vendible) no cuenta
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
insert into public.schema_migrations (name, checksum) values ('334_warehouse_ops_permiso_de_gerente.sql', '358d999861170a6dc9bcddb84eb00d984b7af04d5d2c04b7a2941e24dce9b60e') on conflict (name) do nothing;
