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
-- Y SOLO LOS DE SU TIENDA (el duenio, 2026-10-26: «cada customer tiene una tienda assign entonces solo pueden ver esos
-- clientes si son de su tienda»). La misma regla que las ordenes (131): el admin ve todos; si la persona tiene tiendas
-- marcadas (profiles.visible_stores), esas; si no, la de su perfil (profiles.store); sin ninguna de las dos, todas (como
-- en la 131: nadie se queda a oscuras). El cliente guarda el codigo (BRO, MCA…) y el perfil el nombre («RDZ Brownsville»):
-- se traduce aqui, igual que TIENDAS en src/lib/customers/reglas.ts.
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
    and coalesce((
      select p.role = 'admin'
          or (coalesce(cardinality(p.visible_stores), 0) = 0 and nullif(btrim(p.store), '') is null)
          or (case upper(btrim(c.store))
                when 'BRO' then 'RDZ Brownsville' when 'EDG' then 'RDZ Edinburg' when 'MCA' then 'RDZ McAllen'
                when 'PHR' then 'RDZ Pharr' when 'WES' then 'RDZ Weslaco' when 'MIS' then 'RDZ Mission'
                else btrim(c.store) end)
             = any(case when coalesce(cardinality(p.visible_stores), 0) > 0 then p.visible_stores else array[btrim(p.store)] end)
      from public.profiles p where p.id = auth.uid()
    ), false)
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
insert into public.schema_migrations (name, checksum) values ('203_cuentas_de_clientes_en_ordenes.sql', 'ff77ef7ea383ec1be573ad3565b1318e8eb4ef8795011766b8e3cef1a6c4be17') on conflict (name) do nothing;
