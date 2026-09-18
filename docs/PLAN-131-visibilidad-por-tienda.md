# Plan — 131 · Qué tiendas ve cada persona

**Estado:** escrito, **sin aplicar** — y no es la frase de rutina: el 2026-09-17 se aplicó **por
accidente** durante un ensayo (§6.1) y el 2026-09-18 se revirtió por decisión del dueño. La base está
como antes de esta rama. Lo aplica el orquestador después de fusionar, con `migrate-status` antes y
después y con respaldo activo.
**Fichero:** `supabase/migrations/131_visibilidad_por_tienda.sql` — se escribió como la **124** y se
renumeró al descongelarla (main se llevó la 125, la 126 y la 127, y 128-130 están reservadas para el
motor de rutas). Donde abajo se cuenta lo que pasó, se la sigue llamando 124, porque así se llamaba.
**Fecha:** 2026-09-17, revisado y descongelado el 2026-09-18 · **Rama:** `visibilidad-por-tienda`

> **Esta versión del plan es la cuarta.** La primera solo traía el filtro por tienda. Al ensayar la
> migración contra producción se vio que **el filtro no filtraba**, y la causa no era el filtro: está
> en §0, y obliga a tocar algo que **D-100 dejó aparcado a propósito**. La tercera añadió §6.1, que es
> la regla que salió de que esta migración se aplicara sola.
>
> **La cuarta la descongela**, con cuatro cambios: la cláusula mira las **tres** columnas de tienda
> (§4.1), la matriz gana el **caso 11** (§6), `schema.sql` gana un aviso y no un arreglo (§7.1), y la
> migración pasa a ser la **131**.
>
> **El sí que faltaba está dado**, y conviene saber por quién: lo dio el **orquestador por delegación
> del dueño** (*«tú toma las decisiones y termina todo»*, 2026-09-18), no el dueño en persona. Lo que
> el bloque 1 le quita al almacén sigue siendo lo de siempre —borradores, pendientes, rechazadas y
> anuladas de su pestaña «Todas»— y ahora está acotado: en la pantalla de Órdenes ya no las veía desde
> **D-313**.

---

## El problema, en una línea

Hoy quien entra a Entregas con rol de ventas, office, gerente o logística ve **todas** las órdenes de
todas las tiendas, y el dueño quiere poder limitarlo por persona.

Cuando se le preguntó si era comodidad (menos ruido en la lista) o seguridad, contestó lo segundo:
**«que no puedan verlo»**. Eso decide dónde vive el cambio: en Postgres. Un filtro en el navegador
esconde filas que la API sigue entregando a quien sepa pedirlas.

---

## 0. Lo que hay que arreglar primero, y que no es de esta rama

**`auth write deliveries` es de tipo `ALL`, y `ALL` incluye `SELECT`.** Las políticas permisivas se
suman con `OR`, así que su `using ((select has_deliveries_access()))` deja leer **todas** las filas a
cualquiera con el módulo, y `auth read deliveries` no decide nada.

Consecuencias, que llevan ahí desde siempre:

- La rama del chofer de la 083 (*«solo las suyas»*) **está muerta**. No se nota porque la pantalla del
  chofer filtra igual en el cliente (`driver/page.tsx:47-48`).
- La del almacén (*«solo ciertas etapas»*) **también**.
- Y la cláusula de tienda de esta migración **nacería muerta**.

**No es un hallazgo nuevo: lo dejó escrito D-100**, en su sección *«Encontrado de paso, NO cambiado»*,
con números medidos entonces (*el chofer pasaba de ver 89 entregas a 30; los cuatro de almacén, de 89 a
83*) y con una razón explícita para no tocarlo: *«cambia lo que ve gente que trabaja hoy y eso no se
suelta un jueves por la tarde sin avisar»*.

**Esta rama lo desaparca, y eso necesita un sí del dueño antes de aplicarse**, no antes de escribirse.
Lo que cambia para alguien que trabaja hoy:

| Quién | Qué cambia | Medido |
|---|---|---|
| Chofer | Nada en su pantalla: ya filtraba igual en el cliente. Lo que cambia es que deja de poder pedirle a la API las de otros | `driver/page.tsx:47-48` filtra con la misma condición que la política |
| Almacén | Su pestaña **«Todas»** deja de enseñar borradores, pendientes, rechazadas y anuladas | Sus cinco pestañas por etapa (`warehouse/page.tsx:20-26`) son exactamente las cinco que la política deja pasar. Y en la pantalla de Órdenes ya no ve nada anterior a `approved`: lo corta `src/lib/ordenes-visibles.ts:56` (D-313), con esas mismas cinco etapas |
| Ventas / office / gerente / logística | Nada, salvo que se les marquen tiendas | Caen en `else true` |
| Admin | Nada | |

