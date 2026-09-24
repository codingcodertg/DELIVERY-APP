# Plan 142 · Almacén deshace un paso, borrar se acota a borradores, y cada borrado deja rastro

Plan en papel exigido por `CLAUDE.md` («Antes de tocar RLS, triggers o permisos en producción»).
Molde: `docs/PLAN-A-2a-profiles-rls.md`.

**Estado (2026-09-23):** primera versión leída por el orquestador, que **midió M1-M12 en producción
(solo lectura)** y trajo las respuestas del dueño. Esta versión las incorpora: office y gerente
**borran cualquier borrador de su tienda y su grupo**, y **cada orden borrada deja rastro** en una
tabla nueva. Las decisiones del orquestador (picked_up→ready sin tienda, motivo en pantalla, almacén
sin approved→pending) coinciden con lo propuesto. **Pendiente de aprobar esta versión.**

**Pedido del dueño, literal:** *«deja que warehouse y office tengan la opción de deshacer un stage,
como por ejemplo deshacer un delivered o un fulfilling o un ready; y también que los draft, si no los
ocupan, los puedan borrar o seguir editando; igual las duplicadas»*.

**La migración está escrita y NO aplicada:** `supabase/migrations/142_deshacer_almacen_y_borrar_borradores.sql`.
Aplicarla es del orquestador, después del merge, con respaldo hecho y `migrate-status` antes y
después. **No hay código de pantalla en esta rama**, a propósito: primero se aprueba esto.

> **Ojo con el número.** La rama `visibilidad-almacen-y-ventana` tiene un
> `docs/PLAN-142-visibilidad-almacen-y-ventana.md`, pero su propio plan dice *«NO hay migración 142»*
> (línea 9). La migración 142 sigue libre; los dos documentos se llaman «142» por el orden en que
> se escribieron, no porque compartan migración. Si esa rama acaba trayendo una migración, una de
> las dos se renumera al fusionar.

Lo del repo sale de **leer el código de `b1a847cf`** (main); este worktree no tiene `.env.local` y
no ha ejecutado nada contra la base. **Lo de la base lo midió el orquestador** el 2026-09-23 con las
consultas de §7, y aparece marcado *«medido en producción»*. Lo que sigue sin medir está en §9.

---

## 0 · Resumen

1. **Office ya tiene todo lo de deshacer** (D-361, 139). Lo único que le falta de lo pedido es
   **borrar borradores**, y eso hoy solo lo enseña la pantalla al admin. Con la 142, office y gerente
   borran **cualquier borrador de su tienda y su grupo** (respuesta del dueño).
2. **Almacén ya deshacía en la base tres de los cuatro pasos**, en cualquier tienda y sin motivo; la
   pantalla solo le enseñaba uno. Lo nuevo en la base es `fulfilling → approved` y **el límite de
   tienda**.
3. **El agujero de DELETE está confirmado, en el repo y medido en producción:** cualquiera con el
   módulo borra cualquier orden que vea, no hay trigger de DELETE (M2), y **el borrado se lleva el
   historial y los avisos** (`order_events` y `notifications` en cascada, M4), así que no queda rastro.
   Desde el 2026-07-15 se han borrado **4 órdenes** (M5).
4. **Seguir editando un borrador y un duplicado ya funciona** para todos menos almacén (D-286). No se
   toca.
5. Para que «solo tu propio borrador» signifique algo, **`created_by` deja de poder reescribirse**:
   hoy ventas puede ponerse como autor del borrador de otro (en producción nadie lo ha hecho: M9 = 0).
6. **Cada orden borrada deja rastro** (pedido del dueño): tabla `deliveries_borradas`, escrita por un
   trigger `before delete` con la fila, sus eventos y sus avisos, quién y cuándo. Solo se inserta;
   nadie la cambia ni la borra, admin y service-role incluidos. La lee solo el admin.

---

## 1 · Qué ve y qué puede hacer cada rol HOY

«Office» es el rol `accounting`; «Gerente de Oficina» es `manager` (`constants.ts:839-842`).

### 1a. Deshacer un paso

`PASO_ATRAS` (`src/lib/constants.ts:1110-1112`): `delivered→picked_up`, `picked_up→ready`,
`ready→fulfilling`, `fulfilling→approved`, `approved→pending`.

| Rol | Pantalla (qué botón ve) | Base (`guard_delivery_stage`, def. vigente = 139) |
|---|---|---|
| admin | «Deshacer etapa» en los 5 pasos (`puedeDeshacer`, `constants.ts:1118-1121`; botón `OrderModal.tsx:2389`) | todo: sale del guard en `139:88` |
| manager / accounting | igual que admin, con motivo obligatorio (`OrderModal.tsx:2356-2396`, `deshacerEtapa` en `:844-851`) | los 5 pasos: `139:202` (approved→pending) y `139:209-213` |
| **warehouse** | **solo `ready→fulfilling`**, «Volver a preparando» (`OrderModal.tsx:2957-2963`, `volverAPreparar` `:818-829`), **sin motivo** (nota fija) y en cualquier orden que abra | **`ready→fulfilling`, `picked_up→ready`, `delivered→picked_up`**, en **cualquier tienda** (`139:218-226`). **No** `fulfilling→approved` ni `approved→pending` |
| driver | nada de «deshacer»; «Dejar en tienda» (`picked_up→ready`, D-224) en su parada | `picked_up→ready` (`139:194`) |
| sales | nada | nada (`139:183-217` no le da ningún paso atrás) |
| logistics | ve «Desbloquear» en `approved` porque tiene la capacidad `approve` (`OrderModal.tsx:2935-2937`) | **nada**: el guard no le da ningún cambio de etapa (`139:229`). Es un botón que la base rechaza; ya anotado fuera de alcance en `DECISIONS.md:17769`. **No se toca aquí** |

Qué ve almacén en la base: solo etapas `approved…delivered` (`131:215`), **de todas las tiendas**:
`tiendas_visibles()` lo exime (`131:138`). El corte por tienda vive solo en su pantalla
(`warehouse/page.tsx:47-84`: su tienda y su grupo, las tres columnas de tienda, y la dirección de
recogida).

### 1b. Borrar una orden

| Capa | Hoy |
|---|---|
| Pantalla | Botón «Eliminar» **solo si `me.role === "admin"`** (`OrderModal.tsx:2435-2437`), cualquier etapa. Llama a `remove` (`:1107-1116`) → `deleteDelivery` (`data-provider.tsx:1270-1290`). No hay ningún otro sitio que borre órdenes (`grep deleteDelivery`: solo `OrderModal.tsx:1113`) |
| Base, política | `"deliveries delete"`, **creada en `131:195-197` y no tocada después** (`grep` de las 132-141: nada). `for delete to authenticated using ((select public.has_deliveries_access()))` |
| Base, trigger | **Ninguno de DELETE.** El guard es `before insert or update` (`048:119`, idéntico en 017-042); el único otro trigger del repo sobre `deliveries` es `deliveries_touch`, `before update` (`schema.sql:160`) |
| Base, lectura | Un `DELETE … WHERE id = …` además necesita que la fila pase la política de SELECT. O sea: **cualquiera con el módulo borra cualquier orden que pueda leer**. Para ventas/office/gerente, eso es todo lo de sus tiendas visibles; para almacén, todo lo de `approved` en adelante de todas las tiendas |
| Rastro | **Ninguno.** `order_events.delivery_id … on delete cascade` (`schema.sql:129`), igual `notifications` (`schema.sql:145`, `001:11`). La 100 declaró `order_events` *append-only, incluso para admin* (`100:64`), pero la cascada de la FK se salta la RLS: borrar la orden borra su historial. `security_events` no sirve: su `target_id` referencia `auth.users` (`053:23`), es de usuarios, no de órdenes. Sobreviven solo referencias sueltas: `route_plan_stops.order_ref` (texto, `133:107`) con `delivery_id` a null, y `driver_incidents.delivery_id` a null (`041:11`) |

**Veredicto: el agujero está confirmado, en el repo y en producción.** Medido por el orquestador el
2026-09-23: los únicos triggers de `deliveries` son `deliveries_guard_stage` y `deliveries_touch`,
ambos `before insert/update` (M2); `"deliveries delete"` es la de la 131 (M3); y al borrar una orden
se van en cascada `order_events` **y `notifications`**, mientras `driver_incidents`,
`route_plan_stops` y `deliveries.redelivery_of` quedan a `null` (M4). Un vendedor, un chofer o un
almacenista pueden borrar una orden entregada llamando a PostgREST, y no queda ni la orden ni su
historial.

