# Plan 145 · El gerente hace el proceso de bodega (Preparar, Listo, Recogida)

Plan en papel exigido por `CLAUDE.md` («Antes de tocar RLS, triggers o permisos en producción»).
Molde: `docs/PLAN-142-deshacer-y-borradores.md`.

**Estado (2026-09-25):** escrito por un worker en un worktree **sin `.env.local` y sin acceso a la base**. Todo lo
de este documento sale de **leer el repo** (`origin/main` = `10e65adc`) y de medir el **demo local**. Nada se ha
ejecutado contra producción: el ensayo de §6 y las mediciones de §7 son para el orquestador. **Pendiente de aprobar.**

**Pedido del dueño (2026-09-25), literal:** *«Como gerente quiero poder hacer el proceso de bodega cuando necesario.
Ahorita solo permite brincar a Delivered pero no me deja poner Prepare, Ready, Pickup, etc. Esto es de office manager,
hazlo»*.

**La migración está escrita y NO aplicada:** `supabase/migrations/145_gerente_hace_bodega.sql`. Solo redefine
`public.guard_delivery_stage()`. Sin columnas, tablas, políticas ni funciones nuevas.

---

## 0 · Resumen

| | Hoy (142) | Con la 145 |
|---|---|---|
| Gerente `approved → fulfilling` («Comenzar preparación») | ✗ la base lo rechaza, la ficha no lo ofrece | ✓ en cualquier tienda que vea |
| Gerente `fulfilling → ready` («Marcar listo», con los pallets reales) | ✗ / ✗ | ✓ |
| Gerente `ready → picked_up` («Recoger», con el recuento) | ✗ / ✗ | ✓ |
| Gerente `picked_up → delivered` | ✓ «Marcar entregada ya» (139) | igual |
| Gerente entregar ya / deshacer un paso | ✓ (139) | igual |
| Office (`accounting`) | entrega ya y deshace, no avanza | **igual**: no avanza |
| Almacén, chofer, ventas, logística, admin | — | **idénticos** |

Y un arreglo de cliente sin base, encontrado al medir (§9): **«Marcar entregada ya» desde `approved`, `fulfilling` y
`ready` no salía del navegador** desde D-361: `LEGAL_TRANSITIONS` no tenía el salto y los dos proveedores lo rechazaban
con «This order must be approved by a manager first.». Solo funcionaba desde `picked_up`.

---

## 1 · Qué ve y qué puede hacer el gerente HOY

- **La ficha** (`OrderModal.tsx`, `StageActions`): «Comenzar preparación» y «Marcar listo» salían con `canFulfill(me)`,
  y «Recoger» con `canDeliver(me)`. `ROLE_CAPS.manager = ["create", "approve", "dashboard"]`: ni `fulfill` ni `deliver`.
  Así que el gerente veía «✓ Marcar entregada ya» y «↩ Deshacer etapa» (139) y ningún paso de avance.
- **La base** (142, la última que define el guard): la rama de cambios de etapa de `manager`/`accounting` tiene
  enviar/volver a borrador, anular (122), aprobar/rechazar/desbloquear (118, 127), entregar ya y deshacer (139). **Ningún
  paso hacia delante.** Un `approved → fulfilling` del gerente cae en
  `raise exception '% cannot move an order from % to %'`.
- **Lo que la recogida escribe además de la etapa** —`pickup_gps_at`, `pickup_lat/lng`, `actual_pallets`, y en carga
  partida `order_suffix`— va en la misma fila que el cambio de etapa; el guard no mira columnas en un cambio de etapa.
  La carga partida hace además un `INSERT` con `order_suffix` en `ready`, que el guard ya admite para `manager`
  (`r in ('warehouse','driver','logistics','manager','accounting') and new_stage in ('ready','approved','fulfilling')`).

## 2 · Qué se propone

### 2a. El guard (la 145)

Dentro del sub-bloque `if r in ('manager','accounting') then`, después del deshacer de la 139, **una rama nueva**:

```sql
      if r = 'manager'
         and ((old_stage = 'approved'   and new_stage = 'fulfilling')
           or (old_stage = 'fulfilling' and new_stage = 'ready')
           or (old_stage = 'ready'      and new_stage = 'picked_up')) then return NEW; end if;
```

Es lo único que cambia. El resto del guard es **el de la 142 letra por letra**; lo comprueba una prueba del repo
(`gerente-hace-bodega.test.ts`: «quitando la rama 145, el guard es el de la 142») y, al aplicar, la autocomprobación del
propio `.sql`.

### 2b. Dos decisiones, con su motivo (para validar)

1. **Solo `manager`, no `accounting`.** El dueño lo pidió para el Office Manager («esto es de office manager»). D-279 puso
   a office en las mismas listas que el gerente para **crear y aprobar**; la 139 y la 142 también los tratan igual, pero
   ahí el dueño los nombró a los dos («si office incluye al gerente»). Aquí no. **Si office también debe hacer bodega**,
   es añadir `'accounting'` a esta rama y a `gerenteHaceBodega` en la app — una línea en cada sitio y otra migración.
2. **En cualquier tienda que vea, sin `orden_de_mis_tiendas`.**
   - El gerente **ya** lleva una orden de `approved` a `delivered` de un salto en cualquier tienda (139). Acotar los pasos
     de en medio le dejaría entregar de golpe en otra tienda pero no prepararla: un límite que no limita.
   - Almacén avanza en cualquier tienda (142: «hacia delante, idéntico y en cualquier tienda»). Lo que la 142 acotó por
     tienda fue el **deshacer** de almacén, no el avanzar.
   - **2 gerentes no tienen tienda** (medido por el orquestador el 2026-09-23, D-377). Con límite de tienda no podrían
     hacer bodega en ninguna orden.
   - Lo que el gerente ve ya lo acota la lectura (131, `visible_stores`): la base no deja escribir en una fila que no ve.

### 2c. La pantalla

- `src/lib/constants.ts`: `gerenteHaceBodega(r)` (= `manager`), `preparaEnLaFicha(u)` (= `canFulfill(u)` o gerente) y
  `recogeEnLaFicha(u)` (= `canDeliver(u)` o gerente).
- `OrderModal.tsx`, `StageActions`: «Comenzar preparación» y «Marcar listo» salen con `preparaEnLaFicha`; «Recoger» con
  `recogeEnLaFicha`. **«Iniciar viaje» / «En camino» siguen siendo de `canDeliver`**: son tiempos del chofer y estamparlos
  desde la oficina falsearía el KPI de trayecto a la recogida.
- **No se toca `ROLE_CAPS`.** Dar `fulfill`/`deliver` al gerente le abriría la pantalla de Almacén, la de Chofer
  (`driver/page.tsx` mira `canDeliver`), «Mi ruta», «Dejar en tienda», las fotos de prueba y «Marcar entregado» con POD. No
  se pidió nada de eso.
- `LEGAL_TRANSITIONS`: `approved`, `fulfilling` y `ready` ganan `delivered` (§9).

### 2d. Lo que pide cada paso, y lo que hace el gerente sin eso

