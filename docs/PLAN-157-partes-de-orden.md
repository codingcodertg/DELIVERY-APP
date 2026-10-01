# Plan 157 · Partes de una orden: una orden que no cabe en el camión son DOS órdenes (#Xa, #Xb), 2 P y 2 D

Plan en papel exigido por `CLAUDE.md` («Antes de tocar RLS, triggers o permisos en producción»: aquí se **reemplaza el
guard `guard_delivery_stage`** —con un cambio de una lista— y se añaden **tres funciones que escriben en `deliveries`**, una
de ellas `SECURITY DEFINER` porque borra). Molde: `docs/PLAN-154-lista-unica.md` y `docs/PLAN-155-encuestas.md`.

**Estado (2026-09-30):** escrito por un worker en un worktree sin `.env.local`. Producción se **leyó** (`begin read only`)
para medir qué hay (§7), y la migración y la matriz de §6 se **ensayaron contra producción dentro de una transacción con
`ROLLBACK`** (resultado en §6). **Nada aplicado. Pendiente de aprobar.**

**Número:** 157, la siguiente libre (en `supabase/migrations/` la última es `156_competencia_suelta.sql`).

**Pedido del dueño (2026-09-30, literal, tal como lo pasó el orquestador):**

> *«so if we have an order of more than 10 pallets that will be devided into 2 those 2 orders should assign as 2 p 2 d»*

Es decir: una orden que no cabe en el camión y se parte en dos cargas tiene que comportarse como **dos paradas completas**:
dos recogidas (P) y dos entregas (D), cada una con su número, sus flechas y su «Pasar a…», en el Gestor, en el plan y en
«Mi ruta». Y él lo dice con sus palabras: *«those 2 orders»*.

**Decisiones del orquestador que esto implementa** (validadas midiendo; lo que no cuadró, en §1 y en la entrada de
`DECISIONS.md`): (1) las partes pueden ir con choferes distintos; (2) el chofer marca cada parte por separado; (3) el
reparto de pallets lo propone el sistema (llena el camión, el resto a la siguiente) y el gestor puede corregirlo, con la
suma igual a la de la orden; (4) una orden que cabe entera no se parte nunca, y una partida se puede volver a juntar si cabe.

**La migración está escrita y NO aplicada:** `supabase/migrations/157_partes_de_orden.sql`.

---

## 0 · Resumen

| | Hoy (hasta la 156) | Con la 157 |
|---|---|---|
| Una orden de 15 pallets en un camión de 10, al «Armar rutas» | el motor la parte en cargas **virtuales** `id#a` (10) y `id#b` (5) del **mismo** chofer; el plan las enseña como «carga 1 de 2» | la app la parte en **dos órdenes** `#Xa` (10) y `#Xb` (5) **antes** de planificar (`partir_carga`); el motor las reparte como dos órdenes cualesquiera |
| Publicar | escribe **una** fila: el chofer y el puesto de la **primera** carga; la segunda no escribe nada | escribe **cada carga** (son filas); `publish_route_plan` **no cambia** |
| Gestor y «Mi ruta» | la segunda carga es una fila informativa que **no se mueve ni se marca** (`otraCarga`, `indice: null`) | cada carga es una orden: su P y su D, sus flechas, su «Pasar a…», su botón de recoger y entregar |
| Mover algo a mano | la lista guardada conoce **una** P y **una** D de 15: «+15 = 15 · ⚠ se pasa 5 de 10» | cada carga con su puesto (`route_seq`, `pickup_seq`) |
| Choferes distintos para las cargas | en el plan sí se puede, pero publicar lo pierde | sí: cada carga tiene su `assigned_driver` |
| Corregir el reparto | no hay dónde | `reparte_cargas(a, b, pallets_de_a)`; la suma no cambia |
| Volver a juntar | no hay cómo | `juntar_cargas(a, b)` si las dos siguen pendientes; `b` se borra y queda en `deliveries_borradas` (142) |
| `guard_delivery_stage` (145) | una carga partida (`order_suffix`) solo puede **nacer** en ready/approved/fulfilling | la **misma** función letra por letra, con `'pending'` en esa lista (el motor rutea pendientes) |
| Políticas, grants de tabla, `publish_route_plan`, realtime, columnas | — | **no se tocan** |
| Filas existentes | — | **ninguna cambia** al aplicarla |

## 1 · El modelo, y por qué así

**Qué hace falta.** Que cada carga de una orden partida tenga lo que tiene una parada completa: chofer, puesto de su entrega
(`route_seq`), posición de su recogida (`pickup_seq`), etapa (recogida / entregada), quién la recogió y cuándo, su
comprobante, su RLS por chofer, su realtime y su historial. Y que todo lo que hoy lee `route_seq` siga funcionando para
una orden sin partes.