**Cuánto se ha borrado (M5, medido en producción):** desde el `stats_reset` del **2026-07-15**,
`deliveries` **4** filas borradas, `order_events` **946**, `notifications` **141**. **Cuatro órdenes no
explican 946 eventos**, y ni una migración ni el código actual borran eventos (`clearTrainingData`
hoy solo limpia un overlay en memoria). **Queda sin explicar**; una versión vieja de la app es la
sospecha, no una medición. M6: `order_no` va de 1 a 339 con 245 filas (94 huecos, que no prueban
borrados: un INSERT rechazado también consume número). M7: 0 paradas de plan huérfanas.

Y un detalle que importa para la pantalla: `deleteDelivery` hace `.delete().eq("id", id)` **sin
`.select()`** (`data-provider.tsx:1286`) y quita la fila de la lista **antes** de saber si se borró.
Un DELETE que la RLS no deja pasar **no da error: borra cero filas y vuelve limpio**. Con el botón
solo para admin nunca se notó; en cuanto lo vea alguien más, hay que mirar cuántas filas volvieron.

### 1c. Seguir editando un borrador, y el duplicado

**Ya funciona, y no se cambia.**

- `canEditFields`: en `draft` edita **cualquier rol menos almacén** (`constants.ts:1144`, D-286). El
  botón «Editar» sale de ahí (`OrderModal.tsx:2900-2902`) y los campos también
  (`editable = isNew || (startEditing && canEditFields(...))`, `:107`).
- Base: misma etapa en `draft` → ventas y chofer (`139:114`), gerente/office (`139:175`), logística
  (`139:179`). Almacén no (`139:176` empieza en `approved`), y además la RLS no le deja ver un
  borrador (`131:215`).
- Ventas **ve los borradores de cualquiera** (`visibilidad-ventas.ts:39`, D-286).
- **Duplicar crea un borrador**: `borradorDuplicado` pone `stage: "draft"` (`order-duplicate.ts:45`);
  la ficha se queda abierta en la copia (`OrderModal.tsx:1140-1159`). El botón «Duplicar» lo ve
  quien tiene `create` (`:2438-2440`): admin, manager, sales, accounting (`constants.ts:829-843`).
  El duplicado es un borrador más: se edita igual, y con este plan **lo borra quien lo duplicó**.

Lo único que el dueño pide de borradores y **no** existe es **borrarlos** sin ser admin.

---

## 2 · Qué se propone, rol por rol (DESPUÉS)

### 2a. Deshacer

| Rol | Pasos | Dónde | Motivo |
|---|---|---|---|
| admin | los 5 (sin cambio) | todas | obligatorio en pantalla (sin cambio) |
| manager / accounting | los 5 (sin cambio) | lo que vean (sin cambio) | obligatorio en pantalla (sin cambio) |
| **warehouse** | **`delivered→picked_up`, `ready→fulfilling`, `fulfilling→approved`** | **solo órdenes de su tienda y su grupo** | **obligatorio en pantalla**, como office |
| warehouse | `picked_up→ready` | **cualquier tienda, como hoy** | — (ver abajo) |
| sales, driver, logistics | sin cambio | | |

**Por qué almacén no hace `approved → pending`:** es «desaprobar», y aprobar no es suyo. Además,
en cuanto la orden vuelve a `pending` almacén **deja de verla** (`131:215`): se quedaría sin poder
deshacer su propio error.

**Por qué `picked_up → ready` se queda sin límite de tienda:** es el mismo salto que **«Dejar en
tienda»** (D-224, `LeaveAtStore.tsx:59`), que almacén hace porque tiene la capacidad `deliver`
(`constants.ts:834`) y que **cambia `store`/`pickup_name` en la misma escritura** a la tienda donde
se deja. Acotarlo por la tienda de antes rompería dejar en tu tienda una carga de otra. Es también
la vuelta del chofer, que no tiene límite de tienda. **La pantalla sí puede acotar** el botón de
«Deshacer» en `picked_up` a sus tiendas: una pantalla más estrecha que la base no produce errores.

**Cambio para quien trabaja hoy (se dice porque quita algo):** `ready→fulfilling` y
`delivered→picked_up` **dejan de valer en órdenes de otra tienda** para almacén. Hoy el botón
«Volver a preparando» (D-287) funciona en cualquier orden que almacén abra. La consulta M11 (§7)
mide si alguien lo ha usado fuera de su tienda.

**Almacén sin tienda** (`profiles.store` vacío): **no deshace** (la función devuelve `false`). Falla
cerrado. Hoy su pantalla, sin tienda, le enseña **todo** (`warehouse/page.tsx:84`), así que la
pantalla tiene que esconder el botón de deshacer si `me.store` está vacío, o sería un botón que la
base rechaza (D-044). M10 cuenta cuántos almacenistas no tienen tienda.

#### ¿Puede el guard saber la tienda? Sí.

La función se llama en el trigger, que ve `OLD` entero y puede leer `profiles.store` de
`auth.uid()` y `settings.stores` (el guard ya lee `settings` por fila con `store_auto_approves`,
`020:12-17`). La 142 añade `public.orden_de_mis_tiendas(store, pickup_name, delivery_name,
pickup_address)`, que replica el corte de la pantalla:

- **Mis tiendas** = `profiles.store` + las de su grupo (`settings.stores[*].group`, D-293), como
  `tiendasDelGrupo` (`store-group.ts:39-47`). La propia cuenta siempre, aunque ya no esté en Ajustes.
- **La orden es mía** si alguna de **sus tres columnas** de tienda —`store`, `pickup_name`,
  `delivery_name`, como la 131— es de mis tiendas, **o** su `pickup_address` es la dirección de una
  de ellas (como `atStore`, `warehouse/page.tsx:75`).
- Normaliza igual que `normalizaLugar`/`nombreNormalizado` (espacios colapsados, recortado,
  minúsculas); el grupo, como `grupoNormalizado` (recortado, minúsculas).

**Es más ancha que la pantalla, a propósito:** la pantalla solo mira `delivery_name` en los tipos
tienda-a-tienda (`tiendasDeLaOrden`); la función mira las tres siempre, porque el tipo vive en un
jsonb (`settings.order_type_rules`) y leerlo por fila es lo que la 080 quitó. **Más ancha no produce
botones que la base rechace; más estrecha sí.** La consecuencia: un almacenista podría deshacer en
la base una orden de otra tienda cuyo `delivery_name` sea la suya aunque no sea Intertienda. Es un
caso de laboratorio y la pantalla no se lo ofrece.

**Límite que hay que decir:** almacén puede **editar cualquier campo** de una orden en
`approved…delivered` de cualquier tienda (`139:176`, tramo de misma etapa). O sea que podría poner
`store` = la suya en una escritura y deshacer en la siguiente. El límite de tienda del deshacer es
real para quien usa la app, **no** contra alguien que llame a PostgREST a propósito. Cerrar eso es
acotar la edición de almacén por tienda, que es otro encargo (y lo que la rama
`visibilidad-almacen-y-ventana` estudia para la lectura).

#### El motivo obligatorio

Como en la 139, **lo pide la pantalla y viaja en la nota de `order_events`**; la base **no** lo
comprueba (no hay columna y el evento se escribe después, en otra petición: `data-provider.tsx:1365`).
Para almacén, la pantalla debe usar el mismo diálogo de motivo que office (`OrderModal.tsx:2356-2396`)
y **«Volver a preparando» pasa a pedir motivo** (hoy escribe una nota fija, `:827`). Si el dueño
quiere que la base lo exija, hace falta una columna o una RPC: fuera de esta migración.

### 2b. Borrar

**Office y gerente borran cualquier borrador de su tienda y su grupo, sea de quien sea.** La
primera versión de este plan proponía que no, porque anular deja rastro y borrar no. **El dueño
respondió que sí** (2026-09-23), y lo aplica a `accounting` **y** `manager`, que para él son los dos
«office». La objeción del rastro desaparece con §2d: ahora borrar también deja constancia.

- «Su tienda» se decide con **la misma función** que el deshacer de almacén,
  `orden_de_mis_tiendas` (su tienda y su grupo, las tres columnas de tienda o la dirección de
  recogida). La lectura (131, `tiendas_visibles`) además tiene que dejarle ver la fila.
- **Office o gerente sin tienda** (`profiles.store` vacío): solo borran **sus propios** borradores.
  Falla cerrado. **No medido** cuántos hay (M10 midió solo almacén); M13 lo cuenta.
- M8 (medido en producción): hoy hay **2 borradores**, los dos de `accounting`, ninguno de más de 14
  días.

| Rol | Hoy (base) | Después |
|---|---|---|
| admin | cualquier orden que vea (todas) | **igual** |
| manager, accounting | cualquier orden que vea | **cualquier borrador de su tienda y su grupo**, y el suyo propio esté donde esté |
| sales, driver, logistics | cualquier orden que vea | **solo su propio borrador** |
| warehouse | cualquier orden que vea (`approved`+) | solo su propio borrador: en la práctica **nada**, almacén no crea borradores (`139:90-111`) |

