# Plan 154 · Una sola lista por camión: dónde va cada recogida

Plan en papel exigido por `CLAUDE.md` («Antes de tocar RLS, triggers o permisos en producción»: aquí hay **esquema** —una
columna en `deliveries`— y se **reemplaza una función** que escribe en `deliveries`). Molde: `docs/PLAN-152-zonas-preferidas.md`.

**Estado (2026-09-28):** escrito por un worker en un worktree **sin `.env.local` y sin acceso a la base**. Todo sale de
**leer el repo** (`origin/main` = `e92330f2`, D-442; migraciones hasta la 153 aplicadas según el orquestador) y de las pruebas
del repo. Nada se ha ejecutado contra producción: ni la migración, ni su autocomprobación, ni el ensayo de §6.
**Pendiente de aprobar.**

**Número:** 154, la siguiente libre (en `supabase/migrations/` la última es `153_estimados_competencia.sql`).

**Pedido del dueño (2026-09-28):** en su especificación del motor de rutas, sección «Cambio principal: una sola lista por
camión, sin cargas separadas»: *«Elimina el concepto de cargas (truckloads) separadas […] todas las órdenes del conductor van
en una sola lista continua […] El camión puede recoger, entregar una parte, volver a recoger en otra tienda y seguir
entregando»*, y *«Migración: si en el modelo de datos existe hoy una tabla o campo de cargas (loads/truckloads), propón cómo
pasar de ese modelo a la lista única antes de borrar nada, qué pasa con los datos históricos y qué pantallas lo usan. No lo
elimines sin mi aprobación.»* Preguntado por el orquestador «¿eliminamos los viajes?»: *«SI ELIMINA VIAJES»*.

**La migración está escrita y NO aplicada:** `supabase/migrations/154_lista_unica.sql`.

---

## 0 · Resumen

| | Hoy (hasta la 153) | Con la 154 |
|---|---|---|
| `deliveries.route_seq` | puesto de la entrega; **dentro de su viaje** si lo escribió publicar, **seguido** si lo escribió el Gestor | igual; lo que se escribe desde ahora es siempre **seguido** en todo el día |
| `deliveries.load_no` (033) | el viaje: 1 (o nulo) el primero, 2, 3… | **se deja de escribir** (la app lo pone a `null` al guardar o publicar). **No se borra.** Solo se LEE para ordenar una ruta vieja que nadie ha tocado |
| `deliveries.pickup_seq` | no existe | `numeric`, nulo, sin defecto: **dónde va la recogida** en la lista, en la escala de `route_seq` |
| `publish_route_plan` (135) | escribe `assigned_driver`, `route_seq`, `load_no`, `load_auto` | la **misma** función con una línea más: escribe `pickup_seq` |
| Políticas, grants, guards | — | **no se tocan** |
| Filas existentes | — | leen `pickup_seq` nulo; **ningún `UPDATE`** |

## 1 · El modelo, y por qué así

**Qué hace falta guardar.** En una lista continua cada orden tiene DOS paradas: su recogida (P) y su entrega (D). Hoy solo se
guarda el puesto de la entrega. La recogida se derivaba: todas las del viaje delante de las entregas de ese viaje. Con viajes
fuera, «delante de su viaje» deja de significar algo, y una recarga a media ruta **con carga a bordo** (recoger P4 después de
entregar D1, sin vaciar el camión: el ejemplo de la especificación) no se puede reconstruir de ningún otro dato.

**La forma mínima: un número por orden, en la misma escala que `route_seq`.** La entrega de la orden va en `route_seq = k`
(entero, como hoy). Su recogida va en `pickup_seq`, un número **entre** el puesto de la entrega que tiene delante y el de la
que tiene detrás. Con `m` paradas de recogida seguidas delante de la entrega de puesto `k`, la `j`-ésima (desde 0) lleva
`k − (m − j)/(m + 1)`; todas las órdenes de una misma parada de recogida (misma tienda, seguidas) llevan el mismo número. Se
redondea a la diezmilésima (`escrituraDeLaLista`, `src/lib/lista-unica.ts`). Leer es ordenar: entregas por `route_seq`,
recogidas por `pickup_seq`, y cada recogida antes de la primera entrega de puesto mayor.

