-- 164_tipo_proveedor.sql — el tipo de orden «Proveedor» (D-511)
--
-- El dueño: «hay que agregar un tipo de orden diferente que es para cuando se lleva producto a un
-- proveedor, sale de una tienda y se lleva a un proveedor obviamente no lleva invoice ni nada de eso
-- se va a llamar proveedor».
--
-- Esto es SOLO datos: `deliveries.order_type` es `text` libre, sin `check` y sin enum (la crea
-- `014_sync_delivery_columns.sql:20` y nadie la altera después), así que un tipo nuevo no necesita
-- tocar el esquema. La lista de tipos válidos vive en `public.settings`: `order_types` (text[]) y
-- `order_type_rules` (jsonb). Se puede hacer desde la pantalla Datos; se hace aquí para que quede
-- en el repo y no dependa de que alguien se acuerde de clicar.
--
-- Las tres banderas de la regla:
--
--   storeToStore: false  — el destino es la dirección del PROVEEDOR, libre, no una de nuestras
--                          tiendas. Si fuera `true`, el destino se elegiría de un desplegable de
--                          nuestras tiendas y la orden se le repartiría a tres tiendas a la vez.
--   hasCustomer:  false  — bandera nueva (D-511). Hasta ahora «no hay cliente» y «el destino es una
--                          de mis tiendas» eran la MISMA bandera, y por eso este tipo no se podía
--                          describir: necesita lo primero sin lo segundo. Sin esto, la orden
--                          recibiría el SMS de cliente y el motor de rutas le daría prioridad de
--                          *builder*.
--   docRef: 'hidden'     — valor nuevo (D-511): no lleva papel Y no se pintan los campos de
--                          Factura/PO/SO. Distinto de 'none', que no los exige pero los sigue
--                          pintando; 'none' no se redefinió porque es configurable desde Datos y
--                          cambiarle el significado alteraría en silencio lo que alguien ya eligiera.
--
-- Se escribe con `||` (merge), no reemplazando el objeto: `order_type_rules` lleva hoy Customer,
-- Transfer e Intertienda, y la autocomprobación de `146_customer_siempre_con_factura.sql:139-143`
-- exige que Customer conserve `docRef = 'invoice'`. Un `set order_type_rules = '{...}'` entero lo
-- borraría y rompería esa guarda.
--
-- Idempotente: el `where` del array evita duplicar el nombre si esto se corre dos veces.
--
-- NO lleva `begin`/`commit` a propósito: una migración con su propia transacción cierra la de fuera
-- y se aplica sola en un ensayo con ROLLBACK (pasó con la 124).

update public.settings
set order_types = order_types || array['Proveedor']
where id = 1
  and not ('Proveedor' = any (order_types));

update public.settings
set order_type_rules = order_type_rules || jsonb_build_object(
  'Proveedor', jsonb_build_object(
    'storeToStore', false,
    'hasCustomer',  false,
    'docRef',       'hidden'
  )
)
where id = 1;

-- Comprobación: el tipo está en la lista, su regla es la que se quería, y Customer sigue intacto
-- (que es lo que la 146 vigila). Si algo de esto no cuadra, la migración revienta aquí en vez de
-- dejar la configuración a medias.
do $$
declare
  faltan text;
begin
  select string_agg(q, '; ') into faltan from (
    select 'Proveedor no quedo en order_types' as q
      from public.settings where id = 1 and not ('Proveedor' = any (order_types))
    union all
    select 'la regla de Proveedor no es la esperada: ' || coalesce((order_type_rules -> 'Proveedor')::text, 'ausente')
      from public.settings where id = 1
       and coalesce(order_type_rules -> 'Proveedor' ->> 'docRef', '') <> 'hidden'
    union all
    select 'la regla de Proveedor dice tener cliente'
      from public.settings where id = 1
       and coalesce(order_type_rules -> 'Proveedor' ->> 'hasCustomer', '') <> 'false'
    union all
    select 'la regla de Proveedor dice ser tienda-a-tienda'
      from public.settings where id = 1
       and coalesce(order_type_rules -> 'Proveedor' ->> 'storeToStore', '') <> 'false'
    union all
    select 'Customer perdio su docRef invoice (lo vigila la 146)'
      from public.settings where id = 1
       and coalesce(order_type_rules -> 'Customer' ->> 'docRef', '') <> 'invoice'
  ) t;
  if faltan is not null then
    raise exception '164 no quedo bien: %', faltan;
  end if;
end $$;

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('164_tipo_proveedor.sql', '572aab51736f64e8f8e71cf78617cbda12091bce982216c9eb2e631cc4cdd62f') on conflict (name) do nothing;