**Duplicados:** nacen `draft` con `created_by` = quien duplicó (`data-provider.tsx:934`). Los borra
quien los duplicó, y office/gerente de esa tienda. No necesitan regla aparte.

### 2c. `created_by` deja de reescribirse (necesario para 2b)

Medido: el cliente **siempre** manda `created_by: me.id` al insertar (`data-provider.tsx:934`),
pero **la base no lo comprueba ni lo fija**: el guard no mira `created_by` en INSERT, y el tramo de
misma etapa de ventas en `draft` (`139:114`) devuelve `NEW` sin mirar columnas. O sea que hoy ventas
puede escribir `created_by = <yo>` en el borrador de otro. Con la política de 2b, eso sería
«hacerme autor y borrarlo». La 142:

- **INSERT** de un no-admin: `NEW.created_by := auth.uid()` (como `canceled_by` en la 122). No rompe
  nada de la app: ya manda ese mismo valor.
- **UPDATE** de un no-admin: si `created_by` cambia → `'Who created an order is history: it cannot be
  rewritten'`. El guardado de la ficha manda la orden entera (`OrderModal.tsx:549-571`), con el
  `created_by` que ya tenía, así que no cambia.
- El admin sale antes (`139:88`) y puede corregirlo.

De paso **endurece la 125 y la 138**, que dan permisos a ventas «en SU orden» mirando `created_by`
(`139:121`, `139:138`) y hoy se podían saltar reescribiéndolo. M9 (medido en producción): **0**
órdenes cuyo `created_by` difiera del autor de su evento `created`; nadie lo ha usado.

### 2d. El rastro de cada orden borrada (pedido del dueño)

Tabla nueva **`public.deliveries_borradas`**, una fila por orden borrada:

| Columna | Qué guarda |
|---|---|
| `delivery_id`, `order_no` | la orden (sin FK: ya no existe) |
| `fila` | la orden entera, `to_jsonb(OLD)` |
| `eventos` | sus `order_events`, en `jsonb`, por fecha |
| `notificaciones` | sus `notifications`, en `jsonb`, por fecha |
| `borrada_por` | `auth.uid()`. **NULL cuando borra service-role** (o postgres sin sesión): es el dato, «lo borró el sistema, no una persona» |
| `borrada_por_rol` | `profiles.role` de quien borró, en ese momento |
| `borrada_en` | `now()` |

**Quién la escribe:** un trigger `before delete … for each row` sobre `deliveries`
(`deliveries_guardar_borrada`), con una función `security definer`. **Before**, porque a esa altura
los hijos todavía existen: la cascada de la FK corre después. Y es un **trigger**, no la app: **no se
lo salta nadie que borre por SQL, service-role incluido** (solo el dueño de la tabla, con
`session_replication_role = replica` o deshabilitándolo). Si el DELETE se deshace, la fila del rastro
se deshace con él: el rastro dice lo que **se borró**, no lo que se intentó.

**Solo se inserta, y nadie la toca:**

- RLS activada, **una sola política, de SELECT, para el admin** (`is_admin()`). Sin políticas de
  escritura.
- `revoke insert, update, delete, truncate` a `authenticated` **y a `service_role`**; `revoke all` a
  `anon`.
- **Un trigger `before update or delete` por fila y otro `before truncate`** que lanzan error siempre.
  Los privilegios no frenan al dueño de la tabla ni a quien se los devuelva; el trigger sí, y
  service-role no se lo salta. Queda fuera solo quien pueda deshabilitar triggers (postgres).

**Qué no cubre:** lo borrado **antes** de aplicar la 142 (las 4 órdenes de M5) no se recupera. Y un
borrado que corra con los triggers deshabilitados no deja rastro: eso solo lo puede hacer el dueño
de la base.

**Revertir la 142 NO borra esta tabla** (§8): guarda órdenes que ya no existen en ningún otro sitio.

---

## 3 · Inventario de lecturas y escrituras que toca

| Objeto | Qué | Quién lo usa |
|---|---|---|
| `public.guard_delivery_stage()` | **reemplazada** (desde la def. vigente, la de la 139) | trigger `deliveries_guard_stage`, en cada INSERT/UPDATE de `deliveries` |
| `public.orden_de_mis_tiendas(text,text,text,text)` | **nueva**, `stable security definer`, `revoke … from public, anon`, `grant execute … to authenticated` (en una política corre como quien consulta) | el guard (almacén deshace) y la política de borrar (office borra) |
| política `"deliveries delete"` | `alter policy` (no drop: sin ventana sin política) | todo DELETE de `deliveries` por `authenticated` |
| `public.deliveries_borradas` | **tabla nueva**, RLS, solo SELECT para admin | la escribe solo el trigger |
| `public.guardar_orden_borrada()` + trigger `deliveries_guardar_borrada` | **nuevos**, `before delete` por fila en `deliveries`, `security definer` | cada DELETE de `deliveries`, venga de quien venga |
| `public.deliveries_borradas_inmutable()` + triggers `deliveries_borradas_inmutable` / `deliveries_borradas_sin_truncate` | **nuevos** | cualquier UPDATE, DELETE o TRUNCATE de la tabla del rastro |
| Lee al borrar | `order_events`, `notifications` de la orden | desde la función definer, aunque quien borra no los vea |
| Lee | `profiles.store` (de `auth.uid()`), `settings.stores` | ambas solo las escribe el admin: `profiles_guard_privileged` (`131:100-118`), `settings update admin` (`100:35-36`) |

No se tocan: la política de lectura (131), las de insert/update (131), las políticas de
`order_events`, columnas de `deliveries`, filas. Service-role (`auth.uid()` null) sigue saliendo del
guard en la primera línea y salta la RLS, **pero no el trigger del rastro**.

---

## 4 · Qué NO debe romperse

1. **Office y gerente, idénticos:** entregar ya (4 etapas) y deshacer (5 pasos). La 142 no toca su
   rama; la autocomprobación del `.sql` lo verifica por texto.
2. **Almacén hacia delante, idéntico y en cualquier tienda:** `approved→fulfilling→ready→picked_up
   →delivered`. Su edición en misma etapa (`139:176`), idéntica.
3. **«Dejar en tienda» (D-224)** para almacén y chofer: `picked_up→ready` sin límite de tienda.
4. **D-286:** cualquiera menos almacén edita cualquier borrador visible. El candado de `created_by`
   no lo toca: editar no cambia el autor.
5. **La 122:** una entregada no se anula, tampoco el admin, y la invariante sigue **antes** de la
   salida de admin.
6. **125, 127, 138:** comprobadas por texto en la autocomprobación.
7. **El admin sigue borrando cualquier orden** (lo único que la pantalla ofrece hoy).
8. **Split loads y reentregas** (INSERT de almacén/chofer/office con `order_suffix`/`redelivery_of`):
   el cliente ya manda `created_by = me.id`, así que forzarlo no cambia nada.
9. **Ninguna otra política permisiva otorga DELETE** sobre `deliveries` (autocomprobación: una ALL o
   DELETE de más lo reabriría todo sin que se notara).
10. **El admin y service-role siguen pudiendo borrar**, y ahora dejan rastro. El trigger del rastro no
    impide un borrado salvo que falle su propio INSERT; si eso pasara, el borrado entero se deshace,
    que es lo correcto para un registro que tiene que ser fiable.
11. **Borrar una orden a la que apunta una reentrega** (`redelivery_of`): la FK la pone a `null` con un
    UPDATE interno que **dispara el guard como quien borra**. Hoy ya es así; con la 142 solo borran
    borradores (salvo el admin, que sale del guard), y un borrador no es origen de reentregas, así que
    no debería darse. Dicho por si aparece.

**Pruebas del repo que leen el `.sql` del guard y habrá que mover a la 142 en la fase de pantalla**
(no en esta rama): `entregar-ya-y-deshacer.test.ts:19` (lee la 139 y modela almacén como «la base no
le deja deshacer nada», lo cual **ya hoy es falso**: la 139 le deja 3 pasos; la prueba pasa porque
compara `false` con `false`), `agregar-material.test.ts` (138 y 139). Las demás leen migraciones
anteriores y no cambian.

---

## 5 · Las políticas, el guard y el rastro, literales

El `.sql` completo está en `supabase/migrations/142_deshacer_almacen_y_borrar_borradores.sql`
(checksum `b80064bc…4c6b`, bloque `-- @ledger-below` puesto). **Sin `begin`/`commit` propios.**
El guard se generó **copiando el cuerpo de la 139 por programa y aplicando dos reemplazos
comprobados** (cada ancla tenía que aparecer exactamente una vez); el diff contra la 139 es solo
esto:

```sql
  if r = 'admin' then return NEW; end if;
+
+  -- 142: quien creo la orden es historia. ...
+  if TG_OP = 'INSERT' then
+    NEW.created_by := auth.uid();
+  elsif NEW.created_by is distinct from OLD.created_by then
+    raise exception 'Who created an order is history: it cannot be rewritten';
+  end if;
```

