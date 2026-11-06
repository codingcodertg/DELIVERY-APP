-- 263: Merma: el origen se vuelve a preguntar, el CRMA es opcional y sin CRMA la devolucion no es perdida (Warehouse Ops, D-883) (2026-11-06).
--
-- Corrige un error de la 259. El pedido 714584e6 de Roberto (admin) pedia quitar del formulario de merma «de donde
-- viene» y el CRMA, y asi se hizo. Pero 18 minutos despues, en el mismo hilo, Roberto habia escrito:
--   «Disregard this request. It does apply BUT the CRMA is optional and if CRMA is filled then it sums the loss,
--    if no CRMA then no loss».
-- La pantalla nueva vuelve a preguntar el origen y, en devolucion de cliente, el CRMA, que ahora es OPCIONAL.
--
-- La perdida, leyendo su frase al pie de la letra y junto con la regla de la 259 (solo cuentan las piezas danadas):
--   - merma interna:                        unit_cost x damaged_pieces (igual que la 259)
--   - devolucion de cliente CON CRMA:       unit_cost x damaged_pieces
--   - devolucion de cliente SIN CRMA:       0.00 (no cuenta como perdida), tenga o no costo el producto
-- La cuenta vive en UNA funcion, public.warehouse_ops_scrap_loss, y la usan las tres que escriben total_loss:
--   - warehouse_ops_file_report        (ya no exige el CRMA en devolucion de cliente)
--   - warehouse_ops_edit_scrap_product (recalcula con el origen y el CRMA de la fila)
--   - warehouse_ops_edit_scrap_origin  (NUEVA: el gerente corrige el origen y pone o quita el CRMA, que suele llegar
--                                       despues del reporte; la perdida lo sigue). Mismo permiso que corregir producto.
-- Las filas que ya hay se recalculan con la misma funcion: solo cambian las devoluciones de cliente sin CRMA (a 0.00).
--
-- SE APLICA ANTES de desplegar la pantalla nueva. La desplegada (Warehouse Ops 0.4.0) manda siempre
-- return_type = internal y crma = null: para ella nada cambia (misma firma, mismo monto guardado: costo x danadas). Su
-- correccion de producto (warehouse_ops_edit_scrap_product, misma firma) tambien sigue igual. Una pantalla mas vieja
-- en cache (0.3.0: devolucion de cliente con CRMA; o solo scrap_type) tambien sigue entrando. Nada exige ahora algo que
-- antes no se exigiera; lo unico que se relaja es el CRMA obligatorio.
--
-- Sin begin/commit propios. Para deshacer: volver a correr las dos funciones de la 259,
-- drop function public.warehouse_ops_edit_scrap_origin(uuid, text, text), update public.warehouse_reports set
-- total_loss = round(unit_cost * coalesce(damaged_pieces, case when scrap_type = 'sample' then 0 else total_pieces end), 2)
-- where kind = 'scrap' and unit_cost is not null, drop function public.warehouse_ops_scrap_loss(numeric, integer, text, text)
-- y delete from public.schema_migrations where name = '263_merma_crma_opcional.sql'.

-- 1. La cuenta de la perdida, en un solo sitio
create or replace function public.warehouse_ops_scrap_loss(
  p_cost numeric, p_damaged integer, p_return_type text, p_crma text
) returns numeric
  language sql immutable set search_path = '' as $$
  select case
    when p_return_type = 'customer_return' and nullif(btrim(coalesce(p_crma, '')), '') is null then 0.00
    when p_cost is null or p_damaged is null then null
    else round(p_cost * p_damaged, 2)
  end
$$;

-- 2. Las filas que ya hay: la misma cuenta (solo cambian las devoluciones de cliente sin CRMA)
update public.warehouse_reports
   set total_loss = public.warehouse_ops_scrap_loss(unit_cost, coalesce(damaged_pieces, case when scrap_type = 'sample' then 0 else total_pieces end), return_type, crma)
 where kind = 'scrap' and total_pieces is not null
   and total_loss is distinct from public.warehouse_ops_scrap_loss(unit_cost, coalesce(damaged_pieces, case when scrap_type = 'sample' then 0 else total_pieces end), return_type, crma);

