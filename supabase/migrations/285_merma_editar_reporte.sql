-- 285: Merma — editar TODO un reporte de merma como admin/gerente (aun ya aprobado) (2026-11-10).
--
-- El dueño (10 nov): el admin y el gerente deben poder EDITAR cualquier campo de un reporte de merma ya enviado
-- (p. ej. escribir el nombre/descripción completo), incluso si ya está aprobado. Al editar contenido, las firmas se
-- invalidan (el trigger `warehouse_ops_wipe_sigs_on_edit` de la 280/281 las borra) y la aprobación se revierte: vuelve
-- a «pendiente de firma». Un almacenista (scrap_only) NO puede editar tras enviar; solo admin/gerente.
--
-- RPC `warehouse_ops_edit_scrap_report(p_report uuid, p_patch jsonb)`: aplica solo las claves presentes en el patch
-- (lo demás se queda igual), recalcula `total_loss`, limpia las fechas/actores de aprobación/desecho/ajuste (el trigger
-- de etapa recalcula `stage` → `photographed`) y marca edited_by/edited_at.
--
-- SEGURIDAD (revisión):
--   1. Desechar/ajustar solo lo deshace un ADMIN con `warehouse_ops_set_scrap_stage`; por eso, si el reporte ya está en
--      'dumped' o 'adjusted', editar (que revierte esas etapas) EXIGE nivel admin/store_admin — un gerente simple no.
--   2. No se confía en los campos de producto del cliente: si el patch trae `product_id` no nulo, el sku/nombre/precio
--      salen de `erp.products` (no del patch); `product_not_in_catalog` SIEMPRE = (product_id is null).
--   3. Solo escribe si de verdad cambió algún campo de CONTENIDO (si no, lanza «nada que cambiar» y no toca nada, para
--      no borrar las firmas con un abrir+guardar sin cambios).
--   (Auditoría: no hay una bitácora de merma sencilla a la cual anotar el adjunto previo; se omite — no es bloqueante.)
--
-- Claves del patch (todas opcionales): product_id, product_name, unit_cost, scrap_type, boxes, pieces_per_box,
-- loose_pieces, total_pieces, damaged_pieces, sample_pieces, return_type, reason, crma, broken_on (date),
-- broken_by (array de uuid), answers (objeto que se MEZCLA en answers: reported_by, comments…). (product_sku y
-- product_not_in_catalog del patch se IGNORAN: los decide el catálogo.)
--
-- Additive (solo crea la función). 237/280/281/282/283/284 intactas. Para deshacer:
--   drop function if exists public.warehouse_ops_edit_scrap_report(uuid, jsonb);
--   delete from public.schema_migrations where name = '285_merma_editar_reporte.sql';

create or replace function public.warehouse_ops_edit_scrap_report(p_report uuid, p_patch jsonb)
  returns void
  language plpgsql volatile security definer set search_path = public, erp as $$