**Descartado:**
- *Una tabla `route_stops` (una fila por parada).* Es el modelo «de libro», pero duplica lo que ya guarda `route_plan_stops`
  para el motor, obliga a mantener dos fuentes de verdad en cada flecha, y cambia todo lo que hoy lee `route_seq` («Mi ruta»,
  el manifiesto, almacén, el mapa). La columna es una línea y no rompe a ningún lector.
- *Reescribir `route_seq` como puesto en la lista ENTERA (P y D en la misma numeración entera).* Rompe a quien ordena por
  `route_seq` pensando que son entregas 0..n−1 (la escritura de las flechas, `reorderStops`, «Mejor lugar», el arrastre), y
  una entrega movida por un camino que no conoce las recogidas dejaría números mezclados.
- *Un entero `pickup_seq` = «antes de la entrega k».* No ordena dos recogidas seguidas delante de la misma entrega sin otra
  columna más; el número entre dos puestos sí.

**Lo que la escala compra:** cualquier camino que solo reordena entregas (arrastre, «Mejor lugar») deja cada recogida en su
hueco numérico, y la lectura la adelanta delante de su entrega si hiciera falta: **una entrega nunca sale antes que su
recogida**, pase lo que pase con los datos.

## 2 · Sin la 154 (la pantalla degrada sola)

La app mira si las filas que lee **traen** la clave `pickup_seq` (`select *` la trae aunque valga `null`):
`tienePosicionDeRecogida`. Sin la columna:

- **No la pide ni la manda**: `reorderStops` no escribe `pickup_seq`, el deshacer no la lee (`select` sin ella), publicar la
  manda en `writes` y la función vieja (135) la ignora. Escribir una columna que no existe haría fallar la escritura entera.
- **La regla de las recogidas (la de siempre, sin viajes):** las órdenes se cargan en bloques, en el orden de sus entregas y
  tanto como quepa en el camión (el mismo corte que hacía `splitIntoTrips`), y cada bloque se recoge —una parada por tienda,
  en el orden de su primera entrega— justo antes de la primera entrega del bloque. Una ruta que cabe entera en el camión son
  todas las recogidas al principio; una que no, recarga a media ruta cuando el camión se vacía. Es exactamente lo que se
  pintaba con viajes, **sin la raya, sin «Viaje N» y en la misma lista**. Un viaje histórico (`load_no`) también corta el
  bloque: una ruta vieja se lee como se cargó.
- **Las flechas de las filas P se apagan** y lo dicen («Necesita la actualización de la base (154)…»); las de las D siguen.
- Con la 154, una orden **sin** `pickup_seq` (lo guardado antes, o una recién asignada) sigue la misma regla, solo ella.

## 3 · Inventario de lecturas y escrituras

| Pieza | Qué hace con esto | Cambia |
|---|---|---|
| `deliveries.pickup_seq` | columna nueva | **nueva** |
| `deliveries.load_no` | comentario «HISTÓRICO» | solo el comentario; **ni se borra ni se toca un dato** |
| `publish_route_plan(uuid, jsonb)` | `update deliveries … load_no = (w->>'load_no')::integer, pickup_seq = (w->>'pickup_seq')::numeric` | una línea más; el resto, la 135 letra por letra (lo compara una prueba) |
| Gestor, flechas ↑↓ de P y D, «Pasar a…», «Mejor lugar», soltar en «📅 Horario», «Asignar ruta a…» | escriben la lista entera: `route_seq` seguido (tras lo ya hecho, D-433), `load_no = null`, y `pickup_seq` **si la columna existe** | sí (app) |
| Gestor, deshacer/rehacer (D-417) | lee `id, assigned_driver, route_seq, load_no, updated_at` **+ `pickup_seq` si existe**, y escribe solo lo que difiere | sí (app) |
| Asignar / quitar / vaciar ruta | `assigned_driver`, `route_seq: null`, `load_no: null` (como hoy) | no |
| «Mi ruta» (`my-route`) y «Orden planeado del día» | leen `route_seq`, `pickup_seq` (si hay) y, para lo viejo, `load_no` | sí (app): una lista, sin viajes |
| Plan del motor (`route_plan_stops`, `route_plans.writes`) | el plan ya era una lista; `writes` lleva `pickup_seq` y ya no `load_no` | sí (app) |
| Copia de un publicado (D-429, `copia.ts`) | compara lo escrito con lo de hoy; `load_no` nulo contra nulo | sí (app) |
| «Agregar material» (D-342) | si la orden tiene `load_no`, cuenta contra ese viaje; si no, el día entero | **no** (se deja; en la práctica, al no escribirse viajes, cuenta el día entero — ver §7) |
| Manifiesto, almacén, mapa de despacho | ordenan por `route_seq` | no |