**La forma elegida: las cargas son ÓRDENES hermanas** —la misma `order_no` y `order_code` con `order_suffix` `a`, `b`,
`c`…—. Es el mecanismo que la app **ya tiene desde la migración 012** («split loads»: cuando el chofer carga menos de lo
que dice la orden, lo cargado se queda como `#Xa` y el resto nace como `#Xb`, una orden nueva en `ready`; en producción se
ha usado una vez, medido en §7), extendido al momento de **planificar**. Con eso:

- **Ningún lector cambia.** `deliveries.route_seq`, `pickup_seq`, `assigned_driver`, `stage` ya existen por fila. El
  Gestor pinta carriles por `assigned_driver`, «Mi ruta» filtra por `assigned_driver`, el manifiesto y el almacén
  ordenan por `route_seq`, la RLS del chofer dice `assigned_driver = su nombre`, realtime escucha `deliveries`: **todo
  eso ya trata una carga como una parada completa**, porque lo es.
- **Las cuatro decisiones salen solas:** (1) cada carga tiene su chofer; (2) cada carga tiene su etapa y el chofer la marca
  con el mismo botón de siempre; (3) los pallets de cada carga son `actual_pallets`/`est_pallets` de su fila, y
  `reparte_cargas` los cambia sin cambiar la suma; (4) `partir_carga` solo se llama cuando no cabe (lo decide la misma
  regla del motor, `parteOrdenesGrandes`), y `juntar_cargas` deshace la partición si las dos siguen pendientes.
- **El dueño ya lo ve así.** Dice *«those 2 orders»*, y en la tabla de Órdenes una carga partida al recoger ya le sale
  como `#FA100a` y `#FA100b`.

**Descartado:**

- *Una tabla `delivery_parts` (`delivery_id, parte, pallets, assigned_driver, route_seq, pickup_seq, stage, picked_up_at,
  delivered_at`).* Es el modelo «de libro», y es lo que proponía el encargo. Lo que cuesta: **cada lector de `deliveries`
  tendría que aprender que una orden puede tener partes** —los carriles del Gestor (`byDriver` por `assigned_driver` de la
  orden → por chofer de la parte), «Mi ruta» (`paradasDelChofer` por `assigned_driver` → unión de partes), el manifiesto,
  el mapa, el plan y sus `writes`, `publish_route_plan`, la copia de un publicado, el deshacer, «Mejor lugar», el arrastre,
  `lista-unica` entera (`{orden, parte}` en vez de `orden`)—; **la política de lectura de `deliveries` tendría que cambiar**
  (un chofer con solo la parte 2 no vería la orden: `assigned_driver` es de la orden), que es la tabla más leída de la app y
  el cambio con más riesgo del repo (131); haría falta **un trigger que derive la etapa de la orden** de las de sus partes
  —y el guard de etapa (145) no deja al chofer volver una `delivered` a `picked_up`, así que des-marcar una parte exigiría
  otro bypass como `app.route_publishing`—; realtime en otra tabla; el comprobante y las fotos de cada parte (hoy viven en
  la orden); y la cola sin conexión por parte. Es el mismo resultado con diez veces más superficie y dos fuentes de verdad
  (la fila de la orden y sus partes) que tendrían que cuadrar en cada escritura.
- *Un `jsonb` de partes en `deliveries`.* Lo mismo que la tabla, sin RLS ni realtime por parte, y con cada escritura
  pisando el array entero (lección de «no reenviar lo leído»).
- *Dejar las cargas virtuales del motor y «publicar la segunda».* Publicar escribe por orden (`deliveries.id`); no hay
  dónde escribir dos puestos ni dos choferes para una fila.

**Lo que esta forma cuesta, y se asume** (para el dueño, en la entrada de `DECISIONS.md`): en Órdenes una orden partida
son **dos filas** (como ya pasa con la partición al recoger); los avisos al cliente (SMS/correo) salen **por carga** (dos
«en camino», dos «entregado», con `#Xa` y `#Xb`), como hoy con la partición al recoger; la tarifa (`delivery_fee`) y la
factura **se copian** a la carga nueva, como hace la partición al recoger (012) —un informe que sume tarifas por fila la
contaría dos veces; es el comportamiento que ya existe y se deja anotado—; y **«la orden»** como unidad pasa a ser la
**familia** (las filas con la misma `order_no`): la familia está entregada cuando todas sus cargas lo están
(`etapaDeLaFamilia`, `src/lib/cargas-partidas.ts`). No hay una fila madre con una etapa propia.

## 2 · Lo que pasa hoy, medido (`src/lib/cargas-partidas.test.ts`, bloque «HOY»; y producción, §7)

Con las funciones de verdad —`planifica`, `escriturasAlPublicar`, `lecturaDeLaRuta`, `mueveEnLaLista`, `aplicaMovimiento`—
y una orden `g` de 15 pallets más una `h` de 2, en un camión de 10:

