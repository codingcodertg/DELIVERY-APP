-- 327: merma RECHAZADA (dueño, 2026-11-18: «the manager can reject and comment, e.g. still sellable, not scrap»).
--
-- El gerente (o quien gestiona la merma de esa tienda: la misma puerta que aprobar, `warehouse_ops_can_manage`) rechaza
-- una merma ANTES de desecharla (documentada, fotografiada, pendiente en grupo, aprobada) con un motivo obligatorio
-- (3 caracteres o más). Una merma rechazada:
--   · tiene `rejected_at`, `rejected_by`, `rejected_reason`; la etapa (`stage`) pasa a «rejected». La etapa sigue
--     DERIVADA de las fechas (270): el trigger pone «rejected» antes que todo lo demás y NO borra las fechas de las
--     etapas anteriores. Por eso «deshacer el rechazo» solo limpia las tres columnas y la merma regresa a la etapa que
--     tenía (aprobada, fotografiada…) sin guardar nada más.
--   · sale fuera de los totales en dinero y de «Todas pendientes» (eso lo filtra la app; el KPI de 325 se redefine aquí).
--   · no entra a un grupo nuevo (la creación del grupo exige «fotografiada»).
--   · conserva sus fotos y su historial (la bitácora registra el cambio de etapa y el motivo).
-- Si estaba en un grupo PENDIENTE (sin aprobar) sale de él y el grupo pierde las firmas que cubrían ese conjunto. Si
-- estaba en un grupo ya APROBADO se queda en él (la hoja firmada no se toca). Deshacer el rechazo no la regresa al grupo
-- pendiente: vuelve a «fotografiada» y hay que volver a agregarla al grupo.
--
-- Quién: `warehouse_ops_can_manage(store)`, la misma puerta que aprueba (`warehouse_ops_approve_scrap_group` y
-- `warehouse_ops_set_scrap_stage` a «approved»). El supervisor de almacén no; el almacén (scrap_only) no.
--
-- Qué cambia:
--   1. Columnas `rejected_at`, `rejected_by`, `rejected_reason` (con tope de 3 a 500 caracteres) y «rejected» en la
--      restricción de `stage`.
--   2. Funciones NUEVAS: `warehouse_ops_reject_scrap(uuid, text)` y `warehouse_ops_unreject_scrap(uuid)`.
--   3. Funciones REDEFINIDAS (cuerpo copiado de su última versión; solo cambia lo indicado):
--        - `warehouse_report_stage_guard()` (de la 270): «rejected» primero en la etapa; limpia los campos de rechazo
--          en lo que no es merma.
--        - `warehouse_ops_set_scrap_stage(uuid, text, text)` (de la 296): una merma rechazada no cambia de etapa a mano.
--        - `warehouse_ops_kpi_almacen_mes(text, date, date)` (de la 325): la merma de 325 excluye las rechazadas.
--   Nada más. Sin tocar la RLS ni las políticas: la fila es la misma y quien la ve sigue viéndola (el autor la ve
--   rechazada con su motivo en «Mis reportes»).
--
-- Notificación: NO existe una notificación en la app para cambios de etapa de la merma (la tabla `notifications` es de
-- órdenes de entrega); no se inventa una. El motivo queda en la bitácora de la merma y en su tarjeta.
--
-- Idempotente: `add column if not exists`, `create or replace`, restricciones con `drop ... if exists`.
-- Para deshacer: volver a crear las tres funciones redefinidas con el cuerpo de la 270 / 296 / 325, quitar las dos
-- funciones nuevas y las columnas. delete from public.schema_migrations where name = '327_merma_rechazo.sql';

-- ---------------------------------------------------------------------------
-- 1. Columnas y restricciones
-- ---------------------------------------------------------------------------
alter table public.warehouse_reports
  add column if not exists rejected_at timestamptz,
  add column if not exists rejected_by uuid references auth.users(id) on delete set null,
  add column if not exists rejected_reason text;

alter table public.warehouse_reports drop constraint if exists warehouse_reports_stage_check;
alter table public.warehouse_reports add constraint warehouse_reports_stage_check
  check (stage is null or stage in ('documented', 'photographed', 'approved', 'dumped', 'adjusted', 'rejected'));

alter table public.warehouse_reports drop constraint if exists warehouse_reports_rejected_reason_check;
alter table public.warehouse_reports add constraint warehouse_reports_rejected_reason_check
  check (rejected_reason is null or char_length(btrim(rejected_reason)) between 3 and 500);

-- ---------------------------------------------------------------------------
-- 2. La etapa (REDEFINIDA, 270 + 327): «rejected» manda sobre las demás.
-- ---------------------------------------------------------------------------
create or replace function public.warehouse_report_stage_guard()
  returns trigger language plpgsql set search_path = public as $$
