# Plan 142 · Almacén deshace un paso, y borrar pasa a ser del borrador propio

Plan en papel exigido por `CLAUDE.md` («Antes de tocar RLS, triggers o permisos en producción»).
Molde: `docs/PLAN-A-2a-profiles-rls.md`. **Sin aprobar todavía.**

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

Todo lo de aquí sale de **leer el código de `b1a847cf`** (main). Nada se ha ejecutado contra la base:
este worktree no tiene `.env.local`. Lo que depende de la base está en §7 como consulta de solo
lectura para el orquestador, y en §9 como no medido.

---

## 0 · Resumen en cinco líneas

1. **Office ya tiene todo lo de deshacer** (D-361, 139). Lo único que le falta de lo pedido es
   **borrar borradores**, y eso hoy solo lo enseña la pantalla al admin.
2. **Almacén ya deshacía en la base tres de los cuatro pasos**, en cualquier tienda y sin motivo; la
   pantalla solo le enseñaba uno. Lo nuevo en la base es `fulfilling → approved` y **el límite de
   tienda**.
3. **El agujero de DELETE está confirmado en el repo:** cualquiera con el módulo borra cualquier orden
   que vea, no hay trigger que lo acote, y **el borrado se lleva el historial** (`order_events` cuelga
   con `ON DELETE CASCADE`), así que no queda rastro.
4. **Seguir editando un borrador y un duplicado ya funciona** para todos menos almacén (D-286). No se
   toca.
5. Para que «solo tu propio borrador» signifique algo, **`created_by` deja de poder reescribirse**:
   hoy ventas puede ponerse como autor del borrador de otro.

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

**Veredicto: el agujero está confirmado en el repo** (falta confirmarlo en la base, §7 M2-M4). Un
vendedor, un chofer o un almacenista pueden borrar una orden entregada llamando a PostgREST, y no
queda ni la orden ni su historial.

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

| Rol | Hoy (base) | Propuesta |
|---|---|---|
| admin | cualquier orden que vea (todas) | **igual** |
| sales, driver, manager, accounting, logistics | cualquier orden que vea | **solo su propio borrador**: `stage = 'draft'` y `created_by = auth.uid()` |
| warehouse | cualquier orden que vea (`approved`+) | solo su propio borrador — en la práctica **nada**: almacén no crea borradores (el guard no le deja insertar en `draft`, `139:90-111`) |

**¿Office borra los borradores de otros de su tienda? Propuesta: NO.** Office ya puede **anular**
cualquier borrador con motivo (`draft→canceled`, `139:187` y la invariante de motivo de la 122), y
anular **deja rastro** en `order_events`; borrar no deja nada (§1b). El caso que el dueño describe
—«los draft, si no los ocupan»— es un borrador **propio** que sobra: eso lo cubre la regla de autor.
Para el borrador abandonado de otro, anular es la herramienta correcta. Si el dueño lo quiere igual,
es una línea en la política (ver §5, alternativa comentada) y la RLS de lectura ya lo acota a sus
tiendas visibles.

**Duplicados:** nacen `draft` con `created_by` = quien duplicó (`data-provider.tsx:934`). Los borra
quien los duplicó. No necesitan regla aparte.

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
(`139:121`, `139:138`) y hoy se podían saltar reescribiéndolo.

---

## 3 · Inventario de lecturas y escrituras que toca

| Objeto | Qué | Quién lo usa |
|---|---|---|
| `public.guard_delivery_stage()` | **reemplazada** (desde la def. vigente, la de la 139) | trigger `deliveries_guard_stage`, en cada INSERT/UPDATE de `deliveries` |
| `public.orden_de_mis_tiendas(text,text,text,text)` | **nueva**, `stable security definer`, `revoke … from public, anon` | solo el guard |
| política `"deliveries delete"` | `alter policy` (no drop: sin ventana sin política) | todo DELETE de `deliveries` por `authenticated` |
| Lee | `profiles.store` (de `auth.uid()`), `settings.stores` | ambas solo las escribe el admin: `profiles_guard_privileged` (`131:100-118`), `settings update admin` (`100:35-36`) |

No se tocan: la política de lectura (131), las de insert/update (131), `order_events`, columnas,
filas. Service-role (`auth.uid()` null) sigue saliendo del guard en la primera línea y salta la RLS.

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