## 4 · Qué pasa con lo histórico

- **Nada se borra.** `load_no` se queda con lo que tiene. Las órdenes ya **entregadas** o **recogidas** no se reescriben nunca
  (no salen en el Gestor, D-433).
- Una ruta **pendiente** guardada con viajes y que nadie toca se sigue leyendo en su orden: el viaje viejo ordena antes que
  el puesto (`entregasEnOrden`) y corta el bloque de recogidas. **Solo se ve distinta**: sin raya ni «Viaje N».
- Una ruta publicada ANTES de este cambio se sigue reconociendo como «la publicada» (`posicionesPorViajeHistoricas`): no sale
  el aviso «cambió desde que se publicó» sin que nadie la tocara.
- En cuanto alguien toca una ruta pendiente (una flecha, «Mejor lugar», soltar, publicar de nuevo), sus órdenes pendientes
  pasan a `route_seq` seguido, `load_no = null` y, con la 154, `pickup_seq`.
- **Quitar la columna `load_no`** es un paso aparte, **pendiente de la aprobación del dueño**. Antes haría falta: que ninguna
  orden pendiente la lleve distinta de `null` (una consulta), quitar las lecturas de lo histórico (`entregasEnOrden`,
  `posicionesPorViajeHistoricas`, «Agregar material») y decidir qué se hace con lo entregado (se puede quedar como está en un
  respaldo). No se ha escrito.

**Qué pantallas leían `load_no`** (hasta este cambio): Gestor (tarjeta por viajes `groupIntoLoads`, selector «Viaje N»,
«Unir/Dividir», mover viaje, mapa por viaje, «Ver un viaje»), «Mi ruta» (tarjetas por viaje), `lectura-de-ruta`
(`sigueElPlan`, `viajeCambiado`), «Agregar material» (tope por viaje), la copia de un publicado, y la firma de la medida.

## 5 · El SQL, literal

Ver `154_lista_unica.sql`. En resumen:

```sql
alter table public.deliveries add column if not exists pickup_seq numeric;
comment on column public.deliveries.pickup_seq is '…';
comment on column public.deliveries.load_no   is 'HISTORICO (033) …';
create or replace function public.publish_route_plan(p_plan uuid, p_avisos jsonb default '[]'::jsonb) … -- la de la 135 +
         pickup_seq      = (w->>'pickup_seq')::numeric,
revoke execute … from public, anon;  grant execute … to authenticated;   -- como la 135
```

La autocomprobación (`do $comprueba$`) exige: la columna `numeric`, nula y sin defecto; que `load_no` siga existiendo; que
`publish_route_plan` escriba `pickup_seq`, conserve las seis comprobaciones de la 133/135 y el `for update`, no sea
`security definer`, y los grants (anon no, authenticated sí).

Sin `begin`/`commit` propios. **Sin el número de la decisión dentro del `.sql`**: numerarla no cambia el checksum.
Checksum del registro: `37e5453d4d0e07c98b295b410e187fba29c7d0c244a983e3adde22cfdb055204`
(`node scripts/db/migrate-status.mjs --sum 154_lista_unica.sql`, 2026-09-28; una prueba del repo lo recalcula).

