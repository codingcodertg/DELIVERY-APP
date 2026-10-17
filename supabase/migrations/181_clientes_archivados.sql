-- ===========================================================================
-- 181 - Clientes: archivar las filas de erp.customers que no son clientes (sin borrarlas)
-- ===========================================================================
-- ESCRITA Y NO APLICADA: aplicarla es del orquestador, despues del merge, con migrate-status antes y despues.
--
-- El dueno (2026-10-16): «HAZME EL CLEANUP DE LO DEL CLIENTES VIEW».
--
-- Medido ese dia en produccion sobre erp.customers (1.348 filas): 149 filas NO son clientes. Vienen del Excel maestro
-- tal cual (D-569) y son de tres clases: 20 sin nombre real («+», «;», «..», «*», «30.27», «4V», «HB», «SO 10873»),
-- 40 comodines de QuickBooks («VENTA AL MOSTRADOR», «SALES ORDER», «BAD DEBT», «DAMAGED MERCHANDISE», «INVENTORY BY/
-- COORD», «DE MCALLEN A», «DE MISSION A») y 101 con activity_status Internal / Supplier / Competencia (empresas del
-- grupo, proveedores, competencia). Las tres clases se solapan; la union son 149.
--
-- POR QUE ARCHIVAR Y NO BORRAR: la lista se volvera a importar desde el Excel (importa-clientes.mjs es idempotente y
-- NUNCA borra), y una fila borrada volveria con la siguiente importacion. Archivada, el upsert la actualiza pero
-- archived_at se queda (coalesce solo toca columnas del Excel). Y es reversible: quitar archived_at es desarchivar.
--
-- QUE TRAE: dos columnas y un indice parcial. NADA MAS.
--   archived_at:     cuando se archivo; null = cliente vivo (lo normal).
--   archived_reason: por que, en texto libre. El script scripts/archiva-clientes-basura.mjs usa tres motivos fijos
--                    ('sin nombre', 'comodin de QuickBooks', 'interno/proveedor/competencia') y la ficha deja escribir
--                    uno a mano. No hay check: un motivo nuevo no debe exigir una migracion.
--   customers_vivos_idx: indice parcial sobre las filas con archived_at is null, que son las que la lista pide.
--
-- NO ARCHIVA NADA: los datos los cambia el script, en seco por defecto, aparte y despues (misma regla que la 180 con
-- importa-clientes.mjs). Una migracion de esquema no decide que fila es basura.
--
-- SIN POLITICAS NUEVAS: las de la 180 son por fila, no por columna; quien puede actualizar (admin y manager del hub,
-- erp.customers_can_write()) puede poner y quitar archived_at, y quien lee, lo lee.
--
-- Sin begin/commit propios, a proposito: quien aplica envuelve el fichero en una transaccion.
-- ===========================================================================

alter table erp.customers
  add column if not exists archived_at timestamptz,
  add column if not exists archived_reason text;

create index if not exists customers_vivos_idx on erp.customers (store, lower(btrim(account))) where archived_at is null;

-- Reversion:
--   drop index if exists erp.customers_vivos_idx;
--   alter table erp.customers drop column if exists archived_reason, drop column if exists archived_at;
--   delete from public.schema_migrations where name = '181_clientes_archivados.sql';
-- (Quitar las columnas pierde QUE estaba archivado y por que. Para deshacer solo el archivado y conservar el esquema:
--  node scripts/archiva-clientes-basura.mjs --deshacer --escribe.)

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('181_clientes_archivados.sql', '9d7ba3a37832303a3e6f4bf2b749b4783aff3f2e8cd91ffe479f51efeaac426b') on conflict (name) do nothing;