**Pruebas del repo que leen el `.sql` del guard y habrá que mover a la 142 en la fase de pantalla**
(no en esta rama): `entregar-ya-y-deshacer.test.ts:19` (lee la 139 y modela almacén como «la base no
le deja deshacer nada», lo cual **ya hoy es falso**: la 139 le deja 3 pasos; la prueba pasa porque
compara `false` con `false`), `agregar-material.test.ts` (138 y 139). Las demás leen migraciones
anteriores y no cambian.

---

## 5 · Las políticas y el guard, literales

El `.sql` completo está en `supabase/migrations/142_deshacer_almacen_y_borrar_borradores.sql`
(checksum `e1aec446…a07c`, bloque `-- @ledger-below` puesto). **Sin `begin`/`commit` propios.**
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

La política, **desde la vigente** (`131:195-197`):

```sql
alter policy "deliveries delete" on public.deliveries
  using (
    (select public.has_deliveries_access())
    and (
      (select public.is_admin())
      or (stage = 'draft' and created_by = (select auth.uid()))
    )
  );
```

**Alternativa, si el dueño quiere que office borre borradores ajenos** (no está en el `.sql`):

```sql
      or (stage = 'draft' and (select public.current_user_role()) in ('manager','accounting'))
```

La lectura (131) ya lo acota a sus tiendas visibles.

---

## 6 · Matriz de pruebas por rol, con ROLLBACK (la corre el orquestador)

**Antes de nada, M2 (§7): que no haya triggers de terceros sobre `deliveries`** (webhooks de la base,
`net.http_post`). En el repo no hay ninguno (`grep net.http` solo sale en el ERP, `064:1630`), y
`pg_net` encola dentro de la transacción, así que un ROLLBACK no manda nada; pero se mira.

Los 4 casos que **D-361 se saltó por falta de datos** (`fulfilling→delivered`, `picked_up→delivered`,
`picked_up→ready`, `fulfilling→approved` de office) van aquí como O1-O4, **con órdenes creadas dentro
de la transacción**: ya no dependen de que haya órdenes en esas etapas en producción.

Sustituir: `<UUID-ALMACEN>` (rol `warehouse`, **con** tienda), `<UUID-OFFICE>` (`accounting`),
`<UUID-VENTAS>` y `<UUID-VENTAS2>` (dos `sales`), `<UUID-ADMIN>`, y `<TIENDA-B>` (una tienda de
`settings.stores` que **no** sea la del almacenista **ni de su grupo**; M12 las lista).

Se pega entero en `psql` (o el runner de siempre). **Sin `commit` en ningún sitio.** Cada caso va en
su propio `begin … exception` dentro de un `do`: un error esperado no aborta la transacción, y cada
línea imprime `OK` o `MAL`.