```sql
  elsif r = 'warehouse' then
    if (old_stage = 'approved'   and new_stage = 'fulfilling')
    or (old_stage = 'fulfilling' and new_stage = 'ready')
    or (old_stage = 'ready'      and new_stage = 'picked_up')
    or (old_stage = 'picked_up'  and new_stage = 'delivered')
-   or (old_stage = 'ready'      and new_stage = 'fulfilling')
-   or (old_stage = 'picked_up'  and new_stage = 'ready')
-   or (old_stage = 'delivered'  and new_stage = 'picked_up') then return NEW; end if;
+   or (old_stage = 'picked_up'  and new_stage = 'ready') then return NEW; end if;
+   if ((old_stage = 'delivered'  and new_stage = 'picked_up')
+    or (old_stage = 'ready'      and new_stage = 'fulfilling')
+    or (old_stage = 'fulfilling' and new_stage = 'approved')) then
+     if public.orden_de_mis_tiendas(OLD.store, OLD.pickup_name, OLD.delivery_name, OLD.pickup_address) then
+       return NEW;
+     end if;
+     raise exception 'Warehouse can only undo a step on orders of its own store';
+   end if;
    raise exception 'Warehouse cannot move an order from % to %', old_stage, new_stage;
```

Se mira `OLD` (la orden como estaba): la tienda que ponga la misma escritura no cuenta.

La política de borrar, **desde la vigente** (`131:195-197`, confirmada en producción, M3):

```sql
alter policy "deliveries delete" on public.deliveries
  using (
    (select public.has_deliveries_access())
    and (
      (select public.is_admin())
      or (stage = 'draft' and created_by = (select auth.uid()))
      or (stage = 'draft'
          and (select public.current_user_role()) in ('manager', 'accounting')
          and public.orden_de_mis_tiendas(store, pickup_name, delivery_name, pickup_address))
    )
  );
```

`orden_de_mis_tiendas` va **sin** `(select …)` porque depende de la fila; solo se evalúa en DELETE,
que en la app es de una orden cada vez.

El rastro (resumido; literal en el `.sql`):

```sql
create table if not exists public.deliveries_borradas (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null, order_no bigint,
  fila jsonb not null,
  eventos jsonb not null default '[]'::jsonb,
  notificaciones jsonb not null default '[]'::jsonb,
  borrada_por uuid,            -- auth.uid(); NULL = service-role o postgres sin sesion
  borrada_por_rol text,
  borrada_en timestamptz not null default now()
);
alter table public.deliveries_borradas enable row level security;
create policy "deliveries_borradas select admin" on public.deliveries_borradas
  for select to authenticated using ((select public.is_admin()));
revoke all on public.deliveries_borradas from anon;
revoke insert, update, delete, truncate on public.deliveries_borradas from authenticated, service_role;
grant select on public.deliveries_borradas to authenticated;

-- inmutable: before update or delete (por fila) y before truncate -> raise exception siempre
-- el que escribe: before delete on public.deliveries, security definer:
--   insert into public.deliveries_borradas (...) values (OLD.id, OLD.order_no, to_jsonb(OLD),
--     (jsonb_agg de sus order_events), (jsonb_agg de sus notifications), auth.uid(), current_user_role());
```

La autocomprobación del `.sql` verifica, además de lo de la 139: la política con las tres ramas; que
sea la única que otorga DELETE; el trigger `BEFORE DELETE … FOR EACH ROW` habilitado; la tabla con
RLS y solo una política de SELECT; que ni `authenticated` ni `service_role` tengan UPDATE/DELETE
(ni `authenticated` INSERT); y los dos triggers de inmutabilidad habilitados.

---

## 6 · Matriz de pruebas por rol, con ROLLBACK (la corre el orquestador)

**46 casos.** M2 (medido en producción) ya confirmó que no hay triggers de terceros sobre
`deliveries`; el ensayo además crea sus propias órdenes, eventos y avisos dentro de la transacción,
así que no depende de los datos de producción ni los toca. Los 4 casos que **D-361 se saltó**
(`fulfilling→delivered`, `picked_up→delivered`, `picked_up→ready`, `fulfilling→approved` de office)
son O1-O4.

Sustituir:

- `<UUID-ALMACEN>` (rol `warehouse`, con tienda; M10: los 4 la tienen), `<UUID-OFFICE>` (`accounting`,
  **con** tienda), `<UUID-GERENTE>` (`manager`, **con** tienda), `<UUID-VENTAS>` y `<UUID-VENTAS2>`
  (dos `sales`), `<UUID-ADMIN>`.
- `<TIENDA-B>`: una tienda de `settings.stores` que **no** sea ni esté en el grupo del almacenista,
  de office ni del gerente. M12 (medido): McAllen y Mission forman el grupo `RFT`; si alguno de los
  tres es de McAllen o Mission, `<TIENDA-B>` no puede ser ninguna de las dos.
- `<UUID-OFFICE>`, `<UUID-GERENTE>`, `<UUID-VENTAS>` y `<UUID-VENTAS2>` tienen que **ver**
  `<TIENDA-B>` y su propia tienda (sin `visible_stores`, o con ellas dentro); si no, sus casos salen
  «MAL 0» porque la lectura esconde la fila, no porque la regla falle.

Se pega entero en `psql` **desde la raíz del repo** (el `\i` es relativo). **Sin `commit` en ningún
sitio.** Cada caso va en su propio `begin … exception` dentro de un `do`: un error esperado no aborta
la transacción, y cada línea imprime `OK` o `MAL`.