**Cómo se arregla:** Postgres no tiene «ALL menos SELECT», así que la de escritura se parte en tres
—`for insert`, `for update`, `for delete`— con el **mismo** `has_deliveries_access()`. Nadie gana ni
pierde capacidad de escribir; lo único que cambia es que dejan de otorgar lectura. Va en una
transacción: entre el `drop` y los `create` no puede haber un instante en el que nadie pueda escribir.

**Van en la misma migración a propósito.** Aplicar solo el filtro es aplicar una mentira: parece
seguridad y no lo es. Aplicar solo la partición es cambiar lo que ve el almacén sin motivo visible.

## 1. Qué se cierra, dicho sin adornos

- Una persona con tiendas marcadas **deja de recibir de la base** las órdenes de las demás tiendas.
  No es que no se le pinten: no llegan.
- Eso recorta a la vez **todo** lo que bebe de esa consulta: la lista de Órdenes, el mapa, Cuentas,
  Resumen y el Panel. Las 14 pantallas de `src/app/(app)` leen del mismo array
  (`src/lib/data-provider.tsx`), así que **no existe** «esta pantalla completa y esta recortada» para
  la misma persona. Está preguntado y respondido: el mapa de ventas **sí** se recorta, porque un mapa
  que enseña el pin de una orden que la lista esconde no es una función, es el agujero.
- **Sus totales cambian.** Un gerente con tiendas marcadas ve el total de esas tiendas, no el de la
  empresa. Es deliberado («igual que office, se elige en el dropdown») y por eso el diálogo de usuario
  lo avisa por escrito al marcar casillas.

## 2. Inventario de LECTURAS de `public.deliveries`

| Quién | Dónde | Qué pasa con este cambio |
|---|---|---|
| El navegador de cualquiera con Entregas | `data-provider.tsx`, una consulta para las 14 pantallas | Recortada por la política: por rol (chofer/almacén, **por primera vez**) y por tienda |
| `/api/track/[id]` | seguimiento público de una orden | **No cambia**: usa su propio camino, no la sesión |
| `/api/notion-summary` | resumen a Notion | **No cambia**: va con service-role, que salta RLS |
| Realtime | recarga por tabla | Recibe lo que la política deje pasar |

## 3. Inventario de ESCRITURAS

- `public.deliveries`: las tres políticas nuevas llevan el mismo permiso que la de antes. **Nadie
  gana ni pierde nada.** Un `update` sigue funcionando sobre una fila que no se puede leer, porque
  `supabase-js` no pide `returning` salvo que se encadene `.select()`.
- `public.profiles.visible_stores`: la escribe **solo un admin**, desde el diálogo de usuario. Lo hace
  cumplir el guardia (§5), no la pantalla.

## 4. Las definiciones vigentes, literales, y el cambio

**La última migración que toca la política de lectura es la 083.** **La última que define el guardia de
`profiles` es la 104** (no la 099 ni la 101). Las dos se copian desde ahí; un `create or replace`
reemplaza entero, y partir de una versión vieja borraría en silencio lo que se añadió después.

### 4.1 `auth read deliveries` — se le añade una cláusula al final

Lo de arriba (acceso al módulo, y la rama por rol de chofer y almacén) **no se toca**. Se le suma:

```sql
    and (
      is_training
      or (select public.tiendas_visibles()) is null
      or btrim(coalesce(store, '')) = ''
      or lower(btrim(coalesce(store, '')))          = any ((select public.tiendas_visibles())::text[])
      or lower(btrim(coalesce(pickup_name, '')))    = any ((select public.tiendas_visibles())::text[])
      or lower(btrim(coalesce(delivery_name, ''))) = any ((select public.tiendas_visibles())::text[])
    )
```

**Las TRES columnas, no solo `store`.** En una Intertienda la orden le importa a las dos tiendas —el
dueño, D-309: *«in intertienda orders people from both pickup and delivery store can see the order»*—
y desde **D-312** `store` y `pickup_name` son la tienda que **manda** el material y `delivery_name` la
que lo **recibe**. Con `store` a secas, a quien se le marcara la tienda que recibe dejaría de ver justo
las Intertiendas que va a recibir: el filtro las escondería a quien más le importan, y **no fallaría
nada** — simplemente no aparecerían. Es el caso 11 de la matriz.