```sql
begin;

-- 0. La migración, dentro de la misma transacción (se deshace con el resto).
\i supabase/migrations/142_deshacer_almacen_y_borrar_borradores.sql

-- 1. Datos de prueba, como postgres: auth.uid() es null y el guard los deja pasar sin mirar.
--    Tienda A = la del almacenista. Ids fijos para poder leerlos.
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
  ('14200000-0000-4000-8000-000000000025','draft',     '<TIENDA-B>','<TIENDA-B>','ENSAYO 142','<UUID-VENTAS>');

set local role authenticated;

-- 2. ALMACEN
set local request.jwt.claims to '{"sub":"<UUID-ALMACEN>","role":"authenticated"}';
do $$
declare n int;
begin
  -- Tienen que PASAR (1 fila)
  begin update public.deliveries set stage='approved'   where id='14200000-0000-4000-8000-000000000001'; get diagnostics n = row_count;
    raise notice 'W1  fulfilling->approved, su tienda (NUEVO)    esperado 1 fila: %', case when n=1 then 'OK' else 'MAL '||n end;
  exception when others then raise notice 'W1  MAL: %', sqlerrm; end;
  begin update public.deliveries set stage='fulfilling' where id='14200000-0000-4000-8000-000000000002'; get diagnostics n = row_count;
    raise notice 'W2  ready->fulfilling, su tienda (D-287)       esperado 1 fila: %', case when n=1 then 'OK' else 'MAL '||n end;
  exception when others then raise notice 'W2  MAL: %', sqlerrm; end;
  begin update public.deliveries set stage='ready'      where id='14200000-0000-4000-8000-000000000003'; get diagnostics n = row_count;
    raise notice 'W3  picked_up->ready, su tienda                esperado 1 fila: %', case when n=1 then 'OK' else 'MAL '||n end;
  exception when others then raise notice 'W3  MAL: %', sqlerrm; end;
  begin update public.deliveries set stage='picked_up'  where id='14200000-0000-4000-8000-000000000004'; get diagnostics n = row_count;
    raise notice 'W4  delivered->picked_up, su tienda            esperado 1 fila: %', case when n=1 then 'OK' else 'MAL '||n end;
  exception when others then raise notice 'W4  MAL: %', sqlerrm; end;
  begin update public.deliveries set stage='ready'      where id='14200000-0000-4000-8000-000000000009'; get diagnostics n = row_count;
    raise notice 'W8  picked_up->ready, OTRA tienda (D-224)      esperado 1 fila: %', case when n=1 then 'OK' else 'MAL '||n end;
  exception when others then raise notice 'W8  MAL: %', sqlerrm; end;
  begin update public.deliveries set stage='fulfilling' where id='14200000-0000-4000-8000-000000000010'; get diagnostics n = row_count;
    raise notice 'W9  approved->fulfilling, OTRA tienda (igual)  esperado 1 fila: %', case when n=1 then 'OK' else 'MAL '||n end;
  exception when others then raise notice 'W9  MAL: %', sqlerrm; end;
  -- Tienen que FALLAR
  begin update public.deliveries set stage='approved'   where id='14200000-0000-4000-8000-000000000006';
    raise notice 'W5  fulfilling->approved, OTRA tienda          esperado ERROR: MAL, paso';
  exception when others then raise notice 'W5  esperado ERROR: OK (%)', sqlerrm; end;
  begin update public.deliveries set stage='fulfilling' where id='14200000-0000-4000-8000-000000000007';
    raise notice 'W6  ready->fulfilling, OTRA tienda (hoy pasa)  esperado ERROR: MAL, paso';
  exception when others then raise notice 'W6  esperado ERROR: OK (%)', sqlerrm; end;
  begin update public.deliveries set stage='picked_up'  where id='14200000-0000-4000-8000-000000000008';
    raise notice 'W7  delivered->picked_up, OTRA tienda (hoy pasa) esperado ERROR: MAL, paso';
  exception when others then raise notice 'W7  esperado ERROR: OK (%)', sqlerrm; end;
  begin update public.deliveries set stage='pending'    where id='14200000-0000-4000-8000-000000000022';
    raise notice 'W10 approved->pending, su tienda               esperado ERROR: MAL, paso';
  exception when others then raise notice 'W10 esperado ERROR: OK (%)', sqlerrm; end;
  begin update public.deliveries set stage='ready'      where id='14200000-0000-4000-8000-000000000021';
    raise notice 'W11 delivered->ready (dos pasos), su tienda    esperado ERROR: MAL, paso';
  exception when others then raise notice 'W11 esperado ERROR: OK (%)', sqlerrm; end;
  -- Borrar: 0 filas, sin error
  begin delete from public.deliveries where id='14200000-0000-4000-8000-000000000005'; get diagnostics n = row_count;
    raise notice 'W12 borrar una aprobada de su tienda (hoy 1)   esperado 0 filas: %', case when n=0 then 'OK' else 'MAL '||n end;
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
    raise notice 'W13 SIN tienda: fulfilling->approved           esperado ERROR: MAL, paso';
  exception when others then raise notice 'W13 esperado ERROR: OK (%)', sqlerrm; end;
end $$;

-- 3. OFFICE: los 4 casos que D-361 no pudo ejercer, y borrar
set local request.jwt.claims to '{"sub":"<UUID-OFFICE>","role":"authenticated"}';
do $$
declare n int;
begin
  begin update public.deliveries set stage='delivered' where id='14200000-0000-4000-8000-000000000011'; get diagnostics n = row_count;
    raise notice 'O1  office fulfilling->delivered (D-361)       esperado 1 fila: %', case when n=1 then 'OK' else 'MAL '||n end;
  exception when others then raise notice 'O1  MAL: %', sqlerrm; end;
  begin update public.deliveries set stage='delivered' where id='14200000-0000-4000-8000-000000000012'; get diagnostics n = row_count;
    raise notice 'O2  office picked_up->delivered (D-361)        esperado 1 fila: %', case when n=1 then 'OK' else 'MAL '||n end;
  exception when others then raise notice 'O2  MAL: %', sqlerrm; end;
  begin update public.deliveries set stage='ready'     where id='14200000-0000-4000-8000-000000000013'; get diagnostics n = row_count;
    raise notice 'O3  office picked_up->ready (D-361)            esperado 1 fila: %', case when n=1 then 'OK' else 'MAL '||n end;
  exception when others then raise notice 'O3  MAL: %', sqlerrm; end;
  begin update public.deliveries set stage='approved'  where id='14200000-0000-4000-8000-000000000014'; get diagnostics n = row_count;
    raise notice 'O4  office fulfilling->approved (D-361)        esperado 1 fila: %', case when n=1 then 'OK' else 'MAL '||n end;
  exception when others then raise notice 'O4  MAL: %', sqlerrm; end;
  begin delete from public.deliveries where id='14200000-0000-4000-8000-000000000015'; get diagnostics n = row_count;
    raise notice 'O5  office borra borrador AJENO (hoy 1)        esperado 0 filas: %', case when n=0 then 'OK' else 'MAL '||n end;
  exception when others then raise notice 'O5  MAL: %', sqlerrm; end;
  begin delete from public.deliveries where id='14200000-0000-4000-8000-000000000024'; get diagnostics n = row_count;
    raise notice 'O6  office borra una entregada (hoy 1)         esperado 0 filas: %', case when n=0 then 'OK' else 'MAL '||n end;
  exception when others then raise notice 'O6  MAL: %', sqlerrm; end;
  begin delete from public.deliveries where id='14200000-0000-4000-8000-000000000018'; get diagnostics n = row_count;
    raise notice 'O7  office borra SU borrador                   esperado 1 fila: %', case when n=1 then 'OK' else 'MAL '||n end;
  exception when others then raise notice 'O7  MAL: %', sqlerrm; end;
end $$;

-- 4. VENTAS2 sobre el borrador de VENTAS
set local request.jwt.claims to '{"sub":"<UUID-VENTAS2>","role":"authenticated"}';
do $$
declare n int;
begin
  begin update public.deliveries set delivery_notes='ensayo 142' where id='14200000-0000-4000-8000-000000000019'; get diagnostics n = row_count;
    raise notice 'V1  edita borrador ajeno (D-286)               esperado 1 fila: %', case when n=1 then 'OK' else 'MAL '||n end;
  exception when others then raise notice 'V1  MAL: %', sqlerrm; end;
  begin update public.deliveries set created_by='<UUID-VENTAS2>' where id='14200000-0000-4000-8000-000000000019';
    raise notice 'V2  se pone de autor de un borrador ajeno (hoy pasa) esperado ERROR: MAL, paso';
  exception when others then raise notice 'V2  esperado ERROR: OK (%)', sqlerrm; end;
  begin delete from public.deliveries where id='14200000-0000-4000-8000-000000000019'; get diagnostics n = row_count;
    raise notice 'V3  borra borrador ajeno (hoy 1)               esperado 0 filas: %', case when n=0 then 'OK' else 'MAL '||n end;
  exception when others then raise notice 'V3  MAL: %', sqlerrm; end;
end $$;

-- 5. VENTAS sobre lo suyo
set local request.jwt.claims to '{"sub":"<UUID-VENTAS>","role":"authenticated"}';
do $$
declare n int; autor uuid;
begin
  begin delete from public.deliveries where id='14200000-0000-4000-8000-000000000017'; get diagnostics n = row_count;
    raise notice 'V4  borra SU pendiente (hoy 1)                 esperado 0 filas: %', case when n=0 then 'OK' else 'MAL '||n end;
  exception when others then raise notice 'V4  MAL: %', sqlerrm; end;
  begin delete from public.deliveries where id='14200000-0000-4000-8000-000000000020'; get diagnostics n = row_count;
    raise notice 'V5  borra SU entregada (hoy 1)                 esperado 0 filas: %', case when n=0 then 'OK' else 'MAL '||n end;
  exception when others then raise notice 'V5  MAL: %', sqlerrm; end;
  begin delete from public.deliveries where id='14200000-0000-4000-8000-000000000015'; get diagnostics n = row_count;
    raise notice 'V6  borra SU borrador                          esperado 1 fila: %', case when n=1 then 'OK' else 'MAL '||n end;
  exception when others then raise notice 'V6  MAL: %', sqlerrm; end;
  begin update public.deliveries set created_by=null where id='14200000-0000-4000-8000-000000000017';
    raise notice 'V7  borra el autor de SU pendiente (hoy pasa)  esperado ERROR: MAL, paso';
  exception when others then raise notice 'V7  esperado ERROR: OK (%)', sqlerrm; end;
  begin insert into public.deliveries (stage, store, account, created_by)
      values ('draft','<TIENDA-B>','ENSAYO 142','<UUID-VENTAS2>') returning created_by into autor;
    raise notice 'V8  inserta firmando como otro (hoy queda el otro) esperado autor = el mismo: %',
      case when autor = '<UUID-VENTAS>'::uuid then 'OK' else 'MAL '||coalesce(autor::text,'null') end;
  exception when others then raise notice 'V8  MAL: %', sqlerrm; end;
end $$;

-- 6. ADMIN
set local request.jwt.claims to '{"sub":"<UUID-ADMIN>","role":"authenticated"}';
do $$
declare n int;
begin
  begin update public.deliveries set created_by='<UUID-ADMIN>' where id='14200000-0000-4000-8000-000000000016'; get diagnostics n = row_count;
    raise notice 'A1  admin corrige el autor                     esperado 1 fila: %', case when n=1 then 'OK' else 'MAL '||n end;
  exception when others then raise notice 'A1  MAL: %', sqlerrm; end;
  begin update public.deliveries set stage='canceled', canceled_reason='other', canceled_reason_note='ensayo' where id='14200000-0000-4000-8000-000000000024';
    raise notice 'A2  admin anula una entregada (122)            esperado ERROR: MAL, paso';
  exception when others then raise notice 'A2  esperado ERROR: OK (%)', sqlerrm; end;
  begin delete from public.deliveries where id='14200000-0000-4000-8000-000000000024'; get diagnostics n = row_count;
    raise notice 'A3  admin borra una entregada (igual que hoy)  esperado 1 fila: %', case when n=1 then 'OK' else 'MAL '||n end;
  exception when others then raise notice 'A3  MAL: %', sqlerrm; end;
end $$;

ROLLBACK;
```

