-- 230: Promos — precio por grupo de tiendas (D-812, 2026-11-03).
--
-- El dueño, con la tabla de precios por tamaño para Brownsville («in brownsville promo add this prices for the items
-- names containing that sizes»): «en este caso este precio solo aplica para brownsville». Hasta hoy el precio de un
-- producto en una ronda era UNO (promo_products.price, del libro) y lo veían todos los grupos; lo que cada grupo
-- decidía era solo aprobar o rechazar.
--
-- Qué hace: `promo_decisions.price` — el precio que ESE grupo le pone a ESE producto en ESA ronda. Nulo = el del
-- libro. Vive en la fila de la decisión porque es exactamente la misma clave (ronda, producto, grupo) y los mismos
-- permisos: lo escribe quien decide por ese grupo (promo_is_decider y su grupo, o el admin), y la ronda cerrada lo
-- para el mismo disparador. Una fila puede nacer solo con precio y seguir «pending».
--
-- Sin begin/commit propios. Para deshacer: alter table public.promo_decisions drop column price; borrar la fila del
-- registro.
alter table public.promo_decisions add column if not exists price numeric;
alter table public.promo_decisions drop constraint if exists promo_decisions_precio_no_negativo;
alter table public.promo_decisions add constraint promo_decisions_precio_no_negativo check (price is null or price >= 0);
comment on column public.promo_decisions.price is
  'D-812: el precio de este grupo para este producto en esta ronda; nulo = el del libro (promo_products.price).';

-- ===========================================================================
-- Autocomprobación (mira el catálogo)
-- ===========================================================================
do $chk$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'promo_decisions' and column_name = 'price') then
    raise exception '230: promo_decisions.price no existe';
  end if;
  if not exists (select 1 from information_schema.column_privileges where table_schema = 'public' and table_name = 'promo_decisions'
                   and column_name = 'price' and grantee = 'authenticated' and privilege_type = 'UPDATE') then
    raise exception '230: authenticated no puede escribir promo_decisions.price (el grant de la 140 era por tabla; revisar)';
  end if;
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum)
  values ('230_promos_precio_por_grupo.sql', 'bbd65bbe746054305f0f905f4db3df1e2e57d1f051b5420a5151a48eaaf3bc00') on conflict (name) do nothing;
