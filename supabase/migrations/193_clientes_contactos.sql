-- ===========================================================================
-- 193 . Varios contactos por cliente (D-668)
-- ===========================================================================
-- PEDIDO. El duenio, 2026-10-24: «en la parte de customers pueden haber que en un solo cliente tenga diferentes
-- contactos […] si un mismo contacto tiene varios telefonos, varios correos, que se pueda ir poniendo». Hasta hoy una
-- fila tenia UN contacto en cuatro columnas de texto (contact_name, contact_title, phone, email), y lo que no cabia se
-- escribia junto: «956-605-8867 - Emmanuel» en el telefono, «a@x.com;b@y.com» en el correo.
--
-- QUE HACE: una columna `contacts` (jsonb, una lista; vacia por defecto) en erp.customers. Cada elemento es un contacto:
-- {"name": texto|null, "title": texto|null, "phones": [texto], "emails": [texto], "note": texto|null}. La forma la pone la app
-- (`src/lib/customers/formato.ts`); aqui solo se exige que sea una lista. Las cuatro columnas de antes se quedan: la app
-- las escribe como ESPEJO del primer contacto (la lista, la busqueda y «Decidir si se juntan» las siguen leyendo).
--
-- QUE NO HACE: no rellena la lista. Mientras una fila tenga la lista vacia, la app saca sus contactos de las cuatro
-- columnas de antes, al vuelo; el barrido que la rellena es `scripts/contactos-de-clientes.mts` (con su respaldo). No toca
-- la RLS (la columna entra en las politicas de la tabla, que son por fila) ni `erp.junta_clientes` (189): al juntar dos
-- filas de una tienda, los contactos de la que se archiva no se suman; lo distinto de su espejo se apunta en las notas,
-- como hasta hoy, y la fila archivada se puede abrir.
--
-- Sin begin/commit: quien aplica envuelve el fichero.
--
-- Reversion: `alter table erp.customers drop column contacts;` y borrar la fila del registro. Las cuatro columnas de
-- antes siguen ahi, con el primer contacto de cada fila.

alter table erp.customers add column if not exists contacts jsonb not null default '[]'::jsonb;

alter table erp.customers drop constraint if exists customers_contacts_es_lista;
alter table erp.customers add constraint customers_contacts_es_lista check (jsonb_typeof(contacts) = 'array');

-- ===========================================================================
-- Autocomprobacion (mira el catalogo)
-- ===========================================================================
do $chk$
begin
  if not exists (select 1 from pg_attribute where attrelid = 'erp.customers'::regclass and attname = 'contacts' and attnotnull and not attisdropped) then
    raise exception '193: falta erp.customers.contacts (not null)';
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'erp.customers'::regclass and conname = 'customers_contacts_es_lista') then
    raise exception '193: falta la restriccion de la lista';
  end if;
  if exists (select 1 from erp.customers where jsonb_typeof(contacts) <> 'array') then
    raise exception '193: hay filas cuyos contactos no son una lista';
  end if;
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('193_clientes_contactos.sql', '8f94f61ec3d1b55f157b0dfbc2edc71943b16fbf0adbac2e2873d1675e2cfa50') on conflict (name) do nothing;