**Resumen de lo que debe salir — 31 casos, cada línea tiene que decir `OK`:**

| Esperado | Casos | Cuántos |
|---|---|---|
| 1 fila | W1-W4, W8, W9, O1-O4, O7, V1, V6, A1, A3 | 15 |
| ERROR | W5-W7, W10, W11, W13, V2, V7, A2 | 9 |
| 0 filas, sin error (la RLS de borrar filtra) | W12, O5, O6, V3, V4, V5 | 6 |
| el autor lo pone la base | V8 | 1 |

**Cambian respecto de hoy (11):** W1 (hoy falla), W6 y W7 (hoy pasan), V2 y V7 (hoy pasan), V8 (hoy
queda el otro como autor), y los seis de cero filas (hoy borran 1). Los otros 20 tienen que salir
igual antes y después.

Requisitos de los datos: `<UUID-OFFICE>` y `<UUID-VENTAS>`/`<UUID-VENTAS2>` tienen que **ver**
`<TIENDA-B>` (sin `visible_stores`, o con ella dentro); si no, sus casos salen «MAL 0» porque la
lectura esconde la fila, no porque el guard falle. El `\i` es relativo: correrlo desde la raíz del
repo.

**Recomendado:** correr el mismo bloque **sin** el `\i` de la migración (base de hoy) y guardar la
salida: así la diferencia antes/después queda medida, no supuesta. Sin la 142, W13 no es una prueba
(hoy almacén no tiene límite de tienda) y V8 dice «MAL» a propósito.