```sql
begin;

-- 0. La migración, dentro de la misma transacción (se deshace con el resto).
\i supabase/migrations/142_deshacer_almacen_y_borrar_borradores.sql

-- 1. Datos de prueba, como postgres: auth.uid() es null y el guard los deja pasar sin mirar.
--    A = tienda del almacenista, O = de office, G = del gerente. Ids fijos para poder leerlos.
insert into public.deliveries (id, stage, store, pickup_name, account, created_by) values
  ('14200000-0000-4000-8000-000000000001','fulfilling',(select store from public.profiles where id='<UUID-ALMACEN>'),(select store from public.profiles where id='<UUID-ALMACEN>'),'ENSAYO 142',null),
  ('14200000-0000-4000-8000-000000000002','ready',     (select store from public.profiles where id='<UUID-ALMACEN>'),(select store from public.profiles where id='<UUID-ALMACEN>'),'ENSAYO 142',null),
  ('14200000-0000-4000-8000-000000000003','picked_up', (select store from public.profiles where id='<UUID-ALMACEN>'),(select store from public.profiles where id='<UUID-ALMACEN>'),'ENSAYO 142',null),
  ('14200000-0000-4000-8000-000000000004','delivered', (select store from public.profiles where id='<UUID-ALMACEN>'),(select store from public.profiles where id='<UUID-ALMACEN>'),'ENSAYO 142',null),
  ('14200000-0000-4000-8000-000000000005','approved',  (select store from public.profiles where id='<UUID-ALMACEN>'),(select store from public.profiles where id='<UUID-ALMACEN>'),'ENSAYO 142',null),
  ('14200000-0000-4000-8000-000000000006','fulfilling','<TIENDA-B>','<TIENDA-B>','ENSAYO 142',null),
  ('14200000-0000-4000-8000-000000000007','ready',     '<TIENDA-B>','<TIENDA-B>','ENSAYO 142',null),
  ('14200000-0000-4000-8000-000000000008','delivered', '<TIENDA-B>','<TIENDA-B>','ENSAYO 142',null),
  ('14200000-0000-4000-8000-000000000009','picked_up', '<TIENDA-B>','<TIENDA-B>','ENSAYO 142',null),
  ('14200000-0000-4000-8000-000000000010','approved',  '<TIENDA-B>','<TIENDA-B>','ENSAYO 142',null),
  ('14200000-0000-4000-8000-000000000011','fulfilling','<TIENDA-B>','<TIENDA-B>','ENSAYO 142',null),
  ('14200000-0000-4000-8000-000000000012','picked_up', '<TIENDA-B>','<TIENDA-B>','ENSAYO 142',null),
  ('14200000-0000-4000-8000-000000000013','picked_up', '<TIENDA-B>','<TIENDA-B>','ENSAYO 142',null),
  ('14200000-0000-4000-8000-000000000014','fulfilling','<TIENDA-B>','<TIENDA-B>','ENSAYO 142',null),
  ('14200000-0000-4000-8000-000000000015','draft',     '<TIENDA-B>','<TIENDA-B>','ENSAYO 142','<UUID-VENTAS>'),
  ('14200000-0000-4000-8000-000000000016','draft',     '<TIENDA-B>','<TIENDA-B>','ENSAYO 142','<UUID-VENTAS2>'),
  ('14200000-0000-4000-8000-000000000017','pending',   '<TIENDA-B>','<TIENDA-B>','ENSAYO 142','<UUID-VENTAS>'),
  ('14200000-0000-4000-8000-000000000018','draft',     '<TIENDA-B>','<TIENDA-B>','ENSAYO 142','<UUID-OFFICE>'),
  ('14200000-0000-4000-8000-000000000019','draft',     '<TIENDA-B>','<TIENDA-B>','ENSAYO 142','<UUID-VENTAS>'),
  ('14200000-0000-4000-8000-000000000020','delivered', '<TIENDA-B>','<TIENDA-B>','ENSAYO 142','<UUID-VENTAS>'),
  ('14200000-0000-4000-8000-000000000021','delivered', (select store from public.profiles where id='<UUID-ALMACEN>'),(select store from public.profiles where id='<UUID-ALMACEN>'),'ENSAYO 142',null),
  ('14200000-0000-4000-8000-000000000022','approved',  (select store from public.profiles where id='<UUID-ALMACEN>'),(select store from public.profiles where id='<UUID-ALMACEN>'),'ENSAYO 142',null),
  ('14200000-0000-4000-8000-000000000023','fulfilling',(select store from public.profiles where id='<UUID-ALMACEN>'),(select store from public.profiles where id='<UUID-ALMACEN>'),'ENSAYO 142',null),
  ('14200000-0000-4000-8000-000000000024','delivered', '<TIENDA-B>','<TIENDA-B>','ENSAYO 142',null),
  ('14200000-0000-4000-8000-000000000025','draft',     '<TIENDA-B>','<TIENDA-B>','ENSAYO 142','<UUID-VENTAS>'),
  ('14200000-0000-4000-8000-000000000026','draft',     (select store from public.profiles where id='<UUID-OFFICE>'),(select store from public.profiles where id='<UUID-OFFICE>'),'ENSAYO 142','<UUID-VENTAS>'),
  ('14200000-0000-4000-8000-000000000027','draft',     (select store from public.profiles where id='<UUID-GERENTE>'),(select store from public.profiles where id='<UUID-GERENTE>'),'ENSAYO 142','<UUID-VENTAS>'),
  ('14200000-0000-4000-8000-000000000028','pending',   (select store from public.profiles where id='<UUID-OFFICE>'),(select store from public.profiles where id='<UUID-OFFICE>'),'ENSAYO 142','<UUID-OFFICE>');

-- Un evento y un aviso de la orden 024, para ver que el rastro se los lleva (R1).
insert into public.order_events (delivery_id, kind, note, created_by)
  values ('14200000-0000-4000-8000-000000000024', 'delivered', 'ENSAYO 142', null);
insert into public.notifications (user_id, delivery_id, kind, message)
  values ('<UUID-ADMIN>', '14200000-0000-4000-8000-000000000024', 'delivered', 'ENSAYO 142');

set local role authenticated;

-- 2. ALMACEN
set local request.jwt.claims to '{"sub":"<UUID-ALMACEN>","role":"authenticated"}';
do $$
declare n int;
begin
  -- Tienen que PASAR (1 fila)
  begin update public.deliveries set stage='approved'   where id='14200000-0000-4000-8000-000000000001'; get diagnostics n = row_count;
    raise notice 'W1  fulfilling->approved, su tienda (NUEVO)      esperado 1 fila: %', case when n=1 then 'OK' else 'MAL '||n end;
  exception when others then raise notice 'W1  MAL: %', sqlerrm; end;
  begin update public.deliveries set stage='fulfilling' where id='14200000-0000-4000-8000-000000000002'; get diagnostics n = row_count;
    raise notice 'W2  ready->fulfilling, su tienda (D-287)         esperado 1 fila: %', case when n=1 then 'OK' else 'MAL '||n end;
  exception when others then raise notice 'W2  MAL: %', sqlerrm; end;
  begin update public.deliveries set stage='ready'      where id='14200000-0000-4000-8000-000000000003'; get diagnostics n = row_count;
    raise notice 'W3  picked_up->ready, su tienda                  esperado 1 fila: %', case when n=1 then 'OK' else 'MAL '||n end;
  exception when others then raise notice 'W3  MAL: %', sqlerrm; end;
  begin update public.deliveries set stage='picked_up'  where id='14200000-0000-4000-8000-000000000004'; get diagnostics n = row_count;
    raise notice 'W4  delivered->picked_up, su tienda              esperado 1 fila: %', case when n=1 then 'OK' else 'MAL '||n end;
  exception when others then raise notice 'W4  MAL: %', sqlerrm; end;
  begin update public.deliveries set stage='ready'      where id='14200000-0000-4000-8000-000000000009'; get diagnostics n = row_count;
    raise notice 'W8  picked_up->ready, OTRA tienda (D-224)        esperado 1 fila: %', case when n=1 then 'OK' else 'MAL '||n end;
  exception when others then raise notice 'W8  MAL: %', sqlerrm; end;
  begin update public.deliveries set stage='fulfilling' where id='14200000-0000-4000-8000-000000000010'; get diagnostics n = row_count;
    raise notice 'W9  approved->fulfilling, OTRA tienda (igual)    esperado 1 fila: %', case when n=1 then 'OK' else 'MAL '||n end;
  exception when others then raise notice 'W9  MAL: %', sqlerrm; end;
  -- Tienen que FALLAR
  begin update public.deliveries set stage='approved'   where id='14200000-0000-4000-8000-000000000006';
    raise notice 'W5  fulfilling->approved, OTRA tienda            esperado ERROR: MAL, paso';
  exception when others then raise notice 'W5  esperado ERROR: OK (%)', sqlerrm; end;
  begin update public.deliveries set stage='fulfilling' where id='14200000-0000-4000-8000-000000000007';
    raise notice 'W6  ready->fulfilling, OTRA tienda (hoy pasa)    esperado ERROR: MAL, paso';
  exception when others then raise notice 'W6  esperado ERROR: OK (%)', sqlerrm; end;
  begin update public.deliveries set stage='picked_up'  where id='14200000-0000-4000-8000-000000000008';
    raise notice 'W7  delivered->picked_up, OTRA tienda (hoy pasa) esperado ERROR: MAL, paso';
  exception when others then raise notice 'W7  esperado ERROR: OK (%)', sqlerrm; end;
  begin update public.deliveries set stage='pending'    where id='14200000-0000-4000-8000-000000000022';
    raise notice 'W10 approved->pending, su tienda                 esperado ERROR: MAL, paso';
  exception when others then raise notice 'W10 esperado ERROR: OK (%)', sqlerrm; end;
  begin update public.deliveries set stage='ready'      where id='14200000-0000-4000-8000-000000000021';
    raise notice 'W11 delivered->ready (dos pasos), su tienda      esperado ERROR: MAL, paso';
  exception when others then raise notice 'W11 esperado ERROR: OK (%)', sqlerrm; end;
  -- Borrar: 0 filas, sin error
  begin delete from public.deliveries where id='14200000-0000-4000-8000-000000000005'; get diagnostics n = row_count;
    raise notice 'W12 borra una aprobada de su tienda (hoy 1)      esperado 0 filas: %', case when n=0 then 'OK' else 'MAL '||n end;
  exception when others then raise notice 'W12 MAL: %', sqlerrm; end;
end $$;

-- 2b. ALMACEN SIN TIENDA: se le quita la tienda como postgres, dentro de la transaccion.
reset role;
set local request.jwt.claims to '{}';
update public.profiles set store = null where id = '<UUID-ALMACEN>';
set local role authenticated;
set local request.jwt.claims to '{"sub":"<UUID-ALMACEN>","role":"authenticated"}';
do $$
begin
  begin update public.deliveries set stage='approved' where id='14200000-0000-4000-8000-000000000023';
    raise notice 'W13 SIN tienda: fulfilling->approved             esperado ERROR: MAL, paso';
  exception when others then raise notice 'W13 esperado ERROR: OK (%)', sqlerrm; end;
end $$;

-- 3. OFFICE: los 4 casos que D-361 no pudo ejercer, y borrar
set local request.jwt.claims to '{"sub":"<UUID-OFFICE>","role":"authenticated"}';
do $$
declare n int;
begin
  begin update public.deliveries set stage='delivered' where id='14200000-0000-4000-8000-000000000011'; get diagnostics n = row_count;
    raise notice 'O1  office fulfilling->delivered (D-361)         esperado 1 fila: %', case when n=1 then 'OK' else 'MAL '||n end;
  exception when others then raise notice 'O1  MAL: %', sqlerrm; end;
  begin update public.deliveries set stage='delivered' where id='14200000-0000-4000-8000-000000000012'; get diagnostics n = row_count;
    raise notice 'O2  office picked_up->delivered (D-361)          esperado 1 fila: %', case when n=1 then 'OK' else 'MAL '||n end;
  exception when others then raise notice 'O2  MAL: %', sqlerrm; end;
  begin update public.deliveries set stage='ready'     where id='14200000-0000-4000-8000-000000000013'; get diagnostics n = row_count;
    raise notice 'O3  office picked_up->ready (D-361)              esperado 1 fila: %', case when n=1 then 'OK' else 'MAL '||n end;
  exception when others then raise notice 'O3  MAL: %', sqlerrm; end;
  begin update public.deliveries set stage='approved'  where id='14200000-0000-4000-8000-000000000014'; get diagnostics n = row_count;
    raise notice 'O4  office fulfilling->approved (D-361)          esperado 1 fila: %', case when n=1 then 'OK' else 'MAL '||n end;
  exception when others then raise notice 'O4  MAL: %', sqlerrm; end;
  begin delete from public.deliveries where id='14200000-0000-4000-8000-000000000015'; get diagnostics n = row_count;
    raise notice 'O5  borra borrador AJENO de OTRA tienda (hoy 1)  esperado 0 filas: %', case when n=0 then 'OK' else 'MAL '||n end;
  exception when others then raise notice 'O5  MAL: %', sqlerrm; end;
  begin delete from public.deliveries where id='14200000-0000-4000-8000-000000000024'; get diagnostics n = row_count;
    raise notice 'O6  borra una entregada (hoy 1)                  esperado 0 filas: %', case when n=0 then 'OK' else 'MAL '||n end;
  exception when others then raise notice 'O6  MAL: %', sqlerrm; end;
  begin delete from public.deliveries where id='14200000-0000-4000-8000-000000000018'; get diagnostics n = row_count;
    raise notice 'O7  borra SU borrador, en otra tienda            esperado 1 fila: %', case when n=1 then 'OK' else 'MAL '||n end;
  exception when others then raise notice 'O7  MAL: %', sqlerrm; end;
  begin delete from public.deliveries where id='14200000-0000-4000-8000-000000000026'; get diagnostics n = row_count;
    raise notice 'O8  borra borrador AJENO de SU tienda (dueno)    esperado 1 fila: %', case when n=1 then 'OK' else 'MAL '||n end;
  exception when others then raise notice 'O8  MAL: %', sqlerrm; end;
  begin delete from public.deliveries where id='14200000-0000-4000-8000-000000000028'; get diagnostics n = row_count;
    raise notice 'O9  borra SU pendiente de SU tienda (hoy 1)      esperado 0 filas: %', case when n=0 then 'OK' else 'MAL '||n end;
  exception when others then raise notice 'O9  MAL: %', sqlerrm; end;
end $$;

-- 3b. GERENTE (manager): tambien es "office" para el dueno
set local request.jwt.claims to '{"sub":"<UUID-GERENTE>","role":"authenticated"}';
do $$
declare n int;
begin
  begin delete from public.deliveries where id='14200000-0000-4000-8000-000000000027'; get diagnostics n = row_count;
    raise notice 'G1  gerente borra borrador AJENO de SU tienda    esperado 1 fila: %', case when n=1 then 'OK' else 'MAL '||n end;
  exception when others then raise notice 'G1  MAL: %', sqlerrm; end;
end $$;

-- 4. VENTAS2 sobre el borrador de VENTAS
set local request.jwt.claims to '{"sub":"<UUID-VENTAS2>","role":"authenticated"}';
do $$
declare n int;
begin
  begin update public.deliveries set delivery_notes='ensayo 142' where id='14200000-0000-4000-8000-000000000019'; get diagnostics n = row_count;
    raise notice 'V1  edita borrador ajeno (D-286)                 esperado 1 fila: %', case when n=1 then 'OK' else 'MAL '||n end;
  exception when others then raise notice 'V1  MAL: %', sqlerrm; end;
  begin update public.deliveries set created_by='<UUID-VENTAS2>' where id='14200000-0000-4000-8000-000000000019';
    raise notice 'V2  se pone de autor de borrador ajeno (hoy pasa) esperado ERROR: MAL, paso';
  exception when others then raise notice 'V2  esperado ERROR: OK (%)', sqlerrm; end;
  begin delete from public.deliveries where id='14200000-0000-4000-8000-000000000019'; get diagnostics n = row_count;
    raise notice 'V3  borra borrador ajeno (hoy 1)                 esperado 0 filas: %', case when n=0 then 'OK' else 'MAL '||n end;
  exception when others then raise notice 'V3  MAL: %', sqlerrm; end;
end $$;

-- 5. VENTAS sobre lo suyo, y el rastro visto por un no-admin
set local request.jwt.claims to '{"sub":"<UUID-VENTAS>","role":"authenticated"}';
do $$
declare n int; autor uuid;
begin
  begin delete from public.deliveries where id='14200000-0000-4000-8000-000000000017'; get diagnostics n = row_count;
    raise notice 'V4  borra SU pendiente (hoy 1)                   esperado 0 filas: %', case when n=0 then 'OK' else 'MAL '||n end;
  exception when others then raise notice 'V4  MAL: %', sqlerrm; end;
  begin delete from public.deliveries where id='14200000-0000-4000-8000-000000000020'; get diagnostics n = row_count;
    raise notice 'V5  borra SU entregada (hoy 1)                   esperado 0 filas: %', case when n=0 then 'OK' else 'MAL '||n end;
  exception when others then raise notice 'V5  MAL: %', sqlerrm; end;
  begin delete from public.deliveries where id='14200000-0000-4000-8000-000000000015'; get diagnostics n = row_count;
    raise notice 'V6  borra SU borrador                            esperado 1 fila: %', case when n=1 then 'OK' else 'MAL '||n end;
  exception when others then raise notice 'V6  MAL: %', sqlerrm; end;
  begin update public.deliveries set created_by=null where id='14200000-0000-4000-8000-000000000017';
    raise notice 'V7  borra el autor de SU pendiente (hoy pasa)    esperado ERROR: MAL, paso';
  exception when others then raise notice 'V7  esperado ERROR: OK (%)', sqlerrm; end;
  begin insert into public.deliveries (stage, store, account, created_by)
      values ('draft','<TIENDA-B>','ENSAYO 142','<UUID-VENTAS2>') returning created_by into autor;
    raise notice 'V8  inserta firmando como otro (hoy queda el otro) esperado autor = el mismo: %',
      case when autor = '<UUID-VENTAS>'::uuid then 'OK' else 'MAL '||coalesce(autor::text,'null') end;
  exception when others then raise notice 'V8  MAL: %', sqlerrm; end;
  begin select count(*) into n from public.deliveries_borradas;
    raise notice 'R4  ventas LEE el rastro (ya hay filas)          esperado 0 filas: %', case when n=0 then 'OK' else 'MAL '||n end;
  exception when others then raise notice 'R4  MAL: %', sqlerrm; end;
  begin insert into public.deliveries_borradas (delivery_id, fila) values (gen_random_uuid(), '{}'::jsonb);
    raise notice 'R5  ventas ESCRIBE en el rastro                  esperado ERROR: MAL, paso';
  exception when others then raise notice 'R5  esperado ERROR: OK (%)', sqlerrm; end;
end $$;

-- 6. ADMIN
set local request.jwt.claims to '{"sub":"<UUID-ADMIN>","role":"authenticated"}';
do $$
declare n int; r record;
begin
  begin update public.deliveries set created_by='<UUID-ADMIN>' where id='14200000-0000-4000-8000-000000000016'; get diagnostics n = row_count;
    raise notice 'A1  admin corrige el autor                       esperado 1 fila: %', case when n=1 then 'OK' else 'MAL '||n end;
  exception when others then raise notice 'A1  MAL: %', sqlerrm; end;
  begin update public.deliveries set stage='canceled', canceled_reason='other', canceled_reason_note='ensayo' where id='14200000-0000-4000-8000-000000000024';
    raise notice 'A2  admin anula una entregada (122)              esperado ERROR: MAL, paso';
  exception when others then raise notice 'A2  esperado ERROR: OK (%)', sqlerrm; end;
  begin delete from public.deliveries where id='14200000-0000-4000-8000-000000000024'; get diagnostics n = row_count;
    raise notice 'A3  admin borra una entregada (igual que hoy)    esperado 1 fila: %', case when n=1 then 'OK' else 'MAL '||n end;
  exception when others then raise notice 'A3  MAL: %', sqlerrm; end;
  -- El rastro
  begin select * into r from public.deliveries_borradas where delivery_id='14200000-0000-4000-8000-000000000024';
    select count(*) into n from public.order_events where delivery_id='14200000-0000-4000-8000-000000000024';
    raise notice 'R1  rastro de 024: fila, 1 evento, 1 aviso, quien esperado todo: %',
      case when r.fila->>'stage' = 'delivered' and jsonb_array_length(r.eventos) = 1
                and jsonb_array_length(r.notificaciones) = 1
                and r.borrada_por = '<UUID-ADMIN>'::uuid and r.borrada_por_rol = 'admin'
                and n = 0   -- la cascada si se llevo el evento de la tabla viva
           then 'OK' else 'MAL '||coalesce(r::text,'sin fila')||' eventos vivos='||n end;
  exception when others then raise notice 'R1  MAL: %', sqlerrm; end;
  begin select * into r from public.deliveries_borradas where delivery_id='14200000-0000-4000-8000-000000000015';
    raise notice 'R2  rastro del borrador que borro ventas (V6)    esperado quien=ventas: %',
      case when r.borrada_por = '<UUID-VENTAS>'::uuid and r.borrada_por_rol = 'sales' then 'OK' else 'MAL '||coalesce(r::text,'sin fila') end;
  exception when others then raise notice 'R2  MAL: %', sqlerrm; end;
  begin select * into r from public.deliveries_borradas where delivery_id='14200000-0000-4000-8000-000000000026';
    raise notice 'R3  rastro del borrador ajeno que borro office (O8) esperado quien=office: %',
      case when r.borrada_por = '<UUID-OFFICE>'::uuid and r.borrada_por_rol = 'accounting'
                and r.fila->>'created_by' = '<UUID-VENTAS>' then 'OK' else 'MAL '||coalesce(r::text,'sin fila') end;
  exception when others then raise notice 'R3  MAL: %', sqlerrm; end;
  begin update public.deliveries_borradas set borrada_por = null where delivery_id='14200000-0000-4000-8000-000000000024';
    raise notice 'R6  admin CAMBIA el rastro                       esperado ERROR: MAL, paso';
  exception when others then raise notice 'R6  esperado ERROR: OK (%)', sqlerrm; end;
  begin delete from public.deliveries_borradas where delivery_id='14200000-0000-4000-8000-000000000024';
    raise notice 'R7  admin BORRA el rastro                        esperado ERROR: MAL, paso';
  exception when others then raise notice 'R7  esperado ERROR: OK (%)', sqlerrm; end;
end $$;

-- 7. SERVICE-ROLE: borra (sin auth.uid()) y deja rastro con borrada_por NULL; no puede tocar el rastro
reset role;
set local request.jwt.claims to '{}';
set local role service_role;
do $$
declare n int; r record;
begin
  begin delete from public.deliveries where id='14200000-0000-4000-8000-000000000025'; get diagnostics n = row_count;
    select * into r from public.deliveries_borradas where delivery_id='14200000-0000-4000-8000-000000000025';
    raise notice 'R8  service-role borra: 1 fila y rastro sin autor esperado todo: %',
      case when n = 1 and r.id is not null and r.borrada_por is null then 'OK' else 'MAL n='||n||' '||coalesce(r::text,'sin fila') end;
  exception when others then raise notice 'R8  MAL: %', sqlerrm; end;
  begin update public.deliveries_borradas set borrada_por_rol = 'x' where delivery_id='14200000-0000-4000-8000-000000000025';
    raise notice 'R9  service-role CAMBIA el rastro                esperado ERROR: MAL, paso';
  exception when others then raise notice 'R9  esperado ERROR: OK (%)', sqlerrm; end;
  begin delete from public.deliveries_borradas where delivery_id='14200000-0000-4000-8000-000000000025';
    raise notice 'R10 service-role BORRA el rastro                 esperado ERROR: MAL, paso';
  exception when others then raise notice 'R10 esperado ERROR: OK (%)', sqlerrm; end;
end $$;

-- 8. POSTGRES (dueno de la tabla): los privilegios no le frenan; el trigger si
reset role;
do $$
begin
  begin delete from public.deliveries_borradas where delivery_id='14200000-0000-4000-8000-000000000025';
    raise notice 'R11 postgres BORRA el rastro                     esperado ERROR: MAL, paso';
  exception when others then raise notice 'R11 esperado ERROR: OK (%)', sqlerrm; end;
  begin truncate public.deliveries_borradas;
    raise notice 'R12 postgres VACIA el rastro (truncate)          esperado ERROR: MAL, paso';
  exception when others then raise notice 'R12 esperado ERROR: OK (%)', sqlerrm; end;
end $$;

ROLLBACK;
```