## 6 · Matriz de pruebas por rol, con ROLLBACK (la corre el orquestador)

**11 casos.** Se pega entero en `psql` **desde la raíz del repo** (el `\i` es relativo). **Sin `commit` en ningún sitio.**

Sustituir: `<UUID-ADMIN>` (`admin`), `<UUID-LOGISTICA>` (`logistics`), `<UUID-GERENTE>` (`manager`), `<UUID-CHOFER>`
(`driver`), `<UUID-VENTAS>` (`sales`), todos con acceso a Entregas; `<ORDEN>`: una orden `approved` o `ready` de hoy con
chofer; `<NOMBRE-CHOFER>`: el `full_name` de ese chofer.

```sql
begin;

-- 0. La migración, dentro de la misma transacción (se deshace con el resto).
\i supabase/migrations/154_lista_unica.sql

-- P. Nada cambió en los datos: todas leen pickup_seq nulo, y load_no sigue como estaba.
do $$ declare n int; begin
  select count(*) into n from public.deliveries where pickup_seq is not null;
  raise notice 'P1  filas con pickup_seq                               esperado 0: %', case when n = 0 then 'OK' else 'MAL '||n end;
end $$;

set local role authenticated;

-- L. Logística guarda una lista (lo que hace la flecha): route_seq, load_no nulo y pickup_seq.
set local request.jwt.claims to '{"sub":"<UUID-LOGISTICA>","role":"authenticated"}';
do $$ declare n int; begin
  update public.deliveries set route_seq = 3, load_no = null, pickup_seq = 2.5 where id = '<ORDEN>'; get diagnostics n = row_count;
  raise notice 'L1  logistica escribe pickup_seq                       esperado 1: %', case when n = 1 then 'OK' else 'MAL '||n end;
end $$;
do $$ declare v numeric; begin
  select pickup_seq into v from public.deliveries where id = '<ORDEN>';
  raise notice 'L2  se lee 2.5                                         esperado 2.5: %', case when v = 2.5 then 'OK' else 'MAL '||coalesce(v::text, 'null') end;
end $$;

-- A. Admin, igual.
set local request.jwt.claims to '{"sub":"<UUID-ADMIN>","role":"authenticated"}';
do $$ declare n int; begin
  update public.deliveries set pickup_seq = 1.3333 where id = '<ORDEN>'; get diagnostics n = row_count;
  raise notice 'A1  admin escribe pickup_seq                           esperado 1: %', case when n = 1 then 'OK' else 'MAL '||n end;
end $$;

-- G. El gerente: las mismas reglas que route_seq para él (145). Se anota lo que pase; lo esperado es lo mismo que con route_seq.
set local request.jwt.claims to '{"sub":"<UUID-GERENTE>","role":"authenticated"}';
do $$ declare a int; b int; begin
  begin update public.deliveries set route_seq = route_seq where id = '<ORDEN>'; get diagnostics a = row_count; exception when others then a := -1; end;
  begin update public.deliveries set pickup_seq = pickup_seq where id = '<ORDEN>'; get diagnostics b = row_count; exception when others then b := -1; end;
  raise notice 'G1  gerente: pickup_seq igual que route_seq            esperado iguales: % (route_seq %, pickup_seq %)', case when a = b then 'OK' else 'MAL' end, a, b;
end $$;

-- C. El chofer LEE su orden con la columna (la ve con su RLS de siempre) y no la puede cambiar si no puede cambiar route_seq.
set local request.jwt.claims to '{"sub":"<UUID-CHOFER>","role":"authenticated"}';
do $$ declare n int; begin
  select count(*) into n from public.deliveries where id = '<ORDEN>' and pickup_seq is not null;
  raise notice 'C1  el chofer lee su pickup_seq                        esperado 1 (si la orden es suya): %', n;
end $$;
do $$ declare a int; b int; begin
  begin update public.deliveries set route_seq = route_seq where id = '<ORDEN>'; get diagnostics a = row_count; exception when others then a := -1; end;
  begin update public.deliveries set pickup_seq = 0 where id = '<ORDEN>'; get diagnostics b = row_count; exception when others then b := -1; end;
  raise notice 'C2  chofer: pickup_seq igual que route_seq             esperado iguales: % (route_seq %, pickup_seq %)', case when a = b then 'OK' else 'MAL' end, a, b;
end $$;

-- V. Ventas: lo mismo que con route_seq.
set local request.jwt.claims to '{"sub":"<UUID-VENTAS>","role":"authenticated"}';
do $$ declare a int; b int; begin
  begin update public.deliveries set route_seq = route_seq where id = '<ORDEN>'; get diagnostics a = row_count; exception when others then a := -1; end;
  begin update public.deliveries set pickup_seq = 0 where id = '<ORDEN>'; get diagnostics b = row_count; exception when others then b := -1; end;
  raise notice 'V1  ventas: pickup_seq igual que route_seq             esperado iguales: % (route_seq %, pickup_seq %)', case when a = b then 'OK' else 'MAL' end, a, b;
end $$;

-- F. Publicar escribe pickup_seq y deja load_no en null. Como logística, con un borrador HECHO A MANO para <ORDEN>.
reset role;
insert into public.route_plans (id, plan_date, status, source, version, input, result, writes)
values ('00000000-0000-0000-0000-000000000154', current_date, 'draft', 'engine', 99999,
        jsonb_build_object('ordenes', (select jsonb_agg(jsonb_build_object('id', id, 'updated_at', updated_at)) from public.deliveries where id = '<ORDEN>')),
        '{}'::jsonb,
        jsonb_build_array(jsonb_build_object('id', '<ORDEN>', 'assigned_driver', '<NOMBRE-CHOFER>', 'route_seq', 0, 'pickup_seq', -0.5, 'load_auto', true)));
set local role authenticated;
set local request.jwt.claims to '{"sub":"<UUID-LOGISTICA>","role":"authenticated"}';
do $$ declare r jsonb; v numeric; l int; begin
  r := public.publish_route_plan('00000000-0000-0000-0000-000000000154', '[]'::jsonb);
  select pickup_seq, load_no into v, l from public.deliveries where id = '<ORDEN>';
  raise notice 'F1  publicar escribe pickup_seq = -0.5                 esperado OK: %', case when v = -0.5 then 'OK' else 'MAL '||coalesce(v::text, 'null') end;
  raise notice 'F2  publicar deja load_no en null                      esperado OK: %', case when l is null then 'OK' else 'MAL '||l end;
  raise notice 'F3  written                                            esperado 1: %', r->>'written';
end $$;
-- Las columnas que publicar NO toca siguen como estaban (la 135 no cambia nada más): se ve comparando antes/después si se quiere.

rollback;
```

Nota sobre F: el `insert` en `route_plans` se hace como `postgres` (la tabla tiene sus políticas, 133) para no depender de que
logística pueda crear un borrador a mano; lo que se prueba es la función. Si el disparador de la 133 exige más campos al
insertar, se añaden con los valores de un borrador real (`select * from route_plans where status = 'draft' limit 1`).

## 7 · Qué NO debe romperse, y lo que queda pendiente

- Publicar **antes** de aplicar la 154 (la 135 ignora `pickup_seq` y deja `load_no` en null): funciona; la recogida no se
  guarda y la pantalla usa la regla.
- Guardar una flecha **antes** de la 154: no se manda `pickup_seq` (lo comprueba una prueba de la app).
- Rutas publicadas antes de este cambio: se siguen reconociendo como publicadas.
- **Pendiente, a propósito:** quitar `load_no` (con aprobación); «Agregar material» sigue con su tope por viaje si la orden
  aún tiene viaje, y si no, el día entero — con la lista única lo justo sería la **carga máxima** de la lista con los pallets
  nuevos. Se deja anotado; no se tocó en esta rama.