declare n int;
begin
  if NEW.kind <> 'scrap' then
    NEW.stage := null; NEW.photographed_at := null;
    NEW.approved_at := null; NEW.approved_by := null; NEW.approval_sheet := null;
    NEW.dumped_at := null; NEW.dumped_by := null;
    NEW.adjusted_at := null; NEW.adjusted_by := null; NEW.adjustment_proof := null;
    NEW.rejected_at := null; NEW.rejected_by := null; NEW.rejected_reason := null;
    return NEW;
  end if;
  n := cardinality(coalesce(NEW.photos, '{}'));
  if n = 0 then
    NEW.photographed_at := null;
  elsif NEW.photographed_at is null then
    -- La primera foto: al crear con foto, la fecha del reporte; al agregarla despues, ahora.
    NEW.photographed_at := case when TG_OP = 'INSERT' then coalesce(NEW.created_at, now()) else now() end;
  end if;
  NEW.stage := case
    when NEW.rejected_at is not null then 'rejected'
    when NEW.adjusted_at is not null then 'adjusted'
    when NEW.dumped_at is not null then 'dumped'
    when NEW.approved_at is not null then 'approved'
    when n > 0 then 'photographed'
    else 'documented' end;
  return NEW;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Cambiar etapa a mano (REDEFINIDA, 296 + 327): una rechazada no se mueve; primero se deshace el rechazo.
-- ---------------------------------------------------------------------------
create or replace function public.warehouse_ops_set_scrap_stage(p_report uuid, p_stage text, p_proof text default null)
  returns void language plpgsql security definer set search_path = public as $$
declare
  yo uuid := auth.uid();
  r record;
  gid uuid;
  orden text[] := array['documented', 'photographed', 'approved', 'dumped', 'adjusted'];
  de int; a int;
begin
  if p_stage is null or not (p_stage = any(orden)) then
    raise exception 'warehouse_ops: etapa desconocida' using errcode = '22023';
  end if;
  -- Bloqueo en el mismo orden que la firma (293): primero el grupo, si lo hay; luego la merma.
  select scrap_group_id into gid from public.warehouse_reports where id = p_report;
  if gid is not null then perform 1 from public.warehouse_scrap_groups where id = gid for update; end if;
  select * into r from public.warehouse_reports where id = p_report for update;
  if r.id is null then raise exception 'warehouse_ops: reporte desconocido'; end if;
  if r.kind <> 'scrap' then
    raise exception 'warehouse_ops: solo la merma tiene etapas' using errcode = '22023';
  end if;
  if yo is null or not public.warehouse_ops_can_see(r.kind, r.store, r.author_id) then
    raise exception 'warehouse_ops: sin acceso' using errcode = '42501';
  end if;
  if not coalesce(public.warehouse_ops_can_manage(r.store), false) then
    raise exception 'warehouse_ops: solo el gerente de la tienda cambia la etapa' using errcode = '42501';
  end if;
  -- 327: una merma rechazada no cambia de etapa a mano: primero se deshace el rechazo (que la regresa a su etapa).
  if r.rejected_at is not null then
    raise exception 'warehouse_ops: la merma esta rechazada; deshaz el rechazo primero' using errcode = '22023';
  end if;
  de := array_position(orden, coalesce(r.stage, 'documented'));
  a := array_position(orden, p_stage);
  if a = de then raise exception 'warehouse_ops: ya esta en esa etapa' using errcode = '22023'; end if;

  if a < de then
    -- 296 (reunión 11 nov): deshacer una etapa es SOLO de admin (admin de la app, o store_admin: la puerta de arriba ya
    -- lo limita a sus tiendas). El gerente solo deshace lo pendiente (sacar del grupo / borrar grupo / quitar su firma).
    if coalesce(public.warehouse_ops_level_of(yo), '') not in ('admin', 'store_admin') then
      raise exception 'warehouse_ops: deshacer una etapa es solo para el admin' using errcode = '42501';
    end if;
    if de - a <> 1 or p_stage = 'documented' then
      raise exception 'warehouse_ops: se deshace un paso a la vez' using errcode = '22023';
    end if;
    update public.warehouse_reports set
      adjusted_at = case when r.stage = 'adjusted' then null else adjusted_at end,
      adjusted_by = case when r.stage = 'adjusted' then null else adjusted_by end,
      adjustment_proof = case when r.stage = 'adjusted' then null else adjustment_proof end,
      dumped_at = case when r.stage = 'dumped' then null else dumped_at end,
      dumped_by = case when r.stage = 'dumped' then null else dumped_by end,
      approved_at = case when r.stage = 'approved' then null else approved_at end,
      approved_by = case when r.stage = 'approved' then null else approved_by end,
      approval_sheet = case when r.stage = 'approved' then null else approval_sheet end,
      -- Deshacer la aprobación de una merma que venía de un grupo la saca del grupo (queda fotografiada y suelta).
      scrap_group_id = case when r.stage = 'approved' then null else scrap_group_id end,
      edited_by = yo, edited_at = now()
    where id = p_report;
    if r.stage = 'approved' then
      delete from public.warehouse_report_signatures where report_id = p_report;
      if r.scrap_group_id is not null and not exists (select 1 from public.warehouse_reports where scrap_group_id = r.scrap_group_id) then
        delete from public.warehouse_scrap_group_signatures where group_id = r.scrap_group_id;
        delete from public.warehouse_scrap_groups where id = r.scrap_group_id;
      end if;
    end if;
    return;
  end if;

  -- Hacia adelante: de una en una, con foto, y la regla de cada etapa (igual que antes).
  if r.stage = 'documented' or cardinality(coalesce(r.photos, '{}')) = 0 then
    raise exception 'warehouse_ops: primero la foto de las piezas' using errcode = '22023';
  end if;
  if a - de <> 1 then raise exception 'warehouse_ops: las etapas van de una en una' using errcode = '22023'; end if;

  if p_stage = 'approved' then
    if not public.warehouse_ops_dos_firmas_validas(null, p_report) then
      raise exception 'warehouse_ops: faltan las dos firmas (gerente y supervisor), de personas distintas' using errcode = '22023';
    end if;
    update public.warehouse_reports set approved_at = now(), approved_by = yo, approval_sheet = null, edited_by = yo, edited_at = now() where id = p_report;
  elsif p_stage = 'dumped' then
    update public.warehouse_reports set dumped_at = now(), dumped_by = yo, edited_by = yo, edited_at = now() where id = p_report;
  elsif p_stage = 'adjusted' then
    if p_proof is null or btrim(p_proof) = '' then
      raise exception 'warehouse_ops: falta el adjunto (la captura del sistema)' using errcode = '22023';
    end if;
    if split_part(p_proof, '/', 1) <> yo::text then raise exception 'warehouse_ops: adjunto no valido'; end if;
    update public.warehouse_reports set adjusted_at = now(), adjusted_by = yo, adjustment_proof = p_proof, edited_by = yo, edited_at = now() where id = p_report;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Rechazar (NUEVA)
