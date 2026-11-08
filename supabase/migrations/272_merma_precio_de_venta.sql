-- 272: Merma: el monto por pieza es el PRECIO DE VENTA del catalogo, no el costo del proveedor (Warehouse Ops) (2026-11-08).
--
-- Roberto (gerente de almacen), 2026-11-08: «Cost should be sales price, most employees should not know of product
-- costs from supplier.» Hasta hoy la merma congelaba erp.products.cost (lo que nos cuesta el producto) en
-- warehouse_reports.unit_cost y con el sacaba la perdida en $. Eso le ensenaba el costo del proveedor a cualquiera
-- que registra o ve una merma. Desde esta migracion se congela erp.products.price (el precio de venta por pieza).
--
-- Que hace:
--   1. warehouse_ops_search_products (247): devuelve pp.price en la columna `cost` (misma firma: la pantalla ya
--      desplegada la lee igual y pasa a ver el precio sin cambiar nada).
--   2. warehouse_ops_file_report (263, mismo cuerpo salvo la fuente): al vincular un producto del catalogo copia
--      pp.price en unit_cost; la perdida sigue siendo warehouse_ops_scrap_loss(precio, danadas, origen, crma).
--      Fuera de catalogo (252) el monto por pieza lo escribe quien reporta: ahora se le pide como precio de venta.
--   3. warehouse_ops_edit_scrap_product (265, mismo cuerpo salvo la fuente): al corregir hacia un producto del
--      catalogo copia pp.price. A mano (p_cost) sigue igual.
--   4. Las mermas que ya hay y estan vinculadas al catalogo (product_id no nulo y product_not_in_catalog = false)
--      pasan a unit_cost = precio actual del producto y total_loss se recalcula con la MISMA cuenta de la 259/263:
--      warehouse_ops_scrap_loss(unit_cost, coalesce(damaged_pieces, ...), return_type, crma). Las que estan fuera
--      de catalogo no se tocan: ese monto lo escribio una persona.
--
-- La columna sigue llamandose unit_cost (renombrarla tocaria tipos, pantallas, pruebas y CSV); lo que cambia es
-- lo que guarda y como lo nombra la pantalla: «Price» / «Precio».
--
-- Sin begin/commit propios. Para deshacer: volver a correr warehouse_ops_search_products de la 247,
-- warehouse_ops_file_report de la 263 y warehouse_ops_edit_scrap_product de la 265; las filas recalculadas no se
-- pueden devolver a su costo de antes sin un respaldo (el costo congelado se sobrescribe aqui a proposito), y
-- delete from public.schema_migrations where name = '272_merma_precio_de_venta.sql'.

-- 1. Buscar producto: la misma firma, el precio de venta en la columna `cost`
create or replace function public.warehouse_ops_search_products(q text)
  returns table (id bigint, sku text, name text, cost numeric, pieces_per_box integer)
  language plpgsql stable security definer set search_path = public, erp as $$
