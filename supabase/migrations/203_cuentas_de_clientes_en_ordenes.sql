-- ===========================================================================
-- 203 . Las cuentas del formulario de orden salen de Clientes (D-NEXT)
-- ===========================================================================
-- PEDIDO. El duenio, 2026-10-26: «cuando uno busca un customer en el order form […] esos customers tienen que ser los
-- mismos que estan en el customer app […] Y eso tiene que estar conectado».
--
-- POR QUE UNA FUNCION. erp.customers tiene la puerta del modulo de Clientes (has_customers_access, 180) y, desde la 198,
-- un vendedor solo ve los libres y los suyos. Un despachador o un vendedor de Entregas sin la casilla de Clientes no lee
-- la tabla, y el formulario de orden necesita los nombres. En vez de abrir la tabla, una funcion estrecha que devuelve
-- SOLO lo que el formulario usa: cuenta, tienda, primer contacto, su telefono y la direccion, de clientes sin archivar.
--
-- QUIEN: autenticado con acceso a Entregas (has_deliveries_access). La regla de la 198 se respeta: un vendedor ve los
-- clientes libres, los suyos y los que creo (erp.customers_ve_la_fila).
--
-- QUE NO HACE: no toca erp.customers ni sus politicas; no crea clientes.
--
-- Sin begin/commit: quien aplica envuelve el fichero.
--
-- Reversion: drop function public.cuentas_de_clientes(); y borrar la fila del registro.

create or replace function public.cuentas_de_clientes()
  returns table (account text, store text, contact text, phone text, address text)
  language sql stable security definer set search_path = public, erp as $$
  select c.account::text,
         c.store::text,
         coalesce(nullif(btrim(c.contacts -> 0 ->> 'name'), ''), nullif(btrim(c.contact_name), ''))::text,
         coalesce(nullif(btrim(c.contacts -> 0 -> 'phones' ->> 0), ''), nullif(btrim(c.phone), ''))::text,
         nullif(btrim(c.address), '')::text
  from erp.customers c
  where public.has_deliveries_access()
    and c.archived_at is null
    and nullif(btrim(c.account), '') is not null
    and erp.customers_ve_la_fila(c.rep_id, c.created_by)
  order by c.account, c.store;
$$;

revoke execute on function public.cuentas_de_clientes() from public, anon;
grant execute on function public.cuentas_de_clientes() to authenticated;

-- ===========================================================================
-- Autocomprobacion (mira el catalogo)
-- ===========================================================================
do $chk$
begin
  if to_regprocedure('public.cuentas_de_clientes()') is null then
    raise exception '203: falta public.cuentas_de_clientes()';
  end if;
  if not (select prosecdef from pg_proc where oid = 'public.cuentas_de_clientes()'::regprocedure) then
    raise exception '203: cuentas_de_clientes no es security definer';
  end if;
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('203_cuentas_de_clientes_en_ordenes.sql', '408fdf1964a2110e04c17349f3bdf514df8118acc206f898af9ab48bbb870c99') on conflict (name) do nothing;