-- ---------------------------------------------------------------------------
create or replace function public.warehouse_ops_reject_scrap(p_report uuid, p_reason text)
  returns void
  language plpgsql volatile security definer set search_path = public as $$
declare
  yo uuid := auth.uid();
  limpio text := btrim(coalesce(p_reason, ''));
  r record;
  gid uuid;
begin
  if char_length(limpio) < 3 then
    raise exception 'warehouse_ops: el motivo del rechazo necesita al menos 3 caracteres' using errcode = '22023';
  end if;
  if char_length(limpio) > 500 then
    raise exception 'warehouse_ops: el motivo del rechazo es muy largo (500 caracteres como máximo)' using errcode = '22023';
  end if;
  -- Mismo orden de bloqueo que la etapa (296): primero el grupo, si lo hay; luego la merma.
  select scrap_group_id into gid from public.warehouse_reports where id = p_report;
  if gid is not null then perform 1 from public.warehouse_scrap_groups where id = gid for update; end if;
  select * into r from public.warehouse_reports where id = p_report for update;
  if r.id is null then raise exception 'warehouse_ops: reporte desconocido'; end if;
  if r.kind <> 'scrap' then raise exception 'warehouse_ops: solo la merma se rechaza' using errcode = '22023'; end if;
  if yo is null or not coalesce(public.warehouse_ops_can_see(r.kind, r.store, r.author_id), false) then
    raise exception 'warehouse_ops: sin acceso' using errcode = '42501';
  end if;
  if not coalesce(public.warehouse_ops_can_manage(r.store), false) then
    raise exception 'warehouse_ops: solo quien gestiona la tienda rechaza una merma' using errcode = '42501';
  end if;
  if r.rejected_at is not null then raise exception 'warehouse_ops: la merma ya esta rechazada' using errcode = '22023'; end if;
  -- Antes de desechar: documentada, fotografiada (la pendiente en grupo es fotografiada) o aprobada.
  if coalesce(r.stage, 'documented') not in ('documented', 'photographed', 'approved') then
    raise exception 'warehouse_ops: solo se rechaza antes de desechar' using errcode = '22023';
  end if;
  -- En un grupo PENDIENTE la merma sale del grupo y las firmas de ese grupo se borran (cubrían otro conjunto).
  if r.scrap_group_id is not null and not exists (
       select 1 from public.warehouse_scrap_groups g where g.id = r.scrap_group_id and g.approved_at is not null) then
    update public.warehouse_reports set scrap_group_id = null where id = p_report;
    delete from public.warehouse_scrap_group_signatures where group_id = r.scrap_group_id;
    if not exists (select 1 from public.warehouse_reports where scrap_group_id = r.scrap_group_id) then
      delete from public.warehouse_scrap_groups where id = r.scrap_group_id;
    end if;
  end if;
  update public.warehouse_reports
     set rejected_at = now(), rejected_by = yo, rejected_reason = limpio, edited_by = yo, edited_at = now()
   where id = p_report;
  perform public.warehouse_ops_log(p_report, 'rechazo', jsonb_build_object('motivo', limpio, 'etapa', r.stage));
