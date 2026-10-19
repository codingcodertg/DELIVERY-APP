-- ===========================================================================
-- 182 - Clientes: las tres columnas del Excel que la 180 dejo fuera (CRM TYPE: STORE, CRM TYPE: GROUP, Associated with)
-- ===========================================================================
-- ESCRITA Y NO APLICADA: aplicarla es del orquestador, despues del merge, con migrate-status antes y despues.
--
-- El dueno (2026-10-18): «in cusotmer tab haz un cuztomizable order thing so we can all columsn if we wanted to that
-- were on the excel» y «the crm stuff in the customer is missing».
--
-- Medido ese dia en el Excel («REAL Master List Customers PRE DEC.xlsx», hoja ALL, 1.349 filas, 27 cabeceras con nombre
-- y una 28.a sin nombre y vacia), contra erp.customers (180 + 181): de las 27, 23 estan en la tabla y 4 no:
--   CRM TYPE: STORE   12 llenas  (MID 2, SMALL 2, LARGE 2, "LOST" 6 -las comillas vienen en la celda-)
--   CRM TYPE: GROUP    6 llenas  (MID 2, SMALL 2, LARGE 2)
--   Associated with    3 llenas  (ACERO-SYNERGY x3)
--   CONCATENATE    1.349 llenas, y las 1.349 son EXACTAMENTE STORE seguido de ACCOUNT (0 distintas).
--
-- QUE TRAE: tres columnas de texto libre, NADA MAS. Sin check: en el Excel la columna CRM mezcla valores de HISTORY
-- (MID/SMALL/LARGE) con uno de STATUS (LOST), y el dueno la va a seguir rellenando a mano; un valor nuevo no debe
-- exigir una migracion. Son columnas del CRM que la 180 descarto por estar casi vacias (docs/PLAN-clientes.md, seccion
-- 2); el dueno quiere TODAS las del Excel disponibles, y estas son justo «the crm stuff».
--
-- CONCATENATE NO se guarda: es STORE+ACCOUNT pegados (una formula del Excel) y la clave natural de la tabla ya es
-- (store, account). Guardarla seria una copia que se desincroniza al corregir una cuenta desde la ficha. La pantalla la
-- calcula (columna «Store + account» del selector) y el importador la ignora, como hasta ahora. La columna 28 sin
-- nombre no existe: ni cabecera ni datos.
--
-- SIN POLITICAS NUEVAS: las de la 180 son por fila, no por columna; quien escribe (erp.customers_can_write()) escribe
-- estas tambien, y quien lee, las lee.
--
-- El importador (scripts/importa-clientes.mjs) las lee del Excel y las escribe con el mismo coalesce que el resto:
-- volver a correrlo sobre las 1.348 filas rellena SOLO estas tres (y lo que estuviera vacio) sin pisar notes ni el
-- archivado de la 181.
--
-- Sin begin/commit propios, a proposito: quien aplica envuelve el fichero en una transaccion.
-- ===========================================================================

alter table erp.customers
  add column if not exists crm_type_store text,
  add column if not exists crm_type_group text,
  add column if not exists associated_with text;

-- Reversion:
--   alter table erp.customers drop column if exists associated_with, drop column if exists crm_type_group, drop column if exists crm_type_store;
--   delete from public.schema_migrations where name = '182_clientes_crm.sql';
-- (Quitar las columnas pierde lo que se haya escrito en ellas desde la ficha; lo del Excel vuelve con el importador.)

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('182_clientes_crm.sql', 'c62a411e14161f02ec2759fd5cdbb37a7fb7ad9e102de21f1ab22b2782b5e9e5') on conflict (name) do nothing;
