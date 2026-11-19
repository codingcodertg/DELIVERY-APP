-- 333: Conteos de inventario, revision (2026-11-19). El dueño y Roberto (gerente de almacen), revisando la pantalla:
--   «Whenever we're doing counts… we're just focused on inputting»; «Let's say I counted 100 boxes, but I have to review
--   if any of those are already sold… 20 are sold, so really I have 80… they need to keep a record… invoice number,
--   product, and sold»; «It never asks me to input the system information… The system should say counted 100, pending
--   20, actual 80 versus the system that says 105… why are we missing 25 boxes?».
--   «Organize, Count, Review, Sign off, Adjust».
--   Y la base no dejaba buscar bien: «No products match» con proveedor + medida y con proveedor + nota.
--
-- Que cambia (idempotente; depende de la 274 y la 273):
--   1. Etapas nuevas y su orden: organizing (1 Organizar) → counting (2 Contar) → review (3 Revisar órdenes pendientes,
--      DESPUÉS de contar) → sign_off (4 Firmar) → adjusted (5 Ajustar). `reviewing_orders` deja de existir.
--      Conversión de los conteos que ya están en curso (no se pierde nada; cada fecha y cada nota se queda en su columna):
--        reviewing_orders → counting   (el paso viejo 2 «órdenes revisadas» ocurrió ANTES de contar; su fecha y su nota
--                                       siguen en orders_reviewed_at / orders_reviewed_by / orders_note; la revisión
--                                       nueva de órdenes pendientes se hace después de contar).
--        review, sin firma  → review   (ya contado; queda para la revisión nueva de órdenes pendientes).
--        review, firmado    → sign_off (la firma vieja queda en signed_at / signed_by / signed_sheet; falta solo ajustar).
--        counting, organizing, adjusted, cancelled → sin cambio.
--      La restricción de `stage` se cambia DESPUÉS de convertir, así que la conversión corre una sola vez y el resto de
--      la migración también puede correr de nuevo.
--   2. warehouse_counts.sign_note: la razón de la firma cuando hay diferencias (obligatoria si hay alguna).
--   3. warehouse_count_lines.system_qty_set_by / _by_name / _at: quién puso o corrigió la cantidad del SISTEMA de la
--      línea (la foto del ERP al crear el conteo no tiene quien; si la cantidad se tecleó o se corrigió, sí).
--   4. Tabla NUEVA warehouse_count_pending: las órdenes pendientes de una línea (factura, cantidad vendida y no
--      entregada, nota). La cantidad va en la MISMA unidad que lo contado (piezas; cajas + sueltas si el producto
--      tiene piezas por caja). RLS de lectura igual que las líneas; sin escritura directa.
--   5. Funciones NUEVAS: warehouse_ops_pending_add / _update / _delete (personal, etapa review);
--      warehouse_ops_count_set_system (gerente, etapa sign_off: pone o corrige el sistema de una línea; quita la firma
--      si la había); warehouse_ops_count_back (gerente, sign_off → review: para corregir órdenes pendientes).
--   6. Funciones REDEFINIDAS (la firma de sign cambia y se borra la vieja):
--        warehouse_ops_count_advance(uuid, text, text)  organizing→counting→review→sign_off, un paso a la vez.
--        warehouse_ops_count_recount(uuid, text)        vuelve a counting desde counting / review / sign_off.
--        warehouse_ops_count_sign(uuid, text, text)     (NUEVA firma: + la razón; exige sistema en todas las líneas y
--                                                       la razón si hay diferencia después de órdenes pendientes).
--        warehouse_ops_count_adjust(uuid, text[])       ajusta desde sign_off, firmado.
--        warehouse_ops_count_vendors(text)              proveedor y medidas ignorando mayúsculas, espacios y el
--                                                       espaciado de la medida («24 x 48» = «24x48», como el ERP).
--        warehouse_ops_count_products(...)              la misma comparación normalizada. ANTES comparaba el texto
--                                                       crudo del ERP contra el parámetro recortado (v.name = btrim(...),
--                                                       p.size_in = btrim(...)): cualquier espacio o mayúscula de más
--                                                       en el ERP daba CERO productos. El producto (por id) no tenía el
--                                                       problema, por eso «un producto» sí funcionaba. Además, con
--                                                       proveedor + medida la nota ahora es un filtro OPCIONAL.
--        warehouse_ops_create_count(...)                el título incluye la nota si la hay.
--   7. Nada más: la RLS de warehouse_counts y de las líneas no cambia; el cubo tampoco (las fotos de las órdenes
--      pendientes no existen).
--
-- Sin begin/commit propios. Para deshacer (no recupera los conteos convertidos; ver arriba):
--   drop table if exists public.warehouse_count_pending;
--   drop function if exists public.warehouse_ops_pending_add(uuid, text, int, int, int, text);
--   drop function if exists public.warehouse_ops_pending_update(uuid, text, int, int, int, text);
--   drop function if exists public.warehouse_ops_pending_delete(uuid);
--   drop function if exists public.warehouse_ops_count_set_system(uuid, numeric);
--   drop function if exists public.warehouse_ops_count_back(uuid, text);
--   drop function if exists public.warehouse_ops_count_sign(uuid, text, text);
--   drop function if exists public.warehouse_ops_pending_qty(uuid, int, int, int);
--   drop function if exists public.warehouse_ops_norm_nombre(text);
--   drop function if exists public.warehouse_ops_norm_medida(text);
--   delete from public.schema_migrations where name = '333_conteos_revision_y_sistema.sql';

