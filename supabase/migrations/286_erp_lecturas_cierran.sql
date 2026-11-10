-- 286: ERP — cerrar las lecturas abiertas de catálogo/precios/inventario (revisión de seguridad, M3) (2026-11-10).
--
-- Hallazgo: `erp.categories`, `erp.vendors`, `erp.store_products`, `erp.lots`, `erp.price_history` e
-- `erp.inventory_movements` tienen la puerta de módulo `has_erp_access()` (política ALL), PERO además tenían políticas
-- `SELECT using (true)`. Como las políticas permisivas se SUMAN (OR), esas abrían la lectura a CUALQUIER usuario
-- autenticado — incluido quien no tiene el módulo ERP —, dejando ver costos, precios, proveedores e inventario.
--
-- Se comprobó que fuera de `/erp` nada lee esas tablas (merma usa `erp.products` por un RPC security-definer aparte),
-- así que quitarlas no rompe otros módulos.
--
-- Qué hace: elimina esas políticas `SELECT using(true)` (incluidas las duplicadas). Queda la puerta `has_erp_access()`
-- (ALL), que ya cubre el SELECT: solo quien tiene el módulo ERP lee el catálogo.
--
-- Additive/correctivo; no crea tablas. 237/280-285 intactas. Para deshacer: volver a crear las políticas abiertas
-- (no recomendado) y `delete from public.schema_migrations where name = '286_erp_lecturas_cierran.sql';`

drop policy if exists "categories read"          on erp.categories;
drop policy if exists "read categories"          on erp.categories;
drop policy if exists "vendors read"             on erp.vendors;
drop policy if exists "read vendors"             on erp.vendors;
drop policy if exists "store_products read"      on erp.store_products;
drop policy if exists "lots read"                on erp.lots;
drop policy if exists "price_history read"       on erp.price_history;
drop policy if exists "inventory_movements read" on erp.inventory_movements;

-- ===========================================================================
-- Autocomprobacion: ninguna de esas tablas debe quedar con un SELECT abierto (using true) para authenticated,
-- y todas deben conservar su puerta has_erp_access().
-- ===========================================================================
do $chk$
declare
  t text;
  tablas text[] := array['categories', 'vendors', 'store_products', 'lots', 'price_history', 'inventory_movements'];
begin
  foreach t in array tablas loop
    if exists (
      select 1 from pg_policies
      where schemaname = 'erp' and tablename = t and cmd = 'SELECT' and qual = 'true'
    ) then
      raise exception '286: erp.% todavia tiene un SELECT abierto (using true)', t;
    end if;
    if not exists (
      select 1 from pg_policies
      where schemaname = 'erp' and tablename = t and position('has_erp_access' in coalesce(qual, '')) > 0
    ) then
      raise exception '286: erp.% se quedo sin la puerta has_erp_access()', t;
    end if;
  end loop;
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('286_erp_lecturas_cierran.sql', '7ea0418be7eee96918d63c3fc16c4b942c18cf71a3bfa08b1e5cc97c37ed9a77') on conflict (name) do nothing;