-- 3. Registrar un reporte (la de la 259; CRMA opcional y perdida con la funcion)
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
      select pp.id, pp.sku, pp.name, pp.cost into prod from erp.products pp where pp.id = (p_scrap->>'product_id')::bigint;
      if prod.id is null then raise exception 'warehouse_ops: producto desconocido'; end if;
      v_libre := false;
    else
      -- Fuera de catalogo (252): nombre escrito a mano y, si lo saben, el costo por pieza. Un gerente lo corrige luego.
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
        -- 259: la perdida es costo x piezas DANADAS. 263: y 0 si es devolucion de cliente sin CRMA.
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

-- 4. Corregir el producto de una merma (la de la 259; recalcula con el origen y el CRMA de la fila)
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
  if yo is null or not exists (
    select 1 from public.profiles p where p.id = yo and (
      p.role = 'admin'
      or ('warehouse_ops' = any(coalesce(p.module_access, '{}'))
          and (p.role = 'manager' or 'warehouse_ops_supervisor' = any(coalesce(p.permissions, '{}')))
          and (p.store = r.store or r.store = any(coalesce(p.visible_stores, '{}'))))
    )
  ) then
    raise exception 'warehouse_ops: solo el gerente de la tienda corrige la merma' using errcode = '42501';
  end if;
  if p_product_id is not null then
    select pp.id, pp.sku, pp.name, pp.cost into prod from erp.products pp where pp.id = p_product_id;
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

-- 5. Corregir el origen y el CRMA de una merma (nueva). El CRMA es opcional; la perdida lo sigue.
create or replace function public.warehouse_ops_edit_scrap_origin(
  p_report uuid, p_return_type text, p_crma text
) returns void
  language plpgsql volatile security definer set search_path = public as $$
declare
  yo uuid := auth.uid();
  r record;
  v_origen text := coalesce(nullif(p_return_type, ''), 'internal');
  v_crma text := nullif(left(btrim(coalesce(p_crma, '')), 100), '');
begin
  select * into r from public.warehouse_reports where id = p_report and kind = 'scrap';
  if r.id is null then raise exception 'warehouse_ops: reporte desconocido'; end if;
  if yo is null or not exists (
    select 1 from public.profiles p where p.id = yo and (
      p.role = 'admin'
      or ('warehouse_ops' = any(coalesce(p.module_access, '{}'))
          and (p.role = 'manager' or 'warehouse_ops_supervisor' = any(coalesce(p.permissions, '{}')))
          and (p.store = r.store or r.store = any(coalesce(p.visible_stores, '{}'))))
    )
  ) then
    raise exception 'warehouse_ops: solo el gerente de la tienda corrige la merma' using errcode = '42501';
  end if;
  if v_origen not in ('internal', 'customer_return') then
    raise exception 'warehouse_ops: origen de la merma no valido';
  end if;
  if v_origen <> 'customer_return' then v_crma := null; end if;
  update public.warehouse_reports set return_type = v_origen, crma = v_crma,
      total_loss = public.warehouse_ops_scrap_loss(unit_cost, coalesce(damaged_pieces, case when scrap_type = 'sample' then 0 else total_pieces end), v_origen, v_crma),
      edited_by = yo, edited_at = now()
    where id = p_report;
end $$;

revoke all on function public.warehouse_ops_scrap_loss(numeric, integer, text, text) from public, anon, authenticated;
revoke all on function public.warehouse_ops_file_report(text, text, uuid[], jsonb, text[], jsonb) from public, anon;
grant execute on function public.warehouse_ops_file_report(text, text, uuid[], jsonb, text[], jsonb) to authenticated;
revoke all on function public.warehouse_ops_edit_scrap_product(uuid, bigint, text, numeric) from public, anon;
grant execute on function public.warehouse_ops_edit_scrap_product(uuid, bigint, text, numeric) to authenticated;
revoke all on function public.warehouse_ops_edit_scrap_origin(uuid, text, text) from public, anon;
grant execute on function public.warehouse_ops_edit_scrap_origin(uuid, text, text) to authenticated;

