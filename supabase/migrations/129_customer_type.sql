-- 129 · Builder o venta al mostrador, en cada orden (rama motor-rutas-modelo)
--
-- El motor de rutas da prioridad a los builders: van antes en la ruta y son los ultimos en quedarse fuera
-- cuando no cabe todo. Al preguntarle al dueno donde se decide quien es builder, contesto: «se marca en
-- cada orden», con la cuenta como valor por defecto. Esta es la columna de la orden; el valor por defecto
-- de cada cuenta vive en el JSON de `settings.accounts`, como `intertienda`, y no necesita migracion.
--
-- ADMITE NULL, y no es un olvido: un movimiento entre tiendas no es ni lo uno ni lo otro, y las ordenes
-- anteriores a este campo se quedan como estaban. NO SE RELLENA NADA HACIA ATRAS: decidir hoy que una
-- orden de hace un mes era de un builder seria inventarlo. El motor trata un null en una orden a cliente
-- como mostrador —prioridad normal—, que es lo contrario de darle prioridad a quien nadie marco.
--
-- NO TOCA NINGUNA POLITICA NI NINGUN GUARD. La columna se edita con el formulario de la orden, asi que
-- vale para ella lo mismo que para cualquier otro campo: `guard_delivery_stage` (vigente: la 127) decide
-- quien edita en que etapa.
--
-- UNA COSA QUE HAY QUE MIRAR AL ENSAYAR. `guard_delivery_stage` compara filas enteras con una variable
-- `public.deliveries%rowtype` (la excepcion del GPS tardio del chofer, de la 048, y la de la factura de
-- ventas, de la 125). Una columna nueva cambia ese tipo de fila. Postgres recompila la funcion cuando el
-- tipo cambia, pero es justo la clase de cosa que se comprueba y no se supone: el ensayo de abajo repite,
-- CON la columna ya anadida, los dos casos que dependen de esa comparacion.
--
-- SIN `begin`/`commit` PROPIOS. Quien aplica envuelve el fichero.

alter table public.deliveries
  add column if not exists customer_type text;

-- Aparte y con su nombre, para que volver a aplicar el fichero no falle ni la duplique.
alter table public.deliveries drop constraint if exists deliveries_customer_type_allowed;
alter table public.deliveries
  add constraint deliveries_customer_type_allowed
  check (customer_type is null or customer_type in ('builder', 'counter_sale'));

comment on column public.deliveries.customer_type is
  'builder | counter_sale | null. Se marca en cada orden a cliente; por defecto, lo que diga su cuenta (settings.accounts[].customer_type). 129';

-- ===========================================================================
-- Autocomprobacion
-- ===========================================================================
do $comprueba$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'deliveries'
                    and column_name = 'customer_type' and data_type = 'text' and is_nullable = 'YES') then
    raise exception '129: deliveries.customer_type no quedo como text que admite null';
  end if;
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.deliveries'::regclass and conname = 'deliveries_customer_type_allowed') then
    raise exception '129: falta la restriccion de valores de customer_type';
  end if;
  -- (Que no se rellena nada hacia atras se ve en el fichero: no hay ningun UPDATE. No se cuenta aqui,
  -- porque volver a aplicar esto con ordenes ya marcadas tiene que seguir pasando.)
  -- El guard sigue ahi y sigue colgado de la tabla.
  if not exists (select 1 from pg_trigger where tgrelid = 'public.deliveries'::regclass
                  and tgname = 'deliveries_guard_stage' and not tgisinternal) then
    raise exception '129: el trigger deliveries_guard_stage no esta';
  end if;
end $comprueba$;

-- ===========================================================================
-- Reversion
-- ===========================================================================
--   alter table public.deliveries drop constraint if exists deliveries_customer_type_allowed;
--   alter table public.deliveries drop column if exists customer_type;
--   delete from public.schema_migrations where name = '129_customer_type.sql';
--
-- Borra lo que se haya marcado desde que se aplico. Si interesa, primero
--   create table customer_type_backup as select id, customer_type from public.deliveries where customer_type is not null;
-- La app aguanta sin la columna: el formulario comprueba si la base la tiene antes de mandarla.

-- ===========================================================================
-- Ensayo, con ROLLBACK (lo que se escribe aqui se deshace)
-- ===========================================================================
-- Con la 129 aplicada DENTRO de la misma transaccion. `pg_temp.intenta` es el ayudante de la 123.
--
--   set local role authenticated;
--
--   -- A. Los valores.
--   set local request.jwt.claims = '{"sub":"<uuid-admin>","role":"authenticated"}';
--   A1 update public.deliveries set customer_type = 'builder'      where id = <orden-a-cliente>        -> PERMITIDO
--   A2 update public.deliveries set customer_type = 'counter_sale' where id = <orden-a-cliente>        -> PERMITIDO
--   A3 update public.deliveries set customer_type = null           where id = <orden-a-cliente>        -> PERMITIDO
--   A4 update public.deliveries set customer_type = 'vip'          where id = <orden-a-cliente>        -> BLOQUEADO (check)
--
--   -- B. El guard sigue comparando filas enteras, ahora con una columna mas.
--   --    Son los casos 1 y 3 del ensayo de la 125, y el del GPS tardio de la 048.
--   set local request.jwt.claims = '{"sub":"<uuid-vendedor>","role":"authenticated"}';
--   B1 update ... set invoice_num = 'ENSAYO-1' where id = <orden-suya-approved-sin-factura>            -> PERMITIDO  (como tras la 125)
--   B2 update ... set invoice_num = 'ENSAYO-2', customer_type = 'builder' where id = <la misma>        -> BLOQUEADO  (la factura Y otro campo)
--   B3 update ... set customer_type = 'builder' where id = <orden-suya-approved>                       -> BLOQUEADO  (ventas no edita en approved)
--   set local request.jwt.claims = '{"sub":"<uuid-chofer>","role":"authenticated"}';
--   B4 update ... set pod_lat = 26.2, pod_lng = -98.2 where id = <orden-suya-delivered>                -> PERMITIDO  (GPS tardio, 048)
--   B5 update ... set pod_lat = 26.2, customer_type = 'builder' where id = <la misma>                  -> BLOQUEADO
--
--   -- C. Crear una orden con el campo.
--   set local request.jwt.claims = '{"sub":"<uuid-vendedor>","role":"authenticated"}';
--   C1 insert de una orden en draft con customer_type = 'builder'                                      -> PERMITIDO
--
--   reset role;
--   rollback;
--
-- No verificado al escribirlo: nada de esto se ha corrido. Una rama no toca produccion.

-- @ledger-below
insert into public.schema_migrations (name, checksum)
  values ('129_customer_type.sql', '45f2283a1e88a71428c31b20d102e645567c104fd508f3ea71774f1d701ca343') on conflict (name) do nothing;
