-- ===========================================================================
-- 197 . Clientes: las redes sociales de la cuenta (D-682)
-- ===========================================================================
-- PEDIDO. Roberto Rodriguez Jr (admin), 2026-10-25, en Clientes: «Lets add a Socials tab for their Facebook, Instagram,
-- YouTube, TikTok, Twitter, Alignable, LinkedIn», senialando el sitio a la derecha de las pastillas de contactos.
--
-- QUE HACE: una columna `socials` (jsonb, un objeto; vacio por defecto) en erp.customers: {"facebook": texto, "instagram":
-- texto, "youtube": texto, "tiktok": texto, "twitter": texto, "alignable": texto, "linkedin": texto}, cada una solo si se
-- escribio. El texto es la URL entera o solo el usuario; la app lo abre igual (`src/lib/customers/redes.ts`). Aqui solo se
-- exige que sea un objeto.
--
-- QUE NO HACE: no toca la RLS (la columna entra en las politicas de la tabla, que son por fila) ni `erp.junta_clientes`
-- (189): al juntar dos filas, las redes de la que se archiva no se suman; la fila archivada se puede abrir.
--
-- Sin begin/commit: quien aplica envuelve el fichero.
--
-- Reversion: `alter table erp.customers drop column socials;` y borrar la fila del registro.

alter table erp.customers add column if not exists socials jsonb not null default '{}'::jsonb;

alter table erp.customers drop constraint if exists customers_socials_es_objeto;
alter table erp.customers add constraint customers_socials_es_objeto check (jsonb_typeof(socials) = 'object');

-- ===========================================================================
-- Autocomprobacion (mira el catalogo)
-- ===========================================================================
do $chk$
begin
  if not exists (select 1 from pg_attribute where attrelid = 'erp.customers'::regclass and attname = 'socials' and attnotnull and not attisdropped) then
    raise exception '197: falta erp.customers.socials (not null)';
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'erp.customers'::regclass and conname = 'customers_socials_es_objeto') then
    raise exception '197: falta la restriccion del objeto';
  end if;
  if exists (select 1 from erp.customers where jsonb_typeof(socials) <> 'object') then
    raise exception '197: hay filas cuyas redes no son un objeto';
  end if;
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('197_clientes_redes_sociales.sql', '1d69f8401ec861454cb22762c5b679556f6121fd12667eebfd82d459462783f2') on conflict (name) do nothing;