**Si algún MAL no es de los esperados, parar**: no aplicar.

Opcional, si hay tiendas agrupadas (M12): un caso W14 con una orden de **otra tienda del mismo
grupo** que el almacenista, `fulfilling→approved`, esperado 1 fila.

---

## 7 · Mediciones de solo lectura (para el orquestador, antes de aplicar)

Todas son `select`. Ninguna escribe. Van antes del ensayo.

```sql
-- M1. El guard vigente es el de la 139 (y la 142 no está)
select position('or (old_stage = ''fulfilling'' and new_stage = ''approved'') then return NEW; end if;'
                in pg_get_functiondef('public.guard_delivery_stage()'::regprocedure)) > 0 as tiene_139,
       position('orden_de_mis_tiendas'
                in pg_get_functiondef('public.guard_delivery_stage()'::regprocedure)) = 0 as sin_142;

-- M2. Triggers sobre deliveries: ¿alguno de DELETE?, ¿alguno llama fuera (webhook, net.http_post)?
select tgname, pg_get_triggerdef(oid) from pg_trigger
 where tgrelid = 'public.deliveries'::regclass and not tgisinternal order by tgname;

-- M3. Políticas de deliveries, literales (confirma que "deliveries delete" es la de la 131)
select policyname, cmd, permissive, roles, qual, with_check from pg_policies
 where schemaname = 'public' and tablename = 'deliveries' order by cmd, policyname;

-- M4. Qué se lleva un borrado: FKs hacia deliveries (c = cascade, n = set null)
select conrelid::regclass as tabla, conname, confdeltype from pg_constraint
 where confrelid = 'public.deliveries'::regclass and contype = 'f' order by 1;

-- M5. ¿Se ha borrado algo? Contadores de Postgres desde el último reset de estadísticas
select relname, n_tup_ins, n_tup_upd, n_tup_del, n_live_tup from pg_stat_user_tables
 where schemaname = 'public' and relname in ('deliveries', 'order_events', 'notifications');
select stats_reset from pg_stat_database where datname = current_database();

-- M6. Huecos en order_no (identity). OJO: un INSERT que el guard rechaza también consume número,
--     así que un hueco NO prueba un borrado; cero huecos sí prueba que no hubo ninguno.
select min(order_no), max(order_no), count(*),
       max(order_no) - min(order_no) + 1 - count(*) as huecos
  from public.deliveries;

-- M7. Paradas de planes de ruta que apuntaban a una orden que ya no existe (evidencia de borrado)
select count(*) as paradas_huerfanas,
       count(distinct split_part(s.order_ref, '#', 1)) as ordenes_distintas
  from public.route_plan_stops s
 where s.delivery_id is null
   and split_part(s.order_ref, '#', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   and not exists (select 1 from public.deliveries d where d.id::text = split_part(s.order_ref, '#', 1));

-- M8. Borradores hoy: cuántos, de quién, y cuántos viejos (lo que el dueño llama «si no los ocupan»)
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

-- M10. Almacenistas sin tienda (con la 142 no deshacen)
select count(*) filter (where coalesce(btrim(store), '') = '') as sin_tienda, count(*) as total
  from public.profiles where role = 'warehouse';

-- M11. Pasos atrás hechos en los últimos 90 días, por rol, y cuántos de almacén fuera de su tienda
--      (APROXIMADO: no cuenta grupos, y un evento de nota con kind = etapa puede colarse).
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

-- M12. Para elegir <TIENDA-B> y ver si hay grupos
select e->>'name' as tienda, nullif(btrim(e->>'group'), '') as grupo
  from public.settings s, jsonb_array_elements(s.stores) e;
select id, full_name, store from public.profiles where role = 'warehouse';
```

