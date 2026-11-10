-- 285: Merma — editar TODO un reporte de merma como admin/gerente (aun ya aprobado) (2026-11-10).
--
-- El dueño (10 nov): el admin y el gerente deben poder EDITAR cualquier campo de un reporte de merma ya enviado
-- (p. ej. escribir el nombre/descripción completo), incluso si ya está aprobado. Al editar contenido, las firmas se
-- invalidan (el trigger `warehouse_ops_wipe_sigs_on_edit` de la 280/281 las borra) y la aprobación se revierte: vuelve
-- a «pendiente de firma». Un almacenista (scrap_only) NO puede editar tras enviar; solo admin/gerente.
--
-- RPC `warehouse_ops_edit_scrap_report(p_report uuid, p_patch jsonb)`: aplica solo las claves presentes en el patch
-- (lo demás se queda igual), recalcula `total_loss` con `warehouse_ops_scrap_loss`, limpia las fechas/actores de
-- aprobación/desecho/ajuste (el trigger de etapa recalcula `stage` → `photographed`) y marca edited_by/edited_at.
-- Puerta: `warehouse_ops_can_manage(store)` (admin, o gerente/supervisor de la tienda) — la misma de los otros edit_*.
--
-- Claves del patch (todas opcionales): product_id, product_sku, product_name, product_not_in_catalog, scrap_type,
-- boxes, pieces_per_box, loose_pieces, total_pieces, damaged_pieces, sample_pieces, unit_cost, return_type, reason,
-- crma, broken_on (date), broken_by (array de uuid), answers (objeto que se MEZCLA en answers: reported_by, comments…).
--
-- Additive (solo crea la función). 237/280/281/282/283/284 intactas. Para deshacer:
--   drop function if exists public.warehouse_ops_edit_scrap_report(uuid, jsonb);
--   delete from public.schema_migrations where name = '285_merma_editar_reporte.sql';

create or replace function public.warehouse_ops_edit_scrap_report(p_report uuid, p_patch jsonb)
  returns void
  language plpgsql volatile security definer set search_path = public as $$
declare
  yo uuid := auth.uid();
  r record;
  v_cost numeric;
  v_damaged integer;
  v_total integer;
  v_scrap text;
  v_return text;
  v_crma text;
  v_broken uuid[];
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'warehouse_ops: patch invalido' using errcode = '22023';
  end if;
  select * into r from public.warehouse_reports where id = p_report and kind = 'scrap';
  if r.id is null then raise exception 'warehouse_ops: reporte desconocido'; end if;
  if yo is null or not public.warehouse_ops_can_manage(r.store) then
    raise exception 'warehouse_ops: solo el admin o el gerente edita el reporte' using errcode = '42501';
  end if;

  -- Valores nuevos (patch si viene la clave; si no, lo que ya había). Una clave con null explicito pone null.
  v_cost    := case when p_patch ? 'unit_cost'      then (p_patch->>'unit_cost')::numeric      else r.unit_cost end;
  v_damaged := case when p_patch ? 'damaged_pieces' then (p_patch->>'damaged_pieces')::integer else r.damaged_pieces end;
  v_total   := case when p_patch ? 'total_pieces'   then (p_patch->>'total_pieces')::integer   else r.total_pieces end;
  v_scrap   := case when p_patch ? 'scrap_type'     then (p_patch->>'scrap_type')              else r.scrap_type end;
  v_return  := case when p_patch ? 'return_type'    then (p_patch->>'return_type')             else r.return_type end;
  v_crma    := case when p_patch ? 'crma'           then (p_patch->>'crma')                    else r.crma end;
  if p_patch ? 'broken_by' then
    v_broken := (select coalesce(array_agg(value::uuid), '{}') from jsonb_array_elements_text(p_patch->'broken_by'));
  else
    v_broken := r.broken_by;
  end if;
  if v_cost is not null and (v_cost < 0 or v_cost > 100000) then
    raise exception 'warehouse_ops: costo no valido' using errcode = '22023';
  end if;

  update public.warehouse_reports set
    product_id            = case when p_patch ? 'product_id'            then nullif(p_patch->>'product_id','')::bigint else product_id end,
    product_sku           = case when p_patch ? 'product_sku'           then p_patch->>'product_sku'                   else product_sku end,
    product_name          = case when p_patch ? 'product_name'          then left(btrim(coalesce(p_patch->>'product_name','')),200) else product_name end,
    product_not_in_catalog= case when p_patch ? 'product_not_in_catalog' then (p_patch->>'product_not_in_catalog')::boolean else product_not_in_catalog end,
    scrap_type            = v_scrap,
    boxes                 = case when p_patch ? 'boxes'          then (p_patch->>'boxes')::integer         else boxes end,
    pieces_per_box        = case when p_patch ? 'pieces_per_box' then (p_patch->>'pieces_per_box')::integer else pieces_per_box end,
    loose_pieces          = case when p_patch ? 'loose_pieces'   then (p_patch->>'loose_pieces')::integer   else loose_pieces end,
    total_pieces          = v_total,
    damaged_pieces        = v_damaged,
    sample_pieces         = case when p_patch ? 'sample_pieces'  then (p_patch->>'sample_pieces')::integer  else sample_pieces end,
    unit_cost             = case when v_cost is null then null else round(v_cost, 2) end,
    return_type           = v_return,
    reason                = case when p_patch ? 'reason' then p_patch->>'reason' else reason end,
    crma                  = v_crma,
    broken_on             = case when p_patch ? 'broken_on' then nullif(p_patch->>'broken_on','')::date else broken_on end,
    broken_by             = v_broken,
    answers               = case when p_patch ? 'answers' then coalesce(answers, '{}'::jsonb) || (p_patch->'answers') else answers end,
    total_loss            = public.warehouse_ops_scrap_loss(
                              case when v_cost is null then null else round(v_cost, 2) end,
                              coalesce(v_damaged, case when v_scrap = 'sample' then 0 else v_total end),
                              v_return, v_crma),
    -- Revertir la aprobacion: el trigger de etapa recalcula stage -> photographed; las firmas las borra el trigger de contenido.
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
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('285_merma_editar_reporte.sql', '623912212457a0a5fe12641df97823df0871ed31973440a5e9f0620975833385') on conflict (name) do nothing;