Tres consecuencias dichas, no descubiertas después:

1. **Es más ancho que lo que hace la app.** `tiendasDeLaOrden` (`src/lib/order-endpoints.ts:110`) solo
   mira las tres columnas en los tipos **tienda-a-tienda**; aquí se miran siempre. El tipo vive en
   `settings.order_type_rules`, un `jsonb`, y leerlo **por fila** en la tabla más leída de la app es
   exactamente lo que la **080** vino a quitar. Se acepta a propósito: esto es un **techo por persona**
   que se **suma** a los cortes por rol de la app, no los sustituye. Un techo más estrecho que la app
   esconde trabajo; uno más ancho deja que el corte de la app siga decidiendo, como hoy. El único caso
   nuevo que deja pasar es una orden de cliente cuyo `pickup_name` o `delivery_name` sea, literalmente,
   el nombre de una de **tus propias** tiendas.
2. **La escapatoria de «orden sin tienda» se deja en `store`, como estaba.** Podría haberse cambiado a
   «ninguna de las tres», pero eso *estrecharía*: una orden con `store` vacío y un `delivery_name`
   ajeno dejaría de verla quien antes sí. Se prefiere lo monótono — este cambio solo puede añadir
   visibilidad, nunca quitarla.
3. **Se repite la forma conocida en vez de usar `&&`.** Un `(select tiendas_visibles())::text[] &&
   array[…]` sería una llamada en vez de tres, pero es SQL **no medido**, y el `::text[]` de la línea
   de al lado existe justo porque una forma no medida reventó al aplicarse. Las tres `(select …)` son
   *InitPlans*: una evaluación por consulta cada una, no por fila.

**El `::text[]` no es adorno.** Sin él, Postgres parsea `x = any ((select f()))` como la forma
**subconsulta** de `ANY` —compara `x` contra cada *fila* devuelta— y la única fila es un `text[]`, así
que la migración revienta al aplicarse con `operator does not exist: text = text[]`. Los paréntesis
dobles no la vuelven expresión de array; el cast sí, y conserva el `(select …)` que hace que se evalúe
una vez por consulta. Se descubrió **ensayando la migración**, no leyéndola: ninguna prueba de texto
puede ver esto.

### 4.2 `public.tiendas_visibles()` — nueva

Devuelve `null` cuando quien pregunta lo ve todo (admin, chofer, almacén, o sin tiendas marcadas) y si
no, sus tiendas **normalizadas** (`lower(btrim(...))`), porque los nombres son texto libre y
«McAllen » y «mcallen» son la misma tienda.

**Devuelve el array en vez de contestar sí-o-no por fila a propósito.** `deliveries` es la tabla más
leída de la app y la **080** existe justo porque un helper por fila se ejecutaba una vez por fila.
Envuelta en `(select ...)`, esta se evalúa **una vez por consulta**.

### 4.3 `guard_profile_privileged_columns()` — se le añade `visible_stores`

Cuerpo de la 104 más la columna nueva. Por qué, en §5.

## 5. Lo que NO debe romperse

1. **Que la persona limitada no pueda quitarse el límite.** `profiles update self or admin` (099) deja
   que cualquiera actualice **su propia fila**; lo único que limita las columnas es el disparador
   `profiles_guard_privileged`. Sin meter `visible_stores` en el guardia, quien está limitado escribe
   `visible_stores = '{}'` desde el navegador y vuelve a verlo todo. **Es el punto entero de esta
   migración.** Caso 6.
2. **Que nadie se quede a oscuras el día que se aplique.** Todas las filas quedan con `visible_stores`
   nulo = ve todas. La migración no cambia lo que ve nadie **por tienda** hasta que un admin marca
   casillas. (Por rol sí cambia, y es el §0.)
3. **El chofer sigue viendo lo suyo** aunque sea de otra tienda, y el almacén sus etapas. Su rama
   manda; la de tienda no les aplica. Casos 5, 8 y 9.
4. **El admin nunca se filtra.** Caso 4.
5. **Las órdenes sin tienda las sigue viendo todo el mundo.** Hoy no hay ninguna (153 órdenes, 0 sin
   tienda, medido en producción el 2026-09-17).
6. **El sandbox de enseñanza** (`is_training`) sigue pasando para todos.
7. **Escribir no cambia para nadie.** Caso 10.
8. **La planificación de rutas no se recorta.** `/routes` es de `logistics` y `admin`; a nadie de
   logística se le marcan tiendas salvo que se quiera justo eso, y el diálogo lo avisa.