end $$;

-- ---------------------------------------------------------------------------
-- 5. Deshacer el rechazo (NUEVA): solo limpia las tres columnas; la etapa vuelve sola (se deriva de las fechas).
-- ---------------------------------------------------------------------------
create or replace function public.warehouse_ops_unreject_scrap(p_report uuid)
  returns void
  language plpgsql volatile security definer set search_path = public as $$
declare
  yo uuid := auth.uid();
  r record;
begin
  select * into r from public.warehouse_reports where id = p_report for update;
  if r.id is null then raise exception 'warehouse_ops: reporte desconocido'; end if;
  if r.kind <> 'scrap' then raise exception 'warehouse_ops: solo la merma se rechaza' using errcode = '22023'; end if;
  if yo is null or not coalesce(public.warehouse_ops_can_see(r.kind, r.store, r.author_id), false) then
    raise exception 'warehouse_ops: sin acceso' using errcode = '42501';
  end if;
  if not coalesce(public.warehouse_ops_can_manage(r.store), false) then
    raise exception 'warehouse_ops: solo quien gestiona la tienda deshace un rechazo' using errcode = '42501';
  end if;
  if r.rejected_at is null then raise exception 'warehouse_ops: la merma no esta rechazada' using errcode = '22023'; end if;
  update public.warehouse_reports
     set rejected_at = null, rejected_by = null, rejected_reason = null, edited_by = yo, edited_at = now()
   where id = p_report;
  perform public.warehouse_ops_log(p_report, 'rechazo_deshecho', jsonb_build_object('motivo', r.rejected_reason));
end $$;

revoke all on function public.warehouse_ops_reject_scrap(uuid, text) from public, anon;
revoke all on function public.warehouse_ops_unreject_scrap(uuid) from public, anon;
grant execute on function public.warehouse_ops_reject_scrap(uuid, text) to authenticated;
grant execute on function public.warehouse_ops_unreject_scrap(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. KPI de almacén (REDEFINIDA, 325 + 327): la merma rechazada no cuenta en el valor de merma.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Autocomprobación
-- ---------------------------------------------------------------------------
do $chk$
declare f text;
begin
  if has_function_privilege('anon', 'public.warehouse_ops_reject_scrap(uuid,text)', 'execute')
     or has_function_privilege('anon', 'public.warehouse_ops_unreject_scrap(uuid)', 'execute') then
    raise exception '327: anon no debe ejecutar rechazar / deshacer rechazo';
  end if;
  f := pg_get_functiondef('public.warehouse_report_stage_guard()'::regprocedure);
  if position('''rejected''' in f) = 0 then raise exception '327: la guardia debe poner la etapa rechazada'; end if;
  f := pg_get_functiondef('public.warehouse_ops_set_scrap_stage(uuid,text,text)'::regprocedure);
  if position('esta rechazada' in f) = 0 then raise exception '327: cambiar etapa debe negarse con una merma rechazada'; end if;
  f := pg_get_functiondef('public.warehouse_ops_kpi_almacen_mes(text,date,date)'::regprocedure);
  if position('rejected_at is null' in f) = 0 then raise exception '327: el KPI debe excluir las rechazadas'; end if;
  f := pg_get_functiondef('public.warehouse_ops_reject_scrap(uuid,text)'::regprocedure);
  if position('warehouse_ops_can_manage' in f) = 0 then raise exception '327: rechazar exige gestionar la tienda'; end if;
  f := pg_get_functiondef('public.warehouse_ops_unreject_scrap(uuid)'::regprocedure);
  if position('warehouse_ops_can_manage' in f) = 0 then raise exception '327: deshacer el rechazo exige gestionar la tienda'; end if;
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('327_merma_rechazo.sql', 'dd4e5204be517082739616cdd79fc0d09f1b3218f90a1b237a3da0b3d12e050b') on conflict (name) do nothing;