1. El motor parte `g` en `g#a` (10) y `g#b` (5), **las dos en el mismo chofer**, con `P:g#a`, `D:g#a`, `P:g#b`, `D:g#b`.
2. **Publicar escribe UNA fila** (`g`, con el chofer y el puesto de su primera carga); `h` otra. Nada con `#`.
3. Leída con el plan publicado, la ruta pinta **4 filas** de `g` (2 P + 2 D) pero **2 sin índice** (no se mueven): la
   segunda D es `otraCarga`. En la lista que se mueve y escribe hay **una** P y **una** D de `g`.
4. En cuanto alguien mueve algo, manda lo guardado: `P1 D1 P2 D2`, y la cuenta de `P1` dice **«+15 = 15 · ⚠ se pasa 5 de
   10»**. Bajar `P1` sobre `D1` no se deja (precedencia); no existe ninguna «otra carga» que mover.
5. En el plan (ajuste a mano), pasar `g#b` a otro chofer **sí** se deja (`esUnaRuta` juzga por parte) —pero al publicar,
   `g` se escribe una vez, con el chofer de su primera carga: la segunda se pierde.
6. «Mi ruta» pinta la segunda carga como «Entregar otra carga de», **sin botón**: no se marca por separado.

En producción (§7): hoy mismo, 2026-09-30, el borrador v1 del plan partió `FT197` (14 pallets, `RDZ Pharr`, camiones de 10)
en `#a`/`#b`; solo `#a` tiene paradas (P5/D5 de Julio Jijon) y `writes` lleva **una** entrada para la orden
(`route_seq 4`, `pickup_seq 3.5`). Es exactamente el hueco que el dueño describe.

## 3 · Inventario de lecturas y escrituras

| Pieza | Qué hace con esto | Cambia |
|---|---|---|
| `guard_delivery_stage()` (145) | el guard entero; UN cambio: `new_stage in ('ready','approved','fulfilling','pending')` en la rama «nace con `order_suffix`» | **sí** (una lista; una prueba compara los dos bloques línea a línea) |
| `partir_carga(uuid, numeric) → uuid` | nueva, invoker: copia la madre a una fila nueva (letra siguiente, `p_resto` pallets, sin puesto ni sellos) y resta a la madre; dos `order_events` | **nueva** |
| `reparte_cargas(uuid, uuid, numeric)` | nueva, invoker: dos UPDATE de misma etapa; la suma no cambia | **nueva** |
| `juntar_cargas(uuid, uuid)` | nueva, **definer** (borra): devuelve pallets a `a`, borra `b`, quita la letra si no queda hermana | **nueva** |
| `puede_partir_cargas()`, `pallets_de_la_carga(deliveries)`, `la_ve_quien_llama(deliveries)` | auxiliares: quién puede; los pallets que cuentan; la cláusula de tienda de la política de lectura (131) para `juntar` | **nuevas** |
| `publish_route_plan` (154) | escribe cada fila de `writes`; las cargas son filas | **no** |
| Políticas de `deliveries` (131, 142), grants, realtime | — | **no** (la autocomprobación exige que sigan siendo 4 y que borrar siga siendo la de la 142) |
| `POST /api/route-plan` («Armar rutas») | tras leer el día, `parteOrdenesGrandes` dice qué órdenes no caben y en cuánto; por cada una llama `partir_carga` (con la sesión de quien planifica) y **vuelve a leer el día**; si la función no existe (sin la 157: `PGRST202`/`42883`), planifica como hoy (cargas virtuales) | sí (app) |
| Gestor, filas P y D | etiqueta «carga 1 de 2» en las filas de una familia; en la fila D: «✂» partir (solo si no cabe en el camión de su carril), «✎» pallets de esta carga (familias de dos), «⤵» juntar (si las dos siguen pendientes y la suma cabe) | sí (app) |
| «Mi ruta» | etiqueta «carga 1 de 2» en la fila y en la tarjeta de siguiente parada; el botón de recoger/entregar es el de siempre, por carga | sí (app) |
| Proveedores (`DataState`) | `partirCarga`, `reparteCargas`, `juntarCargas`: el real por `rpc`, el demo en memoria con la misma lista de columnas | sí (app) |
| `lista-unica`, `lectura-de-ruta`, `publicar`, `copia`, `vista` | nada: una carga es una orden. El camino de las cargas virtuales (`otraCarga`, `ordenDeLaParte`, `carga N de M`) **se queda** para leer planes guardados antes y como respaldo sin la 157 | no |

## 4 · Qué NO debe romperse

- **Una orden que cabe entera no se parte nunca:** `partir_carga` solo se llama cuando `parteOrdenesGrandes` la parte (es
  decir, cuando su total supera el camión más grande de los que pueden llevarla), o a mano desde el Gestor, y el botón solo
  sale cuando no cabe en el camión de ese carril.
- **La partición al recoger (012, `OrderModal`) sigue igual:** misma letra, mismo `order_no`; `partir_carga` usa la misma
  regla de letras (la siguiente a la mayor de la familia), así que las dos vías no chocan.
- **Publicar antes/después de la 157:** la función no cambia. Un plan guardado con cargas virtuales (antes de esto) se sigue
  leyendo (`ordenDeLaParte`, `vista.carga`).
