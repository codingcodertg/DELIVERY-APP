-- 296: merma — opciones para DESHACER (dueño, 11 nov: «in scrap report I need an option to undo») (2026-11-11).
--
-- Cuatro cosas, todas con la misma puerta que el resto de la merma (`warehouse_ops_can_manage`: admin de la app,
-- store_admin en sus tiendas, o gerente / supervisor de almacén de esa tienda con nivel «full»):
--
--   1. SACAR UNA MERMA DE UN GRUPO pendiente (`warehouse_ops_remove_from_scrap_group`) o BORRAR el grupo pendiente
--      entero (`warehouse_ops_delete_scrap_group`). Las mermas vuelven a «fotografiada», sin grupo. Una firma de grupo
--      cubre un conjunto concreto de mermas: si el conjunto cambia, las firmas del grupo se borran. Con el grupo ya
--      aprobado no se puede (para eso está deshacer la etapa, punto 2).
--   2. DESHACER LA ETAPA también para el gerente (antes solo admin / store_admin). Sigue siendo un paso a la vez y nunca
--      hasta «documentada». Deshacer «aprobada» de una merma que venía de un grupo la SACA de ese grupo (vuelve a
--      fotografiada y suelta): el grupo conserva su aprobación para las demás; si se queda vacío, se borra.
--   3. Deshacer en bloque: la app llama a la misma función por cada merma (no necesita nada aquí).
--   4. QUITAR LA FIRMA propia de un grupo antes de aprobarse: `warehouse_ops_unsign_scrap_group` ya existía; ahora
--      bloquea la fila del grupo (FOR UPDATE) como la firma (293), para que firmar y quitar no se pisen.
--
-- Orden de bloqueo en todo lo que toca un grupo: primero el GRUPO, luego sus mermas (igual que la firma de la 293).
-- Additive salvo `set_scrap_stage` y `unsign_scrap_group`, que se reescriben enteras. 237/238/239 intactas.

-- ---------------------------------------------------------------------------------------------------------------
-- 1a. Sacar una merma de su grupo pendiente.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.warehouse_ops_remove_from_scrap_group(p_report uuid)
  returns void language plpgsql security definer set search_path = public as $$
declare
  yo uuid := auth.uid();
  gid uuid;
  g record;
  r record;
begin
  select scrap_group_id into gid from public.warehouse_reports where id = p_report and kind = 'scrap';
  if gid is null then raise exception 'warehouse_ops: la merma no esta en ningun grupo' using errcode = '22023'; end if;
  select * into g from public.warehouse_scrap_groups where id = gid for update;
  if g.id is null then raise exception 'warehouse_ops: grupo desconocido'; end if;
  if yo is null or not public.warehouse_ops_can_manage(g.store) then
    raise exception 'warehouse_ops: solo quien gestiona esa tienda cambia el grupo' using errcode = '42501';
  end if;
  if g.approved_at is not null then
    raise exception 'warehouse_ops: el grupo ya esta aprobado; deshaz la etapa de la merma' using errcode = '22023';
  end if;
  select * into r from public.warehouse_reports where id = p_report for update;
  if r.scrap_group_id is distinct from gid then
    raise exception 'warehouse_ops: la merma cambio de grupo; vuelve a abrir la hoja' using errcode = '40001';
  end if;
  update public.warehouse_reports set scrap_group_id = null, edited_by = yo, edited_at = now() where id = p_report;
  -- La firma cubria un conjunto concreto: si cambia, se firma otra vez.
  delete from public.warehouse_scrap_group_signatures where group_id = gid;
  if not exists (select 1 from public.warehouse_reports where scrap_group_id = gid) then
    delete from public.warehouse_scrap_groups where id = gid;
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 1b. Borrar un grupo pendiente entero.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.warehouse_ops_delete_scrap_group(p_group uuid)
  returns void language plpgsql security definer set search_path = public as $$
declare
  yo uuid := auth.uid();
  g record;
begin
  select * into g from public.warehouse_scrap_groups where id = p_group for update;
  if g.id is null then raise exception 'warehouse_ops: grupo desconocido'; end if;
  if yo is null or not public.warehouse_ops_can_manage(g.store) then
    raise exception 'warehouse_ops: solo quien gestiona esa tienda borra el grupo' using errcode = '42501';
  end if;
  if g.approved_at is not null then
    raise exception 'warehouse_ops: el grupo ya esta aprobado; no se borra' using errcode = '22023';
  end if;
  perform 1 from public.warehouse_reports where scrap_group_id = p_group for update;
  update public.warehouse_reports set scrap_group_id = null, edited_by = yo, edited_at = now() where scrap_group_id = p_group;
  delete from public.warehouse_scrap_group_signatures where group_id = p_group;
  delete from public.warehouse_scrap_groups where id = p_group;
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 2. Etapas: deshacer para quien gestiona la tienda (antes solo admin / store_admin).
-- ---------------------------------------------------------------------------------------------------------------
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
  if not public.warehouse_ops_can_manage(r.store) then
    raise exception 'warehouse_ops: solo el gerente de la tienda cambia la etapa' using errcode = '42501';
  end if;
  de := array_position(orden, coalesce(r.stage, 'documented'));
  a := array_position(orden, p_stage);
  if a = de then raise exception 'warehouse_ops: ya esta en esa etapa' using errcode = '22023'; end if;

  if a < de then
    -- 296: deshacer lo puede quien gestiona la tienda (la puerta de arriba). Un paso, y nunca hasta 'documented'.
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

