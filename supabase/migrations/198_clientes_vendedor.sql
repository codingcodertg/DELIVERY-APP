-- ===========================================================================
-- 198 . Clientes: el vendedor de cada cliente, y cada vendedor ve solo los suyos (D-683)
-- ===========================================================================
-- PEDIDO. El duenio, 2026-10-25: «the customer app has a sales rep assigned to each customer. Right now, they just have
-- initials […] they will only be able to see their own source customers and the customer assigned to them, and the free
-- ones. If the customer isn't assigned to them, they will not be able to see it. And also, I want in edit, and when
-- they're creating, you assign a sales rep».
--
-- QUE HACE:
--   1. `rep_id` (uuid, perfil del hub, se vacia si el perfil se borra) en erp.customers: el VENDEDOR del cliente. Las
--      iniciales de QuickBooks (rep_store, rep_qb, rep_history) se quedan como estaban; el reparto inicial por iniciales
--      lo hace `scripts/asigna-vendedores.mjs` (con su respaldo), no esta migracion.
--   2. erp.customers_can_write(): ahora tambien el VENDEDOR del hub (profiles.role = 'sales') con la casilla del modulo,
--      ademas del admin y del manager con casilla. Es la ultima definicion: la de la 180 queda sustituida.
--   3. erp.customers_ve_la_fila(rep, creador): quien no es vendedor ve todo; un vendedor ve las filas sin vendedor, las
--      suyas y las que creo el. Una politica RESTRICTIVA mas sobre erp.customers con esa funcion: se SUMA a la puerta del
--      modulo (180) y a las permisivas de leer/escribir, que no se tocan. Escribir (with check) no se restringe: un
--      vendedor puede pasarle un cliente a otro; despues de guardarlo ya no lo ve, y eso es lo pedido.
--
-- QUE NO HACE: no toca erp.customer_files (195) ni la cola «Decidir si se juntan» (189): sus politicas siguen por modulo.
-- Un vendedor con el id de un cliente ajeno podria listar sus archivos por la API; la pantalla no se lo ensenia.
--
-- Sin begin/commit: quien aplica envuelve el fichero.
--
-- Reversion: drop policy "customers solo los suyos (vendedor)"; drop function erp.customers_ve_la_fila; volver a la
-- customers_can_write de la 180; `alter table erp.customers drop column rep_id;` y borrar la fila del registro.

alter table erp.customers add column if not exists rep_id uuid references public.profiles(id) on delete set null;
create index if not exists customers_rep_id on erp.customers (rep_id);

create or replace function erp.customers_can_write()
  returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select (role = 'admin' or (role in ('manager', 'sales') and 'customers' = any(coalesce(module_access, '{}'))))
    from public.profiles where id = auth.uid()
  ), false);
$$;

create or replace function erp.customers_ve_la_fila(p_rep uuid, p_creador uuid)
  returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role <> 'sales' from public.profiles where id = auth.uid()), false)
      or p_rep is null
      or p_rep = auth.uid()
      or p_creador = auth.uid();
$$;

drop policy if exists "customers solo los suyos (vendedor)" on erp.customers;
create policy "customers solo los suyos (vendedor)" on erp.customers as restrictive for all to authenticated
  using ((select erp.customers_ve_la_fila(rep_id, created_by))) with check (true);

-- ===========================================================================
-- Autocomprobacion (mira el catalogo)
-- ===========================================================================
do $chk$
begin
  if not exists (select 1 from pg_attribute where attrelid = 'erp.customers'::regclass and attname = 'rep_id' and not attisdropped) then
    raise exception '198: falta erp.customers.rep_id';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'erp' and tablename = 'customers' and policyname = 'customers solo los suyos (vendedor)' and permissive = 'RESTRICTIVE') then
    raise exception '198: falta la politica restrictiva del vendedor';
  end if;
  if position('role in (''manager'', ''sales'')' in pg_get_functiondef('erp.customers_can_write'::regproc)) = 0 then
    raise exception '198: customers_can_write no deja escribir al vendedor';
  end if;
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('198_clientes_vendedor.sql', 'b261369085ff2c41de796ffdcc5d4a6c6b51064064e6a5c2cff1fea42373cb4f') on conflict (name) do nothing;