- **Sin la 157** la app no se rompe: «Armar rutas» recibe «función no encontrada» y parte en cargas virtuales como hoy; los
  botones del Gestor avisan de que falta la actualización.
- **El chofer no parte ni junta** desde esto (su partición al recoger es otra vía); ventas y almacén tampoco.
- **Nada ajeno cambia:** la matriz comprueba que ninguna otra orden se toca (E1/E2) y la autocomprobación, que las
  políticas siguen siendo las que eran.

## 5 · El SQL, literal

Ver `157_partes_de_orden.sql`. En resumen:

```sql
create or replace function public.guard_delivery_stage() … -- la de la 145 letra por letra, con:
      if r in ('warehouse','driver','logistics','manager','accounting') and new_stage in ('ready','approved','fulfilling','pending') then
create or replace function public.puede_partir_cargas() returns boolean … security definer   -- admin, logistics, manager, accounting, con el módulo
create or replace function public.pallets_de_la_carga(p public.deliveries) returns numeric     -- coalesce(actual, est)
create or replace function public.partir_carga(p_id uuid, p_resto numeric) returns uuid       -- invoker
create or replace function public.reparte_cargas(p_a uuid, p_b uuid, p_pallets_a numeric)     -- invoker
create or replace function public.la_ve_quien_llama(d public.deliveries) returns boolean       -- definer; la cláusula de tienda de la 131
create or replace function public.juntar_cargas(p_a uuid, p_b uuid) returns void              -- SECURITY DEFINER (borra)
revoke execute … from public, anon;  grant execute … to authenticated;                        -- las cuatro de la app; la auxiliar interna sin grant
```

La autocomprobación (`do $chk$`) exige: el guard con la lista nueva **en el código, no en un comentario**, con la marca
«145», las tres salidas de siempre, `security definer` y su disparador; `partir`/`reparte` **no** definer; `juntar` definer
y con `la_ve_quien_llama`, `puede_partir_cargas` y el `delete`; grants (anon no, authenticated sí; la auxiliar sin grant);
la política de borrar sigue siendo la de la 142; la de lectura sigue mirando `tiendas_visibles`; `deliveries` sigue con
sus 4 políticas.

Sin `begin`/`commit` propios. **Sin el número de la decisión dentro del `.sql`**: numerarla no cambia el checksum.
Checksum del registro: `cf3e7ebef2626a79675148174ff3a47b10d00d1fe46562b671bf64ddb4c1f639`
(`node scripts/db/migrate-status.mjs --sum 157_partes_de_orden.sql`, 2026-09-30; una prueba del repo lo recalcula).

## 6 · Matriz de pruebas por rol, con ROLLBACK (la corre el orquestador)

**30 casos.** Se pega entero en `psql` **desde la raíz del repo** (el `\i` es relativo). **Sin `commit` en ningún sitio.**
No depende de ningún dato: crea su propia orden de prueba (`ZZ157`, 15 pallets) como `postgres` y todo se deshace.

Sustituir: `<UUID-ADMIN>` (`admin`), `<UUID-LOGISTICA>` (`logistics`), `<UUID-GERENTE>` (`manager`), `<UUID-CHOFER>` y
`<UUID-CHOFER-2>` (dos `driver`, con `<NOMBRE-CHOFER>` y `<NOMBRE-CHOFER-2>` = su `full_name`), `<UUID-VENTAS>` (`sales` **con**
el módulo de Entregas), `<UUID-ALMACEN>` (`warehouse`), `<TIENDA>` (el `name` de una tienda de Ajustes).

**Ensayado contra producción el 2026-09-30 con ROLLBACK (por el worker, con los UUID reales): 30 de 30 OK** (tres
pasadas: la primera cayó en la autocomprobación —Supabase concede `EXECUTE` a `authenticated` por defecto, así que la
auxiliar interna hay que revocársela por su nombre—; la segunda en `juntar_cargas` —`photos` es **jsonb**, no `text[]`,
y `array_length` no existe para jsonb—; las dos se corrigieron en el `.sql` y se volvió a ensayar). Comprobado después,
en solo lectura, que no quedó nada: ni la orden `ZZ157`, ni las funciones, ni la fila del registro, ni el plan de prueba, y
el guard sigue siendo el de la 145 (sin la marca «157»). E2 contó **366** órdenes ajenas, las mismas antes y después.