**Resumen de lo que debe salir — 46 casos, cada línea tiene que decir `OK`:**

| Esperado | Casos | Cuántos |
|---|---|---|
| 1 fila | W1-W4, W8, W9, O1-O4, O7, O8, G1, V1, V6, A1, A3 | 17 |
| ERROR | W5-W7, W10, W11, W13, V2, V7, A2, R5, R6, R7, R9, R10, R11, R12 | 16 |
| 0 filas, sin error (la RLS filtra) | W12, O5, O6, O9, V3, V4, V5, R4 | 8 |
| contenido comprobado | V8 (autor), R1 (fila + evento + aviso + quién, y la cascada), R2, R3 (quién), R8 (service-role: 1 fila y rastro con `borrada_por` NULL) | 5 |

**Cambian respecto de hoy (25):** W1 (hoy falla), W6 y W7 (hoy pasan), V2 y V7 (hoy pasan), V8 (hoy
queda el otro como autor), los siete de cero filas sobre `deliveries` (W12, O5, O6, O9, V3, V4, V5:
hoy borran 1), y los doce del rastro (R1-R12: la tabla no existe). **Los otros 21 tienen que salir
igual antes y después**, incluidos O8 y G1 (hoy office y gerente ya borran cualquier cosa; lo nuevo
es que **solo** eso).