declare
  yo uuid := auth.uid();
  r record;
  es_admin boolean;
  v_pid bigint; v_sku text; v_name text; v_nic boolean; v_cost numeric;
  v_scrap text; v_boxes integer; v_per integer; v_loose integer; v_total integer;
  v_damaged integer; v_sample integer;
  v_return text; v_reason text; v_crma text; v_broken_on date; v_broken_by uuid[];
  v_answers jsonb; v_loss numeric;
  cambio boolean;
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'warehouse_ops: patch invalido' using errcode = '22023';
  end if;
  select * into r from public.warehouse_reports where id = p_report and kind = 'scrap';
  if r.id is null then raise exception 'warehouse_ops: reporte desconocido'; end if;
  if yo is null or not public.warehouse_ops_can_manage(r.store) then
    raise exception 'warehouse_ops: solo el admin o el gerente edita el reporte' using errcode = '42501';
  end if;
  es_admin := coalesce(public.warehouse_ops_level_of(yo), '') in ('admin', 'store_admin');
  -- Desechar/ajustar solo lo deshace un admin (como en set_scrap_stage): editar en esas etapas las revierte.
  if coalesce(r.stage, 'documented') in ('dumped', 'adjusted') and not es_admin then
    raise exception 'warehouse_ops: una merma desechada o ajustada solo la edita un admin' using errcode = '42501';
  end if;

  -- Producto: si viene product_id no nulo, el catalogo manda (sku/nombre/precio); nunca se toma del patch.
  if p_patch ? 'product_id' and nullif(p_patch->>'product_id', '') is not null then
    v_pid := (p_patch->>'product_id')::bigint;
    select pp.sku, pp.name, pp.price into v_sku, v_name, v_cost from erp.products pp where pp.id = v_pid;
    if v_name is null then raise exception 'warehouse_ops: producto desconocido' using errcode = '22023'; end if;
    v_nic := false;
  elsif p_patch ? 'product_id' then
    -- product_id explicitamente nulo = producto a mano (fuera de catalogo).
    v_pid := null; v_sku := null; v_nic := true;
    v_name := left(btrim(coalesce(case when p_patch ? 'product_name' then p_patch->>'product_name' else r.product_name end, '')), 200);
    v_cost := case when p_patch ? 'unit_cost' then nullif(p_patch->>'unit_cost', '')::numeric else r.unit_cost end;
  else
    -- No se toca el producto; solo puede cambiar el precio a mano.
    v_pid := r.product_id; v_sku := r.product_sku; v_name := r.product_name; v_nic := r.product_not_in_catalog;
    v_cost := case when p_patch ? 'unit_cost' then nullif(p_patch->>'unit_cost', '')::numeric else r.unit_cost end;
  end if;
  v_cost := case when v_cost is null then null else round(v_cost, 2) end;
  if v_cost is not null and (v_cost < 0 or v_cost > 100000) then
    raise exception 'warehouse_ops: costo no valido' using errcode = '22023';
  end if;

  v_scrap  := case when p_patch ? 'scrap_type'     then p_patch->>'scrap_type'                    else r.scrap_type end;
  v_boxes  := case when p_patch ? 'boxes'          then nullif(p_patch->>'boxes', '')::int        else r.boxes end;
  v_per    := case when p_patch ? 'pieces_per_box' then nullif(p_patch->>'pieces_per_box','')::int else r.pieces_per_box end;
  v_loose  := case when p_patch ? 'loose_pieces'   then nullif(p_patch->>'loose_pieces','')::int   else r.loose_pieces end;
  if p_patch ? 'boxes' or p_patch ? 'pieces_per_box' or p_patch ? 'loose_pieces' then
    v_total := coalesce(v_boxes, 0) * coalesce(v_per, 0) + coalesce(v_loose, 0);
  elsif p_patch ? 'total_pieces' then
    v_total := nullif(p_patch->>'total_pieces', '')::int;
  else
    v_total := r.total_pieces;
  end if;
  v_damaged := case when p_patch ? 'damaged_pieces' then nullif(p_patch->>'damaged_pieces','')::int else r.damaged_pieces end;
  v_sample  := case when p_patch ? 'sample_pieces'  then nullif(p_patch->>'sample_pieces','')::int  else r.sample_pieces end;
  v_return  := case when p_patch ? 'return_type'    then p_patch->>'return_type'                 else r.return_type end;
  v_reason  := case when p_patch ? 'reason'         then nullif(p_patch->>'reason', '')          else r.reason end;
  v_crma    := case when p_patch ? 'crma'           then nullif(p_patch->>'crma', '')            else r.crma end;
  v_broken_on := case when p_patch ? 'broken_on'    then nullif(p_patch->>'broken_on','')::date  else r.broken_on end;
  if p_patch ? 'broken_by' then
    v_broken_by := (select coalesce(array_agg(value::uuid), '{}') from jsonb_array_elements_text(p_patch->'broken_by'));
  else
    v_broken_by := r.broken_by;
  end if;
  v_answers := case when p_patch ? 'answers' then coalesce(r.answers, '{}'::jsonb) || (p_patch->'answers') else r.answers end;
  v_loss := public.warehouse_ops_scrap_loss(v_cost, coalesce(v_damaged, case when v_scrap = 'sample' then 0 else v_total end), v_return, v_crma);

  -- ¿Cambió de verdad algún campo de CONTENIDO? (No se miran las columnas de etapa/auditoria.)
  cambio :=
       v_pid is distinct from r.product_id
    or v_sku is distinct from r.product_sku
    or v_name is distinct from r.product_name
    or v_nic is distinct from r.product_not_in_catalog
    or v_scrap is distinct from r.scrap_type
    or v_boxes is distinct from r.boxes
    or v_per is distinct from r.pieces_per_box
    or v_loose is distinct from r.loose_pieces
    or v_total is distinct from r.total_pieces
    or v_damaged is distinct from r.damaged_pieces
    or v_sample is distinct from r.sample_pieces
    or v_cost is distinct from r.unit_cost
    or v_return is distinct from r.return_type
    or v_reason is distinct from r.reason
    or v_crma is distinct from r.crma
    or v_broken_on is distinct from r.broken_on
    or v_broken_by is distinct from r.broken_by
    or v_answers is distinct from r.answers;
  if not cambio then
    raise exception 'warehouse_ops: nada que cambiar' using errcode = '22023';
  end if;

  update public.warehouse_reports set
    product_id = v_pid, product_sku = v_sku, product_name = v_name, product_not_in_catalog = v_nic,
    scrap_type = v_scrap, boxes = v_boxes, pieces_per_box = v_per, loose_pieces = v_loose, total_pieces = v_total,
    damaged_pieces = v_damaged, sample_pieces = v_sample, unit_cost = v_cost,
    return_type = v_return, reason = v_reason, crma = v_crma, broken_on = v_broken_on, broken_by = v_broken_by,
    answers = v_answers, total_loss = v_loss,
    -- Revertir la aprobacion (solo llegamos aqui si cambio el contenido): el trigger de etapa recalcula stage ->
    -- photographed; las firmas las borra el trigger de contenido.
    approved_at = null, approved_by = null, approval_sheet = null,
    dumped_at = null, dumped_by = null,
    adjusted_at = null, adjusted_by = null, adjustment_proof = null,
    edited_by = yo, edited_at = now()
  where id = p_report;
