# Plan — 138 · Ventas agrega material a una orden ya hecha

**Estado:** escrito, **nada construido**. Esta rama trae **solo este documento**: ni código, ni
migración, ni pruebas. Se escribe para decidir, no para aplicar.
**Fichero de la migración cuando se apruebe:** `supabase/migrations/138_agregar_material.sql`
(confirmado con `ls supabase/migrations | tail -3` → 135, 136, **137**).
**Fecha:** 2026-09-19 · **Rama:** `plan-agregar-material` · **Base medida:** `main` 217b834 (D-338).

---

## El problema, en una línea

Un vendedor, literal: *«A veces agendo un Delivery pero luego el cliente me solicita más material.
Para enviarlo con el mismo envío quiero que agregues la opción de "editar" pero no voy a poder editar
sino que voy a poder agregar más facturas e incrementar # de Pallets»*.

Dos cosas, y **solo** esas dos: **añadir** facturas y **subir** pallets, en una orden suya que ya
existe. Ni cambiar ni quitar facturas, ni bajar pallets, ni tocar dirección, fecha o tarifa.

---

## 1. Cómo se guarda hoy «la factura», y por qué NO puede ser una lista con comas

**`deliveries.invoice_num` es UN solo texto** (`types.ts:131`, `text` en la base). No existe ningún
campo de facturas adicionales.

Lo leen —medido, no supuesto:

| Quién | Dónde | Qué hace con ella |
|---|---|---|
| Comprobante de entrega | `slip.ts:123` | fila «Factura #» |
| Hoja de carga | `slip.ts:214` | `invoice_num \|\| po2 \|\| so_num \|\| estimate_num \|\| —` |
| Manifiesto | `manifest.ts:29` | `Fact #…` por parada |
| Tabla de Órdenes | `OrdersTable.tsx:63` | la columna «Factura #» |
| Tabla, agrupada | `OrdersTable.tsx:125,132` | la etiqueta del grupo cuando se agrupa por factura |
| Documento del tipo | `order-document.ts:24,38,42,45,55` | si el tipo pide factura, **esta** es la que cuenta |
| Pestaña «Factura pendiente» | `documento-pendiente.ts` + `facturaPendiente` (D-338) | pendiente = `documentoPendiente(...).campo === "invoice_num"` |
| Captura desde la fila | `documento-pendiente.ts:60` | ventas escribe `invoice_num` en SU orden (lo que abre la 125) |
| Duplicados | `documento-pendiente.ts:73` y `misma-factura.ts` | `facturaComparable`: sin espacios, sin `#`, minúsculas |
| Búsqueda | `ordenes-visibles.ts` | `invoice_num` está en el pajar de la búsqueda |
| Importación CSV | `csv-import.ts:49` | cabecera `Invoice #` |
| Duplicar / re-entrega | `order-duplicate.ts`, `order-sites.ts` | la copian o la limpian |
| Pantallas | `driver`, `my-route`, `routes`, `warehouse`, `OrderModal` | la pintan |
| API del plan de ruta | `api/route-plan/*` | la lleva a la hoja |

**Meter comas en `invoice_num` rompe a todos en silencio**, y esto es lo peor: ninguno falla, todos
siguen funcionando mal. `facturaComparable("1234, 5678")` deja de casar con `"1234"`, así que el
control de duplicados se apaga; la pestaña de factura pendiente da la orden por resuelta; el
comprobante imprime un churro; agrupar por factura crea un grupo nuevo por cada combinación.

### Propuesta: una columna nueva, y `invoice_num` intacta

```sql
alter table public.deliveries
  add column if not exists invoices_extra text[];
```

- **`invoice_num` sigue siendo «la» factura de la orden** — la primera—, y **nada de la tabla de
  arriba cambia de comportamiento**. Ese es el punto: la lista nueva no entra por la puerta de atrás
  en trece sitios.
