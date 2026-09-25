# Plan 146 · Una Customer no sale de borrador ni se entrega sin factura

Plan en papel exigido por `CLAUDE.md` («Antes de tocar RLS, triggers o permisos en producción»).
Molde: `docs/PLAN-145-gerente-hace-bodega.md`.

**Estado (2026-09-25):** escrito por un worker en un worktree **sin `.env.local` y sin acceso a la base**. Todo lo
de este documento sale de **leer el repo** (`origin/main` = `5ffeddbd`) y de medir el **demo local**. Nada se ha
ejecutado contra producción: el ensayo de §6 y las mediciones de §7 son para el orquestador. **Pendiente de aprobar.**

**Pedido del dueño (2026-09-25), literal:** *«Invoice pending shouldn't show customers, that shouldn't be possible
anyway»*. Aclarado: *«me refiero que el pending invoice no debería aparecer para customer porque el customer siempre
debe llevar invoice, revisa eso»*.

**La migración está escrita y NO aplicada:** `supabase/migrations/146_customer_siempre_con_factura.sql`. Trae **una
función y un disparador nuevos**. No toca `guard_delivery_stage` (la 145 sigue siendo su última definición), ni
políticas, ni columnas, ni datos.

---

## 0 · Resumen

| | Hoy | Con la 146 |
|---|---|---|
| La base exige factura en una Customer | **nunca** | al crearla fuera de borrador, al cambiarle la etapa o el tipo, al vaciársela |
| Las 5 viejas sin factura (#93, #163, #197, #223, #243) | — | se pueden seguir editando (chofer, fecha, notas, **ponerles la factura**); no se pueden mover de etapa sin ponerla |
| Borrador, rechazada, anulada | sin factura | igual |
| Intertienda (PO) y Transfer (estimación) | — | **igual**: su regla no es `invoice` |
| Admin | — | **también sujeto** (el dueño dijo «siempre»; la 122 ya puso invariantes antes de la salida de admin) |
| Sin sesión (postgres, service-role) | — | pasa, como en el guard |

## 1 · Qué había (medido)

**La base no mira la factura en ningún sitio**, salvo la rama 125 (ventas **pone** la que falta). El guard de etapas
(145) no la mira al crear ni al mover.

**La pantalla la exigía en un solo sitio**: `submitBlockers` (D-049), que usan los botones de crear y de enviar del
modal (`passesChecks`/`blockSubmit`). Todo lo demás la dejaba pasar. Medido en el demo el 2026-09-25 con el código
de `origin/main` (clics de persona, Chrome headless por CDP), con una Customer aprobada a la que se le quitó la
factura (#1021) y un borrador Customer sin factura (#1001):

| Camino | Dónde (en `origin/main`) | Hoy |
|---|---|---|
| «Marcar entregada ya» (office, gerente, admin) | `OrderModal.tsx:825-828` → `setStage` | **pasa** a `delivered` |
| Enviar a aprobación en bloque (gerente) | `page.tsx:456-464` (`bulkStage`) | **pasa** a `pending` |
| Aprobar en bloque (gerente, admin; también logística ve el botón) | `page.tsx:456-464` | **pasa** a `approved` |
| Admin: «Marcar entregadas» en bloque | `page.tsx:470-490` | **pasa** a `delivered` |
| Admin: «Forzar estado» | `page.tsx:495-516` | **pasa**, a cualquier etapa |
| Re-entrega de una entregada sin factura (office, admin) | `OrderModal.tsx:1119-1125` + `borradorDeReentrega` | **crea una aprobada** sin factura |
| Deshacer un paso en una vieja sin factura | `OrderModal.tsx:834` | pasa (no sale de borrador, pero la mueve) |
| Resto de una carga partida | `OrderModal.tsx:915` | copia la factura del padre: solo sin factura si el padre ya no la tenía |
| Chofer: recoger y entregar | `my-route/page.tsx:95,101`, `OrderModal.tsx:944,1075` | pasa (solo con una vieja: nada nuevo llega ahí sin factura) |
| Crear aprobada/pendiente desde «+ Nueva orden» (ventas, office, gerente, admin) | `OrderModal.tsx:2497` `passesChecks` | **ya bloqueaba** |
| Editar una viva y borrarle la factura (office, gerente, admin) | `OrderModal.tsx:565` `passesChecks` | **ya bloqueaba** |
| Cambiar a Customer una Intertienda viva (office, admin) | `OrderModal.tsx:565` | **ya bloqueaba** |
| Enviar su borrador desde la ficha (ventas) | `OrderModal.tsx:731` `blockSubmit` | **ya bloqueaba** |
| Duplicar | `order-duplicate.ts` | nace **borrador**: no aplica |
| Importar CSV (admin) | `csv-import.ts:113` | nace **borrador**: no aplica |
| Ruta del ERP | `src/lib/erp/actions.ts` | **no escribe `deliveries`** (grep: solo `app_products`, `products`, `product_requests`, `po-docs`) |
| Publicar la ruta (135) | `135_no_publicar_hoja_importada.sql:84` | escribe chofer/secuencia/carga, no etapa ni factura |
| Poner la factura desde la fila (125) | `data-provider.tsx` `ponerDocumento` | solo escribe un valor **no vacío** |
| Agregar material (138) | `agregar-material.ts` | no toca `invoice_num` (tiene prueba) |

Ninguna ruta de `src/app/api` escribe `deliveries` con la llave de servicio (grep del 2026-09-25).

**Las 5 de producción** (medidas por el orquestador): historial `created>delivered…` o `created>edited>delivered…`.
Encajan con «Marcar entregada ya» o con el cierre en bloque del admin sobre una orden creada sin pasar por el envío.

## 2 · Qué se propone

### 2a. La pantalla (sin base)

`src/lib/factura-obligatoria.ts`, `escrituraSinFactura(antes, cambio, reglas)`: la llaman **los dos proveedores de
datos** en `addDelivery`, `updateDelivery` y `setStage`, junto a la guarda de sitio de D-276 y antes de escribir. Por
ahí pasa toda escritura de una orden desde el cliente, así que cierra de una vez los caminos de §1. El aviso es el
texto del envío (`textoDeBloqueo`, sacado de `blockSubmit` para que sea el mismo): *«No se guardó — Todavía falta: •
Factura #»*. En bloque, el resumen nombra las que se quedaron (`resumenSinFactura`), porque el aviso de cada orden lo
pisa el resumen en el mismo instante.

### 2b. La base (la 146)

`public.guard_factura_obligatoria()`, `BEFORE INSERT OR UPDATE` en `deliveries` (disparador
`deliveries_guard_invoice`). Rechaza con `INVOICE_REQUIRED` si la orden **queda** fuera de `draft/rejected/canceled`,
con `invoice_num` vacío, su tipo pide factura, **y** la escritura es un INSERT, cambia la etapa, cambia el tipo o vacía
la factura que había.

### 2c. Decisiones (para validar)

1. **Las 5 viejas no revientan.** Un UPDATE que no cambia etapa ni tipo sobre una orden que **ya** estaba sin factura
   pasa. Si no, cualquier pantalla que la tocara (una nota, la publicación de la ruta, asignar chofer) fallaría con un
   error que no tiene que ver con lo que la persona hizo. Lo que sí se les pide es la factura antes de moverlas de
   etapa — incluido **deshacer** (`delivered → picked_up`): el dueño dijo «siempre», y la salida es poner la factura.
2. **Lo decide la regla del tipo**, no el nombre: `settings.order_type_rules -> tipo ->> 'docRef'`, con `invoice` por
   defecto si la regla existe sin `docRef` (igual que `docRef ?? "invoice"` en la app). Si el tipo **no tiene regla
   explícita**, la base no lo exige: la app aplica ahí un respaldo por palabras clave (`fallbackRule`) y copiarlo al
   SQL sería una segunda definición (el motivo de la 125). La autocomprobación **exige** que hoy Customer tenga regla
   con `invoice`; si no, la migración falla y no se aplica. La regla solo se lee cuando la escritura ya iba a violar lo
   demás: casi todas salen antes sin leer `settings` (lo que la 131 pidió no hacer por fila).
3. **El admin también.** Sin salida de admin. Es una invariante de la orden, como la de la 122.
4. **Sin sesión pasa**, como el guard desde la 019: es el SQL a mano del orquestador, por donde se reparan datos.
5. **La re-entrega y el resto de una carga partida de una Customer sin factura también se bloquean.** Solo pueden venir
   de una vieja: nada nuevo llega a esa etapa sin factura. Si §7-M1 mide alguna **viva** (no entregada) sin factura, el
   chofer no podría recogerla ni entregarla hasta que le pongan la factura: por eso M1 va **antes** de aplicar.

## 3 · Inventario de lecturas y escrituras que toca

| Pieza | Qué | Cambia |
|---|---|---|
| `public.guard_factura_obligatoria()` | función nueva, `SECURITY DEFINER`, `search_path = public` | nueva |
| `deliveries_guard_invoice` | `BEFORE INSERT OR UPDATE ... FOR EACH ROW` en `deliveries` | nuevo |
| `public.settings.order_type_rules` | **lectura**, solo cuando la escritura ya iba a violar la regla | — |
| `guard_delivery_stage` (145), políticas de `deliveries`, `deliveries_borradas`, `order_events` | — | **no se tocan** |

**Orden de los disparadores:** los `BEFORE` corren por orden alfabético: `deliveries_guard_invoice` antes que
`deliveries_guard_stage` y `deliveries_touch`. Esta función no modifica `NEW`; si las dos rechazaran, llega el mensaje
de esta.

## 4 · Qué NO debe romperse

- Guardar borradores sin factura (D-049). Rechazar, anular (122) y volver a borrador sin factura.
- Intertienda (PO) y Transfer (estimación).
- Ponerle la factura a una orden desde la fila (125), también a las 5 viejas. Agregar material (138).
- Publicar la ruta (135): no cambia etapa ni factura.
- Todo lo del guard de etapas (145): ninguna fila de su matriz cambia, salvo que la orden sea Customer sin factura.

## 5 · El SQL, literal

Ver `146_customer_siempre_con_factura.sql`. La autocomprobación (`do $chk$`) mira el código **sin las líneas de
comentario** y con los espacios colapsados (lección de la 144), y exige: las tres salidas (borrador/rechazada/anulada,
con factura, vieja sin cambio de etapa ni tipo), la lectura de la regla con `invoice` por defecto y el rechazo; que la
función **no** mire el rol; el disparador puesto y activo; la premisa de que Customer pide `invoice` hoy; y que el guard
de etapas siga siendo el de la 145. Deja un `NOTICE` con cuántas Customer quedan sin factura fuera de borrador.

## 6 · Matriz de pruebas por rol, con ROLLBACK (la corre el orquestador)

**26 casos.** Crea sus órdenes dentro de la transacción; no depende de datos de producción ni los toca.

Sustituir:

- `<UUID-OFFICE>` (`accounting`), `<UUID-GERENTE>` (`manager`), `<UUID-VENTAS>` (`sales`), `<UUID-ADMIN>` (`admin`),
  `<UUID-CHOFER>` (`driver`).
- `<TIENDA>`: una tienda de `settings.stores` que **todos** esos usuarios vean (sin `visible_stores`, o con ella
  dentro) y que **no** apruebe sola (para que V1/V2 no dependan de `auto`). Si la lectura esconde la fila, el caso sale
  «MAL 0» por RLS, no por la regla.

Se pega entero en `psql` **desde la raíz del repo** (el `\i` es relativo). **Sin `commit` en ningún sitio.**

```sql
begin;

-- 0. La migración, dentro de la misma transacción (se deshace con el resto).
\i supabase/migrations/146_customer_siempre_con_factura.sql

-- 1. Datos de prueba, como postgres: auth.uid() es null y los dos guards los dejan pasar sin mirar (P1).
insert into public.deliveries (id, order_type, stage, store, pickup_name, account, created_by, est_pallets, invoice_num, po2, assigned_driver) values
  ('14600000-0000-4000-8000-000000000001','Customer',   'approved', '<TIENDA>','<TIENDA>','ENSAYO 146',null,3,null,null,null),        -- F4
  ('14600000-0000-4000-8000-000000000002','Customer',   'approved', '<TIENDA>','<TIENDA>','ENSAYO 146',null,3,'ENS-2',null,null),     -- F5
  ('14600000-0000-4000-8000-000000000003','Customer',   'approved', '<TIENDA>','<TIENDA>','ENSAYO 146',null,3,'ENS-3',null,null),     -- F6
  ('14600000-0000-4000-8000-000000000004','Intertienda','approved', '<TIENDA>','<TIENDA>','ENSAYO 146',null,3,null,'PO-4',null),      -- F7
  ('14600000-0000-4000-8000-000000000005','Customer',   'delivered','<TIENDA>','<TIENDA>','ENSAYO 146',null,3,null,null,null),        -- F8 (vieja)
  ('14600000-0000-4000-8000-000000000006','Customer',   'delivered','<TIENDA>','<TIENDA>','ENSAYO 146',null,3,null,null,null),        -- F9 (vieja)
  ('14600000-0000-4000-8000-000000000007','Customer',   'approved', '<TIENDA>','<TIENDA>','ENSAYO 146',null,3,null,null,null),        -- F10
  ('14600000-0000-4000-8000-000000000008','Customer',   'delivered','<TIENDA>','<TIENDA>','ENSAYO 146',null,3,null,null,null),        -- F11 (vieja)
  ('14600000-0000-4000-8000-000000000009','Customer',   'draft',    '<TIENDA>','<TIENDA>','ENSAYO 146','<UUID-GERENTE>',3,null,null,null), -- G1
  ('14600000-0000-4000-8000-000000000010','Customer',   'pending',  '<TIENDA>','<TIENDA>','ENSAYO 146',null,3,null,null,null),        -- G2
  ('14600000-0000-4000-8000-000000000011','Customer',   'draft',    '<TIENDA>','<TIENDA>','ENSAYO 146','<UUID-GERENTE>',3,null,null,null), -- G3
  ('14600000-0000-4000-8000-000000000012','Customer',   'approved', '<TIENDA>','<TIENDA>','ENSAYO 146','<UUID-VENTAS>',3,null,null,null),  -- V3
  ('14600000-0000-4000-8000-000000000013','Customer',   'draft',    '<TIENDA>','<TIENDA>','ENSAYO 146',null,3,null,null,null),        -- A1
  ('14600000-0000-4000-8000-000000000014','Customer',   'delivered','<TIENDA>','<TIENDA>','ENSAYO 146',null,3,null,null,null),        -- A3 (vieja)
  ('14600000-0000-4000-8000-000000000015','Customer',   'picked_up','<TIENDA>','<TIENDA>','ENSAYO 146',null,3,null,null,(select full_name from public.profiles where id='<UUID-CHOFER>')),    -- D1
  ('14600000-0000-4000-8000-000000000016','Customer',   'picked_up','<TIENDA>','<TIENDA>','ENSAYO 146',null,3,'ENS-16',null,(select full_name from public.profiles where id='<UUID-CHOFER>')); -- D2
do $$ begin raise notice 'P1  postgres INSERT Customer sin factura (sin sesion)  esperado: paso -> OK'; end $$;

set local role authenticated;

-- 2. OFFICE (accounting)
set local request.jwt.claims to '{"sub":"<UUID-OFFICE>","role":"authenticated"}';
do $$
declare n int;
begin
  begin insert into public.deliveries (order_type, stage, store, pickup_name, account, est_pallets) values ('Customer','approved','<TIENDA>','<TIENDA>','ENSAYO 146',3);
    raise notice 'F1  crear Customer aprobada SIN factura (NUEVO)   esperado ERROR: MAL, paso';
  exception when others then raise notice 'F1  esperado ERROR: %', case when sqlerrm like 'INVOICE_REQUIRED%' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
  begin insert into public.deliveries (order_type, stage, store, pickup_name, account, est_pallets, invoice_num) values ('Customer','approved','<TIENDA>','<TIENDA>','ENSAYO 146',3,'ENS-F2'); get diagnostics n = row_count;
    raise notice 'F2  crear Customer aprobada CON factura           esperado 1 fila: %', case when n=1 then 'OK' else 'MAL '||n end;
  exception when others then raise notice 'F2  MAL: %', sqlerrm; end;
  begin insert into public.deliveries (order_type, stage, store, pickup_name, account, est_pallets) values ('Customer','draft','<TIENDA>','<TIENDA>','ENSAYO 146',3); get diagnostics n = row_count;
    raise notice 'F3  crear Customer BORRADOR sin factura           esperado 1 fila: %', case when n=1 then 'OK' else 'MAL '||n end;
  exception when others then raise notice 'F3  MAL: %', sqlerrm; end;
  begin update public.deliveries set stage='delivered' where id='14600000-0000-4000-8000-000000000001';
    raise notice 'F4  entregar ya SIN factura (NUEVO)               esperado ERROR: MAL, paso';
  exception when others then raise notice 'F4  esperado ERROR: %', case when sqlerrm like 'INVOICE_REQUIRED%' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
  begin update public.deliveries set stage='delivered' where id='14600000-0000-4000-8000-000000000002'; get diagnostics n = row_count;
    raise notice 'F5  entregar ya CON factura (igual)               esperado 1 fila: %', case when n=1 then 'OK' else 'MAL '||n end;
  exception when others then raise notice 'F5  MAL: %', sqlerrm; end;
  begin update public.deliveries set invoice_num='' where id='14600000-0000-4000-8000-000000000003';
    raise notice 'F6  vaciar la factura de una aprobada (NUEVO)     esperado ERROR: MAL, paso';
  exception when others then raise notice 'F6  esperado ERROR: %', case when sqlerrm like 'INVOICE_REQUIRED%' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
  begin update public.deliveries set order_type='Customer' where id='14600000-0000-4000-8000-000000000004';
    raise notice 'F7  Intertienda viva -> Customer sin factura (NUEVO) esperado ERROR: MAL, paso';
  exception when others then raise notice 'F7  esperado ERROR: %', case when sqlerrm like 'INVOICE_REQUIRED%' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
  begin update public.deliveries set delivery_notes='ensayo 146' where id='14600000-0000-4000-8000-000000000005'; get diagnostics n = row_count;
    raise notice 'F8  vieja sin factura: una nota (igual)           esperado 1 fila: %', case when n=1 then 'OK' else 'MAL '||n end;
  exception when others then raise notice 'F8  MAL: %', sqlerrm; end;
  begin update public.deliveries set invoice_num='ENS-F9' where id='14600000-0000-4000-8000-000000000006'; get diagnostics n = row_count;
    raise notice 'F9  vieja sin factura: ponerle la factura (igual) esperado 1 fila: %', case when n=1 then 'OK' else 'MAL '||n end;
  exception when others then raise notice 'F9  MAL: %', sqlerrm; end;
  begin update public.deliveries set stage='canceled', canceled_reason='other', canceled_reason_note='ensayo 146' where id='14600000-0000-4000-8000-000000000007'; get diagnostics n = row_count;
    raise notice 'F10 anular una aprobada sin factura (igual)       esperado 1 fila: %', case when n=1 then 'OK' else 'MAL '||n end;
  exception when others then raise notice 'F10 MAL: %', sqlerrm; end;
  begin update public.deliveries set stage='picked_up' where id='14600000-0000-4000-8000-000000000008';
    raise notice 'F11 vieja sin factura: deshacer un paso (NUEVO)   esperado ERROR: MAL, paso';
  exception when others then raise notice 'F11 esperado ERROR: %', case when sqlerrm like 'INVOICE_REQUIRED%' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
  begin insert into public.deliveries (order_type, stage, store, pickup_name, account, est_pallets) values ('Transfer','approved','<TIENDA>','<TIENDA>','ENSAYO 146',3); get diagnostics n = row_count;
    raise notice 'F12 crear Transfer aprobada sin factura (igual)   esperado 1 fila: %', case when n=1 then 'OK' else 'MAL '||n end;
  exception when others then raise notice 'F12 MAL: %', sqlerrm; end;
  begin insert into public.deliveries (order_type, stage, store, pickup_name, account, est_pallets, po2) values ('Intertienda','approved','<TIENDA>','<TIENDA>','ENSAYO 146',3,'PO-F13'); get diagnostics n = row_count;
    raise notice 'F13 crear Intertienda aprobada sin factura (igual) esperado 1 fila: %', case when n=1 then 'OK' else 'MAL '||n end;
  exception when others then raise notice 'F13 MAL: %', sqlerrm; end;
end $$;

-- 3. GERENTE
set local request.jwt.claims to '{"sub":"<UUID-GERENTE>","role":"authenticated"}';
do $$
begin
  begin update public.deliveries set stage='approved' where id='14600000-0000-4000-8000-000000000009';
    raise notice 'G1  borrador -> aprobada sin factura (NUEVO)      esperado ERROR: MAL, paso';
  exception when others then raise notice 'G1  esperado ERROR: %', case when sqlerrm like 'INVOICE_REQUIRED%' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
  begin update public.deliveries set stage='approved' where id='14600000-0000-4000-8000-000000000010';
    raise notice 'G2  pendiente -> aprobada sin factura (NUEVO)     esperado ERROR: MAL, paso';
  exception when others then raise notice 'G2  esperado ERROR: %', case when sqlerrm like 'INVOICE_REQUIRED%' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
  begin update public.deliveries set stage='pending' where id='14600000-0000-4000-8000-000000000011';
    raise notice 'G3  borrador -> pendiente sin factura (NUEVO)     esperado ERROR: MAL, paso';
  exception when others then raise notice 'G3  esperado ERROR: %', case when sqlerrm like 'INVOICE_REQUIRED%' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
end $$;

-- 4. VENTAS
set local request.jwt.claims to '{"sub":"<UUID-VENTAS>","role":"authenticated"}';
do $$
declare n int;
begin
  begin insert into public.deliveries (order_type, stage, store, pickup_name, account, est_pallets) values ('Customer','pending','<TIENDA>','<TIENDA>','ENSAYO 146',3);
    raise notice 'V1  crear Customer pendiente SIN factura (NUEVO)  esperado ERROR: MAL, paso';
  exception when others then raise notice 'V1  esperado ERROR: %', case when sqlerrm like 'INVOICE_REQUIRED%' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
  begin insert into public.deliveries (order_type, stage, store, pickup_name, account, est_pallets, invoice_num) values ('Customer','pending','<TIENDA>','<TIENDA>','ENSAYO 146',3,'ENS-V2'); get diagnostics n = row_count;
    raise notice 'V2  crear Customer pendiente CON factura (igual)  esperado 1 fila: %', case when n=1 then 'OK' else 'MAL '||n end;
  exception when others then raise notice 'V2  MAL: %', sqlerrm; end;
  begin update public.deliveries set invoice_num='ENS-V3' where id='14600000-0000-4000-8000-000000000012'; get diagnostics n = row_count;
    raise notice 'V3  poner la factura que falta en SU orden (125)  esperado 1 fila: %', case when n=1 then 'OK' else 'MAL '||n end;
  exception when others then raise notice 'V3  MAL: %', sqlerrm; end;
end $$;

-- 5. ADMIN
set local request.jwt.claims to '{"sub":"<UUID-ADMIN>","role":"authenticated"}';
do $$
declare n int;
begin
  begin update public.deliveries set stage='delivered' where id='14600000-0000-4000-8000-000000000013';
    raise notice 'A1  admin fuerza borrador -> entregada (NUEVO)    esperado ERROR: MAL, paso';
  exception when others then raise notice 'A1  esperado ERROR: %', case when sqlerrm like 'INVOICE_REQUIRED%' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
  begin insert into public.deliveries (order_type, stage, store, pickup_name, account, est_pallets) values ('Customer','approved','<TIENDA>','<TIENDA>','ENSAYO 146',3);
    raise notice 'A2  admin crea Customer aprobada SIN factura (NUEVO) esperado ERROR: MAL, paso';
  exception when others then raise notice 'A2  esperado ERROR: %', case when sqlerrm like 'INVOICE_REQUIRED%' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
  begin update public.deliveries set delivery_notes='ensayo 146' where id='14600000-0000-4000-8000-000000000014'; get diagnostics n = row_count;
    raise notice 'A3  admin: nota en una vieja sin factura (igual)  esperado 1 fila: %', case when n=1 then 'OK' else 'MAL '||n end;
  exception when others then raise notice 'A3  MAL: %', sqlerrm; end;
end $$;

-- 6. CHOFER
set local request.jwt.claims to '{"sub":"<UUID-CHOFER>","role":"authenticated"}';
do $$
declare n int;
begin
  begin update public.deliveries set stage='delivered' where id='14600000-0000-4000-8000-000000000015';
    raise notice 'D1  chofer entrega una SIN factura (NUEVO)        esperado ERROR: MAL, paso';
  exception when others then raise notice 'D1  esperado ERROR: %', case when sqlerrm like 'INVOICE_REQUIRED%' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
  begin update public.deliveries set stage='delivered' where id='14600000-0000-4000-8000-000000000016'; get diagnostics n = row_count;
    raise notice 'D2  chofer entrega una CON factura (igual)        esperado 1 fila: %', case when n=1 then 'OK' else 'MAL '||n end;
  exception when others then raise notice 'D2  MAL: %', sqlerrm; end;
end $$;

ROLLBACK;
```

**Resumen de lo que debe salir — 26 casos, cada línea tiene que decir `OK`:**

| Esperado | Casos | Cuántos |
|---|---|---|
| paso / 1 fila | P1, F2, F3, F5, F8, F9, F10, F12, F13, V2, V3, A3, D2 | 13 |
| ERROR `INVOICE_REQUIRED` | F1, F4, F6, F7, F11, G1, G2, G3, V1, A1, A2, D1 | 13 |

**Cambian respecto de hoy (13):** los 13 de ERROR. Hoy pasan todos (F6 y F7 como office, que hoy edita cualquier
etapa; A1/A2 porque el admin se salta el guard).
**Recomendado:** correr el mismo bloque **sin** el `\i` (base de hoy) y guardar la salida: tienen que diferir
exactamente esos 13, que hoy dirán «MAL, paso».

**Si algún MAL no es de los esperados, parar**: no aplicar. En particular, un ERROR con otro mensaje (el del guard de
etapas o de RLS) significa que el caso no mide lo que dice: revisar `<TIENDA>` y los usuarios.

## 7 · Mediciones de solo lectura (para el orquestador; NO corridas)

```sql
-- M1. ANTES DE APLICAR: Customer fuera de borrador sin factura, por etapa. Las VIVAS (no entregadas) se quedarían
--     sin poder moverse (ni el chofer) hasta ponerles la factura: si sale alguna, decidir antes.
select stage, count(*), array_agg(order_no order by order_no) as ordenes
  from public.deliveries
 where order_type = 'Customer' and stage not in ('draft','rejected','canceled')
   and coalesce(btrim(invoice_num), '') = ''
 group by stage order by stage;

-- M2. La premisa de la decisión 2: la fila de Ajustes y la regla de cada tipo.
select id, order_type_rules from public.settings;

-- M3. Los disparadores de deliveries (tiene que salir deliveries_guard_invoice después de aplicar).
select tgname, tgenabled from pg_trigger where tgrelid = 'public.deliveries'::regclass and not tgisinternal order by tgname;

-- M4. Tipos en uso sin regla explícita (la base no los exigiría; la app, por palabras clave, sí).
select d.order_type, count(*) from public.deliveries d
 where not exists (select 1 from public.settings s where s.order_type_rules ? d.order_type)
 group by 1;
```

## 8 · Reversión

En una transacción propia, a mano (también comentada al final del `.sql`):

```sql
drop trigger if exists deliveries_guard_invoice on public.deliveries;
drop function if exists public.guard_factura_obligatoria();
delete from public.schema_migrations where name = '146_customer_siempre_con_factura.sql';
```

La pantalla sigue exigiendo la factura por su cuenta (`factura-obligatoria.ts`); revertir la base no la afloja. Para
aflojar también la pantalla, revertir el commit.

## 9 · Las 5 viejas y la pestaña «Factura pendiente»

**No se tocan** (dato de producción). Con todos los caminos cerrados, ninguna Customer nueva puede quedar pendiente de
factura; las 5 seguirán en la pestaña hasta que alguien les ponga la factura. **Cómo se arreglan**: desde la propia
pestaña «Factura pendiente», escribiendo el número en la fila (D-310/D-380) — lo puede hacer office o el gerente en
cualquiera, y ventas en las suyas (125). La 146 lo deja pasar (F9, V3). Cuando las 5 tengan factura, la pestaña se
vacía y desaparece sola (solo se pinta con algo dentro, D-313).

**No se esconden las Customer de la pestaña.** Sería esconder justo el problema que hay que arreglar.

## 10 · Lo que NO se ha medido

- **Nada contra la base.** La 146 no está aplicada ni ensayada; la autocomprobación no ha corrido en Postgres (una prueba
  del repo reconstruye lo que busca contra el código sin comentarios; no sustituye aplicarla).
- **M1-M4 sin correr.** En particular, si hay Customer **vivas** sin factura (M1).
- **Las inserciones de la matriz** asumen que las políticas de `deliveries` dejan insertar a office, ventas y admin con
  esas columnas; si alguna exige otra columna, el caso saldrá con otro error (ver §6).