```sql
begin;

-- 0. La migración, dentro de la misma transacción (se deshace con el resto).
\i supabase/migrations/157_partes_de_orden.sql

-- X. Una orden de prueba, como postgres: 15 pallets estimados, pending, con factura, en <TIENDA>, de <NOMBRE-CHOFER>.
--    Y una foto de control: cuántas órdenes hay y la última fecha de cambio.
create temp table ctl as select (select count(*) from public.deliveries) as n, (select max(updated_at) from public.deliveries) as u;
create temp table ids (k text primary key, id uuid);
grant all on table ctl, ids to authenticated;
insert into public.deliveries (id, order_no, order_code, stage, order_type, store, pickup_name, invoice_num, est_pallets, delivery_date, delivery_address, assigned_driver, is_training, account)
values ('00000000-0000-0000-0000-000000000157', 999157, 'ZZ157', 'pending', 'Delivery', '<TIENDA>', '<TIENDA>', 'INV-157', 15, current_date, '1 Ensayo St, Pharr TX', '<NOMBRE-CHOFER>', false, 'Ensayo 157');
do $$ declare s text; begin
  select order_suffix into s from public.deliveries where id = '00000000-0000-0000-0000-000000000157';
  raise notice 'X0  la orden de prueba nace sin letra                        esperado null: %', case when s is null then 'OK' else 'MAL '||s end;
end $$;

set local role authenticated;

-- L. Logística parte, reparte y junta.
set local request.jwt.claims to '{"sub":"<UUID-LOGISTICA>","role":"authenticated"}';
do $$ declare b uuid; a public.deliveries%rowtype; nb public.deliveries%rowtype; n int; begin
  b := public.partir_carga('00000000-0000-0000-0000-000000000157', 5);
  insert into ids values ('b', b);
  select * into a from public.deliveries where id = '00000000-0000-0000-0000-000000000157';
  select * into nb from public.deliveries where id = b;
  raise notice 'L1  partir 15 en 10 + 5: la madre queda con 10 y letra a      esperado OK: %', case when a.est_pallets = 10 and a.order_suffix = 'a' then 'OK' else 'MAL '||coalesce(a.est_pallets::text,'null')||' '||coalesce(a.order_suffix,'null') end;
  raise notice 'L2  la hermana: 5 pallets, letra b, misma orden y código     esperado OK: %', case when nb.est_pallets = 5 and nb.actual_pallets is null and nb.order_suffix = 'b' and nb.order_no = 999157 and nb.order_code = 'ZZ157' then 'OK' else 'MAL' end;
  raise notice 'L3  la hermana copia factura, tienda, dirección, chofer, etapa esperado OK: %', case when nb.invoice_num = 'INV-157' and nb.store = a.store and nb.delivery_address = a.delivery_address and nb.assigned_driver = a.assigned_driver and nb.stage = 'pending' then 'OK' else 'MAL' end;
  raise notice 'L4  la hermana nace sin puesto, sin sellos y con created_by  esperado OK: %', case when nb.route_seq is null and nb.pickup_seq is null and nb.load_no is null and nb.pickup_gps_at is null and nb.photos is null and nb.created_by = '<UUID-LOGISTICA>' then 'OK' else 'MAL' end;
  select count(*) into n from public.order_events where delivery_id in ('00000000-0000-0000-0000-000000000157', b) and created_by = '<UUID-LOGISTICA>';
  raise notice 'L5  dos eventos (edited en la madre, created en la hermana)  esperado 2: %', case when n = 2 then 'OK' else 'MAL '||n end;
end $$;
do $$ begin
  begin perform public.partir_carga('00000000-0000-0000-0000-000000000157', 10); raise notice 'L6  partir con resto = total                                 esperado error: MAL (pasó)';
  exception when others then raise notice 'L6  partir con resto = total                                 esperado error: OK (%)', left(sqlerrm, 40); end;
  begin perform public.partir_carga('00000000-0000-0000-0000-000000000157', 0); raise notice 'L7  partir con resto 0                                       esperado error: MAL (pasó)';
  exception when others then raise notice 'L7  partir con resto 0                                       esperado error: OK (%)', left(sqlerrm, 40); end;
end $$;
do $$ declare b uuid := (select id from ids where k = 'b'); pa numeric; pb numeric; begin
  perform public.reparte_cargas('00000000-0000-0000-0000-000000000157', b, 12);
  select est_pallets into pa from public.deliveries where id = '00000000-0000-0000-0000-000000000157';
  select est_pallets into pb from public.deliveries where id = b;
  raise notice 'L8  repartir 12 + 3: la suma sigue siendo 15                  esperado 12 y 3: %', case when pa = 12 and pb = 3 then 'OK' else 'MAL '||pa||' '||pb end;
  begin perform public.reparte_cargas('00000000-0000-0000-0000-000000000157', b, 15); raise notice 'L9  repartir 15 + 0                                          esperado error: MAL (pasó)';
  exception when others then raise notice 'L9  repartir 15 + 0                                          esperado error: OK (%)', left(sqlerrm, 40); end;
end $$;
do $$ declare b uuid := (select id from ids where k = 'b'); c uuid; s text; p numeric; begin
  c := public.partir_carga(b, 1);
  select order_suffix into s from public.deliveries where id = c;
  raise notice 'L10 partir la hermana b (3) en 2 + 1: la nueva es la c        esperado c: %', case when s = 'c' then 'OK' else 'MAL '||coalesce(s,'null') end;
  perform public.juntar_cargas(b, c);
  select est_pallets, order_suffix into p, s from public.deliveries where id = b;
  raise notice 'L11 juntar c en b: b vuelve a 3 y SIGUE con letra (queda a)    esperado 3 y b: %', case when p = 3 and s = 'b' and not exists (select 1 from public.deliveries where id = c) then 'OK' else 'MAL '||coalesce(p::text,'null')||' '||coalesce(s,'null') end;
end $$;

-- F. Publicar con dos cargas reales: un borrador HECHO A MANO (como postgres) que escribe a y b, publicado por logística.
reset role;
insert into public.route_plans (id, plan_date, status, source, version, input, result, writes)
values ('00000000-0000-0000-0000-000000000158', current_date, 'draft', 'engine', 99999,
        jsonb_build_object('ordenes', (select jsonb_agg(jsonb_build_object('id', id, 'updated_at', updated_at)) from public.deliveries where order_no = 999157)),
        '{}'::jsonb,
        (select jsonb_agg(jsonb_build_object('id', id, 'assigned_driver', '<NOMBRE-CHOFER>', 'route_seq', case when order_suffix = 'a' then 0 else 1 end, 'pickup_seq', case when order_suffix = 'a' then -0.5 else 0.5 end, 'load_auto', true)) from public.deliveries where order_no = 999157));
set local role authenticated;
set local request.jwt.claims to '{"sub":"<UUID-LOGISTICA>","role":"authenticated"}';
do $$ declare r jsonb; n int; begin
  r := public.publish_route_plan('00000000-0000-0000-0000-000000000158', '[]'::jsonb);
  raise notice 'F1  publicar escribe las DOS cargas (sin tocar la función)     esperado 2: %', case when (r->>'written')::int = 2 then 'OK' else 'MAL '||(r->>'written') end;
  select count(*) into n from public.deliveries where order_no = 999157 and route_seq is not null and pickup_seq is not null and assigned_driver = '<NOMBRE-CHOFER>';
  raise notice 'F2  cada carga con su puesto y su recogida                    esperado 2: %', case when n = 2 then 'OK' else 'MAL '||n end;
end $$;

-- C. El chofer ve sus cargas, marca cada una por separado, y no parte ni junta.
set local request.jwt.claims to '{"sub":"<UUID-CHOFER>","role":"authenticated"}';
do $$ declare n int; begin
  select count(*) into n from public.deliveries where order_no = 999157;
  raise notice 'C1  el chofer ve las dos cargas (las dos son suyas)            esperado 2: %', case when n = 2 then 'OK' else 'MAL '||n end;
  begin perform public.partir_carga('00000000-0000-0000-0000-000000000157', 2); raise notice 'C2  el chofer no parte                                       esperado error: MAL (pasó)';
  exception when others then raise notice 'C2  el chofer no parte                                       esperado error: OK (%)', left(sqlerrm, 40); end;
  begin perform public.juntar_cargas('00000000-0000-0000-0000-000000000157', (select id from ids where k = 'b')); raise notice 'C3  el chofer no junta                                       esperado error: MAL (pasó)';
  exception when others then raise notice 'C3  el chofer no junta                                       esperado error: OK (%)', left(sqlerrm, 40); end;
end $$;
-- Logística pasa la carga b a otro chofer: el primero deja de verla.
set local request.jwt.claims to '{"sub":"<UUID-LOGISTICA>","role":"authenticated"}';
update public.deliveries set assigned_driver = '<NOMBRE-CHOFER-2>' where id = (select id from ids where k = 'b');
set local request.jwt.claims to '{"sub":"<UUID-CHOFER>","role":"authenticated"}';
do $$ declare n int; begin
  select count(*) into n from public.deliveries where order_no = 999157;
  raise notice 'C4  con b en otro chofer, el primero ve solo a                 esperado 1: %', case when n = 1 then 'OK' else 'MAL '||n end;
end $$;
set local request.jwt.claims to '{"sub":"<UUID-CHOFER-2>","role":"authenticated"}';
do $$ declare n int; begin
  select count(*) into n from public.deliveries where order_no = 999157;
  raise notice 'C5  el segundo chofer ve solo b                               esperado 1: %', case when n = 1 then 'OK' else 'MAL '||n end;
end $$;
-- Las dos pasan a ready (como postgres y SIN sesión, que es lo que haría almacén), y cada chofer marca la suya.
reset role;
set local request.jwt.claims to '';
update public.deliveries set stage = 'ready' where order_no = 999157;
set local role authenticated;
set local request.jwt.claims to '{"sub":"<UUID-CHOFER>","role":"authenticated"}';
do $$ declare n int; begin
  update public.deliveries set stage = 'picked_up' where id = '00000000-0000-0000-0000-000000000157'; get diagnostics n = row_count;
  raise notice 'C6  el chofer 1 recoge SU carga a                              esperado 1: %', case when n = 1 then 'OK' else 'MAL '||n end;
  update public.deliveries set stage = 'picked_up' where id = (select id from ids where k = 'b'); get diagnostics n = row_count;
  raise notice 'C7  …y no puede tocar la b (no la ve)                         esperado 0: %', case when n = 0 then 'OK' else 'MAL '||n end;
end $$;
reset role;
set local request.jwt.claims to '';
do $$ declare ea text; eb text; begin
  select stage into ea from public.deliveries where id = '00000000-0000-0000-0000-000000000157';
  select stage into eb from public.deliveries where id = (select id from ids where k = 'b');
  raise notice 'C8  la familia queda a = picked_up, b = ready (cada carga su etapa) esperado OK: %', case when ea = 'picked_up' and eb = 'ready' then 'OK' else 'MAL '||ea||' '||eb end;
end $$;
set local role authenticated;
set local request.jwt.claims to '{"sub":"<UUID-LOGISTICA>","role":"authenticated"}';
do $$ begin
  begin perform public.juntar_cargas('00000000-0000-0000-0000-000000000157', (select id from ids where k = 'b')); raise notice 'C9  juntar con a ya recogida                                 esperado error: MAL (pasó)';
  exception when others then raise notice 'C9  juntar con a ya recogida                                 esperado error: OK (%)', left(sqlerrm, 40); end;
end $$;

-- V. Ventas (con el módulo): ni parte ni junta.
set local request.jwt.claims to '{"sub":"<UUID-VENTAS>","role":"authenticated"}';
do $$ begin
  begin perform public.partir_carga((select id from ids where k = 'b'), 1); raise notice 'V1  ventas no parte                                           esperado error: MAL (pasó)';
  exception when others then raise notice 'V1  ventas no parte                                           esperado error: OK (%)', left(sqlerrm, 40); end;
  begin perform public.juntar_cargas('00000000-0000-0000-0000-000000000157', (select id from ids where k = 'b')); raise notice 'V2  ventas no junta                                           esperado error: MAL (pasó)';
  exception when others then raise notice 'V2  ventas no junta                                           esperado error: OK (%)', left(sqlerrm, 40); end;
end $$;

-- W. Almacén: tampoco (parte al recoger por su camino de siempre, no al planificar).
set local request.jwt.claims to '{"sub":"<UUID-ALMACEN>","role":"authenticated"}';
do $$ begin
  begin perform public.partir_carga((select id from ids where k = 'b'), 1); raise notice 'W1  almacén no parte                                          esperado error: MAL (pasó)';
  exception when others then raise notice 'W1  almacén no parte                                          esperado error: OK (%)', left(sqlerrm, 40); end;
end $$;

-- G. El gerente (office) sí: parte la b (ready, 3) en 2 + 1 y la vuelve a juntar.
set local request.jwt.claims to '{"sub":"<UUID-GERENTE>","role":"authenticated"}';
do $$ declare b uuid := (select id from ids where k = 'b'); c uuid; p numeric; begin
  c := public.partir_carga(b, 1);
  perform public.juntar_cargas(b, c);
  select est_pallets into p from public.deliveries where id = b;
  raise notice 'G1  el gerente parte y junta la carga b                       esperado 3: %', case when p = 3 and not exists (select 1 from public.deliveries where id = c) then 'OK' else 'MAL '||coalesce(p::text,'null') end;
end $$;

-- A. Admin, igual; y la carga juntada queda en el rastro de la 142.
set local request.jwt.claims to '{"sub":"<UUID-ADMIN>","role":"authenticated"}';
do $$ declare b uuid := (select id from ids where k = 'b'); c uuid; n int; begin
  c := public.partir_carga(b, 2);
  perform public.juntar_cargas(b, c);
  select count(*) into n from public.deliveries_borradas where delivery_id = c;
  raise notice 'A1  admin parte y junta; la juntada queda en deliveries_borradas esperado 1: %', case when n = 1 then 'OK' else 'MAL '||n end;
end $$;

-- E. Nada más cambió: ninguna otra orden se tocó.
reset role;
set local request.jwt.claims to '';
do $$ declare n0 bigint; u0 timestamptz; k int; begin
  select ctl.n, ctl.u into n0, u0 from ctl;
  select count(*) into k from public.deliveries where order_no <> 999157 and updated_at > u0;
  raise notice 'E1  ninguna orden ajena cambió                               esperado 0: %', case when k = 0 then 'OK' else 'MAL '||k end;
  select count(*) into k from public.deliveries where order_no <> 999157;
  raise notice 'E2  las demás órdenes siguen siendo las mismas                 esperado %: %', n0, case when k = n0 then 'OK' else 'MAL '||k end;
end $$;

rollback;
```