- `invoices_extra` guarda **solo las añadidas después**. Vacío o `null` = la orden es como siempre.
- Lo que **sí** debe enseñarlas todas —comprobante, manifiesto, la ficha— lo hace a través de **un
  único** helper nuevo, `facturasDeLaOrden(d)` → `[invoice_num, ...invoices_extra]` sin vacíos ni
  repetidas. Un helper y no trece lecturas: es la lección de D-309, donde la decisión repartida se
  coló por el hueco entre la pieza y quien la llamaba.
- **El control de duplicados sí tiene que mirar las dos**: si no, la misma factura se puede añadir en
  dos órdenes distintas y nadie lo nota. `ordenConEsaFactura` y `otraConLaMismaFactura` pasan a
  recorrer `facturasDeLaOrden`, con `facturaComparable` como está.

**Alternativa descartada: una tabla hija `order_invoices`.** Es lo correcto en un modelo relacional y
es lo que haría si esto creciera (fecha por factura, importe, quién la puso). Hoy no: la app lee
`deliveries` como **un array plano** en `data-provider`, y una tabla hija obliga a su propia RLS, su
propia carga y un join en la consulta más leída de la app. Para «añadir una o dos facturas a una
orden», un `text[]` es proporcionado. Si el dueño pide después importe o fecha por factura, esto se
migra a tabla y el helper es justo el sitio por donde se cambia sin tocar las trece lecturas.

---

## 2. El candado de la base: qué deja hoy y qué haría falta

**La definición VIGENTE del guard es la 127** (`127_borrador_enviado_nace_aprobado.sql`), no la 125:
la 125 metió el bloque de ventas y la 127 volvió a redefinir la función entera por las etapas. Se
parte de la 127, o `create or replace` borra en silencio lo que la 127 añadió.

Lo que la 127 le deja hoy a ventas **con la etapa quieta** (su bloque, literal):

```sql
    if r = 'sales'
       and old_stage not in ('draft','rejected','canceled')
       and (OLD.created_by = auth.uid() or OLD.assigned_sales_rep = auth.uid())
       and coalesce(btrim(OLD.invoice_num), '') = ''
       and coalesce(btrim(NEW.invoice_num), '') <> '' then
      probe := NEW;
      probe.invoice_num := OLD.invoice_num;
      probe.updated_at  := OLD.updated_at;
      if probe is not distinct from OLD then return NEW; end if;
    end if;
```

Es decir: **solo puede rellenar una factura VACÍA**, y solo eso — el `probe` prueba que no cambió
nada más. Lo que pide el vendedor es sobre órdenes que **ya tienen** factura, así que **no es
ensanchar este bloque: es uno nuevo**, con el mismo patrón.

### 2.1 El bloque nuevo, literal (a añadir en la 138, partiendo de la 127)

```sql
    -- 138: ventas AGREGA material a SU orden ya hecha: facturas nuevas y mas pallets, nunca menos.
    -- Mismo patron que el bloque de la 125: se prueba que lo unico que cambia es lo permitido.
    if r = 'sales'
       and old_stage in ('pending','approved','fulfilling')
       and (OLD.created_by = auth.uid() or OLD.assigned_sales_rep = auth.uid())
       -- La lista solo CRECE, y lo que ya estaba sigue estando en el mismo sitio.
       and coalesce(array_length(NEW.invoices_extra, 1), 0) >= coalesce(array_length(OLD.invoices_extra, 1), 0)
       and coalesce(NEW.invoices_extra, '{}') [1:coalesce(array_length(OLD.invoices_extra,1),0)]
           is not distinct from coalesce(OLD.invoices_extra, '{}')
       -- Los pallets solo SUBEN, y no se inventan desde vacio a la baja.
       and coalesce(NEW.est_pallets, 0) >= coalesce(OLD.est_pallets, 0)
       -- Y algo tiene que cambiar, o esto es una escritura vacia que no deberia pasar por aqui.
       and (NEW.invoices_extra is distinct from OLD.invoices_extra
         or NEW.est_pallets     is distinct from OLD.est_pallets) then
      probe := NEW;
      probe.invoices_extra   := OLD.invoices_extra;
      probe.est_pallets      := OLD.est_pallets;
      probe.pickup_duration  := OLD.pickup_duration;
      probe.delivery_duration := OLD.delivery_duration;
      probe.updated_at       := OLD.updated_at;
      if probe is not distinct from OLD then return NEW; end if;
    end if;
```

