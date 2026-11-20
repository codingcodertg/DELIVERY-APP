-- 336: Conteos de inventario: lotes, unidad de medida, producto escrito a mano y medida opcional (2026-11-19).
-- Reunion de Roberto con el dueno (19 nov). Que cambia (idempotente; depende de la 333):
--   1. warehouse_count_lines.unit_of_measure: la unidad de la linea (box = caja, bag = bolsa, piece = pieza). Null = lineas de antes.
--   2. warehouse_count_lines.lots: jsonb con los lotes de la linea [{qty, lot, note, photo}], hasta 20. Asi un producto puede
--      venir en varios lotes (lote 123 = 100 cajas; lote 3A4 = 20 cajas) con su nota y su foto.
--      El total contado de la linea (counted_total) es la suma de los lotes EN LA UNIDAD ELEGIDA (cajas, bolsas o piezas), sin
--      convertir. Las piezas por caja solo se muestran en la pantalla (25 cajas · 300 piezas). Ojo: la firma compara
--      counted_total contra el sistema (en piezas); en productos por caja hay que convertir en la firma (pendiente).
--   3. warehouse_ops_count_lots(linea, unidad, lotes): el personal captura los lotes de una linea (etapa counting).
--      La pantalla nueva la usa; warehouse_ops_count_line (274) queda intacta para lo viejo.
--   4. warehouse_ops_count_add_line(conteo, nombre): producto escrito a mano (la busqueda no lo encontro). Linea sin
--      producto del catalogo (product_id null, sku LIBRE) con el nombre tecleado. Solo en la etapa counting.
--   5. Alcance «proveedor + medida» con la MEDIDA OPCIONAL: sin medida, todas las medidas del proveedor. Se redefinen
--      warehouse_ops_count_products y warehouse_ops_create_count (cuerpo de la 333 con esa regla).
--   6. warehouse_ops_count_recount (redefinida): al mandar a recontar tambien borra los lotes y la unidad.
-- Sin fila en schema_migrations: se aplica a mano cuando el dueno lo diga. No cambia datos existentes.

alter table public.warehouse_count_lines add column if not exists unit_of_measure text;
alter table public.warehouse_count_lines drop constraint if exists warehouse_count_lines_unit_check;
alter table public.warehouse_count_lines add constraint warehouse_count_lines_unit_check
  check (unit_of_measure is null or unit_of_measure in ('box', 'bag', 'piece'));

alter table public.warehouse_count_lines add column if not exists lots jsonb not null default '[]'::jsonb;
alter table public.warehouse_count_lines drop constraint if exists warehouse_count_lines_lots_check;
alter table public.warehouse_count_lines add constraint warehouse_count_lines_lots_check
  check (jsonb_typeof(lots) = 'array' and jsonb_array_length(lots) <= 20);

-- 3. Los lotes de una linea (personal, etapa counting)
create or replace function public.warehouse_ops_count_lots(p_line uuid, p_unit text, p_lots jsonb)
  returns void language plpgsql volatile security definer set search_path = public as $$