declare patron text;
begin
  if not public.has_warehouse_ops_access() then raise exception 'warehouse_ops: sin acceso' using errcode = '42501'; end if;
  if length(btrim(coalesce(q, ''))) < 2 then return; end if;
  patron := '%' || replace(replace(replace(btrim(q), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return query
    -- 272: precio de venta, no costo del proveedor
    select p.id, p.sku, p.name, p.price as cost, p.pieces_per_box
    from erp.products p
    where p.record_status <> 'archived' and (p.sku ilike patron or p.name ilike patron)
    order by (p.sku ilike btrim(q)) desc, p.name
    limit 8;
end $$;

-- 2. Registrar un reporte (la de la 263; solo cambia pp.cost -> pp.price)
create or replace function public.warehouse_ops_file_report(
  p_kind text, p_store text, p_subject_ids uuid[], p_answers jsonb, p_photos text[], p_scrap jsonb
) returns uuid
  language plpgsql volatile security definer set search_path = public, erp, recruiting as $$
declare
  yo uuid := auth.uid();
  mi_nombre text;
  nuevo uuid;
  sujetos uuid[] := coalesce(p_subject_ids, '{}');
  fotos text[] := coalesce(p_photos, '{}');
  prod record;
  v_boxes int; v_ppb int; v_loose int; v_total int;
  v_broken uuid[] := '{}';
  v_hr_kind text;
  v_texto text;
  s uuid;
  v_libre boolean := false;
  v_nombre text;
  v_costo numeric;
  v_dan int; v_mue int;
  v_tipo text; v_origen text; v_crma text;
begin
  if yo is null or not public.has_warehouse_ops_access() then
    raise exception 'warehouse_ops: sin acceso' using errcode = '42501';
  end if;
  if p_kind not in ('incident', 'zone', 'insubordination', 'safety', 'maintenance', 'positive', 'scrap') then
    raise exception 'warehouse_ops: tipo desconocido %', p_kind;
  end if;
  if not exists (select 1 from public.settings st, jsonb_array_elements(coalesce(st.stores, '[]'::jsonb)) e
                 where st.id = 1 and e->>'name' = p_store) then
    raise exception 'warehouse_ops: tienda desconocida %', p_store;
  end if;
  if exists (select 1 from unnest(sujetos) u where not exists (select 1 from public.profiles pr where pr.id = u)) then
    raise exception 'warehouse_ops: empleado desconocido';
  end if;
  if p_kind in ('incident', 'zone', 'insubordination', 'safety', 'positive') and cardinality(sujetos) = 0 then
    raise exception 'warehouse_ops: falta el empleado';
  end if;
  if p_kind = 'positive' and cardinality(sujetos) <> 1 then
    raise exception 'warehouse_ops: la observacion positiva es de un empleado';
  end if;
  if cardinality(fotos) > 6 or exists (select 1 from unnest(fotos) f where split_part(f, '/', 1) <> yo::text) then
    raise exception 'warehouse_ops: foto no valida';
  end if;
  select full_name into mi_nombre from public.profiles where id = yo;

  if p_kind = 'scrap' then
    if p_scrap is null then raise exception 'warehouse_ops: faltan los datos de la merma'; end if;
    if nullif(p_scrap->>'product_id', '') is not null then
      -- 272: se congela el PRECIO DE VENTA (pp.price), no el costo del proveedor; la columna sigue siendo `cost`.
      select pp.id, pp.sku, pp.name, pp.price as cost into prod from erp.products pp where pp.id = (p_scrap->>'product_id')::bigint;
      if prod.id is null then raise exception 'warehouse_ops: producto desconocido'; end if;
      v_libre := false;
    else
      -- Fuera de catalogo (252): nombre escrito a mano y, si lo saben, el precio de venta por pieza. Un gerente lo corrige luego.
      v_nombre := left(btrim(coalesce(p_scrap->>'free_name', '')), 200);
      if length(v_nombre) < 2 then raise exception 'warehouse_ops: falta el producto'; end if;
      v_costo := nullif(p_scrap->>'unit_cost', '')::numeric;
      if v_costo is not null and (v_costo < 0 or v_costo > 100000) then raise exception 'warehouse_ops: costo no valido'; end if;
      select null::bigint as id, null::text as sku, v_nombre as name, round(v_costo, 2) as cost into prod;
      v_libre := true;
    end if;
    v_boxes := coalesce((p_scrap->>'boxes')::int, 0);
    v_ppb   := coalesce((p_scrap->>'pieces_per_box')::int, 1);
    v_loose := coalesce((p_scrap->>'loose_pieces')::int, 0);
    if v_boxes < 0 or v_loose < 0 or v_ppb < 1 then raise exception 'warehouse_ops: cantidades no validas'; end if;
    v_total := v_boxes * v_ppb + v_loose;
    if v_total < 1 then raise exception 'warehouse_ops: cero piezas'; end if;
    -- 254: el reparto. De las piezas, cuantas danadas y cuantas de muestra; deben sumar el total. Una pantalla vieja
    -- (sin las dos cuentas) manda solo scrap_type = damaged | sample: todas las piezas son de ese tipo.
    if p_scrap ? 'damaged_pieces' or p_scrap ? 'sample_pieces' then
      v_dan := coalesce((p_scrap->>'damaged_pieces')::int, 0);
      v_mue := coalesce((p_scrap->>'sample_pieces')::int, 0);
    elsif p_scrap->>'scrap_type' = 'damaged' then
      v_dan := v_total; v_mue := 0;
    elsif p_scrap->>'scrap_type' = 'sample' then
      v_dan := 0; v_mue := v_total;
    else
      raise exception 'warehouse_ops: falta cuantas piezas estan danadas y cuantas son de muestra';
    end if;
    if v_dan < 0 or v_mue < 0 or v_dan + v_mue <> v_total then
      raise exception 'warehouse_ops: danadas + muestra deben sumar el total de piezas (%)', v_total;
    end if;
    v_tipo := case when v_mue = 0 then 'damaged' when v_dan = 0 then 'sample' else 'mixed' end;
    -- 263: el origen se vuelve a preguntar. Sin return_type sigue siendo internal (lo que manda Warehouse Ops 0.4.0).
    v_origen := coalesce(nullif(p_scrap->>'return_type', ''), 'internal');
    if v_origen not in ('internal', 'customer_return') then
      raise exception 'warehouse_ops: origen de la merma no valido';
    end if;
    v_crma := nullif(left(btrim(coalesce(p_scrap->>'crma', '')), 100), '');
    -- 263: el CRMA es OPCIONAL (la 254 lo exigia en devolucion de cliente). Sin el, la devolucion no cuenta como perdida.
    if v_origen <> 'customer_return' then v_crma := null; end if;
    select coalesce(array_agg(x::uuid), '{}') into v_broken from jsonb_array_elements_text(coalesce(p_scrap->'broken_by', '[]'::jsonb)) x;
    if exists (select 1 from unnest(v_broken) u where not exists (select 1 from public.profiles pr where pr.id = u)) then
      raise exception 'warehouse_ops: empleado desconocido';
    end if;
    insert into public.warehouse_reports (kind, store, author_id, author_name, subject_ids, answers, photos,
        product_id, product_sku, product_name, scrap_type, boxes, pieces_per_box, loose_pieces, total_pieces,
        unit_cost, total_loss, return_type, reason, broken_by, crma, product_not_in_catalog, damaged_pieces, sample_pieces)
      values ('scrap', p_store, yo, mi_nombre, '{}', coalesce(p_answers, '{}'::jsonb), fotos,
        prod.id, prod.sku, prod.name, v_tipo, v_boxes, v_ppb, v_loose, v_total,
        -- 259: la perdida es precio x piezas DANADAS. 263: y 0 si es devolucion de cliente sin CRMA. 272: precio de venta.
        prod.cost, public.warehouse_ops_scrap_loss(prod.cost, v_dan, v_origen, v_crma),
        v_origen, p_scrap->>'reason', v_broken, v_crma, v_libre, v_dan, v_mue)
      returning id into nuevo;
    return nuevo;
  end if;

  insert into public.warehouse_reports (kind, store, author_id, author_name, subject_ids, answers, photos)
    values (p_kind, p_store, yo, mi_nombre, sujetos, coalesce(p_answers, '{}'::jsonb), fotos)
    returning id into nuevo;

  -- El gancho al expediente: una fila por empleado en el historial de RR. HH., como las amonestaciones.
  v_hr_kind := case p_kind when 'insubordination' then 'employee_insubordination'
                           when 'zone' then 'employee_zone_infraction'
                           when 'positive' then 'employee_positive_observation' end;
  if v_hr_kind is not null then
    v_texto := left(coalesce(p_answers->>'description', ''), 1000);
    foreach s in array sujetos loop
      insert into recruiting.hr_history (kind, employee_id, employee_name, actor_id, actor_name, reason, detail, data)
        values (v_hr_kind,
          (select ef.id from recruiting.employee_files ef where ef.id = s),
          (select full_name from public.profiles where id = s),
          yo, mi_nombre, nullif(v_texto, ''),
          'Warehouse Ops · ' || p_store,
          jsonb_build_object('source', 'warehouse_ops', 'report_id', nuevo, 'profile_id', s, 'store', p_store,
                             'answers', coalesce(p_answers, '{}'::jsonb)));
    end loop;
  end if;
  return nuevo;
end $$;

-- 3. Corregir el producto de una merma (la de la 265; solo cambia pp.cost -> pp.price)
create or replace function public.warehouse_ops_edit_scrap_product(
  p_report uuid, p_product_id bigint, p_name text, p_cost numeric
) returns void
  language plpgsql volatile security definer set search_path = public, erp as $$
declare
  yo uuid := auth.uid();
  r record;
  prod record;
  v_nombre text;
begin
  select * into r from public.warehouse_reports where id = p_report and kind = 'scrap';
  if r.id is null then raise exception 'warehouse_ops: reporte desconocido'; end if;
  if yo is null or not public.warehouse_ops_can_manage(r.store) then
    raise exception 'warehouse_ops: solo el gerente de la tienda corrige la merma' using errcode = '42501';
  end if;
  if p_product_id is not null then
    -- 272: precio de venta, no costo del proveedor
    select pp.id, pp.sku, pp.name, pp.price as cost into prod from erp.products pp where pp.id = p_product_id;
    if prod.id is null then raise exception 'warehouse_ops: producto desconocido'; end if;
    update public.warehouse_reports set product_id = prod.id, product_sku = prod.sku, product_name = prod.name,
        unit_cost = prod.cost, total_loss = public.warehouse_ops_scrap_loss(prod.cost, coalesce(damaged_pieces, case when scrap_type = 'sample' then 0 else total_pieces end), return_type, crma),
        product_not_in_catalog = false, edited_by = yo, edited_at = now()
      where id = p_report;
  else
    v_nombre := left(btrim(coalesce(p_name, '')), 200);
    if length(v_nombre) < 2 then raise exception 'warehouse_ops: falta el producto'; end if;
    if p_cost is not null and (p_cost < 0 or p_cost > 100000) then raise exception 'warehouse_ops: costo no valido'; end if;
    update public.warehouse_reports set product_id = null, product_sku = null, product_name = v_nombre,
        unit_cost = round(p_cost, 2), total_loss = public.warehouse_ops_scrap_loss(round(p_cost, 2), coalesce(damaged_pieces, case when scrap_type = 'sample' then 0 else total_pieces end), return_type, crma),
        product_not_in_catalog = true, edited_by = yo, edited_at = now()
      where id = p_report;
  end if;
end $$;

-- 4. Las mermas que ya hay y estan vinculadas al catalogo: precio de venta actual y la misma cuenta (259 + 263)
update public.warehouse_reports r
   set unit_cost  = pp.price,
       total_loss = public.warehouse_ops_scrap_loss(pp.price, coalesce(r.damaged_pieces, case when r.scrap_type = 'sample' then 0 else r.total_pieces end), r.return_type, r.crma)
  from erp.products pp
 where r.kind = 'scrap' and r.product_id = pp.id and coalesce(r.product_not_in_catalog, false) = false
   and r.total_pieces is not null
   and (r.unit_cost is distinct from pp.price
        or r.total_loss is distinct from public.warehouse_ops_scrap_loss(pp.price, coalesce(r.damaged_pieces, case when r.scrap_type = 'sample' then 0 else r.total_pieces end), r.return_type, r.crma));

-- 5. Comprobaciones
do $chk$
declare def text; def2 text; def3 text;
begin
  def  := pg_get_functiondef('public.warehouse_ops_file_report(text, text, uuid[], jsonb, text[], jsonb)'::regprocedure);
  def2 := pg_get_functiondef('public.warehouse_ops_edit_scrap_product(uuid, bigint, text, numeric)'::regprocedure);
  def3 := pg_get_functiondef('public.warehouse_ops_search_products(text)'::regprocedure);
  if position('pp.price as cost' in def) = 0 or position('pp.cost' in def) > 0 then
    raise exception '272: warehouse_ops_file_report sigue copiando el costo del proveedor';
  end if;
  if position('warehouse_ops_scrap_loss(prod.cost, v_dan, v_origen, v_crma)' in def) = 0
     or position('origen de la merma no valido' in def) = 0 or position('damaged_pieces' in def) = 0
     or position('free_name' in def) = 0 or position('hr_history' in def) = 0 then
    raise exception '272: warehouse_ops_file_report perdio algo de la 252 / 254 / 259 / 263';
  end if;
  if position('pp.price as cost' in def2) = 0 or position('pp.cost' in def2) > 0
     or position('warehouse_ops_can_manage' in def2) = 0 or position('warehouse_ops_scrap_loss' in def2) = 0 then
    raise exception '272: warehouse_ops_edit_scrap_product sigue copiando el costo del proveedor o perdio la 263 / 265';
  end if;
  if position('p.price as cost' in def3) = 0 or position('p.cost' in def3) > 0 then
    raise exception '272: warehouse_ops_search_products sigue devolviendo el costo del proveedor';
  end if;
  if exists (select 1 from public.warehouse_reports r join erp.products pp on pp.id = r.product_id
              where r.kind = 'scrap' and coalesce(r.product_not_in_catalog, false) = false and r.total_pieces is not null
                and (r.unit_cost is distinct from pp.price
                     or r.total_loss is distinct from public.warehouse_ops_scrap_loss(pp.price, coalesce(r.damaged_pieces, case when r.scrap_type = 'sample' then 0 else r.total_pieces end), r.return_type, r.crma))) then
    raise exception '272: quedan mermas del catalogo con el costo del proveedor';
  end if;
  if has_function_privilege('anon', 'public.warehouse_ops_file_report(text, text, uuid[], jsonb, text[], jsonb)', 'execute')
     or has_function_privilege('anon', 'public.warehouse_ops_edit_scrap_product(uuid, bigint, text, numeric)', 'execute')
     or has_function_privilege('anon', 'public.warehouse_ops_search_products(text)', 'execute') then
    raise exception '272: anon ejecuta funciones de Warehouse Ops';
  end if;
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('272_merma_precio_de_venta.sql', '61cbba471d2cefb798a0c7b2f9eb2209513b1aaf8b81a65e949aa2db371b7c69') on conflict (name) do nothing;