-- ---------------------------------------------------------------------------------------------------------------
-- 4. Quitar la firma propia de un grupo: igual que antes, ahora con la fila del grupo bloqueada.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.warehouse_ops_unsign_scrap_group(p_group uuid, p_slot text)
  returns void language plpgsql security definer set search_path = public as $$
declare
  yo uuid := auth.uid();
  g record;
  quien uuid;
  admin boolean;
begin
  if p_slot is null or p_slot not in ('gerente', 'supervisor') then
    raise exception 'warehouse_ops: firma desconocida' using errcode = '22023';
  end if;
  select * into g from public.warehouse_scrap_groups where id = p_group for update;
  if g.id is null then raise exception 'warehouse_ops: grupo desconocido'; end if;
  if g.approved_at is not null then raise exception 'warehouse_ops: el grupo ya esta aprobado' using errcode = '22023'; end if;
  if yo is null or not public.warehouse_ops_can_manage(g.store) then
    raise exception 'warehouse_ops: sin acceso' using errcode = '42501';
  end if;
  select signer_id into quien from public.warehouse_scrap_group_signatures where group_id = p_group and slot = p_slot;
  if quien is null then return; end if;
  admin := coalesce(public.warehouse_ops_level_of(yo), '') in ('admin', 'store_admin');
  if quien <> yo and not admin then
    raise exception 'warehouse_ops: solo quien firmo (o un admin) quita la firma' using errcode = '42501';
  end if;
  delete from public.warehouse_scrap_group_signatures where group_id = p_group and slot = p_slot;
end $$;

revoke all on function public.warehouse_ops_remove_from_scrap_group(uuid) from public, anon;
revoke all on function public.warehouse_ops_delete_scrap_group(uuid) from public, anon;
grant execute on function public.warehouse_ops_remove_from_scrap_group(uuid) to authenticated;
grant execute on function public.warehouse_ops_delete_scrap_group(uuid) to authenticated;

-- ===========================================================================
-- Autocomprobacion
-- ===========================================================================
do $chk$
declare f text;
begin
  if has_function_privilege('anon', 'public.warehouse_ops_remove_from_scrap_group(uuid)', 'execute')
     or has_function_privilege('anon', 'public.warehouse_ops_delete_scrap_group(uuid)', 'execute') then
    raise exception '296: anon no debe ejecutar las funciones de deshacer';
  end if;
  f := pg_get_functiondef('public.warehouse_ops_set_scrap_stage(uuid,text,text)'::regprocedure);
  if position('level_of' in f) > 0 then
    raise exception '296: deshacer la etapa ya no depende del nivel admin';
  end if;
  if position('warehouse_ops_can_manage(r.store)' in f) = 0 then
    raise exception '296: cambiar la etapa sigue exigiendo gestionar la tienda';
  end if;
  if position('scrap_group_id = case' in f) = 0 then
    raise exception '296: deshacer la aprobacion debe sacar la merma de su grupo';
  end if;
  foreach f in array array[
    pg_get_functiondef('public.warehouse_ops_remove_from_scrap_group(uuid)'::regprocedure),
    pg_get_functiondef('public.warehouse_ops_delete_scrap_group(uuid)'::regprocedure),
    pg_get_functiondef('public.warehouse_ops_unsign_scrap_group(uuid,text)'::regprocedure)
  ] loop
    if position('for update' in lower(f)) = 0 then
      raise exception '296: las funciones que cambian un grupo deben bloquear su fila (for update)';
    end if;
    if position('approved_at is not null' in f) = 0 then
      raise exception '296: con el grupo aprobado no se cambia';
    end if;
    if position('warehouse_ops_can_manage(g.store)' in f) = 0 then
      raise exception '296: solo quien gestiona la tienda cambia el grupo';
    end if;
  end loop;
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('296_merma_deshacer.sql', 'b244f9b3ce7531d549ba24d179b27bd379e7bed3691ad43cf8e3ba3eb582e72f') on conflict (name) do nothing;