declare yo uuid := auth.uid(); l record; c record; x jsonb; q numeric; total numeric := 0;
begin
  if yo is null then raise exception 'warehouse_ops: sin sesion' using errcode = '42501'; end if;
  select * into l from public.warehouse_count_lines where id = p_line for update;
  if l.id is null then raise exception 'warehouse_ops: linea desconocida'; end if;
  select * into c from public.warehouse_counts where id = l.count_id;
  if not public.warehouse_ops_in_store(c.store) then raise exception 'warehouse_ops: sin acceso a esa tienda' using errcode = '42501'; end if;
  if c.stage <> 'counting' then raise exception 'warehouse_ops: el conteo no esta en la etapa de contar' using errcode = '22023'; end if;
  if p_unit is null or p_unit not in ('box', 'bag', 'piece') then raise exception 'warehouse_ops: unidad no valida' using errcode = '22023'; end if;
  if p_lots is null or jsonb_typeof(p_lots) <> 'array' or jsonb_array_length(p_lots) = 0 or jsonb_array_length(p_lots) > 20 then
    raise exception 'warehouse_ops: lotes no validos' using errcode = '22023';
  end if;
  for x in select value from jsonb_array_elements(p_lots) loop
    if jsonb_typeof(x->'qty') is distinct from 'number' then raise exception 'warehouse_ops: la cantidad debe ser un numero' using errcode = '22023'; end if;
    q := (x->>'qty')::numeric;
    if q is null or q < 0 then raise exception 'warehouse_ops: cantidad negativa o vacia' using errcode = '22023'; end if;
    if q > 1000000 then raise exception 'warehouse_ops: cantidad demasiado grande' using errcode = '22023'; end if;
    if length(coalesce(x->>'lot', '')) > 40 then raise exception 'warehouse_ops: el lote es muy largo' using errcode = '22023'; end if;
    if length(coalesce(x->>'note', '')) > 300 then raise exception 'warehouse_ops: la nota es muy larga' using errcode = '22023'; end if;
    if nullif(x->>'photo', '') is not null and split_part(x->>'photo', '/', 1) <> yo::text then
      raise exception 'warehouse_ops: foto no valida' using errcode = '22023';
    end if;
    total := total + q;
  end loop;
  if total <= 0 then raise exception 'warehouse_ops: falta lo contado' using errcode = '22023'; end if;
  update public.warehouse_count_lines set
    unit_of_measure = p_unit,
    lots = (select coalesce(jsonb_agg(jsonb_build_object('qty', (e.value->>'qty')::numeric, 'lot', nullif(btrim(e.value->>'lot'), ''),
                                                       'note', nullif(btrim(e.value->>'note'), ''), 'photo', nullif(e.value->>'photo', '')) order by e.ord), '[]'::jsonb)
            from jsonb_array_elements(p_lots) with ordinality as e(value, ord)),
    counted_boxes = null, counted_pieces = null, counted_total = round(total, 2),
    counted_by = yo, counted_by_name = public.warehouse_ops_caller_name(), counted_at = now(),
    note = null,
    photo = (select nullif(e.value->>'photo', '') from jsonb_array_elements(p_lots) as e(value) where nullif(e.value->>'photo', '') is not null limit 1),
    recount_requested = false
  where id = p_line;
end $$;
revoke all on function public.warehouse_ops_count_lots(uuid, text, jsonb) from public, anon;
grant execute on function public.warehouse_ops_count_lots(uuid, text, jsonb) to authenticated;

-- 4. Producto escrito a mano (personal, etapa counting): una linea sin producto del catalogo
create or replace function public.warehouse_ops_count_add_line(p_count uuid, p_name text)
  returns uuid language plpgsql volatile security definer set search_path = public as $$
declare yo uuid := auth.uid(); c record; nuevo uuid; nombre text := btrim(coalesce(p_name, ''));
begin
  if yo is null then raise exception 'warehouse_ops: sin sesion' using errcode = '42501'; end if;
  select * into c from public.warehouse_counts where id = p_count for update;
  if c.id is null then raise exception 'warehouse_ops: conteo desconocido'; end if;
  if not public.warehouse_ops_in_store(c.store) then raise exception 'warehouse_ops: sin acceso a esa tienda' using errcode = '42501'; end if;
  if c.stage <> 'counting' then raise exception 'warehouse_ops: el conteo no esta en la etapa de contar' using errcode = '22023'; end if;
  if length(nombre) < 2 or length(nombre) > 120 then raise exception 'warehouse_ops: el nombre necesita entre 2 y 120 letras' using errcode = '22023'; end if;
  insert into public.warehouse_count_lines (count_id, product_id, sku, name, size_in, system_qty, price, pieces_per_box, position)
  values (p_count, null, 'LIBRE', nombre, null, null, null, null,
          coalesce((select max(x.position) from public.warehouse_count_lines x where x.count_id = p_count), 0) + 1)
  returning id into nuevo;
  return nuevo;