-- ---------------------------------------------------------------------------
-- 1. Las columnas nuevas
-- ---------------------------------------------------------------------------
alter table public.warehouse_counts add column if not exists sign_note text;
alter table public.warehouse_counts drop constraint if exists warehouse_counts_sign_note_check;
alter table public.warehouse_counts add constraint warehouse_counts_sign_note_check check (sign_note is null or length(sign_note) <= 500);

alter table public.warehouse_count_lines add column if not exists system_qty_set_by uuid references auth.users(id) on delete set null;
alter table public.warehouse_count_lines add column if not exists system_qty_set_by_name text;
alter table public.warehouse_count_lines add column if not exists system_qty_set_at timestamptz;

-- ---------------------------------------------------------------------------
-- 2. La conversión de etapas (ANTES de cambiar la restricción)
-- ---------------------------------------------------------------------------
alter table public.warehouse_counts drop constraint if exists warehouse_counts_stage_check;
update public.warehouse_counts set stage = 'counting' where stage = 'reviewing_orders';
update public.warehouse_counts set stage = 'sign_off' where stage = 'review' and signed_at is not null;
alter table public.warehouse_counts add constraint warehouse_counts_stage_check
  check (stage in ('organizing', 'counting', 'review', 'sign_off', 'adjusted', 'cancelled'));
alter table public.warehouse_counts alter column stage set default 'organizing';

-- ---------------------------------------------------------------------------
-- 3. Las órdenes pendientes de una línea
-- ---------------------------------------------------------------------------
create table if not exists public.warehouse_count_pending (
  id uuid primary key default gen_random_uuid(),
  count_id uuid not null references public.warehouse_counts(id) on delete cascade,
  line_id uuid not null references public.warehouse_count_lines(id) on delete cascade,
  invoice_no text not null check (btrim(invoice_no) <> '' and length(invoice_no) <= 40),
  qty numeric(12,2) not null check (qty > 0),
  note text check (note is null or length(note) <= 300),
  entered_by uuid references auth.users(id) on delete set null,
  entered_by_name text,
  entered_at timestamptz not null default now(),
  edited_by uuid references auth.users(id) on delete set null,
  edited_by_name text,
  edited_at timestamptz
);
create index if not exists warehouse_count_pending_count on public.warehouse_count_pending (count_id, line_id);

