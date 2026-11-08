-- 274: Conteos de inventario: alcance, cinco pasos, lineas contadas, firma y ajuste (Warehouse Ops) (2026-11-08).
--
-- El dueño y Roberto (gerente de almacen), 2026-11-08: fase 1 de los KPI de almacen. Roberto: «Choose supplier and
-- size, or supplier and note, or product. Steps: 1) organize, 2) review pending orders, 3) count and record,
-- 4) review and sign off, 5) adjust and screenshot». Hasta hoy el conteo se hacia en papel y nadie sabia cuanto
-- cuadraba con el sistema ni cuanto tardaba.
--
-- Que hace:
--   1. Tablas (RLS de lectura para quien tiene Warehouse Ops EN ESA TIENDA, sin politicas de escritura):
--        public.warehouse_counts       un conteo: tienda, alcance (vendor_size / vendor_note / product + proveedor,
--                                      medida, nota, producto), titulo (automatico: «Daltile · 24x48»), etapa
--                                      (organizing / reviewing_orders / counting / review / adjusted / cancelled),
--                                      instrucciones del paso 1, y por etapa quien y cuando (como la 270):
--                                      organized_*, orders_reviewed_* (+ orders_note), counting_done_*,
--                                      signed_* (+ signed_sheet), adjusted_* (+ adjustment_shots), cancelled_*.
--        public.warehouse_count_lines  las lineas: producto (nulo si se borro del catalogo), sku, nombre, medida,
--                                      system_qty (foto del qoh de la tienda AL CREAR el conteo), price (idem),
--                                      pieces_per_box, lo contado (cajas, sueltas, total), quien y cuando, nota,
--                                      foto, y recount_requested (el gerente la mando a recontar).
--   2. RPC (security definer, mismas puertas que la 273: warehouse_ops_in_store = personal de la tienda,
--      warehouse_ops_can_manage = gerente / supervisor full, store_admin en las suyas, admin):
--        warehouse_ops_count_vendors(tienda)         personal: los proveedores del catalogo con sus medidas y cuantos
--                                                    productos (para elegir el alcance).
--        warehouse_ops_count_products(...)           personal: los productos de un alcance con el qoh de la tienda y el
--                                                    precio (la vista previa antes de crear; lo mismo que se congela).
--        warehouse_ops_create_count(...)             gestor: crea el conteo y congela las lineas (system_qty, price).
--        warehouse_ops_count_advance(id, etapa, nota) personal: organizing -> reviewing_orders -> counting -> review,
--                                                    un paso a la vez; a review solo con todas las lineas contadas.
--        warehouse_ops_count_line(...)               personal: registra una linea (cajas + sueltas = total, o solo total),
--                                                    nota y foto; solo en etapa counting.
--        warehouse_ops_count_recount(linea, nota)    gestor: manda una linea a recontar (borra lo contado); el conteo
--                                                    vuelve a counting.
--        warehouse_ops_count_sign(id, hoja)          gestor: firma (nombre + fecha; hoja firmada opcional) en review.
--        warehouse_ops_count_adjust(id, capturas)    gestor: sube las capturas del ajuste en el ERP -> adjusted. Pide firma.
--        warehouse_ops_count_cancel(id, nota)        gestor: cancela (no desde adjusted).
--   3. El cubo 'warehouse-ops' deja ver la hoja firmada, las capturas y las fotos de linea a quien ve la fila.
--
-- El qoh del sistema: erp.store_products.qoh de la tienda (erp.stores.id o .name = la tienda de Warehouse Ops); si la
-- tienda no esta en el ERP, la linea queda con system_qty nulo y la pantalla lo dice.
--
-- ORDEN: aplicar ANTES de desplegar la pantalla; sin esta migracion la seccion «Conteos» dice que falta la 274.
-- Depende de la 273 (warehouse_ops_in_store, warehouse_ops_caller_name), la 265 (warehouse_ops_can_manage) y la 247 (cubo).
--
-- Sin begin/commit propios. Para deshacer:
--   drop function if exists public.warehouse_ops_count_cancel(uuid, text);
--   drop function if exists public.warehouse_ops_count_adjust(uuid, text[]);
--   drop function if exists public.warehouse_ops_count_sign(uuid, text);
--   drop function if exists public.warehouse_ops_count_recount(uuid, text);
--   drop function if exists public.warehouse_ops_count_line(uuid, int, int, int, text, text);
--   drop function if exists public.warehouse_ops_count_advance(uuid, text, text);
--   drop function if exists public.warehouse_ops_create_count(text, text, text, text, text, bigint, text);
--   drop function if exists public.warehouse_ops_count_products(text, text, text, text, text, bigint);
--   drop function if exists public.warehouse_ops_count_vendors(text);
--   drop table if exists public.warehouse_count_lines; drop table if exists public.warehouse_counts;
--   volver a crear la politica "warehouse ops bucket read" como en la 273;
--   delete from public.schema_migrations where name = '274_conteos_de_inventario.sql';