end $$;
revoke all on function public.warehouse_ops_count_add_line(uuid, text) from public, anon;
grant execute on function public.warehouse_ops_count_add_line(uuid, text) to authenticated;

-- 5. Medida opcional (cuerpo de la 333 con la regla nueva)
create or replace function public.warehouse_ops_count_products(p_store text, p_scope_kind text, p_vendor text, p_size text, p_note text, p_product_id bigint)
  returns table (id bigint, sku text, name text, vendor_name text, size_in text, price numeric, pieces_per_box integer, qoh numeric)
  language plpgsql stable security definer set search_path = public, erp as $$
declare tienda text := public.warehouse_ops_erp_store_id(p_store); patron text; sin_nota boolean := btrim(coalesce(p_note, '')) = '';
begin
  if not public.warehouse_ops_in_store(p_store) then raise exception 'warehouse_ops: sin acceso a esa tienda' using errcode = '42501'; end if;
  if p_scope_kind not in ('vendor_size', 'vendor_note', 'product') then raise exception 'warehouse_ops: alcance no valido' using errcode = '22023'; end if;
  if p_scope_kind = 'product' then
    if p_product_id is null then raise exception 'warehouse_ops: falta el producto' using errcode = '22023'; end if;
  elsif p_vendor is null or btrim(p_vendor) = '' then
    raise exception 'warehouse_ops: falta el proveedor' using errcode = '22023';
  elsif p_scope_kind = 'vendor_size' and not sin_nota and length(btrim(p_note)) < 2 then
    raise exception 'warehouse_ops: la nota necesita al menos 2 letras' using errcode = '22023';
  elsif p_scope_kind = 'vendor_note' and length(btrim(coalesce(p_note, ''))) < 2 then
    raise exception 'warehouse_ops: la nota necesita al menos 2 letras' using errcode = '22023';
  end if;
  patron := '%' || replace(replace(replace(btrim(coalesce(p_note, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return query
    select p.id, p.sku, p.name, btrim(v.name) as vendor_name, p.size_in, p.price, p.pieces_per_box, sp.qoh
    from erp.products p
      left join erp.vendors v on v.id = p.vendor_id
      left join erp.store_products sp on sp.product_id = p.id and sp.store_id = tienda
    where p.record_status <> 'archived'
      and case p_scope_kind
            when 'product' then p.id = p_product_id
            when 'vendor_size' then public.warehouse_ops_norm_nombre(v.name) = public.warehouse_ops_norm_nombre(p_vendor)
                 and (nullif(btrim(coalesce(p_size, '')), '') is null or public.warehouse_ops_norm_medida(p.size_in) = public.warehouse_ops_norm_medida(p_size))
                 and (sin_nota or (p.name ilike patron or p.sku ilike patron or coalesce(p.collection, '') ilike patron
                      or coalesce(p.tags, '') ilike patron or coalesce(p.color1, '') ilike patron or coalesce(p.style, '') ilike patron))
            else public.warehouse_ops_norm_nombre(v.name) = public.warehouse_ops_norm_nombre(p_vendor)
                 and (p.name ilike patron or p.sku ilike patron or coalesce(p.collection, '') ilike patron
                      or coalesce(p.tags, '') ilike patron or coalesce(p.color1, '') ilike patron or coalesce(p.style, '') ilike patron)
          end
    order by p.name, p.sku
    limit 500;
end $$;
revoke all on function public.warehouse_ops_count_products(text, text, text, text, text, bigint) from public, anon;
grant execute on function public.warehouse_ops_count_products(text, text, text, text, text, bigint) to authenticated;

create or replace function public.warehouse_ops_create_count(p_store text, p_scope_kind text, p_vendor text, p_size text, p_note text, p_product_id bigint, p_instructions text)
  returns uuid language plpgsql volatile security definer set search_path = public, erp as $$
declare yo uuid := auth.uid(); nuevo uuid; titulo text; n int;
begin
  if yo is null then raise exception 'warehouse_ops: sin sesion' using errcode = '42501'; end if;
  if p_store is null or btrim(p_store) = '' then raise exception 'warehouse_ops: falta la tienda' using errcode = '22023'; end if;
  if not public.warehouse_ops_can_manage(p_store) then
    raise exception 'warehouse_ops: solo el gerente de la tienda abre un conteo' using errcode = '42501';
  end if;
  if p_scope_kind = 'product' then
    select p.sku || ' · ' || p.name into titulo from erp.products p where p.id = p_product_id;
    if titulo is null then raise exception 'warehouse_ops: producto desconocido'; end if;
  elsif p_scope_kind = 'vendor_size' then
    titulo := btrim(p_vendor) || case when btrim(coalesce(p_size, '')) <> '' then ' · ' || btrim(p_size) else '' end || case when btrim(coalesce(p_note, '')) <> '' then ' · ' || btrim(p_note) else '' end;
  elsif p_scope_kind = 'vendor_note' then titulo := btrim(p_vendor) || ' · ' || btrim(p_note);
  else raise exception 'warehouse_ops: alcance no valido' using errcode = '22023';
  end if;
  insert into public.warehouse_counts (store, scope_kind, vendor_name, size_in, note, product_id, title, instructions, created_by, created_by_name)
  values (btrim(p_store), p_scope_kind, nullif(btrim(p_vendor), ''), nullif(btrim(p_size), ''), nullif(btrim(p_note), ''),
          case when p_scope_kind = 'product' then p_product_id end, titulo, nullif(btrim(p_instructions), ''), yo, public.warehouse_ops_caller_name())
  returning id into nuevo;
  insert into public.warehouse_count_lines (count_id, product_id, sku, name, size_in, system_qty, price, pieces_per_box, position)
  select nuevo, q.id, q.sku, q.name, q.size_in, q.qoh, q.price, q.pieces_per_box, row_number() over (order by q.name, q.sku)
  from public.warehouse_ops_count_products(btrim(p_store), p_scope_kind, p_vendor, p_size, p_note, p_product_id) q;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'warehouse_ops: ese alcance no tiene productos' using errcode = '22023'; end if;
  return nuevo;
end $$;
revoke all on function public.warehouse_ops_create_count(text, text, text, text, text, bigint, text) from public, anon;
grant execute on function public.warehouse_ops_create_count(text, text, text, text, text, bigint, text) to authenticated;

-- 6. Recontar tambien borra los lotes y la unidad (cuerpo de la 333 con eso)
create or replace function public.warehouse_ops_count_recount(p_line uuid, p_note text)
  returns void language plpgsql volatile security definer set search_path = public as $$
declare yo uuid := auth.uid(); l record; c record;
begin
  if yo is null then raise exception 'warehouse_ops: sin sesion' using errcode = '42501'; end if;
  select * into l from public.warehouse_count_lines where id = p_line for update;
  if l.id is null then raise exception 'warehouse_ops: linea desconocida'; end if;
  select * into c from public.warehouse_counts where id = l.count_id for update;
  if not public.warehouse_ops_can_manage(c.store) then raise exception 'warehouse_ops: solo el gerente manda a recontar' using errcode = '42501'; end if;
  if c.stage not in ('counting', 'review', 'sign_off') then raise exception 'warehouse_ops: el conteo ya esta ajustado o cancelado' using errcode = '22023'; end if;
  update public.warehouse_count_lines set counted_boxes = null, counted_pieces = null, counted_total = null, counted_by = null, counted_by_name = null,
    counted_at = null, lots = '[]'::jsonb, unit_of_measure = null, recount_requested = true, recount_note = nullif(btrim(p_note), '') where id = p_line;
  update public.warehouse_counts set stage = 'counting', counting_done_at = null, counting_done_by = null, orders_reviewed_at = null, orders_reviewed_by = null,
    signed_at = null, signed_by = null, signed_by_name = null, signed_sheet = null, sign_note = null
  where id = c.id;
end $$;
revoke all on function public.warehouse_ops_count_recount(uuid, text) from public, anon;
grant execute on function public.warehouse_ops_count_recount(uuid, text) to authenticated;
