-- 174: los doce triggers del ERP que la fusión (062–069) nunca conectó.
--
-- Hallazgo del traspaso del ERP de BH (§4.1), MEDIDO en producción el 2026-10-14: el esquema `erp` tiene CERO triggers.
-- La 064 creó las cinco funciones (`audit_row`, `capture_price_history`, `capture_store_price_history`,
-- `apply_movement_to_cache`, `prevent_movement_mutation`), todas con `search_path = ''` y escribiendo en tablas `erp.*`,
-- pero ninguna migración las ata a una tabla. Consecuencias:
--   · `apply_movement_to_cache` es la ÚNICA que mueve `erp.store_products.qoh`: sin su trigger, una recepción o un
--     ajuste escribe su movimiento y el inventario a mano NO cambia. Latente: aún no se ha escrito ningún movimiento.
--   · `prevent_movement_mutation` hace el libro de inventario de solo-añadir; sin él, un movimiento se edita o se borra.
--   · `audit_row` (ocho tablas) y las dos de historial de precios: hoy nada queda registrado.
--
-- Las definiciones son las del repo viejo `codingcodertg/rtg-erp` (v4_11, v4_12, v4_14, v4_27, v4_35, v4_38), copiadas
-- tal cual —momento, eventos, columnas y `for each row`— cambiando solo `public.` por `erp.`. No se adivinó nada.
-- `drop trigger if exists` primero: la migración se puede volver a correr.
--
-- Sin begin/commit (la memoria «una migración no lleva su propia transacción»).

-- v4_11 · auditoría de productos y alias de SKU
drop trigger if exists audit_products on erp.products;
create trigger audit_products after insert or update or delete on erp.products
  for each row execute function erp.audit_row();
drop trigger if exists audit_sku_aliases on erp.sku_aliases;
create trigger audit_sku_aliases after insert or update or delete on erp.sku_aliases
  for each row execute function erp.audit_row();

-- v4_12 · historial de precios (decisión #38: cada cambio de precio o costo deja su fila con quién)
drop trigger if exists price_history_capture on erp.products;
create trigger price_history_capture after insert or update of price, cost on erp.products
  for each row execute function erp.capture_price_history();
drop trigger if exists store_price_history_capture on erp.store_products;
create trigger store_price_history_capture after insert or update of store_price, store_cost on erp.store_products
  for each row execute function erp.capture_store_price_history();

-- v4_14 · auditoría de solicitudes de producto
drop trigger if exists audit_product_requests on erp.product_requests;
create trigger audit_product_requests after insert or update or delete on erp.product_requests
  for each row execute function erp.audit_row();

-- v4_27 · auditoría de órdenes de compra y acuses
drop trigger if exists audit_purchase_orders on erp.purchase_orders;
create trigger audit_purchase_orders after insert or update or delete on erp.purchase_orders
  for each row execute function erp.audit_row();
drop trigger if exists audit_po_lines on erp.po_lines;
create trigger audit_po_lines after insert or update or delete on erp.po_lines
  for each row execute function erp.audit_row();
drop trigger if exists audit_order_acknowledgments on erp.order_acknowledgments;
create trigger audit_order_acknowledgments after insert or update or delete on erp.order_acknowledgments
  for each row execute function erp.audit_row();
drop trigger if exists audit_ack_lines on erp.ack_lines;
create trigger audit_ack_lines after insert or update or delete on erp.ack_lines
  for each row execute function erp.audit_row();

-- v4_35 · auditoría de relaciones entre productos
drop trigger if exists audit_product_relations on erp.product_relations;
create trigger audit_product_relations after insert or update or delete on erp.product_relations
  for each row execute function erp.audit_row();

-- v4_38 · libro de inventario: solo-añadir (ANTES de escribir) y la caché de existencias (después de insertar)
drop trigger if exists trg_movements_append_only on erp.inventory_movements;
create trigger trg_movements_append_only before update or delete on erp.inventory_movements
  for each row execute function erp.prevent_movement_mutation();
drop trigger if exists trg_movement_cache on erp.inventory_movements;
create trigger trg_movement_cache after insert on erp.inventory_movements
  for each row execute function erp.apply_movement_to_cache();

-- Comprobación: los doce, ni uno menos.
do $chk$
declare n int;
begin
  select count(*) into n from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'erp' and not t.tgisinternal and t.tgname in (
     'audit_products','audit_sku_aliases','price_history_capture','store_price_history_capture','audit_product_requests',
     'audit_purchase_orders','audit_po_lines','audit_order_acknowledgments','audit_ack_lines','audit_product_relations',
     'trg_movements_append_only','trg_movement_cache');
  if n <> 12 then raise exception '174: hay % de los 12 triggers del ERP', n; end if;
end $chk$;

-- Reversión: un `drop trigger if exists <nombre> on erp.<tabla>;` por cada uno de los doce de arriba.

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('174_erp_triggers.sql', 'a5dded813db77cdcc1c6917750433926c6fcc232c96975063de249401ad54da7') on conflict (name) do nothing;