Nota sobre F: el `insert` en `route_plans` se hace como `postgres` (la tabla tiene sus políticas, 133) para no depender de que
logística pueda crear un borrador a mano; lo que se prueba es que la función de la 154, **sin tocarla**, escribe las dos
cargas. Nota sobre C7: lo que mide es la política de lectura (131) aplicada a un UPDATE con `where id = …` —un chofer no ve
la carga del otro, así que no la puede marcar—; no es nada nuevo de la 157, pero es lo que hace que «cada chofer marca su
carga» sea verdad en la base y no solo en la pantalla.

## 7 · Mediciones de solo lectura (hechas el 2026-09-30; repetirlas antes de aplicar)

Con `begin read only … rollback` contra producción:

- `schema_migrations` ≥ 150: 150, 151, 152, 153, **154, 155** (la 156 todavía no). `deliveries.pickup_seq` existe.
- `delivery_parts` no existe. `deliveries` lleva `order_suffix`, `route_seq`, `load_no`, `pickup_seq`.
- Cargas partidas al recoger (012): **una** familia en toda la historia (`a` y `b`, las dos `delivered`).
- Órdenes pendientes con más de 10 pallets ahora mismo: **0**. Capacidades: `driver_capacity` = 10 en los cuatro choferes;
  `default_truck_capacity` nulo.