**Las duraciones entran en el `probe` a propósito**, y es el punto 3.4: son función de los pallets, y
si no se dejan cambiar, la orden queda con los tiempos de antes.

**`invoice_num` NO entra**: sigue siendo intocable por esta vía. Quien no tenía factura la pone por
el camino de la 125, que no cambia.

### 2.2 Los pallets: `est_pallets` y solo ese

Existen **dos** columnas (`types.ts:143-144`): `est_pallets` («estimated by sales») y
`actual_pallets` («revised/confirmed by warehouse»). Ventas toca **`est_pallets`**.

Y no es solo una cuestión de a quién pertenece: **todo lo que cuelga de los pallets lee
`actual_pallets ?? est_pallets`** — medido en `analytics.ts` (×4), `dispatch.ts` (×4),
`manifest.ts`, `slip.ts`, `daily-summary.ts`, `ruta-del-dia.ts`, `secuencia-pd.ts`,
`one-tap-stop.ts`, `route-plan/entrada.ts`, y las tarjetas de `OrdersTable`/`OrdersBoard`. O sea que
**en cuanto almacén escribe `actual_pallets`, subir `est_pallets` no cambia absolutamente nada
aguas abajo**. Eso decide el punto 3.

---

## 3. Hasta qué etapa, y qué cuelga de los pallets

**Propuesta: `pending`, `approved` y `fulfilling`. Desde `ready`, no** — y el mensaje dice que llame
a almacén. Coincide con lo que propusiste, y además hay tres medidas que lo sostienen:

1. **Desde `ready` el cambio sería invisible.** Almacén confirma `actual_pallets` justo al marcar
   listo, y a partir de ahí todo lee `actual ?? est`. Subir `est` no movería ni la capacidad, ni el
   manifiesto, ni la hoja de carga. Dejar hacer algo que no hace nada es peor que no dejar.
2. **Ensuciaría una métrica.** `analytics.ts:354` cuenta «carga corta» cuando
   `actual_pallets < est_pallets`. Subir el estimado después de que almacén contó convierte una carga
   normal en una corta, en el panel, sin que nadie haya cargado de menos.
3. **El Gestor todavía planifica `ready`.** `ETAPAS_RUTEABLES` = `pending, approved, fulfilling,
   ready` (`route-plan/publicar.ts:15`), así que permitirlo ahí también tocaría una ruta ya publicada.

### 3.1 Capacidad del camión: **no se avisa**, y hay que decirlo

`assignmentWarnings` (`dispatch.ts:98-114`) calcula `over_capacity` con
`used + adding > capacity`. Dónde se usa, medido: `map/page.tsx:297` (al elegir chofer) y
`map/page.tsx:299` (`currentWarnings`, que **sí** se recalcula en vivo para la orden **seleccionada**).
No hay ningún otro sitio: ni distintivo en la lista, ni en el Gestor, ni campana.

**Conclusión: subir pallets puede desbordar un camión ya asignado y la app no dice nada**, salvo que
logística abra justo esa orden en el mapa. Esto **no lo arregla esta rama** —re-comprobar la
capacidad del día entero es otro trabajo, con su propia decisión sobre dónde se enseña—, pero el
aviso que sí se puede dar barato es que **el cambio quede a la vista** (3.3).

### 3.2 El plan publicado: `route_seq` no cambia, pero la suposición sí

Confirmado: lo que se escribe al publicar es `assigned_driver`, `load_no`, `route_seq`, `load_auto`
(`publicar.ts:18-26`), y nada de eso depende de los pallets. Y `avisosAlPublicar` compara **un plan
nuevo contra el anterior**: corre al publicar, no cuando una orden cambia. Así que un plan ya
publicado **no se entera** de que la carga creció.

**No medido, y hay que medirlo antes de construir:** `publicar.ts` dice en su cabecera que ahí vive
«cuándo un plan ya no vale porque las órdenes cambiaron». No he leído esa parte. Si existe una
comprobación de caducidad, subir pallets debería entrar en ella, y eso cambia el alcance.