**Recomendado:** correr el mismo bloque **sin** el `\i` (base de hoy) y guardar la salida, para que la
diferencia antes/después quede medida. Sin la 142, los R fallan por «relation does not exist» y W13
no es prueba (hoy almacén no tiene límite de tienda).

**Si algún MAL no es de los esperados, parar**: no aplicar.

Opcional, con el grupo `RFT` (M12): un caso W14 con una orden de la **otra** tienda del grupo del
almacenista, `fulfilling→approved`, esperado 1 fila; y el mismo para office (borrador ajeno de la otra
tienda del grupo, esperado 1 fila). Solo si el almacenista u office son de McAllen o Mission.

---

## 7 · Mediciones de solo lectura

**Corridas por el orquestador en producción el 2026-09-23.** Resultados junto a cada una; las
consultas se dejan para repetirlas antes de aplicar.

| | Qué | Resultado (2026-09-23) |
|---|---|---|
| M1 | guard vigente | **= 139**, sin la 142 |
| M2 | triggers sobre `deliveries` | solo `deliveries_guard_stage` y `deliveries_touch` (before insert/update). **Ninguno de DELETE**: agujero confirmado |
| M3 | políticas de `deliveries` | `"deliveries delete"` = `has_deliveries_access()`, la de la 131 |
| M4 | FKs hacia `deliveries` | cascada: `order_events` y `notifications`; a `null`: `driver_incidents`, `route_plan_stops`, `deliveries.redelivery_of` |
| M5 | borrados desde el `stats_reset` (2026-07-15) | `deliveries` **4**, `order_events` **946**, `notifications` **141**. 4 órdenes no explican 946 eventos: **sin explicar** (ni migraciones ni el código actual borran eventos) |
| M6 | huecos en `order_no` | 1-339, 245 filas, **94 huecos** (no prueban borrados) |
| M7 | paradas de plan huérfanas | **0** |
| M8 | borradores | **2**, los dos de `accounting`, ninguno de más de 14 días |
| M9 | `created_by` reescritos | **0** |
| M10 | almacenistas sin tienda | **0** de 4 |
| M11 | pasos atrás, 90 días | 1 de admin (`fulfilling→approved`) y **1 de almacén (`ready→fulfilling`), en su tienda**: el límite de tienda no le habría quitado nada a nadie |
| M12 | tiendas y grupos | McAllen y Mission en el grupo `RFT` |
| M13 | office y gerentes sin tienda | **no medido** (nueva) |