## 6. Matriz de pruebas — se corre ANTES de aplicar, con `ROLLBACK`

Los diez casos están escritos, listos para pegar, al final del `.sql`.

| # | Quién | Qué se espera |
|---|---|---|
| 0 | vendedor, sin marcar | ve N (todas) — el punto de partida |
| 1 | vendedor, 1 tienda | solo esa (más las sin tienda); 0 de otras tiendas |
| 2 | vendedor, 2 tiendas | las dos: marcar suma, no resta |
| 3 | vendedor, `'{}'` | vuelve a N, igual que el caso 0 |
| 4 | admin, 1 tienda | todas: el admin no se filtra |
| 5 | chofer, 1 tienda | las suyas, de la tienda que sean |
| 6 | vendedor limitado | **ERROR del guardia** al intentar quitarse el límite |
| 7 | vendedor limitado | 0 filas al intentar escribírselo a otro (RLS) |
| 8 | chofer | solo lo suyo; 0 de otros — **la rama que hasta hoy estaba muerta** |
| 9 | almacén | solo sus cinco etapas; 0 fuera de ellas |
| 10 | vendedor | un `update` suyo sigue afectando 1 fila |
| 11a | vendedor con la tienda que **manda** | ve la Intertienda — control: ya pasaba con `store` a secas |
| 11b | vendedor con la tienda que **recibe** | **ve la Intertienda.** Con la cláusula vieja daba **0**, y ese 0 era el fallo |
| 11c | vendedor con una **tercera** tienda | **no** la ve: sin esto, 11a y 11b los pasaría un filtro que no filtra |

**El caso 11 necesita una Intertienda real**, y el `.sql` trae la consulta que la busca en vez de dar
por supuestos los nombres de las tiendas (son datos del dueño, no del repo). **Si no hay ninguna, el
caso no se puede medir y se dice**; no se da por bueno.

**El vendedor del ensayo tiene que tener `deliveries` en `module_access`.** Con una cuenta que no lo
tenga, `has_deliveries_access()` ya devuelve false y **todos** los casos dan 0: el ensayo saldría
«bien» sin haber medido nada. El primer `role='sales'` por nombre no sirve.

El caso 0 tampoco es de adorno: sin él, «ve solo las de su tienda» podría estar pasando porque no ve
ninguna.

## 6.1 Cómo se aplica y se ensaya — regla que salió cara

**Una migración nunca lleva `begin`/`commit` propios.** La atomicidad la pone **quien aplica**,
envolviendo el fichero entero; si el fichero los trae, un ensayo con `ROLLBACK` **deja de ser un
ensayo**.

La razón está medida: un `begin` anidado es solo un *WARNING* en Postgres, pero el `commit` de dentro
**cierra la transacción de fuera**. Esta migración llevaba un `begin`/`commit` alrededor del bloque 1
«para que no hubiera un instante sin política de escritura», y **se aplicó sola a producción durante el
ensayo del 2026-09-17**: columna, guardia, función, políticas partidas, filtro y fila del registro,
todo confirmado. Ninguna de las 123 migraciones anteriores lleva transacción propia — la convención
existía y se rompió sin comprobarla.

Ya no los lleva, y hay una prueba que recorre **todas** las migraciones del repo exigiendo que ninguna
tenga `begin`, `commit` ni `rollback` fuera de comentarios.

**Cómo acabó (2026-09-18): el dueño decidió revertir, y está revertido.** Lo hizo la sesión que aplica,
en una transacción con comprobación previa al commit y con un respaldo del estado aplicado guardado
antes. Políticas de vuelta a `ALL: auth write deliveries` + `SELECT: auth read deliveries` sin cláusula
de tienda, guardia con el cuerpo de la 104, `tiendas_visibles()` y la columna fuera, fila del registro
borrada; comprobado después en solo lectura que almacén, chofer y ventas ven otra vez 153 de 153.
**No se perdió nada porque había 0 perfiles con tiendas marcadas** — con casillas puestas, el
`drop column` se las habría llevado, y para eso estaba el respaldo.

Los dos caminos de abajo se dejan escritos por si vuelve a pasar. El que se tomó fue el primero.

**Consecuencia para el registro, y cómo quedó.** El accidente dejó en producción la fila
`('124_visibilidad_por_tienda.sql', '23ab16d2…')`. La reversión del 2026-09-18 la **borró**, así que
hoy no hay ninguna fila de esta migración en `public.schema_migrations`.