### 3.3 La aprobación: **no vuelve a pendiente**, y queda escrito

De acuerdo con tu propuesta. Una orden aprobada que crece no se re-aprueba: el material es del mismo
cliente y del mismo envío, y devolverla a `pending` la sacaría de la cola de almacén, que es justo lo
contrario de lo que pide el vendedor.

Lo que sí hace es **dejar rastro**: un evento en `order_events` con la etapa actual como `kind` y una
nota legible — *«Ventas agregó la factura 1234 y subió los pallets de 4 a 6»* / *«Sales added invoice
1234 and raised pallets from 4 to 6»*. Es el mismo sitio donde vive la historia de la orden y lo ven
almacén y logística al abrirla.

### 3.4 La tarifa **no** depende de los pallets

Medido en `pricing.ts`: `suggestDeliveryFee` es función de `route_miles`, la zona (pin o ciudad) y la
fecha. **Los pallets no entran.** Subirlos no cambia el precio sugerido y no hay nada que hacer.

### 3.5 Las duraciones **sí**, y es fácil olvidarlo

`OrderModal.tsx:473-474`: `pickup_duration` y `delivery_duration` son
`palletDuration(est_pallets, settings.*_min_per_pallet)`, y hoy se recalculan **solo** en
`withDurations`, al guardar el formulario. Una escritura que suba `est_pallets` sin recalcularlas deja
los tiempos del plan de ruta con el valor viejo. **Van en la misma escritura**, y por eso están en el
`probe` del guard.

---

## 4. Cómo se entera almacén

Lo que hay, medido: `notificationsForStage` (`notifications.ts:31`) reparte por **etapa**, y
`pushNotifs(seeds)` (`data-provider.tsx:833`) inserta las semillas que le den. La campana las recibe
por realtime.

**Lo mínimo, y nada más:** cuando la orden está en `fulfilling` —almacén ya la agarró—, una semilla
por cada usuario de rol `warehouse`, `kind: "material_added"`, con el texto de la nota del evento. En
`pending` y `approved` no hace falta: la orden todavía no es de nadie y el evento se ve al abrirla.
**Sin SMS ni correo**, como pediste.

**Una advertencia que viene de D-308:** `pushNotifs` manda el error a `console.error` y devuelve
`void`. Ahí es donde se perdieron las notificaciones de «orden asignada» durante meses. Si esta
notificación importa, **se mide después de aplicarla** —contando filas en `notifications`— en vez de
darla por buena.

---

## 5. La interfaz

Botón **«➕ Agregar material / Add material»** en la ficha, visible solo para el dueño de ventas de la
orden (`orderOwner(d) === me.id`, el mismo criterio de la 125) y solo en las tres etapas de §3.

Un diálogo, dos campos, una sola escritura:

- **Factura adicional**: se teclea y se valida contra duplicados con `facturaComparable`, mirando
  `facturasDeLaOrden` de todas las órdenes no anuladas — incluida esta, para no repetir una que ya
  está.
- **Pallets nuevos**: tiene que ser **mayor** que el actual. El diálogo enseña el actual al lado.
- Se puede hacer solo una de las dos cosas; las dos vacías no guardan nada.

Fuera del diálogo no se abre nada más: **no** es «editar la orden».

---

## 6. Lo que NO debe romperse

1. **`invoice_num` sigue significando lo mismo** para las trece lecturas del §1, incluida la pestaña
   «Factura pendiente» de D-338 y el control de duplicados.
2. **Ventas no gana ninguna otra escritura.** El `probe` del guard es la prueba; la matriz lo ensaya.
3. **Los pallets solo suben**, y solo `est_pallets`. `actual_pallets` sigue siendo de almacén.
4. **Una orden de otro no se toca**, ni una anulada, ni un borrador, ni una `ready` en adelante.
5. **La etapa no cambia** y la aprobación no se pierde.
6. **Las duraciones quedan al día** con los pallets nuevos.
7. **La 125 sigue funcionando**: quien no tenía factura la sigue poniendo desde la fila.
8. **La 127 no pierde nada**: la 138 parte de su cuerpo entero, y se comprueba con un `do $chk$` como
   el de la 127 (que la 125, la 123 y la 122 siguen dentro).

