-- 254: Merma: reparto danadas / muestra y CRMA obligatorio en devoluciones (Warehouse Ops, D-883) (2026-11-05).
--
-- Roberto (admin), dos pedidos sobre el formulario de merma:
--   1. «Primero el total de piezas; luego cuantas de esas estan danadas y cuantas sirven de muestra.» Antes era una
--      sola opcion (danado O muestra) para todas las piezas. Ahora warehouse_reports guarda las dos cuentas:
--      damaged_pieces + sample_pieces = total_pieces. scrap_type queda como resumen: damaged, sample o mixed.
--      Las filas de antes se rellenan con lo que ya decian (todo danado o todo muestra); nada mas cambia en ellas.
--      La perdida NO cambia de regla: sigue siendo costo x total de piezas (un reporte «muestra» ya contaba entero).
--   2. «El CRMA no es opcional, pero solo se pregunta si la merma viene de una devolucion de cliente.»
--      warehouse_ops_file_report lo exige con return_type = customer_return y lo descarta con internal. No va como
--      check de la tabla: hay devoluciones de antes sin CRMA (era opcional).
--   warehouse_ops_file_report es la de la 252 con esos dos cambios; sigue aceptando la pantalla vieja (solo
--   scrap_type) mientras se despliega la nueva.
--
-- Sin begin/commit propios. Para deshacer: volver a crear la funcion de la 252, pasar las filas 'mixed' a 'damaged',
-- drop constraint warehouse_reports_split_shape, volver el check de scrap_type a ('damaged', 'sample'), drop de las
-- dos columnas y delete from public.schema_migrations where name = '254_merma_reparto_y_crma.sql'.

-- 1. Columnas y forma
alter table public.warehouse_reports
  add column if not exists damaged_pieces integer,
  add column if not exists sample_pieces integer;

alter table public.warehouse_reports drop constraint if exists warehouse_reports_scrap_type_check;
alter table public.warehouse_reports add constraint warehouse_reports_scrap_type_check
  check (scrap_type in ('damaged', 'sample', 'mixed'));

update public.warehouse_reports
   set damaged_pieces = case when scrap_type = 'sample' then 0 else total_pieces end,
       sample_pieces  = case when scrap_type = 'sample' then total_pieces else 0 end
 where kind = 'scrap' and damaged_pieces is null and sample_pieces is null and total_pieces is not null;

alter table public.warehouse_reports drop constraint if exists warehouse_reports_split_shape;
alter table public.warehouse_reports add constraint warehouse_reports_split_shape check (
  (damaged_pieces is null and sample_pieces is null)
  or (kind = 'scrap' and damaged_pieces >= 0 and sample_pieces >= 0 and damaged_pieces + sample_pieces = total_pieces
      and scrap_type = case when sample_pieces = 0 then 'damaged' when damaged_pieces = 0 then 'sample' else 'mixed' end)
);

-- 2. Registrar un reporte (la de la 252 + el reparto y el CRMA obligatorio en devoluciones)
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
    -- 254: el CRMA es obligatorio si es devolucion de cliente, y no se guarda si es interno.
    v_origen := p_scrap->>'return_type';
    if v_origen is null or v_origen not in ('internal', 'customer_return') then
      raise exception 'warehouse_ops: falta de donde viene la merma';
    end if;
    v_crma := nullif(left(btrim(coalesce(p_scrap->>'crma', '')), 100), '');
    if v_origen = 'customer_return' and v_crma is null then
      raise exception 'warehouse_ops: falta el CRMA de la devolucion';
    end if;
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
        -- La perdida sigue siendo costo x TODAS las piezas (danadas + muestra), como en la 247.
        prod.cost, case when prod.cost is null then null else round(prod.cost * v_total, 2) end,
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


revoke all on function public.warehouse_ops_file_report(text, text, uuid[], jsonb, text[], jsonb) from public, anon;
grant execute on function public.warehouse_ops_file_report(text, text, uuid[], jsonb, text[], jsonb) to authenticated;

do $chk$
declare
  def text := pg_get_functiondef('public.warehouse_ops_file_report(text, text, uuid[], jsonb, text[], jsonb)'::regprocedure);
begin
  if position('damaged_pieces' in def) = 0 or position('falta el CRMA' in def) = 0 then
    raise exception '254: warehouse_ops_file_report no trae el reparto o el CRMA obligatorio';
  end if;
  if position('free_name' in def) = 0 then
    raise exception '254: warehouse_ops_file_report perdio el fuera de catalogo de la 252';
  end if;
  if exists (select 1 from pg_constraint c where c.conrelid = 'public.warehouse_reports'::regclass and c.contype = 'c'
               and pg_get_constraintdef(c.oid) like '%scrap_type%' and pg_get_constraintdef(c.oid) like '%ANY%'
               and pg_get_constraintdef(c.oid) not like '%mixed%') then
    raise exception '254: queda un check de scrap_type que no acepta mixed';
  end if;
  if exists (select 1 from public.warehouse_reports where kind = 'scrap' and (damaged_pieces is null or sample_pieces is null)) then
    raise exception '254: quedan mermas sin reparto';
  end if;
  if has_function_privilege('anon', 'public.warehouse_ops_file_report(text, text, uuid[], jsonb, text[], jsonb)', 'execute') then
    raise exception '254: anon registra reportes';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'warehouse_reports' and cmd <> 'SELECT') then
    raise exception '254: warehouse_reports no debe tener politicas de escritura';
  end if;
end $chk$;
-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('254_merma_reparto_y_crma.sql', 'f6e1e02b25d070abfb77b1a2a035f446948180feddbaaee133961e3f48ad93bc') on conflict (name) do nothing;