end $$;
revoke all on function public.warehouse_ops_edit_scrap_report(uuid, jsonb) from public, anon;
grant execute on function public.warehouse_ops_edit_scrap_report(uuid, jsonb) to authenticated;

-- ===========================================================================
-- Autocomprobacion
-- ===========================================================================
do $chk$
declare f text;
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'warehouse_ops_edit_scrap_report') then
    raise exception '285: falta la funcion warehouse_ops_edit_scrap_report';
  end if;
  if has_function_privilege('anon', 'public.warehouse_ops_edit_scrap_report(uuid, jsonb)', 'execute') then
    raise exception '285: anon no debe ejecutar warehouse_ops_edit_scrap_report';
  end if;
  f := pg_get_functiondef('public.warehouse_ops_edit_scrap_report(uuid, jsonb)'::regprocedure);
  if position('warehouse_ops_can_manage' in f) = 0 then
    raise exception '285: edit_scrap_report debe exigir la puerta de gestion (can_manage)';
  end if;
  if position('warehouse_ops_scrap_loss' in f) = 0 then
    raise exception '285: edit_scrap_report debe recalcular total_loss';
  end if;
  if position('approved_at = null' in f) = 0 then
    raise exception '285: edit_scrap_report debe revertir la aprobacion al editar';
  end if;
  -- Candados de la revision de seguridad:
  if position('in (''dumped'', ''adjusted'')' in f) = 0 then
    raise exception '285: editar una merma desechada/ajustada debe exigir admin';
  end if;
  if position('nada que cambiar' in f) = 0 then
    raise exception '285: edit_scrap_report debe rechazar el guardado sin cambios';
  end if;
  if position('from erp.products' in f) = 0 then
    raise exception '285: el producto de catalogo debe salir de erp.products, no del cliente';
  end if;
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('285_merma_editar_reporte.sql', 'c04a0fceab7b27d244e3bd66a4c6949b5addb932e31a667e7c7e79834a04c431') on conflict (name) do nothing;