alter table public.warehouse_count_pending enable row level security;
drop policy if exists warehouse_count_pending_read on public.warehouse_count_pending;
create policy warehouse_count_pending_read on public.warehouse_count_pending for select to authenticated
  using (exists (select 1 from public.warehouse_counts c where c.id = count_id and public.warehouse_ops_in_store(c.store)));
revoke all on public.warehouse_count_pending from anon;
grant select on public.warehouse_count_pending to authenticated;
grant all on public.warehouse_count_pending to service_role;

-- ---------------------------------------------------------------------------
-- 4. La comparación normalizada (texto del ERP contra texto de la app)
-- ---------------------------------------------------------------------------
create or replace function public.warehouse_ops_norm_nombre(t text)
  returns text language sql immutable as $$
  select lower(regexp_replace(btrim(coalesce(t, '')), '\s+', ' ', 'g'));
$$;
create or replace function public.warehouse_ops_norm_medida(t text)
  returns text language sql immutable as $$
  select lower(regexp_replace(coalesce(t, ''), '\s+', '', 'g'));
$$;
revoke all on function public.warehouse_ops_norm_nombre(text) from public, anon, authenticated;
revoke all on function public.warehouse_ops_norm_medida(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. El catalogo (proveedores y productos del alcance), con la comparación normalizada
-- ---------------------------------------------------------------------------
create or replace function public.warehouse_ops_count_vendors(p_store text)
  returns table (vendor_name text, sizes text[], products integer)
  language plpgsql stable security definer set search_path = public, erp as $$
begin
  if not public.warehouse_ops_in_store(p_store) then raise exception 'warehouse_ops: sin acceso a esa tienda' using errcode = '42501'; end if;
  return query
    with base as (
      select btrim(v.name) as nombre, public.warehouse_ops_norm_nombre(v.name) as clave_nombre,
             btrim(p.size_in) as medida, public.warehouse_ops_norm_medida(p.size_in) as clave_medida
      from erp.products p join erp.vendors v on v.id = p.vendor_id
      where p.record_status <> 'archived' and btrim(coalesce(v.name, '')) <> ''
    )
    select min(b.nombre)::text,
           coalesce((select array_agg(m.medida order by m.medida) from (
                       select min(x.medida) as medida from base x
                       where x.clave_nombre = b.clave_nombre and x.medida <> '' group by x.clave_medida) m), '{}'::text[]),
           count(*)::int
    from base b
    group by b.clave_nombre
    order by min(b.nombre);
end $$;
revoke all on function public.warehouse_ops_count_vendors(text) from public, anon;
grant execute on function public.warehouse_ops_count_vendors(text) to authenticated;

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
  elsif p_scope_kind = 'vendor_size' and (p_size is null or btrim(p_size) = '') then
    raise exception 'warehouse_ops: falta la medida' using errcode = '22023';
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
                 and public.warehouse_ops_norm_medida(p.size_in) = public.warehouse_ops_norm_medida(p_size)
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

-- ---------------------------------------------------------------------------
-- 6. Crear el conteo (el titulo incluye la nota si la hay)
-- ---------------------------------------------------------------------------
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
    titulo := btrim(p_vendor) || ' · ' || btrim(p_size) || case when btrim(coalesce(p_note, '')) <> '' then ' · ' || btrim(p_note) else '' end;
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

-- ---------------------------------------------------------------------------
-- 7. Avanzar (personal): organizing → counting → review → sign_off
-- ---------------------------------------------------------------------------
create or replace function public.warehouse_ops_count_advance(p_count uuid, p_stage text, p_note text)
  returns void language plpgsql volatile security definer set search_path = public as $$
declare yo uuid := auth.uid(); c record; faltan int;
begin
  if yo is null then raise exception 'warehouse_ops: sin sesion' using errcode = '42501'; end if;
  select * into c from public.warehouse_counts where id = p_count for update;
  if c.id is null then raise exception 'warehouse_ops: conteo desconocido'; end if;
  if not public.warehouse_ops_in_store(c.store) then raise exception 'warehouse_ops: sin acceso a esa tienda' using errcode = '42501'; end if;
  if c.stage = 'organizing' and p_stage = 'counting' then
    update public.warehouse_counts set stage = 'counting', organized_at = now(), organized_by = yo where id = p_count;
  elsif c.stage = 'counting' and p_stage = 'review' then
    select count(*) into faltan from public.warehouse_count_lines l where l.count_id = p_count and l.counted_at is null;
    if faltan > 0 then raise exception 'warehouse_ops: faltan % lineas por contar', faltan using errcode = '22023'; end if;
    update public.warehouse_counts set stage = 'review', counting_done_at = now(), counting_done_by = yo where id = p_count;
  elsif c.stage = 'review' and p_stage = 'sign_off' then
    update public.warehouse_counts set stage = 'sign_off', orders_reviewed_at = now(), orders_reviewed_by = yo, orders_note = nullif(btrim(p_note), '') where id = p_count;
  else
    raise exception 'warehouse_ops: de % no se pasa a %', c.stage, p_stage using errcode = '22023';
  end if;
end $$;
revoke all on function public.warehouse_ops_count_advance(uuid, text, text) from public, anon;
grant execute on function public.warehouse_ops_count_advance(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Órdenes pendientes (personal, etapa review): factura, producto (una línea), cantidad vendida y no entregada
-- ---------------------------------------------------------------------------
-- La cantidad con la MISMA regla que la captura de una línea: cajas + sueltas (si hay piezas por caja) o el total.
create or replace function public.warehouse_ops_pending_qty(p_line uuid, p_boxes int, p_pieces int, p_total int)
  returns numeric language plpgsql stable security definer set search_path = public as $$
declare l record; q numeric;
begin
  select * into l from public.warehouse_count_lines where id = p_line;
  if l.id is null then raise exception 'warehouse_ops: linea desconocida'; end if;
  if p_boxes is not null or p_pieces is not null then
    if l.pieces_per_box is null or l.pieces_per_box <= 0 then raise exception 'warehouse_ops: ese producto no tiene piezas por caja; captura el total' using errcode = '22023'; end if;
    if coalesce(p_boxes, 0) < 0 or coalesce(p_pieces, 0) < 0 then raise exception 'warehouse_ops: cantidad negativa' using errcode = '22023'; end if;
    q := coalesce(p_boxes, 0) * l.pieces_per_box + coalesce(p_pieces, 0);
  elsif p_total is not null then
    if p_total < 0 then raise exception 'warehouse_ops: cantidad negativa' using errcode = '22023'; end if;
    q := p_total;
  else
    raise exception 'warehouse_ops: falta la cantidad vendida' using errcode = '22023';
  end if;
  if q <= 0 then raise exception 'warehouse_ops: la cantidad vendida tiene que ser mayor que cero' using errcode = '22023'; end if;
  return q;
end $$;
revoke all on function public.warehouse_ops_pending_qty(uuid, int, int, int) from public, anon, authenticated;

create or replace function public.warehouse_ops_pending_add(p_line uuid, p_invoice text, p_boxes int, p_pieces int, p_total int, p_note text)
  returns uuid language plpgsql volatile security definer set search_path = public as $$
declare yo uuid := auth.uid(); l record; c record; nuevo uuid;
begin
  if yo is null then raise exception 'warehouse_ops: sin sesion' using errcode = '42501'; end if;
  select * into l from public.warehouse_count_lines where id = p_line;
  if l.id is null then raise exception 'warehouse_ops: linea desconocida'; end if;
  select * into c from public.warehouse_counts where id = l.count_id;
  if not public.warehouse_ops_in_store(c.store) then raise exception 'warehouse_ops: sin acceso a esa tienda' using errcode = '42501'; end if;
  if c.stage <> 'review' then raise exception 'warehouse_ops: las ordenes pendientes se revisan despues de contar' using errcode = '22023'; end if;
  if btrim(coalesce(p_invoice, '')) = '' then raise exception 'warehouse_ops: falta el numero de factura' using errcode = '22023'; end if;
  insert into public.warehouse_count_pending (count_id, line_id, invoice_no, qty, note, entered_by, entered_by_name)
  values (c.id, l.id, btrim(p_invoice), public.warehouse_ops_pending_qty(p_line, p_boxes, p_pieces, p_total), nullif(btrim(coalesce(p_note, '')), ''), yo, public.warehouse_ops_caller_name())
  returning id into nuevo;
  return nuevo;
end $$;
revoke all on function public.warehouse_ops_pending_add(uuid, text, int, int, int, text) from public, anon;
grant execute on function public.warehouse_ops_pending_add(uuid, text, int, int, int, text) to authenticated;

create or replace function public.warehouse_ops_pending_update(p_pending uuid, p_invoice text, p_boxes int, p_pieces int, p_total int, p_note text)
  returns void language plpgsql volatile security definer set search_path = public as $$
declare yo uuid := auth.uid(); pp record; c record;
begin
  if yo is null then raise exception 'warehouse_ops: sin sesion' using errcode = '42501'; end if;
  select * into pp from public.warehouse_count_pending where id = p_pending for update;
  if pp.id is null then raise exception 'warehouse_ops: orden pendiente desconocida'; end if;
  select * into c from public.warehouse_counts where id = pp.count_id;
  if not public.warehouse_ops_in_store(c.store) then raise exception 'warehouse_ops: sin acceso a esa tienda' using errcode = '42501'; end if;
  if c.stage <> 'review' then raise exception 'warehouse_ops: las ordenes pendientes se revisan despues de contar' using errcode = '22023'; end if;
  if btrim(coalesce(p_invoice, '')) = '' then raise exception 'warehouse_ops: falta el numero de factura' using errcode = '22023'; end if;
  update public.warehouse_count_pending set invoice_no = btrim(p_invoice), qty = public.warehouse_ops_pending_qty(pp.line_id, p_boxes, p_pieces, p_total),
    note = nullif(btrim(coalesce(p_note, '')), ''), edited_by = yo, edited_by_name = public.warehouse_ops_caller_name(), edited_at = now()
  where id = p_pending;
end $$;
revoke all on function public.warehouse_ops_pending_update(uuid, text, int, int, int, text) from public, anon;
grant execute on function public.warehouse_ops_pending_update(uuid, text, int, int, int, text) to authenticated;

create or replace function public.warehouse_ops_pending_delete(p_pending uuid)
  returns void language plpgsql volatile security definer set search_path = public as $$
declare yo uuid := auth.uid(); pp record; c record;
begin
  if yo is null then raise exception 'warehouse_ops: sin sesion' using errcode = '42501'; end if;
  select * into pp from public.warehouse_count_pending where id = p_pending for update;
  if pp.id is null then raise exception 'warehouse_ops: orden pendiente desconocida'; end if;
  select * into c from public.warehouse_counts where id = pp.count_id;
  if not public.warehouse_ops_in_store(c.store) then raise exception 'warehouse_ops: sin acceso a esa tienda' using errcode = '42501'; end if;
  if c.stage <> 'review' then raise exception 'warehouse_ops: las ordenes pendientes se revisan despues de contar' using errcode = '22023'; end if;
  delete from public.warehouse_count_pending where id = p_pending;
end $$;
revoke all on function public.warehouse_ops_pending_delete(uuid) from public, anon;
grant execute on function public.warehouse_ops_pending_delete(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Recontar (gerente): desde counting, review o sign_off; borra lo contado y la firma
-- ---------------------------------------------------------------------------
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
    counted_at = null, recount_requested = true, recount_note = nullif(btrim(p_note), '') where id = p_line;
  update public.warehouse_counts set stage = 'counting', counting_done_at = null, counting_done_by = null, orders_reviewed_at = null, orders_reviewed_by = null,
    signed_at = null, signed_by = null, signed_by_name = null, signed_sheet = null, sign_note = null
  where id = c.id;
end $$;
revoke all on function public.warehouse_ops_count_recount(uuid, text) from public, anon;
grant execute on function public.warehouse_ops_count_recount(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. El sistema de una línea (gerente, sign_off): lo tecleado o corregido; quita la firma si la había
-- ---------------------------------------------------------------------------
create or replace function public.warehouse_ops_count_set_system(p_line uuid, p_qty numeric)
  returns void language plpgsql volatile security definer set search_path = public as $$
declare yo uuid := auth.uid(); l record; c record;
begin
  if yo is null then raise exception 'warehouse_ops: sin sesion' using errcode = '42501'; end if;
  if p_qty is null then raise exception 'warehouse_ops: falta la cantidad del sistema' using errcode = '22023'; end if;
  if p_qty < 0 then raise exception 'warehouse_ops: cantidad negativa' using errcode = '22023'; end if;
  select * into l from public.warehouse_count_lines where id = p_line for update;
  if l.id is null then raise exception 'warehouse_ops: linea desconocida'; end if;
  select * into c from public.warehouse_counts where id = l.count_id for update;
  if not public.warehouse_ops_can_manage(c.store) then raise exception 'warehouse_ops: solo el gerente pone la cantidad del sistema' using errcode = '42501'; end if;
  if c.stage <> 'sign_off' then raise exception 'warehouse_ops: la cantidad del sistema se pone en la firma' using errcode = '22023'; end if;
  update public.warehouse_count_lines set system_qty = p_qty, system_qty_set_by = yo, system_qty_set_by_name = public.warehouse_ops_caller_name(), system_qty_set_at = now()
  where id = p_line;
  if c.signed_at is not null then
    update public.warehouse_counts set signed_at = null, signed_by = null, signed_by_name = null, signed_sheet = null, sign_note = null where id = c.id;
  end if;
end $$;
revoke all on function public.warehouse_ops_count_set_system(uuid, numeric) from public, anon;
grant execute on function public.warehouse_ops_count_set_system(uuid, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- 11. Volver a revisar (gerente, sign_off → review): para corregir órdenes pendientes; quita la firma
-- ---------------------------------------------------------------------------
create or replace function public.warehouse_ops_count_back(p_count uuid, p_note text)
  returns void language plpgsql volatile security definer set search_path = public as $$
declare yo uuid := auth.uid(); c record;
begin
  if yo is null then raise exception 'warehouse_ops: sin sesion' using errcode = '42501'; end if;
  select * into c from public.warehouse_counts where id = p_count for update;
  if c.id is null then raise exception 'warehouse_ops: conteo desconocido'; end if;
  if not public.warehouse_ops_can_manage(c.store) then raise exception 'warehouse_ops: solo el gerente regresa el conteo' using errcode = '42501'; end if;
  if c.stage <> 'sign_off' then raise exception 'warehouse_ops: solo se regresa desde firma' using errcode = '22023'; end if;
  update public.warehouse_counts set stage = 'review', signed_at = null, signed_by = null, signed_by_name = null, signed_sheet = null, sign_note = null,
    orders_note = coalesce(nullif(btrim(p_note), ''), orders_note)
  where id = p_count;
end $$;
revoke all on function public.warehouse_ops_count_back(uuid, text) from public, anon;
grant execute on function public.warehouse_ops_count_back(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 12. Firmar (gerente, sign_off): sistema en todas las líneas; razón si hay diferencia después de órdenes pendientes
-- ---------------------------------------------------------------------------
drop function if exists public.warehouse_ops_count_sign(uuid, text);
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

-- ---------------------------------------------------------------------------
-- 13. Ajustar (gerente, sign_off, firmado): las capturas del ERP
-- ---------------------------------------------------------------------------
create or replace function public.warehouse_ops_count_adjust(p_count uuid, p_shots text[])
  returns void language plpgsql volatile security definer set search_path = public as $$
declare yo uuid := auth.uid(); c record; f text;
begin
  if yo is null then raise exception 'warehouse_ops: sin sesion' using errcode = '42501'; end if;
  select * into c from public.warehouse_counts where id = p_count for update;
  if c.id is null then raise exception 'warehouse_ops: conteo desconocido'; end if;
  if not public.warehouse_ops_can_manage(c.store) then raise exception 'warehouse_ops: solo el gerente ajusta el conteo' using errcode = '42501'; end if;
  if c.stage <> 'sign_off' then raise exception 'warehouse_ops: el conteo no esta en firma' using errcode = '22023'; end if;
  if c.signed_at is null then raise exception 'warehouse_ops: primero hay que firmar el conteo' using errcode = '22023'; end if;
  if p_shots is null or cardinality(p_shots) = 0 then raise exception 'warehouse_ops: falta la captura del ajuste' using errcode = '22023'; end if;
  foreach f in array p_shots loop
    if split_part(f, '/', 1) <> yo::text then raise exception 'warehouse_ops: captura no valida' using errcode = '22023'; end if;
  end loop;
  update public.warehouse_counts set stage = 'adjusted', adjusted_at = now(), adjusted_by = yo, adjustment_shots = p_shots where id = p_count;
end $$;
revoke all on function public.warehouse_ops_count_adjust(uuid, text[]) from public, anon;
grant execute on function public.warehouse_ops_count_adjust(uuid, text[]) to authenticated;

-- ===========================================================================
-- Autocomprobacion
-- ===========================================================================
do $chk$
declare f text; def text;
begin
  if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'warehouse_count_pending' and rowsecurity) then
    raise exception '333: warehouse_count_pending no existe o no tiene RLS';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'warehouse_count_pending' and cmd <> 'SELECT') then
    raise exception '333: warehouse_count_pending no debe tener politicas de escritura';
  end if;
  if exists (select 1 from public.warehouse_counts where stage = 'reviewing_orders') then
    raise exception '333: quedan conteos en la etapa vieja reviewing_orders';
  end if;
  foreach f in array array[
    'public.warehouse_ops_pending_add(uuid, text, int, int, int, text)',
    'public.warehouse_ops_pending_update(uuid, text, int, int, int, text)',
    'public.warehouse_ops_pending_delete(uuid)',
    'public.warehouse_ops_count_set_system(uuid, numeric)',
    'public.warehouse_ops_count_back(uuid, text)',
    'public.warehouse_ops_count_sign(uuid, text, text)',
    'public.warehouse_ops_count_adjust(uuid, text[])',
    'public.warehouse_ops_count_recount(uuid, text)',
    'public.warehouse_ops_count_advance(uuid, text, text)',
    'public.warehouse_ops_count_products(text, text, text, text, text, bigint)',
    'public.warehouse_ops_count_vendors(text)'] loop
    if has_function_privilege('anon', f, 'execute') then raise exception '333: anon ejecuta %', f; end if;
  end loop;
  def := pg_get_functiondef('public.warehouse_ops_count_sign(uuid, text, text)'::regprocedure);
  if position('warehouse_ops_can_manage(c.store)' in def) = 0 or position('la razon' in def) = 0 or position('system_qty is null' in def) = 0 then
    raise exception '333: count_sign no pasa por can_manage, no pide la razon o no exige el sistema';
  end if;
  def := pg_get_functiondef('public.warehouse_ops_pending_add(uuid, text, int, int, int, text)'::regprocedure);
  if position('warehouse_ops_in_store(c.store)' in def) = 0 or position('''review''' in def) = 0 then
    raise exception '333: pending_add no usa las puertas o no exige la etapa review';
  end if;
  def := pg_get_functiondef('public.warehouse_ops_count_products(text, text, text, text, text, bigint)'::regprocedure);
  if position('warehouse_ops_norm_nombre' in def) = 0 or position('warehouse_ops_norm_medida' in def) = 0 then
    raise exception '333: count_products no compara normalizado';
  end if;
  def := pg_get_functiondef('public.warehouse_ops_count_adjust(uuid, text[])'::regprocedure);
  if position('''sign_off''' in def) = 0 then raise exception '333: count_adjust no exige la etapa sign_off'; end if;
end $chk$;

-- @ledger-below
