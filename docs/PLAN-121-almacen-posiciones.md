# Plan — 121 · Almacén lee las posiciones de los choferes

**Estado:** PLAN EN PAPEL. Nada aplicado. La migración está escrita
(`supabase/migrations/121_warehouse_lee_posiciones.sql`) y espera respaldo, ensayo y visto bueno.
**Fecha:** 2026-09-17 · **Rama:** `almacen-mapa-en-vivo` · **Decisión:** la entrada `D-313` de esa rama.
**Prerrequisito de aplicación:** la definición actual de la política guardada (§5), que es lo único que
cambia. No hace falta `pg_dump` de datos: esta migración no escribe ninguna fila.

---

## El problema, en una línea

Almacén pidió ver el mapa de las rutas y por dónde va cada chofer. La ruta y el orden de paradas ya se
le dieron sin tocar la base (D-287: salen de `deliveries`, que almacén ya lee). Lo que falta es la
posición en vivo, y esa vive en `public.driver_locations`, cuya política de lectura no incluye a
almacén: la lista llega vacía, sin error y sin aviso.

---

## 1. Qué se abre, dicho sin adornos

La ubicación de los choferes pasa a verla **cualquiera con el rol `warehouse`**, no solo el supervisor
que lo pidió. Se le dijo al dueño con esas palabras y lo eligió igual. Queda escrito aquí porque dentro
de seis meses nadie se acordará de que la pregunta se hizo.

Lo que **no** se abre: escribir posiciones. La política de escritura sigue siendo `driver_id =
auth.uid()`, o sea solo el propio chofer.

---

## 2. Inventario de LECTURAS de `public.driver_locations`

| Quién lee | Para qué | Cómo |
|---|---|---|
| `data-provider.tsx:581` | la cola de las últimas 3 h, y se queda con el fijo más reciente por chofer | cliente, clave anónima → pasa por RLS |
| `data-provider.tsx:769` | tiempo real: cada `INSERT` va directo al punto de ese chofer | canal de Supabase → pasa por RLS |
| `map/page.tsx` | mapa de despacho | desde el proveedor |
| `routes/page.tsx` | gestor de rutas, y las alarmas de seguimiento | desde el proveedor |
| `my-route/page.tsx` | el chofer, su propio punto | desde el proveedor |
| `track/page.tsx` | recorrido de un día, después | consulta propia a `driver_locations` |
| `warehouse/page.tsx` (nuevo) | la ruta del día con «por dónde va» | desde el proveedor |

**Todas van por la clave anónima**, así que todas obedecen a la política. Por eso basta cambiarla: no
hay ningún camino que la salte. El `service_role` (la poda) la salta por definición y no cambia.

## 3. Inventario de ESCRITURAS

| Quién escribe | Qué | Gateado por |
|---|---|---|
| `data-provider.tsx:1120` y `:1154` | el chofer manda su posición, y la cola sin conexión | política de escritura: `driver_id = auth.uid()` |
| `prune_driver_locations` (cron) | borra lo viejo | `service_role` desde la 103 |

Ninguna cambia.

---

## 4. La política vigente, literal, y el cambio

Vigente (la escribió la 080 sobre la de la 043, con el patrón `(select ...)` del initplan). La 103 es
posterior y toca esta tabla, pero **solo** el `EXECUTE` de `prune_driver_locations`; dice expresamente que
no toca la RLS:

```sql
alter policy "read fleet locations" on public.driver_locations
  using (((driver_id = (select auth.uid()))
          OR (COALESCE((select current_user_role()), ''::text)
              = ANY (ARRAY['admin'::text, 'logistics'::text, 'manager'::text]))));
```

El cambio es una palabra: `'warehouse'` entra en esa lista. Se hace con `alter policy` y no con `drop` +
`create`: la política existe, y un `drop` deja un instante con RLS activa y sin política, o sea un
instante en el que nadie ve nada.

La migración escribe `public.current_user_role()` con el esquema delante; la 080 lo escribió sin él.
Es la misma función —`public` está en el `search_path`— y Postgres guarda la expresión ya resuelta, así
que `pg_get_expr` devolverá lo mismo en los dos casos.

---

## 5. Lo que NO debe romperse

| Cosa | Cómo funciona | Contra el cambio |
|---|---|---|
| El chofer ve su propio rastro | primera rama de la política, `driver_id = auth.uid()` | ✅ intacta |
| Admin, logística y gerencia ven la flota | su rama de roles | ✅ intacta; solo se añade uno |
| Ventas y office **no** ven posiciones | no están en la lista | ✅ siguen fuera |
| Un chofer no ve a otro chofer | no está en la lista de roles | ✅ sigue igual |
| Solo el chofer escribe su posición | política de escritura aparte | ✅ no se toca |
| La poda | `service_role`, salta RLS (103) | ✅ no se toca |
| El mapa de despacho y el gestor de rutas | leen del proveedor | ✅ misma política, más ancha |

**Antes de aplicar**, guardar lo que hay, que es lo único que cambia:

```sql
select polname, pg_get_expr(polqual, polrelid)
  from pg_policy where polrelid = 'public.driver_locations'::regclass;
```

---

## 6. Matriz de pruebas — se corre ANTES de aplicar, con `ROLLBACK`

El procedimiento literal está al final de la 121: una posición de ensayo de un chofer real, insertada
como postgres dentro de la transacción, y un `count(*)` por rol. Se corre **dos veces** en la misma
transacción: sin la 121 y con la 121 aplicada dentro. **Cero filas no es un error: es «no ve nada»**, y
así se lee.

Leyenda: 👁 ve la posición · — no la ve.

| Rol | antes | después |
|---|---|---|
| almacén | — | 👁 |
| logística | 👁 | 👁 |
| gerencia | 👁 | 👁 |
| admin | 👁 | 👁 |
| ventas | — | — |
| office (`accounting`) | — | — |
| el propio chofer | 👁 | 👁 |
| otro chofer | — | — |

Y una comprobación más, en los dos casos: **almacén sigue sin poder escribir** una posición ajena.

La matriz esperada sale de leer la política, no de medirla. El ensayo es la medición: una celda que no
coincida se para y se mira antes de aplicar.

---

## 7. Reversión

Una sentencia, la misma política sin `'warehouse'` (está literal en la migración). Sin `drop`. No hay
datos que deshacer: esta migración no escribe ninguna fila. Lo que almacén haya visto mientras estuvo
aplicada, ya lo vio.

---

## 8. Fuera de alcance

- **La pestaña «🗺 Mapa» y el gestor de rutas siguen sin ser de almacén.** El mapa que ve almacén es el
  de su propia pantalla, de solo lectura: no asigna choferes ni reordena paradas.
- **El recorrido histórico (`/track`)** sigue siendo de admin, gerencia y logística. Esta migración abre
  la posición **actual** —lo que pidió el dueño—, y la pantalla de almacén solo pinta fijos de la última
  hora.