| Paso | Almacén | Gerente |
|---|---|---|
| Comenzar preparación | un clic | igual |
| Marcar listo | diálogo con los **pallets reales** (obligatorio, > 0) | igual: el mismo diálogo, con la tarjeta del chofer asignado |
| Recoger | **dos pasos**: cuántos pallets se cargaron (si son menos, **parte la carga** en #Na y #Nb) | igual. Estampa `pickup_gps_at` (la hora) y, si el navegador da posición, `pickup_lat/lng`: **nunca bloquea**, espera 1,2 s como máximo. No reclama chofer: eso solo lo hace un chofer (`claimDelChofer`) |
| Iniciar viaje | sí | **no se le ofrece** |
| Entregar | «Marcar entregado», con POD si Ajustes lo pide (fotos, firma, GPS) | **«Marcar entregada ya»** (139): motivo obligatorio, **sin firma ni GPS**. No se le ofrece «Marcar entregado» |

**Ojo, para validar:** el último paso del gerente pide **motivo**, porque va por «entregar ya». Es la misma decisión que
D-383 tomó con «Dejar en tienda»: dos botones para el mismo salto serían el mismo camino con otro nombre. Si el dueño
quiere un «Marcar entregado» del gerente **sin motivo** en `picked_up`, es pantalla sola (la base ya lo deja).

## 3 · Inventario de lecturas y escrituras que toca

| Pieza | Qué | Cambia |
|---|---|---|
| `public.guard_delivery_stage()` | trigger `BEFORE INSERT OR UPDATE` en `deliveries` | la rama 145 |
| `deliveries` UPDATE de etapa por `manager` | `approved→fulfilling`, `fulfilling→ready` (+ `actual_pallets`), `ready→picked_up` (+ `pickup_gps_at`, `pickup_lat/lng`, `actual_pallets`, `order_suffix`) | antes fallaban |
| `deliveries` INSERT de carga partida por `manager` | `order_suffix` en `ready` | no (ya pasaba) |
| `order_events` | el evento de cada paso lo escribe la app como hasta ahora | no |
| RLS de `deliveries`, `orden_de_mis_tiendas`, política de borrar, `deliveries_borradas` | — | **no se tocan** |

## 4 · Qué NO debe romperse

- La invariante de la 122 (una entregada no se anula), **antes** de la salida de admin.
- El candado de `created_by` (142), después de la salida de admin.
- El deshacer de almacén **acotado a sus tiendas** (142) y su `picked_up→ready` sin tienda (D-224).
- Entregar ya y deshacer de office y gerente (139); lo de la 138 (agregar material), 127, 125 y 123.
- Office no gana nada. Ventas, chofer y logística siguen sin avanzar lo que no avanzaban.
- **Dos pasos de golpe siguen prohibidos** para el gerente (`approved→ready`, `fulfilling→picked_up`), y no se salta la
  aprobación (`pending→fulfilling`, `draft→fulfilling`).

## 5 · El guard, literal

Ver `145_gerente_hace_bodega.sql`. Diferencia con la 142 = **solo** el bloque marcado `-- 145:` (7 líneas, 3 de
comentario). La autocomprobación (`do $chk$`) mira el código **sin las líneas de comentario** (lección de la 144) y con
los espacios colapsados, y exige: la rama entera, dentro del sub-bloque de gerente y office y antes de almacén;
`approved→fulfilling` **exactamente dos veces** (almacén y gerente: una tercera sería otro rol avanzando); y todo lo de
122, 123, 125, 127, 138, 139 y 142.

## 6 · Matriz de pruebas por rol, con ROLLBACK (la corre el orquestador)

**26 casos.** Crea sus órdenes dentro de la transacción; no depende de datos de producción ni los toca.

Sustituir:

- `<UUID-GERENTE>` (`manager`, **con** tienda), `<UUID-OFFICE>` (`accounting`), `<UUID-ALMACEN>` (`warehouse`, con
  tienda), `<UUID-CHOFER>` (`driver`), `<UUID-VENTAS>` (`sales`), `<UUID-LOGISTICA>` (`logistics`).
- `<TIENDA-B>`: una tienda de `settings.stores` que **no** sea ni esté en el grupo del gerente ni del almacenista.
- El gerente, office, ventas, chofer y logística tienen que **ver** `<TIENDA-B>` (sin `visible_stores`, o con ella
  dentro), y el chofer tiene que ver las órdenes que se le asignan (se ponen a su nombre abajo). Si no, sus casos salen
  «MAL 0» porque la lectura esconde la fila, no porque la regla falle.

Se pega entero en `psql` **desde la raíz del repo** (el `\i` es relativo). **Sin `commit` en ningún sitio.**

```sql
begin;

-- 0. La migración, dentro de la misma transacción (se deshace con el resto).
\i supabase/migrations/145_gerente_hace_bodega.sql

-- 1. Datos de prueba, como postgres: auth.uid() es null y el guard los deja pasar sin mirar.
--    G = tienda del gerente. assigned_driver al chofer para que su lectura las vea.
insert into public.deliveries (id, stage, store, pickup_name, account, created_by, est_pallets, assigned_driver) values
  ('14500000-0000-4000-8000-000000000001','approved',  (select store from public.profiles where id='<UUID-GERENTE>'),(select store from public.profiles where id='<UUID-GERENTE>'),'ENSAYO 145',null,4,null),
  ('14500000-0000-4000-8000-000000000002','approved',  '<TIENDA-B>','<TIENDA-B>','ENSAYO 145',null,4,null),
  ('14500000-0000-4000-8000-000000000003','fulfilling','<TIENDA-B>','<TIENDA-B>','ENSAYO 145',null,4,null),
  ('14500000-0000-4000-8000-000000000004','ready',     '<TIENDA-B>','<TIENDA-B>','ENSAYO 145',null,4,null),
  ('14500000-0000-4000-8000-000000000005','picked_up', '<TIENDA-B>','<TIENDA-B>','ENSAYO 145',null,4,null),
  ('14500000-0000-4000-8000-000000000006','approved',  '<TIENDA-B>','<TIENDA-B>','ENSAYO 145',null,4,null),
  ('14500000-0000-4000-8000-000000000007','delivered', '<TIENDA-B>','<TIENDA-B>','ENSAYO 145',null,4,null),
  ('14500000-0000-4000-8000-000000000008','fulfilling','<TIENDA-B>','<TIENDA-B>','ENSAYO 145',null,4,null),
  ('14500000-0000-4000-8000-000000000009','approved',  '<TIENDA-B>','<TIENDA-B>','ENSAYO 145',null,4,null),
  ('14500000-0000-4000-8000-000000000010','fulfilling','<TIENDA-B>','<TIENDA-B>','ENSAYO 145',null,4,null),
  ('14500000-0000-4000-8000-000000000011','pending',   '<TIENDA-B>','<TIENDA-B>','ENSAYO 145',null,4,null),
  ('14500000-0000-4000-8000-000000000012','draft',     '<TIENDA-B>','<TIENDA-B>','ENSAYO 145','<UUID-GERENTE>',4,null),
  ('14500000-0000-4000-8000-000000000013','ready',     '<TIENDA-B>','<TIENDA-B>','ENSAYO 145',null,4,null),
  ('14500000-0000-4000-8000-000000000014','approved',  '<TIENDA-B>','<TIENDA-B>','ENSAYO 145',null,4,null),
  ('14500000-0000-4000-8000-000000000015','approved',  '<TIENDA-B>','<TIENDA-B>','ENSAYO 145',null,4,null),
  ('14500000-0000-4000-8000-000000000016','fulfilling','<TIENDA-B>','<TIENDA-B>','ENSAYO 145',null,4,null),
  ('14500000-0000-4000-8000-000000000017','ready',     '<TIENDA-B>','<TIENDA-B>','ENSAYO 145',null,4,null),
  ('14500000-0000-4000-8000-000000000018','approved',  '<TIENDA-B>','<TIENDA-B>','ENSAYO 145',null,4,null),
  ('14500000-0000-4000-8000-000000000019','approved',  '<TIENDA-B>','<TIENDA-B>','ENSAYO 145',null,4,null),
  ('14500000-0000-4000-8000-000000000020','ready',     '<TIENDA-B>','<TIENDA-B>','ENSAYO 145',null,4,null),
  ('14500000-0000-4000-8000-000000000021','fulfilling','<TIENDA-B>','<TIENDA-B>','ENSAYO 145',null,4,null),
  ('14500000-0000-4000-8000-000000000022','ready',     '<TIENDA-B>','<TIENDA-B>','ENSAYO 145',null,4,(select full_name from public.profiles where id='<UUID-CHOFER>')),
  ('14500000-0000-4000-8000-000000000023','approved',  '<TIENDA-B>','<TIENDA-B>','ENSAYO 145',null,4,(select full_name from public.profiles where id='<UUID-CHOFER>')),
  ('14500000-0000-4000-8000-000000000024','approved',  '<TIENDA-B>','<TIENDA-B>','ENSAYO 145',null,4,null),
  ('14500000-0000-4000-8000-000000000025','approved',  '<TIENDA-B>','<TIENDA-B>','ENSAYO 145',null,4,null);

set local role authenticated;

-- 2. GERENTE (con tienda)
set local request.jwt.claims to '{"sub":"<UUID-GERENTE>","role":"authenticated"}';
do $$
declare n int;
begin
  -- Tienen que PASAR (1 fila)
  begin update public.deliveries set stage='fulfilling' where id='14500000-0000-4000-8000-000000000001'; get diagnostics n = row_count;
    raise notice 'G1  approved->fulfilling, SU tienda (NUEVO)       esperado 1 fila: %', case when n=1 then 'OK' else 'MAL '||n end;
  exception when others then raise notice 'G1  MAL: %', sqlerrm; end;
  begin update public.deliveries set stage='fulfilling' where id='14500000-0000-4000-8000-000000000002'; get diagnostics n = row_count;
    raise notice 'G2  approved->fulfilling, OTRA tienda (NUEVO)     esperado 1 fila: %', case when n=1 then 'OK' else 'MAL '||n end;
  exception when others then raise notice 'G2  MAL: %', sqlerrm; end;
  begin update public.deliveries set stage='ready', actual_pallets=4 where id='14500000-0000-4000-8000-000000000003'; get diagnostics n = row_count;
    raise notice 'G3  fulfilling->ready + pallets reales (NUEVO)    esperado 1 fila: %', case when n=1 then 'OK' else 'MAL '||n end;
  exception when others then raise notice 'G3  MAL: %', sqlerrm; end;
  begin update public.deliveries set stage='picked_up', actual_pallets=4, pickup_gps_at=now() where id='14500000-0000-4000-8000-000000000004'; get diagnostics n = row_count;
    raise notice 'G4  ready->picked_up + hora de recogida (NUEVO)   esperado 1 fila: %', case when n=1 then 'OK' else 'MAL '||n end;
  exception when others then raise notice 'G4  MAL: %', sqlerrm; end;
  begin update public.deliveries set stage='delivered' where id='14500000-0000-4000-8000-000000000005'; get diagnostics n = row_count;
    raise notice 'G5  picked_up->delivered (139, igual)             esperado 1 fila: %', case when n=1 then 'OK' else 'MAL '||n end;
  exception when others then raise notice 'G5  MAL: %', sqlerrm; end;
  begin update public.deliveries set stage='delivered' where id='14500000-0000-4000-8000-000000000006'; get diagnostics n = row_count;
    raise notice 'G6  approved->delivered, entregar ya (igual)      esperado 1 fila: %', case when n=1 then 'OK' else 'MAL '||n end;
  exception when others then raise notice 'G6  MAL: %', sqlerrm; end;
  begin update public.deliveries set stage='picked_up' where id='14500000-0000-4000-8000-000000000007'; get diagnostics n = row_count;
    raise notice 'G7  delivered->picked_up, deshacer (igual)        esperado 1 fila: %', case when n=1 then 'OK' else 'MAL '||n end;
  exception when others then raise notice 'G7  MAL: %', sqlerrm; end;
  begin update public.deliveries set stage='approved' where id='14500000-0000-4000-8000-000000000008'; get diagnostics n = row_count;
    raise notice 'G8  fulfilling->approved, deshacer (igual)        esperado 1 fila: %', case when n=1 then 'OK' else 'MAL '||n end;
  exception when others then raise notice 'G8  MAL: %', sqlerrm; end;
  -- Carga partida: el resto como orden nueva en 'ready' con la letra siguiente (ya pasaba).
  begin insert into public.deliveries (stage, store, pickup_name, account, order_no, order_suffix, est_pallets)
      values ('ready','<TIENDA-B>','<TIENDA-B>','ENSAYO 145',
              (select order_no from public.deliveries where id='14500000-0000-4000-8000-000000000004'),'b',1);
    get diagnostics n = row_count;
    raise notice 'G11 carga partida: INSERT con order_suffix (igual) esperado 1 fila: %', case when n=1 then 'OK' else 'MAL '||n end;
  exception when others then raise notice 'G11 MAL: %', sqlerrm; end;
  -- Tienen que FALLAR
  begin update public.deliveries set stage='ready' where id='14500000-0000-4000-8000-000000000009';
    raise notice 'G9  approved->ready (dos pasos)                   esperado ERROR: MAL, paso';
  exception when others then raise notice 'G9  esperado ERROR: OK (%)', sqlerrm; end;
  begin update public.deliveries set stage='picked_up' where id='14500000-0000-4000-8000-000000000010';
    raise notice 'G10 fulfilling->picked_up (dos pasos)             esperado ERROR: MAL, paso';
  exception when others then raise notice 'G10 esperado ERROR: OK (%)', sqlerrm; end;
  begin update public.deliveries set stage='fulfilling' where id='14500000-0000-4000-8000-000000000011';
    raise notice 'G13 pending->fulfilling (se salta aprobar)        esperado ERROR: MAL, paso';
  exception when others then raise notice 'G13 esperado ERROR: OK (%)', sqlerrm; end;
  begin update public.deliveries set stage='fulfilling' where id='14500000-0000-4000-8000-000000000012';
    raise notice 'G14 draft->fulfilling (se salta aprobar)          esperado ERROR: MAL, paso';
  exception when others then raise notice 'G14 esperado ERROR: OK (%)', sqlerrm; end;
  begin update public.deliveries set stage='fulfilling' where id='14500000-0000-4000-8000-000000000013'; get diagnostics n = row_count;
    raise notice 'G15 ready->fulfilling es DESHACER (139, igual)    esperado 1 fila: %', case when n=1 then 'OK' else 'MAL '||n end;
  exception when others then raise notice 'G15 MAL: %', sqlerrm; end;
end $$;

-- 2b. GERENTE SIN TIENDA: se le quita la tienda como postgres, dentro de la transaccion.
reset role;
set local request.jwt.claims to '{}';
update public.profiles set store = null where id = '<UUID-GERENTE>';
set local role authenticated;
set local request.jwt.claims to '{"sub":"<UUID-GERENTE>","role":"authenticated"}';
do $$
declare n int;
begin
  begin update public.deliveries set stage='fulfilling' where id='14500000-0000-4000-8000-000000000014'; get diagnostics n = row_count;
    raise notice 'G12 SIN tienda: approved->fulfilling (NUEVO)      esperado 1 fila: %', case when n=1 then 'OK' else 'MAL '||n end;
  exception when others then raise notice 'G12 MAL: %', sqlerrm; end;
end $$;

-- 3. OFFICE (accounting): no gana nada
set local request.jwt.claims to '{"sub":"<UUID-OFFICE>","role":"authenticated"}';
do $$
declare n int;
begin
  begin update public.deliveries set stage='fulfilling' where id='14500000-0000-4000-8000-000000000015';
    raise notice 'O1  office approved->fulfilling                   esperado ERROR: MAL, paso';
  exception when others then raise notice 'O1  esperado ERROR: OK (%)', sqlerrm; end;
  begin update public.deliveries set stage='ready' where id='14500000-0000-4000-8000-000000000016';
    raise notice 'O2  office fulfilling->ready                      esperado ERROR: MAL, paso';
  exception when others then raise notice 'O2  esperado ERROR: OK (%)', sqlerrm; end;
  begin update public.deliveries set stage='picked_up' where id='14500000-0000-4000-8000-000000000017';
    raise notice 'O3  office ready->picked_up                       esperado ERROR: MAL, paso';
  exception when others then raise notice 'O3  esperado ERROR: OK (%)', sqlerrm; end;
  begin update public.deliveries set stage='delivered' where id='14500000-0000-4000-8000-000000000018'; get diagnostics n = row_count;
    raise notice 'O4  office approved->delivered, entregar ya (igual) esperado 1 fila: %', case when n=1 then 'OK' else 'MAL '||n end;
  exception when others then raise notice 'O4  MAL: %', sqlerrm; end;
end $$;

-- 4. ALMACEN (control: identico a la 142)
set local request.jwt.claims to '{"sub":"<UUID-ALMACEN>","role":"authenticated"}';
do $$
declare n int;
begin
  begin update public.deliveries set stage='fulfilling' where id='14500000-0000-4000-8000-000000000019'; get diagnostics n = row_count;
    raise notice 'W1  almacen approved->fulfilling, OTRA tienda     esperado 1 fila: %', case when n=1 then 'OK' else 'MAL '||n end;
  exception when others then raise notice 'W1  MAL: %', sqlerrm; end;
  begin update public.deliveries set stage='picked_up' where id='14500000-0000-4000-8000-000000000020'; get diagnostics n = row_count;
    raise notice 'W2  almacen ready->picked_up                      esperado 1 fila: %', case when n=1 then 'OK' else 'MAL '||n end;
  exception when others then raise notice 'W2  MAL: %', sqlerrm; end;
  begin update public.deliveries set stage='approved' where id='14500000-0000-4000-8000-000000000021';
    raise notice 'W3  almacen fulfilling->approved, OTRA tienda (142) esperado ERROR: MAL, paso';
  exception when others then raise notice 'W3  esperado ERROR: OK (%)', sqlerrm; end;
end $$;

-- 5. CHOFER (control)
set local request.jwt.claims to '{"sub":"<UUID-CHOFER>","role":"authenticated"}';
do $$
declare n int;
begin
  begin update public.deliveries set stage='picked_up' where id='14500000-0000-4000-8000-000000000022'; get diagnostics n = row_count;
    raise notice 'D1  chofer ready->picked_up                       esperado 1 fila: %', case when n=1 then 'OK' else 'MAL '||n end;
  exception when others then raise notice 'D1  MAL: %', sqlerrm; end;
  begin update public.deliveries set stage='fulfilling' where id='14500000-0000-4000-8000-000000000023';
    raise notice 'D2  chofer approved->fulfilling                   esperado ERROR: MAL, paso';
  exception when others then raise notice 'D2  esperado ERROR: OK (%)', sqlerrm; end;
end $$;

-- 6. VENTAS y LOGISTICA: no avanzan
set local request.jwt.claims to '{"sub":"<UUID-VENTAS>","role":"authenticated"}';
do $$
begin
  begin update public.deliveries set stage='fulfilling' where id='14500000-0000-4000-8000-000000000024';
    raise notice 'V1  ventas approved->fulfilling                   esperado ERROR: MAL, paso';
  exception when others then raise notice 'V1  esperado ERROR: OK (%)', sqlerrm; end;
end $$;
set local request.jwt.claims to '{"sub":"<UUID-LOGISTICA>","role":"authenticated"}';
do $$
begin
  begin update public.deliveries set stage='fulfilling' where id='14500000-0000-4000-8000-000000000025';
    raise notice 'L1  logistica approved->fulfilling                esperado ERROR: MAL, paso';
  exception when others then raise notice 'L1  esperado ERROR: OK (%)', sqlerrm; end;
end $$;

ROLLBACK;
```

**Resumen de lo que debe salir — 26 casos, cada línea tiene que decir `OK`:**

| Esperado | Casos | Cuántos |
|---|---|---|
| 1 fila | G1-G8, G11, G12, G15, O4, W1, W2, D1 | 15 |
| ERROR | G9, G10, G13, G14, O1-O3, W3, D2, V1, L1 | 11 |

**Cambian respecto de hoy (5):** G1, G2, G3, G4 y G12 (hoy fallan con «manager cannot move an order from … to …»).
**Los otros 21 tienen que salir igual antes y después.**

**Recomendado:** correr el mismo bloque **sin** el `\i` (base de hoy) y guardar la salida: tienen que diferir
exactamente esos 5.

**Si algún MAL no es de los esperados, parar**: no aplicar.

## 7 · Mediciones de solo lectura (para el orquestador; NO corridas)

```sql
-- M1. El guard vigente es el de la 142 (y la 145 no está)
select position('orden_de_mis_tiendas(OLD.store' in d) > 0 as tiene_142,
       position('if r = ''manager''' in d) = 0      as sin_145
  from (select pg_get_functiondef('public.guard_delivery_stage()'::regprocedure) d) x;

-- M2. Gerentes y office, con y sin tienda, y con la lectura acotada
select role, count(*) as total,
       count(*) filter (where coalesce(btrim(store), '') = '') as sin_tienda,
       count(*) filter (where coalesce(array_length(visible_stores, 1), 0) > 0) as con_visible_stores
  from public.profiles where role in ('manager', 'accounting') group by role;

-- M3. Pasos de bodega de los últimos 90 días, por rol (para saber cuánto lo hace hoy el admin en su lugar)
with ev as (
  select e.delivery_id, e.kind, e.created_by,
         lag(e.kind) over (partition by e.delivery_id order by e.created_at) as antes
    from public.order_events e where e.created_at > now() - interval '90 days'
)
select ev.antes || ' -> ' || ev.kind as salto, p.role, count(*)
  from ev join public.profiles p on p.id = ev.created_by
 where (ev.antes, ev.kind) in (('approved','fulfilling'), ('fulfilling','ready'), ('ready','picked_up'))
 group by 1, 2 order by 1, 2;
```

## 8 · Reversión

En una transacción propia, a mano (también comentada al final del `.sql`):

1. El guard como lo dejó la 142: volver a correr **solo** su `create or replace function public.guard_delivery_stage()`
   (de `142_deshacer_almacen_y_borrar_borradores.sql`). **No** el fichero entero: volvería a correr su `alter policy` y
   sus `create table`/triggers.
2. `delete from public.schema_migrations where name = '145_gerente_hace_bodega.sql';`
3. La pantalla: con el guard revertido, los tres botones del gerente fallarían con el error del guard. Revertir también
   `preparaEnLaFicha`/`recogeEnLaFicha` (o hacer que `gerenteHaceBodega` devuelva `false`).

## 9 · Encontrado al medir: «Marcar entregada ya» no salía del navegador desde approved, fulfilling ni ready

**Medido en el demo el 2026-09-25, como gerente, antes del arreglo:** «Marcar entregada ya» en #1021 (`approved`), con
motivo: la orden **se quedó en `approved`** y salió el aviso *«This order must be approved by a manager first.»*.

La causa: los dos proveedores (`data-provider.tsx:1305` y `local-data-provider.tsx:232`) rechazan cualquier salto que no
esté en `LEGAL_TRANSITIONS` antes de escribir, salvo al admin; y D-361 añadió `delivered → picked_up` y
`fulfilling → approved`, pero **no** `delivered` desde `approved`, `fulfilling` ni `ready`. La prueba espejo de D-361
compara la ficha con el `.sql` y pasaba: el hueco estaba en la tercera pieza, que ninguna de las dos miraba. Así que
«entregar ya» **solo funcionaba desde `picked_up`**, y el dueño, que es admin, no lo veía (el admin se salta la lista).

Arreglado añadiendo `delivered` a esas tres etapas, con una prueba nueva que exige que cada etapa desde la que la ficha
ofrece «entregar ya» o «deshacer» exista en la lista. **Es pantalla sola: la base ya lo dejaba (139).**

## 10 · Lo que NO se ha medido

- **Nada contra la base.** Todo es la app contra el texto de la 145, y el demo, que no tiene servidor ni guard.
- **La autocomprobación de la 145 no se ha ejecutado en Postgres.** Una prueba del repo reconstruye lo que busca y lo mira
  contra el código sin comentarios, como hará Postgres; no sustituye aplicarla.
- **M1-M3 sin correr.** En particular, cuántos gerentes tienen `visible_stores` (si la lectura los acota, no verán las
  órdenes de otras tiendas y los casos G2… saldrían «MAL 0» por lectura, no por la regla).
- **El permiso de ubicación del navegador**: en la recogida la app pide la posición (no bloquea). En la oficina saldrá el
  aviso del navegador la primera vez; no se ha visto en un navegador con sesión real.