do $chk$
declare
  def text := pg_get_functiondef('public.warehouse_ops_file_report(text, text, uuid[], jsonb, text[], jsonb)'::regprocedure);
  def2 text := pg_get_functiondef('public.warehouse_ops_edit_scrap_product(uuid, bigint, text, numeric)'::regprocedure);
  def3 text := pg_get_functiondef('public.warehouse_ops_edit_scrap_origin(uuid, text, text)'::regprocedure);
begin
  -- Los tres casos de Roberto, mas sin costo y a centavos
  if public.warehouse_ops_scrap_loss(1.00, 27, 'internal', null) is distinct from 27.00
     or public.warehouse_ops_scrap_loss(1.00, 27, 'customer_return', 'CR-1') is distinct from 27.00
     or public.warehouse_ops_scrap_loss(1.00, 27, 'customer_return', null) is distinct from 0
     or public.warehouse_ops_scrap_loss(1.00, 27, 'customer_return', '   ') is distinct from 0
     or public.warehouse_ops_scrap_loss(null, 27, 'customer_return', null) is distinct from 0
     or public.warehouse_ops_scrap_loss(null, 27, 'internal', null) is not null
     or public.warehouse_ops_scrap_loss(null, 27, 'customer_return', 'CR-1') is not null
     or public.warehouse_ops_scrap_loss(0.335, 3, null, null) is distinct from 1.01 then
    raise exception '263: warehouse_ops_scrap_loss no hace la cuenta acordada';
  end if;
  if position('falta el CRMA' in def) > 0 then
    raise exception '263: warehouse_ops_file_report sigue exigiendo el CRMA';
  end if;
  if position('warehouse_ops_scrap_loss(prod.cost, v_dan, v_origen, v_crma)' in def) = 0
     or position('origen de la merma no valido' in def) = 0 or position('''internal'')' in def) = 0
     or position('damaged_pieces' in def) = 0 or position('free_name' in def) = 0 or position('hr_history' in def) = 0 then
    raise exception '263: warehouse_ops_file_report perdio algo de la 252 / 254 / 259 o no usa la cuenta nueva';
  end if;
  if position('warehouse_ops_scrap_loss' in def2) = 0 or position('* total_pieces' in def2) > 0
     or position('warehouse_ops_scrap_loss' in def3) = 0 or position('solo el gerente de la tienda' in def3) = 0 then
    raise exception '263: las correcciones no recalculan con la cuenta nueva';
  end if;
  if exists (select 1 from public.warehouse_reports where kind = 'scrap' and total_pieces is not null
               and total_loss is distinct from public.warehouse_ops_scrap_loss(unit_cost, coalesce(damaged_pieces, case when scrap_type = 'sample' then 0 else total_pieces end), return_type, crma)) then
    raise exception '263: quedan mermas con la perdida de antes';
  end if;
  if exists (select 1 from public.warehouse_reports where kind = 'scrap' and return_type = 'customer_return'
               and nullif(btrim(coalesce(crma, '')), '') is null and total_loss is distinct from 0) then
    raise exception '263: quedan devoluciones de cliente sin CRMA que cuentan como perdida';
  end if;
  if has_function_privilege('anon', 'public.warehouse_ops_file_report(text, text, uuid[], jsonb, text[], jsonb)', 'execute')
     or has_function_privilege('anon', 'public.warehouse_ops_edit_scrap_product(uuid, bigint, text, numeric)', 'execute')
     or has_function_privilege('anon', 'public.warehouse_ops_edit_scrap_origin(uuid, text, text)', 'execute')
     or has_function_privilege('anon', 'public.warehouse_ops_scrap_loss(numeric, integer, text, text)', 'execute') then
    raise exception '263: anon ejecuta funciones de Warehouse Ops';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'warehouse_reports' and cmd <> 'SELECT') then
    raise exception '263: warehouse_reports no debe tener politicas de escritura';
  end if;
end $chk$;
-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('263_merma_crma_opcional.sql', 'f9c54f41813ed380d32f9eeb716a0c9d41acea153276969ab115a742a8a8cd92') on conflict (name) do nothing;