```sql
-- M1. El guard vigente es el de la 139 (y la 142 no está)
select position('or (old_stage = ''fulfilling'' and new_stage = ''approved'') then return NEW; end if;'
                in pg_get_functiondef('public.guard_delivery_stage()'::regprocedure)) > 0 as tiene_139,
       position('orden_de_mis_tiendas'
                in pg_get_functiondef('public.guard_delivery_stage()'::regprocedure)) = 0 as sin_142;

-- M2. Triggers sobre deliveries: ¿alguno de DELETE?, ¿alguno llama fuera (webhook, net.http_post)?
select tgname, pg_get_triggerdef(oid) from pg_trigger
 where tgrelid = 'public.deliveries'::regclass and not tgisinternal order by tgname;

-- M3. Políticas de deliveries, literales
select policyname, cmd, permissive, roles, qual, with_check from pg_policies
 where schemaname = 'public' and tablename = 'deliveries' order by cmd, policyname;

-- M4. Qué se lleva un borrado: FKs hacia deliveries (c = cascade, n = set null)
select conrelid::regclass as tabla, conname, confdeltype from pg_constraint
 where confrelid = 'public.deliveries'::regclass and contype = 'f' order by 1;

-- M5. Borrados desde el último reset de estadísticas
select relname, n_tup_ins, n_tup_upd, n_tup_del, n_live_tup from pg_stat_user_tables
 where schemaname = 'public' and relname in ('deliveries', 'order_events', 'notifications');
select stats_reset from pg_stat_database where datname = current_database();

-- M6. Huecos en order_no (un INSERT rechazado también consume número: un hueco no prueba un borrado)
select min(order_no), max(order_no), count(*),
       max(order_no) - min(order_no) + 1 - count(*) as huecos
  from public.deliveries;

-- M7. Paradas de planes de ruta que apuntaban a una orden que ya no existe
select count(*) as paradas_huerfanas,
       count(distinct split_part(s.order_ref, '#', 1)) as ordenes_distintas
  from public.route_plan_stops s
 where s.delivery_id is null
   and split_part(s.order_ref, '#', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   and not exists (select 1 from public.deliveries d where d.id::text = split_part(s.order_ref, '#', 1));

-- M8. Borradores hoy
select p.role, count(*) as borradores,
       count(*) filter (where d.created_at < now() - interval '14 days') as de_mas_de_14_dias,
       count(*) filter (where d.created_by is null) as sin_autor
  from public.deliveries d left join public.profiles p on p.id = d.created_by
 where d.stage = 'draft' and not d.is_training
 group by p.role order by 2 desc;

-- M9. ¿Alguien ha reescrito created_by? Autor de la orden contra autor de su evento 'created'
select count(*) as autor_distinto
  from public.deliveries d
  join lateral (select e.created_by from public.order_events e
                 where e.delivery_id = d.id and e.kind = 'created'
                 order by e.created_at limit 1) e on true
 where e.created_by is distinct from d.created_by;

-- M10. Almacenistas sin tienda
select count(*) filter (where coalesce(btrim(store), '') = '') as sin_tienda, count(*) as total
  from public.profiles where role = 'warehouse';

-- M11. Pasos atrás de los últimos 90 días (APROXIMADO: no cuenta grupos)
with ev as (
  select e.delivery_id, e.kind, e.created_by, e.created_at,
         lag(e.kind) over (partition by e.delivery_id order by e.created_at) as antes
    from public.order_events e
   where e.kind in ('draft','pending','approved','rejected','fulfilling','ready','picked_up','delivered','canceled')
)
select ev.antes || ' -> ' || ev.kind as salto, p.role, count(*) as veces,
       count(*) filter (where p.role = 'warehouse'
         and lower(btrim(coalesce(p.store, ''))) not in (lower(btrim(coalesce(d.store, ''))),
                                                          lower(btrim(coalesce(d.pickup_name, ''))),
                                                          lower(btrim(coalesce(d.delivery_name, ''))))) as almacen_fuera_de_su_tienda
  from ev join public.profiles p on p.id = ev.created_by
          join public.deliveries d on d.id = ev.delivery_id
 where ev.created_at > now() - interval '90 days'
   and (ev.antes, ev.kind) in (('delivered','picked_up'), ('picked_up','ready'), ('ready','fulfilling'),
                               ('fulfilling','approved'), ('approved','pending'))
 group by 1, 2 order by 1, 2;

-- M12. Tiendas y grupos
select e->>'name' as tienda, nullif(btrim(e->>'group'), '') as grupo
  from public.settings s, jsonb_array_elements(s.stores) e;
select id, full_name, store from public.profiles where role = 'warehouse';

-- M13. Office y gerentes sin tienda (con la 142 solo borran sus propios borradores)
select role, count(*) filter (where coalesce(btrim(store), '') = '') as sin_tienda, count(*) as total
  from public.profiles where role in ('manager', 'accounting') group by role;
```

---

## 8 · Reversión

En una transacción propia, a mano (también comentada al final del `.sql`):

1. El guard como lo dejó la 139: volver a correr su `create or replace function
   public.guard_delivery_stage()` (de `139_office_entrega_y_deshace.sql`).
2. La política como la dejó la 131:
   `alter policy "deliveries delete" on public.deliveries using ((select public.has_deliveries_access()));`
3. `drop trigger if exists deliveries_guardar_borrada on public.deliveries;` y
   `drop function if exists public.guardar_orden_borrada();`
4. `drop function if exists public.orden_de_mis_tiendas(text, text, text, text);` (después del 1 y el 2).
5. **La tabla `deliveries_borradas` NO se borra al revertir.** Guarda órdenes que ya no existen en
   ningún otro sitio; se queda, con sus triggers de inmutabilidad, aunque nadie escriba más en ella.
   Quitarla sería decisión del dueño, con `pg_dump` de esa tabla antes.
6. `delete from public.schema_migrations where name = '142_deshacer_almacen_y_borrar_borradores.sql';`

**Antes de aplicar:** `pg_dump` reciente o respaldo activo; `node scripts/db/migrate-status.mjs`
antes (tiene que listar solo la 142 como pendiente) y después («todo al día»).

---

## 9 · Lo que NO se ha medido

- **El `.sql` no se ha ejecutado nunca**, ni en ensayo. La autocomprobación y la matriz están
  escritas, no corridas. En particular `orden_de_mis_tiendas` no se ha probado con los nombres
  reales de `settings.stores`, y la tabla y los triggers del rastro no existen en ninguna base todavía.
- **Los 946 `order_events` borrados desde el 2026-07-15** (M5) con solo 4 órdenes borradas: **sin
  explicar**. No viene de ninguna migración ni del código actual; que fuera una versión vieja de la
  app es sospecha, no medición. La 142 no lo explica ni lo cambia: `order_events` sigue sin política
  de DELETE (100) y lo único que la borra es la cascada.
- **M13**: cuántos office/gerentes no tienen tienda (solo borrarían sus propios borradores).
- **Que ningún camino de UPDATE de la app mande un `created_by` distinto** está leído
  (`OrderModal.tsx:549-571` manda la orden con el que ya tenía; `data-provider.tsx:934` fija `me.id` en
  INSERT), no ejecutado. M9 = 0 dice que no ha pasado en producción, no que no pueda pasar.
- **El tamaño del rastro**: una orden con muchos eventos lleva su historial entero en `jsonb`. Con 4
  borrados en dos meses no importa; no está medido para un borrado masivo.
- **`vitest` no se ha corrido** en esta rama: el worktree no tiene `node_modules` y la rama solo añade
  un `.sql` y este `.md`, sin tocar código.
- Nada abierto en un navegador (no hay pantalla nueva todavía).

---

## 10 · Decisiones tomadas (2026-09-23)

**Del dueño:**

1. **Office y gerente borran cualquier borrador de su tienda y su grupo**, sea de quien sea
   (`accounting` y `manager`: los dos son «office» para él). Con la misma función de tienda que el
   deshacer de almacén.
2. **Rastro de cada orden borrada**: tabla escrita por un trigger `before delete`, con la fila, sus
   `order_events` y `notifications`, quién (puede ser NULL con service-role) y cuándo. Solo se
   inserta; nadie la cambia ni la borra, ni el admin; la lee solo el admin; vale también para
   service-role.

**Del orquestador:**

3. `picked_up→ready` de almacén **sin límite de tienda**, por «Dejar en tienda» (D-224).
4. **El motivo del deshacer lo exige la pantalla**, como en la 139.
5. Almacén **no** hace `approved→pending`.

**Queda abierto:** nada que decidir para aplicar. Lo que falta es aprobar esta versión, el respaldo y
el ensayo.

---

## 11 · Qué hará la fase de pantalla (cuando esto se apruebe; no está en esta rama)

- `puedeDeshacer(rol, etapa, orden, yo)`: almacén en `delivered`, `picked_up`, `ready`, `fulfilling`
  **solo si la orden es de sus tiendas** (la misma regla que `esDeMisTiendas`/`atStore`) y `me.store`
  no está vacío; nunca en `approved`.
- «Volver a preparando» (D-287) pasa a ser el diálogo de «Deshacer etapa» con motivo.
- Botón «Eliminar»: admin como hoy; office y gerente **en cualquier `draft` de sus tiendas**; cualquier
  otro, **solo en `draft` y si `created_by === me.id`**. Una función `puedeBorrar` espejo de la
  política, con su prueba contra el `.sql`.
- `deleteDelivery` con `.select("id")`: si vuelve vacío, decirlo y **no** quitar la fila de la lista.
- Una vista de admin de «Órdenes borradas» leyendo `deliveries_borradas` (opcional; la tabla ya sirve
  consultada a mano).
- `entregar-ya-y-deshacer.test.ts` lee la 142 y modela almacén de verdad.
