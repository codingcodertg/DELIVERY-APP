-- 269: Merma: «Transporte» se parte en «del cliente» y «entrega de la tienda» (Warehouse Ops) (2026-11-07).
--
-- PEDIDO. Roberto, solicitud de ayuda c8256a2e (2026-11-07), en Warehouse Ops -> Nuevo reporte -> Merma, paso «Motivo»:
-- "Need to distinguish between customer transportation and if it was a store's delivery". El motivo «Transporte»
-- no decia si la pieza se rompio cuando el cliente se la llevo o cuando la entrego la tienda.
--
-- QUE HACE. La columna public.warehouse_reports.reason tiene un `check` con la lista cerrada de motivos (247). Se
-- vuelve a crear admitiendo los dos nuevos:
--   * transportation_customer : se rompio mientras el cliente la transportaba.
--   * transportation_delivery : se rompio en la entrega de la tienda.
-- El valor viejo `transportation` SE QUEDA en la lista: los reportes ya guardados lo tienen y no se reescriben (la
-- pantalla lo muestra como «Transporte (sin especificar)»; ya no se puede elegir en reportes nuevos).
--
-- ORDEN CON EL DESPLIEGUE. Aplicar ANTES de desplegar: la pantalla nueva manda los dos valores nuevos y, sin esto, la
-- base los rechaza (check). El codigo de antes sigue funcionando con la lista ampliada.
--
-- Nada mas cambia: ni warehouse_ops_file_report, ni triggers, ni permisos. Sin datos que migrar.
--
-- Idempotente: se puede correr dos veces.

alter table public.warehouse_reports drop constraint if exists warehouse_reports_reason_check;
alter table public.warehouse_reports add constraint warehouse_reports_reason_check
  check (reason in ('fell', 'strap', 'forklift', 'transportation', 'transportation_customer', 'transportation_delivery', 'other'));

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('269_merma_motivo_transporte.sql', '990040b45c3675854c8ce155beb508ae294fdfe26cbc583b7f91746f19aa6a13') on conflict (name) do nothing;