- Planes de los últimos 14 días con partes: **el borrador v1 de hoy, 2026-09-30**: `f14f208d…` (`FT197`, 14 pallets contados,
  `RDZ Pharr`) partida en `#a`/`#b`; solo `#a` tiene paradas (P5/D5, Julio Jijon); `writes` lleva una entrada
  (`route_seq 4`, `pickup_seq 3.5`). La orden está hoy `delivered` con `assigned_driver` nulo.
- `guard_delivery_stage` vigente: lleva la marca «145» y no la «151» (13.892 caracteres). Es la de la 145.
- Realtime (`supabase_realtime`): `deliveries` y `order_events`. Una carga es una fila de `deliveries`: ya se escucha.
- Perfiles por rol: accounting 8, admin 4, driver 4, logistics 1, manager 6, sales 14, warehouse 4.
- Claves foráneas hacia `deliveries`: `order_events`, `notifications`, `delivery_surveys` **cascade**; `redelivery_of`,
  `driver_incidents`, `route_plan_stops` **set null**. Borrar una carga juntada no deja nada colgando; el disparador
  `deliveries_guardar_borrada` (142) guarda la fila, sus eventos y sus avisos.
- Disparadores sobre `deliveries`: `deliveries_guard_invoice`, `deliveries_guard_stage`, `deliveries_guardar_borrada`,
  `deliveries_touch`. Políticas de `order_events`: INSERT solo `created_by = auth.uid()` con el módulo; SELECT con el módulo.