---

## 7. Matriz de pruebas — se corre ANTES de aplicar, con `ROLLBACK`

La corre el orquestador; una rama no toca la base. Los casos van escritos al final del `.sql`.

| # | Quién | Qué se intenta | Qué se espera |
|---|---|---|---|
| 0 | vendedor | leer su orden | control: la ve (si no, todo lo demás da 0 sin medir nada) |
| 1 | vendedor | añadir una factura a SU orden `approved` | **1 fila** |
| 2 | vendedor | subir `est_pallets` de 4 a 6 en SU orden | **1 fila** |
| 3 | vendedor | las dos cosas en una escritura, con las duraciones nuevas | **1 fila** |
| 4 | vendedor | **bajar** `est_pallets` de 6 a 4 | **ERROR del guard** |
| 5 | vendedor | **quitar** una factura de `invoices_extra` | **ERROR del guard** |
| 6 | vendedor | **cambiar** una factura ya puesta (misma longitud) | **ERROR del guard** |
| 7 | vendedor | cambiar `delivery_address` en la misma escritura | **ERROR del guard** |
| 8 | vendedor | tocar `invoice_num` (que ya tenía valor) | **ERROR del guard** |
| 9 | vendedor | hacerlo en una orden de OTRO vendedor | **0 filas** (RLS) o error |
| 10 | vendedor | hacerlo en una orden `ready` | **ERROR del guard** |
| 11 | vendedor | hacerlo en una `canceled` | **ERROR del guard** |
| 12 | vendedor | escribir `actual_pallets` | **ERROR del guard** |
| 13 | almacén | seguir escribiendo `actual_pallets` en su etapa | **1 fila** (no se rompió lo suyo) |
| 14 | ventas | el camino de la 125: rellenar una factura VACÍA | **1 fila** (sigue vivo) |

El vendedor del ensayo tiene que tener `deliveries` en `module_access`, o `has_deliveries_access()`
devuelve false y **todos** los casos dan 0: el ensayo saldría «bien» sin haber medido nada. Es la
lección de la 131.

---

## 8. Reversión

```sql
-- 1. El guard, con el cuerpo de la 127 tal cual (sin el bloque de 138).
-- 2. alter table public.deliveries drop column if exists invoices_extra;
--    (borra el dato: si solo se quiere apagar la funcion, basta con 1.)
-- 3. delete from public.schema_migrations where name = '138_agregar_material.sql';
```

Revertir **solo el paso 1** ya cierra la escritura nueva aunque la columna siga: es la marcha atrás
rápida.

La migración irá **sin `begin`/`commit`** —la atomicidad la pone quien aplica— y con su bloque
`-- @ledger-below`, con el checksum de `node scripts/db/migrate-status.mjs --sum`.

---

## 9. Lo que NO está medido, y hay que medirlo antes de construir

- **La caducidad del plan publicado** (§3.2): no he leído esa parte de `publicar.ts`. Si subir
  pallets debe invalidar un plan, el alcance crece.
- **Cuántas órdenes tienen hoy más de una factura de hecho** —por ejemplo con una coma o una barra
  metida a mano en `invoice_num`—. Si las hay, hay que decidir si se migran a la columna nueva o se
  dejan. Es una consulta de solo lectura y la puedo escribir.
- **Nada de esto se ha ejecutado contra Postgres.** El bloque del guard de §2.1 está escrito leyendo
  la 127, no probado: `array_length` sobre un array vacío devuelve `null` y por eso va con
  `coalesce`, pero el corte `[1:0]` de un `text[]` y la comparación `is not distinct from` con
  `'{}'` **son exactamente el tipo de cosa que revienta al aplicarse y no al leerse** — es lo que
  pasó con el `::text[]` de la 131. La matriz del §7 es lo que lo va a decir.
