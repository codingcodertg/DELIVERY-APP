-- 347: Conteos de inventario: la firma pide razón SOLO si hay diferencia (2026-11-24). Sin aplicar hasta que el dueño lo diga.
-- Dueño (2026-11-24, hoja de firma con una bolsa de mortero): «counted − pending = actual, y cuando se compare con el
-- system entonces difference debería match». La 336 (D-1105) dejaba sin comparar las bolsas, las cajas sin piezas por
-- caja y los productos libres, y la firma pedía razón por ellas aunque la cuenta cuadrara. Regla nueva, para toda línea:
--   real = contado − pendiente; diferencia = real − sistema (en la unidad en que está guardada la línea).
--   La razón se pide solo si la diferencia es distinta de 0 después de las órdenes pendientes.
-- Qué cambia (idempotente; depende de la 336; el resto de la firma es la de la 336 tal cual):
--   1. warehouse_ops_count_sign: la prueba «hay diferencia» deja de exigir razón por la unidad (bolsas, cajas sin piezas
--      por caja); solo cuenta la diferencia. Y deja de exigir un producto del catálogo: el producto libre con sistema
--      tecleado también se compara (la pantalla nueva lo hace igual).
-- La aplica el dueño a mano (scripts/db/aplica-migracion.mjs); no cambia datos existentes. Comprobado antes de escribirla:
-- la función de producción era idéntica a la de la 336, así que no se pisa nada más.
create or replace function public.warehouse_ops_count_sign(p_count uuid, p_sheet text, p_note text)
  returns void language plpgsql volatile security definer set search_path = public as $$
declare yo uuid := auth.uid(); c record; faltan_conteo int; faltan_sistema int; hay_diferencia boolean;
begin
  if yo is null then raise exception 'warehouse_ops: sin sesion' using errcode = '42501'; end if;
  select * into c from public.warehouse_counts where id = p_count for update;
  if c.id is null then raise exception 'warehouse_ops: conteo desconocido'; end if;
  if not public.warehouse_ops_can_manage(c.store) then raise exception 'warehouse_ops: solo el gerente firma el conteo' using errcode = '42501'; end if;
  if c.stage <> 'sign_off' then raise exception 'warehouse_ops: el conteo no esta en firma' using errcode = '22023'; end if;
  if p_sheet is not null and split_part(p_sheet, '/', 1) <> yo::text then raise exception 'warehouse_ops: hoja no valida' using errcode = '22023'; end if;
  select count(*) into faltan_conteo from public.warehouse_count_lines l where l.count_id = p_count and l.counted_at is null;
  if faltan_conteo > 0 then raise exception 'warehouse_ops: faltan % lineas por contar', faltan_conteo using errcode = '22023'; end if;
  select count(*) into faltan_sistema from public.warehouse_count_lines l where l.count_id = p_count and l.system_qty is null;
  if faltan_sistema > 0 then raise exception 'warehouse_ops: faltan % cantidades del sistema', faltan_sistema using errcode = '22023'; end if;
  select exists (
    select 1 from public.warehouse_count_lines l
    where l.count_id = p_count
      -- 347: solo la diferencia (después de pendientes) pide razón; ya no la unidad ni que sea producto del catálogo.
      and l.system_qty is not null
      and l.counted_total - coalesce((select sum(pp.qty) from public.warehouse_count_pending pp where pp.line_id = l.id), 0) - l.system_qty <> 0
  ) into hay_diferencia;
  if hay_diferencia and length(btrim(coalesce(p_note, ''))) < 2 then
    raise exception 'warehouse_ops: hay diferencias: escribe la razon antes de firmar' using errcode = '22023';
  end if;
  update public.warehouse_counts set signed_at = now(), signed_by = yo, signed_by_name = public.warehouse_ops_caller_name(), signed_sheet = p_sheet,
    sign_note = nullif(btrim(coalesce(p_note, '')), '') where id = p_count;
end $$;
revoke all on function public.warehouse_ops_count_sign(uuid, text, text) from public, anon;
grant execute on function public.warehouse_ops_count_sign(uuid, text, text) to authenticated;
-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('347_conteos_real_y_diferencia.sql', '25b5be4abcd2d042655000ed81a172ba27486728f9270e4350d7de4797ed6c7a') on conflict (name) do nothing;