-- ---------------------------------------------------------------------------
-- 1. Las tablas
-- ---------------------------------------------------------------------------
create table if not exists public.warehouse_counts (
  id uuid primary key default gen_random_uuid(),
  store text not null,
  scope_kind text not null check (scope_kind in ('vendor_size', 'vendor_note', 'product')),
  vendor_name text,
  size_in text,
  note text,
  product_id bigint,
  title text not null check (btrim(title) <> ''),
  stage text not null default 'organizing' check (stage in ('organizing', 'reviewing_orders', 'counting', 'review', 'adjusted', 'cancelled')),
  instructions text,
  comments text,
  created_by uuid references auth.users(id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now(),
  organized_at timestamptz, organized_by uuid references auth.users(id) on delete set null,
  orders_reviewed_at timestamptz, orders_reviewed_by uuid references auth.users(id) on delete set null, orders_note text,
  counting_done_at timestamptz, counting_done_by uuid references auth.users(id) on delete set null,
  signed_at timestamptz, signed_by uuid references auth.users(id) on delete set null, signed_by_name text, signed_sheet text,
  adjusted_at timestamptz, adjusted_by uuid references auth.users(id) on delete set null, adjustment_shots text[] not null default '{}',
  cancelled_at timestamptz, cancelled_by uuid references auth.users(id) on delete set null, cancel_note text,
  check (scope_kind <> 'vendor_size' or (vendor_name is not null and size_in is not null)),
  check (scope_kind <> 'vendor_note' or (vendor_name is not null and note is not null)),
  check (scope_kind <> 'product' or product_id is not null)
);
create index if not exists warehouse_counts_store_stage on public.warehouse_counts (store, stage, created_at desc);

create table if not exists public.warehouse_count_lines (
  id uuid primary key default gen_random_uuid(),
  count_id uuid not null references public.warehouse_counts(id) on delete cascade,
  product_id bigint,
  sku text not null,
  name text not null,
  size_in text,
  system_qty numeric(12,2),
  price numeric(12,2),
  pieces_per_box integer,
  counted_boxes integer check (counted_boxes is null or counted_boxes >= 0),
  counted_pieces integer check (counted_pieces is null or counted_pieces >= 0),
  counted_total numeric(12,2) check (counted_total is null or counted_total >= 0),
  counted_by uuid references auth.users(id) on delete set null,
  counted_by_name text,
  counted_at timestamptz,
  note text,
  photo text,
  recount_requested boolean not null default false,
  recount_note text,
  position integer not null default 0
);
create index if not exists warehouse_count_lines_count on public.warehouse_count_lines (count_id, position);

alter table public.warehouse_counts enable row level security;
alter table public.warehouse_count_lines enable row level security;
drop policy if exists warehouse_counts_read on public.warehouse_counts;
create policy warehouse_counts_read on public.warehouse_counts for select to authenticated using (public.warehouse_ops_in_store(store));
drop policy if exists warehouse_count_lines_read on public.warehouse_count_lines;
create policy warehouse_count_lines_read on public.warehouse_count_lines for select to authenticated
  using (exists (select 1 from public.warehouse_counts c where c.id = count_id and public.warehouse_ops_in_store(c.store)));
revoke all on public.warehouse_counts, public.warehouse_count_lines from anon;
grant select on public.warehouse_counts, public.warehouse_count_lines to authenticated;
grant all on public.warehouse_counts, public.warehouse_count_lines to service_role;

-- ---------------------------------------------------------------------------
-- 2. El catalogo: proveedores, medidas y productos de un alcance, con el qoh de la tienda
-- ---------------------------------------------------------------------------
-- El id de la tienda en el ERP (erp.stores.id o nombre = la tienda de Warehouse Ops). Nulo si no esta.
create or replace function public.warehouse_ops_erp_store_id(r_store text)
  returns text language sql stable security definer set search_path = public, erp as $$
  select s.id from erp.stores s where s.id = r_store or lower(s.name) = lower(btrim(r_store)) order by (s.id = r_store) desc limit 1;
$$;
revoke all on function public.warehouse_ops_erp_store_id(text) from public, anon, authenticated;

create or replace function public.warehouse_ops_count_vendors(p_store text)
  returns table (vendor_name text, sizes text[], products integer)
  language plpgsql stable security definer set search_path = public, erp as $$
begin
  if not public.warehouse_ops_in_store(p_store) then raise exception 'warehouse_ops: sin acceso a esa tienda' using errcode = '42501'; end if;
  return query
    select v.name as vendor_name,
           coalesce(array_agg(distinct p.size_in order by p.size_in) filter (where p.size_in is not null and btrim(p.size_in) <> ''), '{}') as sizes,
           count(*)::int as products
    from erp.products p join erp.vendors v on v.id = p.vendor_id
    where p.record_status <> 'archived'
    group by v.name order by v.name;
end $$;
revoke all on function public.warehouse_ops_count_vendors(text) from public, anon;
grant execute on function public.warehouse_ops_count_vendors(text) to authenticated;

create or replace function public.warehouse_ops_count_products(p_store text, p_scope_kind text, p_vendor text, p_size text, p_note text, p_product_id bigint)
  returns table (id bigint, sku text, name text, vendor_name text, size_in text, price numeric, pieces_per_box integer, qoh numeric)
  language plpgsql stable security definer set search_path = public, erp as $$
declare tienda text := public.warehouse_ops_erp_store_id(p_store); patron text;
begin
  if not public.warehouse_ops_in_store(p_store) then raise exception 'warehouse_ops: sin acceso a esa tienda' using errcode = '42501'; end if;
  if p_scope_kind not in ('vendor_size', 'vendor_note', 'product') then raise exception 'warehouse_ops: alcance no valido' using errcode = '22023'; end if;
  if p_scope_kind = 'product' then
    if p_product_id is null then raise exception 'warehouse_ops: falta el producto' using errcode = '22023'; end if;
  elsif p_vendor is null or btrim(p_vendor) = '' then
    raise exception 'warehouse_ops: falta el proveedor' using errcode = '22023';
  elsif p_scope_kind = 'vendor_size' and (p_size is null or btrim(p_size) = '') then
    raise exception 'warehouse_ops: falta la medida' using errcode = '22023';
  elsif p_scope_kind = 'vendor_note' and length(btrim(coalesce(p_note, ''))) < 2 then
    raise exception 'warehouse_ops: la nota necesita al menos 2 letras' using errcode = '22023';
  end if;
  patron := '%' || replace(replace(replace(btrim(coalesce(p_note, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return query
    select p.id, p.sku, p.name, v.name as vendor_name, p.size_in, p.price, p.pieces_per_box, sp.qoh
    from erp.products p
      left join erp.vendors v on v.id = p.vendor_id
      left join erp.store_products sp on sp.product_id = p.id and sp.store_id = tienda
    where p.record_status <> 'archived'
      and case p_scope_kind
            when 'product' then p.id = p_product_id
            when 'vendor_size' then v.name = btrim(p_vendor) and p.size_in = btrim(p_size)
            else v.name = btrim(p_vendor)
                 and (p.name ilike patron or p.sku ilike patron or coalesce(p.collection, '') ilike patron
                      or coalesce(p.tags, '') ilike patron or coalesce(p.color1, '') ilike patron or coalesce(p.style, '') ilike patron)
          end
    order by p.name, p.sku
    limit 500;
end $$;
revoke all on function public.warehouse_ops_count_products(text, text, text, text, text, bigint) from public, anon;
grant execute on function public.warehouse_ops_count_products(text, text, text, text, text, bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Las RPC del conteo
-- ---------------------------------------------------------------------------
-- 3a. Crear el conteo y congelar las lineas (gestor)
create or replace function public.warehouse_ops_create_count(p_store text, p_scope_kind text, p_vendor text, p_size text, p_note text, p_product_id bigint, p_instructions text)
  returns uuid language plpgsql volatile security definer set search_path = public, erp as $$
declare yo uuid := auth.uid(); nuevo uuid; titulo text; n int;
begin
  if yo is null then raise exception 'warehouse_ops: sin sesion' using errcode = '42501'; end if;
  if p_store is null or btrim(p_store) = '' then raise exception 'warehouse_ops: falta la tienda' using errcode = '22023'; end if;
  if not public.warehouse_ops_can_manage(p_store) then
    raise exception 'warehouse_ops: solo el gerente de la tienda abre un conteo' using errcode = '42501';
  end if;
  -- El titulo automatico: «Proveedor · medida», «Proveedor · nota» o «SKU · nombre».
  if p_scope_kind = 'product' then
    select p.sku || ' · ' || p.name into titulo from erp.products p where p.id = p_product_id;
    if titulo is null then raise exception 'warehouse_ops: producto desconocido'; end if;
  elsif p_scope_kind = 'vendor_size' then titulo := btrim(p_vendor) || ' · ' || btrim(p_size);
  elsif p_scope_kind = 'vendor_note' then titulo := btrim(p_vendor) || ' · ' || btrim(p_note);
  else raise exception 'warehouse_ops: alcance no valido' using errcode = '22023';
  end if;
  insert into public.warehouse_counts (store, scope_kind, vendor_name, size_in, note, product_id, title, instructions, created_by, created_by_name)
  values (btrim(p_store), p_scope_kind, nullif(btrim(p_vendor), ''), nullif(btrim(p_size), ''), nullif(btrim(p_note), ''),
          case when p_scope_kind = 'product' then p_product_id end, titulo, nullif(btrim(p_instructions), ''), yo, public.warehouse_ops_caller_name())
  returning id into nuevo;
  -- Las lineas: la foto del catalogo HOY (system_qty y price no cambian aunque el ERP cambie).
  insert into public.warehouse_count_lines (count_id, product_id, sku, name, size_in, system_qty, price, pieces_per_box, position)
  select nuevo, q.id, q.sku, q.name, q.size_in, q.qoh, q.price, q.pieces_per_box, row_number() over (order by q.name, q.sku)
  from public.warehouse_ops_count_products(btrim(p_store), p_scope_kind, p_vendor, p_size, p_note, p_product_id) q;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'warehouse_ops: ese alcance no tiene productos' using errcode = '22023'; end if;
  return nuevo;
end $$;
revoke all on function public.warehouse_ops_create_count(text, text, text, text, text, bigint, text) from public, anon;
grant execute on function public.warehouse_ops_create_count(text, text, text, text, text, bigint, text) to authenticated;

-- 3b. Avanzar un paso (personal de la tienda): organizing -> reviewing_orders -> counting -> review
create or replace function public.warehouse_ops_count_advance(p_count uuid, p_stage text, p_note text)
  returns void language plpgsql volatile security definer set search_path = public as $$
declare yo uuid := auth.uid(); c record; faltan int;
begin
  if yo is null then raise exception 'warehouse_ops: sin sesion' using errcode = '42501'; end if;
  select * into c from public.warehouse_counts where id = p_count for update;
  if c.id is null then raise exception 'warehouse_ops: conteo desconocido'; end if;
  if not public.warehouse_ops_in_store(c.store) then raise exception 'warehouse_ops: sin acceso a esa tienda' using errcode = '42501'; end if;
  if c.stage = 'organizing' and p_stage = 'reviewing_orders' then
    update public.warehouse_counts set stage = 'reviewing_orders', organized_at = now(), organized_by = yo where id = p_count;
  elsif c.stage = 'reviewing_orders' and p_stage = 'counting' then
    update public.warehouse_counts set stage = 'counting', orders_reviewed_at = now(), orders_reviewed_by = yo, orders_note = nullif(btrim(p_note), '') where id = p_count;
  elsif c.stage = 'counting' and p_stage = 'review' then
    select count(*) into faltan from public.warehouse_count_lines l where l.count_id = p_count and l.counted_at is null;
    if faltan > 0 then raise exception 'warehouse_ops: faltan % lineas por contar', faltan using errcode = '22023'; end if;
    update public.warehouse_counts set stage = 'review', counting_done_at = now(), counting_done_by = yo where id = p_count;
  else
    raise exception 'warehouse_ops: de % no se pasa a %', c.stage, p_stage using errcode = '22023';
  end if;
end $$;
revoke all on function public.warehouse_ops_count_advance(uuid, text, text) from public, anon;
grant execute on function public.warehouse_ops_count_advance(uuid, text, text) to authenticated;

-- 3c. Registrar una linea (personal): cajas + sueltas (si hay piezas por caja) o el total directo
create or replace function public.warehouse_ops_count_line(p_line uuid, p_boxes int, p_pieces int, p_total int, p_note text, p_photo text)
  returns void language plpgsql volatile security definer set search_path = public as $$
declare yo uuid := auth.uid(); l record; c record; total numeric;
begin
  if yo is null then raise exception 'warehouse_ops: sin sesion' using errcode = '42501'; end if;
  select * into l from public.warehouse_count_lines where id = p_line for update;
  if l.id is null then raise exception 'warehouse_ops: linea desconocida'; end if;
  select * into c from public.warehouse_counts where id = l.count_id;
  if not public.warehouse_ops_in_store(c.store) then raise exception 'warehouse_ops: sin acceso a esa tienda' using errcode = '42501'; end if;
  if c.stage <> 'counting' then raise exception 'warehouse_ops: el conteo no esta en la etapa de contar' using errcode = '22023'; end if;
  if p_photo is not null and split_part(p_photo, '/', 1) <> yo::text then raise exception 'warehouse_ops: foto no valida' using errcode = '22023'; end if;
  if p_boxes is not null or p_pieces is not null then
    if l.pieces_per_box is null or l.pieces_per_box <= 0 then raise exception 'warehouse_ops: ese producto no tiene piezas por caja; captura el total' using errcode = '22023'; end if;
    if coalesce(p_boxes, 0) < 0 or coalesce(p_pieces, 0) < 0 then raise exception 'warehouse_ops: cantidad negativa' using errcode = '22023'; end if;
    total := coalesce(p_boxes, 0) * l.pieces_per_box + coalesce(p_pieces, 0);
  elsif p_total is not null then
    if p_total < 0 then raise exception 'warehouse_ops: cantidad negativa' using errcode = '22023'; end if;
    total := p_total;
  else
    raise exception 'warehouse_ops: falta lo contado' using errcode = '22023';
  end if;
  update public.warehouse_count_lines set
    counted_boxes = p_boxes, counted_pieces = p_pieces, counted_total = total, counted_by = yo, counted_by_name = public.warehouse_ops_caller_name(),
    counted_at = now(), note = nullif(btrim(p_note), ''), photo = p_photo, recount_requested = false
  where id = p_line;
end $$;
revoke all on function public.warehouse_ops_count_line(uuid, int, int, int, text, text) from public, anon;
grant execute on function public.warehouse_ops_count_line(uuid, int, int, int, text, text) to authenticated;

-- 3d. Mandar una linea a recontar (gestor): se borra lo contado y el conteo vuelve a counting
create or replace function public.warehouse_ops_count_recount(p_line uuid, p_note text)
  returns void language plpgsql volatile security definer set search_path = public as $$
declare yo uuid := auth.uid(); l record; c record;
begin
  if yo is null then raise exception 'warehouse_ops: sin sesion' using errcode = '42501'; end if;
  select * into l from public.warehouse_count_lines where id = p_line for update;
  if l.id is null then raise exception 'warehouse_ops: linea desconocida'; end if;
  select * into c from public.warehouse_counts where id = l.count_id for update;
  if not public.warehouse_ops_can_manage(c.store) then raise exception 'warehouse_ops: solo el gerente manda a recontar' using errcode = '42501'; end if;
  if c.stage not in ('counting', 'review') then raise exception 'warehouse_ops: el conteo ya esta firmado o cerrado' using errcode = '22023'; end if;
  update public.warehouse_count_lines set counted_boxes = null, counted_pieces = null, counted_total = null, counted_by = null, counted_by_name = null,
    counted_at = null, recount_requested = true, recount_note = nullif(btrim(p_note), '') where id = p_line;
  update public.warehouse_counts set stage = 'counting', counting_done_at = null, counting_done_by = null, signed_at = null, signed_by = null, signed_by_name = null, signed_sheet = null
  where id = c.id;
end $$;
revoke all on function public.warehouse_ops_count_recount(uuid, text) from public, anon;
grant execute on function public.warehouse_ops_count_recount(uuid, text) to authenticated;

-- 3e. Firmar (gestor, en review): nombre + fecha; la hoja firmada es opcional
create or replace function public.warehouse_ops_count_sign(p_count uuid, p_sheet text)
  returns void language plpgsql volatile security definer set search_path = public as $$
declare yo uuid := auth.uid(); c record;
begin
  if yo is null then raise exception 'warehouse_ops: sin sesion' using errcode = '42501'; end if;
  select * into c from public.warehouse_counts where id = p_count for update;
  if c.id is null then raise exception 'warehouse_ops: conteo desconocido'; end if;
  if not public.warehouse_ops_can_manage(c.store) then raise exception 'warehouse_ops: solo el gerente firma el conteo' using errcode = '42501'; end if;
  if c.stage <> 'review' then raise exception 'warehouse_ops: el conteo no esta en revision' using errcode = '22023'; end if;
  if p_sheet is not null and split_part(p_sheet, '/', 1) <> yo::text then raise exception 'warehouse_ops: hoja no valida' using errcode = '22023'; end if;
  update public.warehouse_counts set signed_at = now(), signed_by = yo, signed_by_name = public.warehouse_ops_caller_name(), signed_sheet = p_sheet where id = p_count;
end $$;
revoke all on function public.warehouse_ops_count_sign(uuid, text) from public, anon;
grant execute on function public.warehouse_ops_count_sign(uuid, text) to authenticated;

-- 3f. Ajustar (gestor): las capturas del ERP; pide la firma
create or replace function public.warehouse_ops_count_adjust(p_count uuid, p_shots text[])
  returns void language plpgsql volatile security definer set search_path = public as $$
declare yo uuid := auth.uid(); c record; f text;
begin
  if yo is null then raise exception 'warehouse_ops: sin sesion' using errcode = '42501'; end if;
  select * into c from public.warehouse_counts where id = p_count for update;
  if c.id is null then raise exception 'warehouse_ops: conteo desconocido'; end if;
  if not public.warehouse_ops_can_manage(c.store) then raise exception 'warehouse_ops: solo el gerente ajusta el conteo' using errcode = '42501'; end if;
  if c.stage <> 'review' then raise exception 'warehouse_ops: el conteo no esta en revision' using errcode = '22023'; end if;
  if c.signed_at is null then raise exception 'warehouse_ops: primero hay que firmar el conteo' using errcode = '22023'; end if;
  if p_shots is null or cardinality(p_shots) = 0 then raise exception 'warehouse_ops: falta la captura del ajuste' using errcode = '22023'; end if;
  foreach f in array p_shots loop
    if split_part(f, '/', 1) <> yo::text then raise exception 'warehouse_ops: captura no valida' using errcode = '22023'; end if;
  end loop;
  update public.warehouse_counts set stage = 'adjusted', adjusted_at = now(), adjusted_by = yo, adjustment_shots = p_shots where id = p_count;
end $$;
revoke all on function public.warehouse_ops_count_adjust(uuid, text[]) from public, anon;
grant execute on function public.warehouse_ops_count_adjust(uuid, text[]) to authenticated;

-- 3g. Cancelar (gestor): nunca uno ya ajustado
create or replace function public.warehouse_ops_count_cancel(p_count uuid, p_note text)
  returns void language plpgsql volatile security definer set search_path = public as $$
declare yo uuid := auth.uid(); c record;
begin
  if yo is null then raise exception 'warehouse_ops: sin sesion' using errcode = '42501'; end if;
  select * into c from public.warehouse_counts where id = p_count for update;
  if c.id is null then raise exception 'warehouse_ops: conteo desconocido'; end if;
  if not public.warehouse_ops_can_manage(c.store) then raise exception 'warehouse_ops: solo el gerente cancela el conteo' using errcode = '42501'; end if;
  if c.stage in ('adjusted', 'cancelled') then raise exception 'warehouse_ops: el conteo ya esta cerrado' using errcode = '22023'; end if;
  update public.warehouse_counts set stage = 'cancelled', cancelled_at = now(), cancelled_by = yo, cancel_note = nullif(btrim(p_note), '') where id = p_count;
end $$;
revoke all on function public.warehouse_ops_count_cancel(uuid, text) from public, anon;
grant execute on function public.warehouse_ops_count_cancel(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. El cubo: la hoja firmada, las capturas y las fotos de linea se ven como las demas
-- ---------------------------------------------------------------------------
drop policy if exists "warehouse ops bucket read" on storage.objects;
create policy "warehouse ops bucket read" on storage.objects for select to authenticated
  using (bucket_id = 'warehouse-ops' and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or exists (select 1 from public.warehouse_reports r where name = any(r.photos) or name = r.approval_sheet or name = r.adjustment_proof)
    or exists (select 1 from public.warehouse_equipment e where name = any(e.photos))
    or exists (select 1 from public.warehouse_checklists c where name = any(c.photos))
    or exists (select 1 from public.warehouse_counts k where name = k.signed_sheet or name = any(k.adjustment_shots))
    or exists (select 1 from public.warehouse_count_lines l where name = l.photo)
  ));

-- ===========================================================================
-- Autocomprobacion
-- ===========================================================================
do $chk$
declare f text; tbl text;
begin
  foreach tbl in array array['warehouse_counts', 'warehouse_count_lines'] loop
    if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = tbl and rowsecurity) then
      raise exception '274: % no existe o no tiene RLS', tbl;
    end if;
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = tbl and cmd <> 'SELECT') then
      raise exception '274: % no debe tener politicas de escritura', tbl;
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = tbl and cmd = 'SELECT' and qual like '%warehouse_ops_in_store%') then
      raise exception '274: la lectura de % no pasa por warehouse_ops_in_store', tbl;
    end if;
  end loop;
  foreach f in array array[
    'public.warehouse_ops_count_vendors(text)',
    'public.warehouse_ops_count_products(text, text, text, text, text, bigint)',
    'public.warehouse_ops_create_count(text, text, text, text, text, bigint, text)',
    'public.warehouse_ops_count_advance(uuid, text, text)',
    'public.warehouse_ops_count_line(uuid, int, int, int, text, text)',
    'public.warehouse_ops_count_recount(uuid, text)',
    'public.warehouse_ops_count_sign(uuid, text)',
    'public.warehouse_ops_count_adjust(uuid, text[])',
    'public.warehouse_ops_count_cancel(uuid, text)',
    'public.warehouse_ops_erp_store_id(text)'] loop
    if has_function_privilege('anon', f, 'execute') then raise exception '274: anon ejecuta %', f; end if;
  end loop;
  if has_function_privilege('authenticated', 'public.warehouse_ops_erp_store_id(text)', 'execute') then raise exception '274: erp_store_id no es para la app'; end if;
  f := pg_get_functiondef('public.warehouse_ops_create_count(text, text, text, text, text, bigint, text)'::regprocedure);
  if position('warehouse_ops_can_manage(p_store)' in f) = 0 or position('warehouse_ops_count_products' in f) = 0 then raise exception '274: create_count no pasa por can_manage o no congela las lineas'; end if;
  f := pg_get_functiondef('public.warehouse_ops_count_advance(uuid, text, text)'::regprocedure);
  if position('warehouse_ops_in_store(c.store)' in f) = 0 or position('faltan % lineas por contar' in f) = 0 then raise exception '274: count_advance no usa las puertas'; end if;
  f := pg_get_functiondef('public.warehouse_ops_count_line(uuid, int, int, int, text, text)'::regprocedure);
  if position('warehouse_ops_in_store(c.store)' in f) = 0 or position('''counting''' in f) = 0 then raise exception '274: count_line no usa las puertas'; end if;
  foreach f in array array['public.warehouse_ops_count_recount(uuid, text)', 'public.warehouse_ops_count_sign(uuid, text)', 'public.warehouse_ops_count_adjust(uuid, text[])', 'public.warehouse_ops_count_cancel(uuid, text)'] loop
    if position('warehouse_ops_can_manage(c.store)' in pg_get_functiondef(f::regprocedure)) = 0 then raise exception '274: % no pasa por can_manage', f; end if;
  end loop;
  f := pg_get_functiondef('public.warehouse_ops_count_adjust(uuid, text[])'::regprocedure);
  if position('primero hay que firmar' in f) = 0 then raise exception '274: count_adjust no pide la firma'; end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'warehouse ops bucket read' and qual like '%warehouse_counts%' and qual like '%warehouse_count_lines%') then
    raise exception '274: la lectura del cubo no deja ver la hoja, las capturas ni las fotos de linea';
  end if;
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('274_conteos_de_inventario.sql', '3a994f3361ecdae3dfebab380ddd118af1313fc69c0404931defffd1bed6324c') on conflict (name) do nothing;