Y fuera de SQL: los **logs de API de Supabase** (Dashboard → Logs → API) muestran peticiones
`DELETE /rest/v1/deliveries`, con la retención que tenga el plan. Es la única fuente que diría
**quién** borró, si alguien lo hizo.

---

## 8 · Reversión

En una transacción propia, a mano (también está comentada al final del `.sql`):

1. El guard como lo dejó la 139: volver a correr su `create or replace function
   public.guard_delivery_stage()` (de `139_office_entrega_y_deshace.sql`).
2. La política como la dejó la 131:
   `alter policy "deliveries delete" on public.deliveries using ((select public.has_deliveries_access()));`
3. `drop function if exists public.orden_de_mis_tiendas(text, text, text, text);` (después del 1).
4. `delete from public.schema_migrations where name = '142_deshacer_almacen_y_borrar_borradores.sql';`

No hay columnas ni filas que revertir: la 142 no crea, no borra y no escribe ninguna fila.

**Antes de aplicar:** `pg_dump` reciente o respaldo activo; `node scripts/db/migrate-status.mjs`
antes (tiene que listar solo la 142 como pendiente) y después («todo al día»).

---

## 9 · Lo que NO se ha medido

- **Nada contra la base.** Todo lo de §1 es el repo. En particular:
  - que el guard vigente en producción sea el de la 139 (M1);
  - que no haya un trigger de DELETE, o un webhook, creado a mano fuera de las migraciones (M2);
  - que la política de borrar en producción sea la de la 131 (M3) y que las FKs sigan en cascada (M4);
  - **si alguien ha borrado órdenes alguna vez** (M5-M7). Los contadores de M5 cuentan desde el
    último reset de estadísticas, no desde siempre; y como el borrado se lleva el historial, **no hay
    forma de saber qué órdenes fueron** salvo por las paradas huérfanas de M7 o los logs de API.
  - cuántos borradores hay y cuántos almacenistas sin tienda (M8, M10);
  - si almacén ha usado «Volver a preparando» fuera de su tienda (M11), que es lo que la 142 le quita.