## 8 · Reversión

Está al final del `.sql`, para pegar a mano en una transacción propia: (1) volver a aplicar **solo** el bloque del guard de
la 145; (2) `drop function` de las seis (`juntar_cargas`, `reparte_cargas`, `partir_carga`, `la_ve_quien_llama`,
`pallets_de_la_carga`, `puede_partir_cargas`); (3) borrar la fila del registro. Las cargas ya partidas **se quedan**: son
órdenes `#Xa`/`#Xb` y se leen, mueven y marcan como cualquier otra. La app sin las funciones vuelve a partir en cargas
virtuales al «Armar rutas» y apaga los botones al recibir «función no encontrada».

## 9 · Lo que le toca al orquestador (en este orden)

1. Leer §1 y la entrada `D-NEXT` de `DECISIONS.md`: el modelo **no** es la tabla `delivery_parts` del encargo, y las
   decisiones 2 («la orden pasa a `delivered` cuando todas sus partes…») y 3 se cumplen **por familia**, sin fila madre.
   Si eso no cuadra, parar aquí.
2. Respaldo (`pg_dump` reciente o respaldo activo). `node scripts/db/migrate-status.mjs` (saldrá la 156 y la 157
   pendientes).
3. Repetir §7 (solo lectura) y la matriz de §6 con ROLLBACK, con los UUID reales. Esperado: 35 OK.
4. Aplicar `157_partes_de_orden.sql` en una transacción. `migrate-status` después.
5. Numerar la decisión (`D-NEXT` → `D-0XX`), sin tocar el `.sql` (no lleva el número).
6. Probar en vivo con una orden de prueba (`is_training`, o una real de más de 10 pallets el día que la haya): «Armar
   rutas» debe dejar dos filas `#Xa`/`#Xb` en Órdenes y 2 P + 2 D en el plan; el Gestor con «carga 1 de 2» y los botones;
   «Mi ruta» con las dos paradas.

## 10 · Lo que NO se ha medido

- La app contra la 157 aplicada (la ruta `POST /api/route-plan` llamando `partir_carga` de verdad): está probada con un
  cliente simulado (`src/lib/cargas-partidas.test.ts`) y el SQL con la matriz, no las dos juntas.
- Un día real con una orden grande en producción desde el Gestor (los botones): medido en el demo por CDP, no contra la base.
- Cuántos avisos al cliente salen con una orden partida (dos, uno por carga): es lo que hace el código de avisos por fila;
  no se ha disparado ninguno (regla permanente).
