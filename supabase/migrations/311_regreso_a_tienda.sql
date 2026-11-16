-- ===========================================================================
-- 311 - Regreso a tienda: el despachador le ordena al chofer dejar en la tienda una orden que ya va en el camión
-- ===========================================================================
-- ESCRITA Y NO APLICADA: aplicarla es del dueño, con migrate-status antes y después.
--
-- QUE HACE. Dos columnas nuevas en public.deliveries, sin valor por defecto y sin tocar nada más:
--   return_to_store_at  cuándo se pidió que el chofer deje la orden en su tienda (null = no hay solicitud).
--   return_to_store_by  quién lo pidió (el despachador). El chofer no se cambia: la orden sigue con él hasta que la deja.
--
-- Al dejarla en la tienda, la pantalla de Mi ruta vuelve la orden a `ready` con assigned_driver, route_seq y load_no en
-- null, y borra estas dos columnas. Esa escritura va por la misma vía de siempre (setStage), no por esta migración.
--
-- SEGURIDAD. Ninguna política nueva: las columnas heredan el RLS que ya tiene la tabla.
--
-- LO QUE NO TOCA. Ninguna otra columna, ninguna política, ningún dato.
--
-- Sin begin/commit propios: quien aplica envuelve el fichero en una transacción.
-- ===========================================================================

alter table public.deliveries
  add column if not exists return_to_store_at timestamptz null,
  add column if not exists return_to_store_by uuid null;
-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('311_regreso_a_tienda.sql', '925e03217308d8beff6159426db2bb13fc52d2b535fcdbf76676efa708468ed0') on conflict (name) do nothing;