- **El `.sql` no se ha ejecutado nunca**, ni en ensayo. La autocomprobación y la matriz están
  escritas, no corridas. En particular la función `orden_de_mis_tiendas` no se ha probado con datos
  reales de `settings.stores` (nombres con espacios, grupos).
- **Que ningún camino de UPDATE de la app mande un `created_by` distinto** está leído
  (`OrderModal.tsx:549-571` manda la orden con el que ya tenía; `data-provider.tsx:934` fija `me.id` en
  INSERT), no ejecutado. La cola offline y las escrituras de `route-plan` no las he recorrido todas;
  el ensayo V1 y el uso real lo dirían.
- **`vitest` no se ha corrido** en esta rama: el worktree no tiene `node_modules` y la rama solo añade
  un `.sql` y este `.md`, sin tocar código. Ninguna prueba del repo lee la carpeta de migraciones
  entera salvo `routes-columns.test.ts:139`, que busca otra restricción.
- Nada abierto en un navegador (no hay pantalla nueva todavía).

---

## 10 · Preguntas para el dueño

1. **¿Office borra borradores de OTROS de su tienda?** Propuesta: no; los anula con motivo (deja
   rastro). Si sí, es la línea de la alternativa de §5.
2. **Almacén pierde `ready→fulfilling` y `delivered→picked_up` en órdenes de otra tienda.** ¿De
   acuerdo? (M11 dirá si alguien lo usaba.) ¿Y el almacenista **sin tienda** no deshace nada?
3. **`picked_up→ready` de almacén se queda sin límite de tienda** porque es también «Dejar en tienda».
   ¿De acuerdo?
4. **¿Quiere rastro de los borrados?** Hoy borrar una orden se lleva su historial. Con la 142 solo se
   borran borradores propios (y el admin cualquier cosa). Si quiere que quede constancia —sobre todo
   de lo que borra el admin—, es otra migración: una tabla `deliveries_borradas` con la fila en jsonb,
   quién y cuándo, escrita por un trigger `after delete`. No está en esta.
5. **¿El motivo del deshacer tiene que exigirlo la base**, o basta con la pantalla (como en la 139)?

---

## 11 · Qué hará la fase de pantalla (cuando esto se apruebe; no está en esta rama)

- `puedeDeshacer(rol, etapa, orden, yo)`: almacén en `delivered`, `picked_up`, `ready`, `fulfilling`
  **solo si la orden es de sus tiendas** (la misma regla que `esDeMisTiendas`/`atStore`) y `me.store`
  no está vacío; nunca en `approved`.
- «Volver a preparando» (D-287) pasa a ser el diálogo de «Deshacer etapa» con motivo.
- Botón «Eliminar»: admin como hoy; cualquier otro, **solo en `draft` y si `created_by === me.id`**.
- `deleteDelivery` con `.select("id")`: si vuelve vacío, decirlo y **no** quitar la fila de la lista.
- `entregar-ya-y-deshacer.test.ts` lee la 142 y modela almacén de verdad; prueba espejo nueva para la
  política de borrar contra `puedeBorrar`.