Eso es justo lo que deja limpio el renumerado: el fichero es ahora
`131_visibilidad_por_tienda.sql`, con checksum **`09ebcd5b…`**, y **no deja huérfana** ninguna fila —
`migrate-status` no conoce el nombre viejo porque ya no está registrado. Se comprueba corriendo
`node scripts/db/migrate-status.mjs` antes de aplicar: la 131 tiene que salir como **pendiente**, y no
puede aparecer ninguna *huérfana* llamada `124_…`. Si apareciera, es que la reversión no borró la fila
y hay que borrarla (`delete from public.schema_migrations where name = '124_visibilidad_por_tienda.sql';`)
antes de seguir.

## 7. Reversión

Escrita literal en la cabecera del `.sql`, en cuatro pasos y en orden: la de escritura vuelve a ser una
sola de tipo `ALL`; la de lectura vuelve a la de 083; `drop function tiendas_visibles()`; y, si se
quiere borrar el dato, `drop column visible_stores`.

**Revertir solo el paso 0 ya devuelve la lectura abierta a todo el mundo**, aunque la cláusula de tienda
siga puesta — que es exactamente el estado de hoy. Es la marcha atrás rápida si algo del almacén o del
chofer se rompe en producción.

## 7.1 `schema.sql` deshace esto entero, y se deja como está

**`supabase/schema.sql` vuelve a abrir la lectura si alguna vez se corre contra una base viva.** Su
bucle de línea base (`supabase/schema.sql`, el `do $$` de las cuatro tablas) hace, para `profiles`,
`settings`, `deliveries` y `order_events`:

```sql
    execute format('drop policy if exists "auth read %1$s" ...');
    execute format('drop policy if exists "auth write %1$s" ...');
    execute format($f$create policy "auth read %1$s" ... for select to authenticated using (true)$f$, t);
    execute format($f$create policy "auth write %1$s" ... for all to authenticated using (true) with check (true)$f$, t);
```

O sea que de un golpe deshace **todo** lo que las migraciones numeradas fueron estrechando encima: la
rama por rol de 011/015, el acceso por módulo de 083 y el filtro por tienda de esta. Y la de escritura
vuelve a nacer **`for all`**, que incluye `SELECT` — la misma forma que esta migración tiene que
partir. No falla nada; simplemente deja de filtrar.

**Propuesta: no se toca el bucle.** Dos razones medidas, no una preferencia:

1. **`083_deliveries_access.sql:69` hace `alter policy "auth write deliveries" on public.deliveries`, a
   secas.** Si la línea base dejara de crear esa política, una reconstrucción desde cero fallaría ahí
   — y una migración ya aplicada **no se edita**.
2. **Partir solo esa política arreglaría una de las dos vías y dejaría la otra.** La de **lectura**
   volvería igual a `using (true)`. Un arreglo a medias aquí es peor que ninguno: invita a creer que
   el fichero se puede volver a correr, y no se puede.

**Lo que sí se hace, y es lo que faltaba: el aviso está escrito donde se cometería el error**, encima
del bucle, con las dos razones y con la regla («si alguna vez se reconstruye el esquema, hay que
volver a aplicar las migraciones numeradas, en orden»). Y tiene prueba: si el aviso desaparece, o si
083 deja de ser un `alter policy` a secas, cae.

La protección real ya estaba y sigue: **la autocomprobación de esta migración se niega a dejar
ninguna otra política permisiva otorgando `SELECT` sobre `deliveries`**. Es lo único que cazaría una
reconstrucción *a posteriori*, porque `public.schema_migrations` no se entera de que el esquema se
volvió a correr: sus filas sobreviven y `migrate-status` seguiría diciendo que está todo aplicado.

## 8. Fuera de alcance (dicho, no olvidado)

- **La escritura no mira la tienda.** Alguien que no puede *ver* una orden de otra tienda podría, con
  su `id` en la mano, escribirla a ciegas. La UI no ofrece ningún camino para eso, pero la base no lo
  impide. Cerrarlo es añadir la misma cláusula al `using` de `deliveries update` y **otra** migración,
  con su propia matriz: ahí el riesgo de romper a office editando órdenes es real. Este plan solo
  **parte** la política de escritura; no cambia a quién deja escribir.
- **Renombrar una tienda** deja las casillas apuntando a un nombre que ya no existe. Esta rama **avisa**
  al renombrar en Datos, con cuántas personas se quedarían sin ver esas órdenes; no las reescribe sola.
- **`profiles.store`** («Tienda asignada») no se toca: sigue siendo *su* tienda, la que usa el almacén y
  el ancla del chofer. Son dos cosas distintas y a propósito.
