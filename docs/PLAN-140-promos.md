# Plan — 140 · RTG PROMOS, fase 1: la base y el lector del Excel

**Estado:** PLAN EN PAPEL. **Nada aplicado.** Ensayado entero contra producción con `ROLLBACK`:
**38 de 38** (§10), y la base quedó limpia. **Espera aprobación del dueño — sin su sí no se aplica.**
**Fecha:** 2026-09-23 · **Rama:** `rtg-promos` desde `e025f6c` (D-363).
**Molde:** `docs/PLAN-A-2a-profiles-rls.md` (inventario → políticas literales → lo que no debe
romperse → matriz por rol con `ROLLBACK` → reversión).
**Prerrequisito de aplicación:** un respaldo (CLAUDE.md, «antes de tocar RLS…»). **Este plan decía
`pg_dump` y no fue eso lo que se hizo** — ver la nota de §11, que dice qué se guardó de verdad y por
qué.

**Alcance de esta fase:** la base (migración 140) y el **lector del Excel como función pura**.
**No hay pantalla**, no se registra el módulo en `MODULES`/`MODULE_ACCESS` de `constants.ts`, no se
toca `APP_VERSIONS` ni `package.json`.

> **Segunda versión de este documento.** La primera se ensayó con `ROLLBACK` y **no llegó a
> ejecutarse**; y después el dueño contestó las preguntas que quedaban abiertas, y sus respuestas
> cambian quién ve qué. Las dos cosas se cuentan aquí donde tocan, sin reescribir lo que decía
> antes — **el inventario del cambio está en §13**. Esta segunda versión sí se ensayó entera: §10.

---

## 0. Lo que medí del Excel

Leído con `exceljs` sobre `9.25.26 Promo (1).xlsx` (43.629 bytes). Confirmo lo ya sabido
—encabezados en la **fila 2**, rótulo `QOH` suelto en la fila 1, `MO` son meses de stock y no una
tienda, cinco hojas por tienda, `Sheet6` con las reglas del dueño— y añado **siete hechos**, todos
trampas para un lector ingenuo:

| # | Hecho medido | Por qué importa |
|---|---|---|
| 1 | **`other` no tiene 9 filas: tiene 15.** Nueve productos (3-11), tres vacías (12-14) y **tres con descripción pero SIN código** (15-17): `ROCA`, `VINYL`, `TAPETES` | son epígrafes escritos a mano. Quien solo salte las vacías se inventa tres productos sin código |
| 2 | **`COST` llega como la cadena vacía `""`**, no como `null`, en cinco de los nueve de `other` | `Number("")` es **0**. Un `Number(cost)` registra costo cero y la pantalla enseñaría margen completo sobre un costo inventado |
| 3 | **`PRICE` es `null` en ocho de los nueve de `other`** | un producto de `other` no puede enseñar descuento. Hay que poder guardarlo sin precio |
| 4 | **`DIFF` viene en TRES formas dentro de `ALL`**: `{formula,result}`, `{formula,result,ref,shareType}` (maestra de fórmula compartida) y `{result,sharedFormula}` (seguidoras). En `other` es `null` | leer `.formula` devuelve `undefined` en la mayoría de las filas. **Se lee `.result`** |
| 5 | **`FMPGC` y `FMPGC 3.5GAL` son DOS productos**, y el segundo lleva un espacio interno | normalizar espacios los funde. Se recorta a los lados y **no** se toca el interior |
| 6 | **Las cinco hojas por tienda son subconjuntos estrictos de `ALL`** (cero códigos fuera) y **`other` no comparte ni un código con `ALL`** | el universo es la unión limpia: 51 + 9 = **60 productos**, sin duplicados |
| 7 | **`Sheet6` se distingue sola**: su fila 2 no son los encabezados | una hoja de productos se reconoce **por su fila 2**, no por su nombre. Así el lector no lleva ningún nombre de hoja dentro |

Y `Sheet6` entera, que es la fuente de la regla de columnas:

```
MANAGERS CAN / APPROVE / REJECT / WRITE DOWN NOTES (EX. DISCONTINUED ITEM)
REPS / FILTER BY STORE / CANNOT SEE COLUMNS  E,G,H,O,Q
```

`E,G,H,O,Q` con A=1 son **NOTES(5), DEMAND(7), MO(8), COST(15), DIFF(17)**. Contado columna por
columna: **`PRICE` (P, 16) NO está en la lista — un vendedor SÍ ve el precio.** Lo digo porque es
fácil leer «no ven costo ni precio» y cerrar una columna de más.

---

## 1. Las respuestas del dueño, y qué mandan

La primera versión de este plan dejó tres preguntas abiertas. **Están contestadas**, y las tres
tiran en la misma dirección: la pantalla es de consulta para todo el mundo, y lo que se acota es
**escribir**, no **ver**.

| | Pregunta | Respuesta | Qué cambia |
|---|---|---|---|
| 1 | ¿un vendedor ve solo su tienda, o todas y filtra? | **todas, y filtra** | desaparece el filtro de grupo en la **lectura** |
| 2 | ¿ve solo lo aprobado, o todo? | **todo, con su estado**: aprobado, rechazado y pendiente | desaparece el filtro por decisión en la **lectura** |
| 3 | ¿una ronda se cierra? | **sí**; el admin la cierra y sus decisiones quedan congeladas | `closed_at` deja de ser decorativo |

**La consecuencia que hay que mirar de frente.** Antes, un vendedor no veía siquiera la **fila** de
un producto no aprobado para su tienda, así que el costo estaba tapado dos veces: por la fila y por
la columna. Ahora ve **todas** las filas, y **lo único que le separa del costo es el privilegio de
columna** de §5. Ya no es una segunda línea de defensa: **es la única.** Está dicho así, en
mayúsculas, dentro de la propia migración y encima de esa política, y la autocomprobación del final
lo vigila.

Y la otra consecuencia, que es de reparto y no de código: como la puerta de lectura pasa a ser
**solo** `has_promos_access()`, **cualquiera a quien se le conceda el módulo ve el catálogo
entero** (sin las cinco columnas). Un chofer con el módulo marcado por error vería los 60 productos
y los precios. No es un fallo de este diseño —es lo que significa «todos ven todo»— pero conviene
que el dueño lo sepa al repartir el módulo.

---

## 2. Las cinco tiendas, los seis códigos, y dónde vive el cruce

El Excel trae **seis** columnas de existencias (`BRO WES PHR MCA MIS EDG`) pero **cinco** hojas de
sugerencias: McAllen y Mission comparten hoja y **deciden juntas**. La unidad de decisión es el
**grupo**, no la tienda: cinco grupos.

**Las tiendas de Ajustes no llevan ese código.** El cruce lo pone el admin, como dato:

```
settings.stores[] (jsonb, ya existente) gana un campo opcional:
  promo_group?: string | null
```

Dos o más tiendas con el mismo valor deciden juntas. **Ni un nombre de tienda aparece en el código
ni en las pruebas**, y la migración **no cambia el esquema de `settings`**: `stores` ya es `jsonb`
(003), así que un campo dentro de cada objeto no necesita DDL.

**Con las respuestas del dueño, el grupo ya solo decide DÓNDE SE ESCRIBE**, no qué se lee.

### Por qué un campo nuevo y no `directory_code`

`NamedLocation` **ya tiene** `directory_code` (D-261) y ya agrupa varias tiendas en una
(`almacen-de-tienda.ts:44`). La forma encaja exactamente. **Aun así no se reusa:** si el directorio
de la empresa se reagrupa, las decisiones de promociones se reagruparían con él, en silencio y sin
que nadie relacione las dos cosas. Un campo propio cuesta una línea en un tipo y desacopla dos
calendarios que no tienen por qué coincidir.

---

## 3. Lo que la 140 toca de lo que ya había — y es UNA sola cosa

> La primera versión decía **«la 140 solo CREA»**. **Era falso**, y no por poco: sin este bloque el
> módulo es imposible de conceder y todo lo demás es decorado.

`public.profiles` tiene esta restricción, cuya **última** definición es la **095**:52-57 (no la 088,
que todavía llevaba `'clockin'`):

```sql
check (module_access is null or module_access <@ array['deliveries','recruiting','timetracker','erp'])
not valid
```

Con eso, **dar `'promos'` a un perfil revienta**. `has_promos_access()` solo sería cierta por la
rama del rol, o sea **solo para un admin**: ni un gerente de oficina, ni oficina, ni un vendedor
podrían entrar nunca. La 140 la redefine añadiendo `'promos'`, conservando las otras cuatro y
**sin** devolver `'clockin'`.

- **`not valid` se conserva**, por la razón que da la propia 095: validarla obligaría a arreglar
  antes cualquier fila con una palabra vieja, o sea a tomar por esa persona una decisión que la 095
  dejó a una persona. `not valid` **no afloja nada de aquí en adelante**: altas y cambios sí se
  comprueban; lo único que no se re-examina son las filas que ya estaban.
- **La autocomprobación lo vigila de tres maneras**: que acepte `promos`, que **no haya perdido**
  ninguna de las otras cuatro, y que **no** haya vuelto a aceptar `clockin` — que es exactamente lo
  que pasaría copiando el cuerpo de la 088.

Todo lo demás de la 140 se crea de cero.

---

## 4. Las cuatro tablas

| Tabla | Qué guarda | Quién escribe |
|---|---|---|
| `public.promo_rounds` | una **ronda** = un Excel subido. Las viejas no se pisan | **service-role** (la subida) · y `promo_set_round_closed()` para cerrar/reabrir |
| `public.promo_products` | los 60 productos, con costo. **La tabla delicada** | solo service-role |
| `public.promo_suggestions` | qué sugería la hoja de cada grupo — información del Excel que si no se pierde | solo service-role |
| `public.promo_decisions` | una decisión por **(ronda, producto, grupo)**: `pending`/`approved`/`rejected` + nota | **el cliente**, con RLS |

Claves: `promo_products` pk `(round_id, code)`; `promo_suggestions` pk `(round_id, code,
group_code)`; `promo_decisions` pk `(round_id, code, group_code)`. El código se guarda **tal cual**
(con su espacio interno si lo trae, hecho 5 de §0).

Las seis existencias por tienda van en **un `jsonb`** (`qoh_by_store`), no en seis columnas: los
códigos de columna son del libro, no del esquema; una columna por tienda obligaría a una migración
cada vez que abra o cierre una tienda.

`promo_rounds` lleva además `closed_at`, `closed_by` y `reopened_at`. **`reopened_at` guarda solo
la última reapertura**: en fase 1 no hay bitácora, y si el dueño la quiere es una tabla aparte.
Queda dicho para que nadie lea «queda rastro» y entienda más de lo que hay.

---

## 5. Inventario de lecturas y escrituras — por rol

| Quién | `promo_rounds` | `promo_products` | `promo_suggestions` | `promo_decisions` |
|---|---|---|---|---|
| **admin** | lee · **cierra y reabre** por la función | lee **todo**, con las 5 privadas | lee todo | lee todo · escribe en **cualquier** grupo, si la ronda está abierta |
| **manager / accounting con grupo** | lee | lee **todo**, con las 5 privadas | lee | lee todo · escribe **solo su grupo**, si la ronda está abierta |
| **sales (vendedor)** | lee | lee **todo**, **sin** las 5 privadas | lee | **lee todo**, no escribe nada |
| **cualquiera con el módulo** | lee | lee todo, sin las 5 privadas | lee | lee todo |
| **sin el módulo** | nada | nada | nada | nada |
| **service-role** (la subida) | escribe | escribe | escribe | — |

Las **cinco privadas** son las de `Sheet6`: `notes`, `demand`, `months_of_stock`, `cost`, `diff`.

---

## 6. Los helpers

Mismo idioma que `has_deliveries_access()` (083) e `is_admin()` (099): `security definer`,
`set search_path = public`, `revoke … from public, anon` **y `grant … to authenticated`** explícito
—en vez de confiar en que el `ALTER DEFAULT PRIVILEGES` del proyecto sea el que se supone, que desde
una rama no se puede comprobar.

| Función | Qué decide |
|---|---|
| `has_promos_access()` | la puerta del módulo. Calcada de `has_deliveries_access()` |
| `promo_group_of_user()` | el grupo de quien pregunta: `profiles.store` → `settings.stores[].promo_group`. **Null es el valor seguro** |
| `promo_is_decider()` | admin en cualquier grupo; `manager` y `accounting` en el suyo. `sales` no está |
| `promo_can_see_private()` | quién ve las cinco. Hoy el mismo conjunto que decide, **escrito aparte a propósito**: «puede aprobar» y «puede ver el costo» son dos hechos, y es la lección de A-2d, donde «ve costo» viajaba pegado a «es gerente de Entregas» solo porque nadie los separó |
| `promo_private(round, code)` | las cinco juntas, enmascaradas — §7 |
| `promo_set_round_closed(round, cerrar)` | cerrar y reabrir. `is_admin()` dentro |

**No hay `promo_visible_groups()`.** La hubo mientras se creyó que un vendedor veía solo su tienda.
Con las respuestas del dueño devolvía «todos los grupos» para quien tuviera acceso y «ninguno» para
quien no: o sea `has_promos_access()` con tres líneas de más. **Se quita en vez de dejarla**, porque
una función llamada «los grupos que ves» que nunca filtra nada invita al siguiente a creer que
filtra.

### Cerrar una ronda: por qué una función y no una ruta de servicio

`authenticated` no tiene `UPDATE` sobre `promo_rounds` ni lo va a tener. Cerrar podía ir por una
ruta de API con la llave de servicio o por una función `security definer`. **Se elige la función**:
cerrar es un booleano, y montar una ruta de servicio para un booleano abre otro camino que se salta
**todo** en el resto de la tabla. Con la función, la comprobación vive en la base y vale para
cualquier llamante.

---

## 7. Cómo se cierran las cinco columnas — y por qué NO con una vista

**El hueco:** un vendedor con el módulo puede pedirle a PostgREST `promo_products?select=*`. Si el
costo está en esa tabla y él puede leerla, lo recibe, pinte la pantalla lo que pinte. Es literalmente
el hallazgo **A-2d** del ERP (`docs/PLAN-A-2d-erp-role-cost.md` §3).

Ese documento evaluó las dos salidas y **recomendó la (B)**; aquí se aplica tal cual:

- **(A) vista `security_definer` + revocar la base entera.** Descartada: una vista definer **se
  salta la RLS de fila**, así que el filtro habría que **duplicarlo** dentro de la vista y mantener
  dos copias. Y va contra la **068**, que existe porque las vistas del ERP nacieron sin
  `security_invoker`.
- **(B) — la que se usa — privilegio de COLUMNA + una función definer.**

```sql
revoke all on public.promo_products from anon, authenticated;
grant select (round_id, code, supplier, size, description, qoh, qoh_by_store, price,
              source_sheet, row_no)
  on public.promo_products to authenticated;
-- notes, demand, months_of_stock, cost, diff: a nadie. Tampoco al admin, que tambien las lee por
-- la funcion, para que haya UN solo camino y no dos que puedan divergir.
```

Las cinco salen por `promo_private(round, code)` (`security definer`, **una llamada por fila y no
cinco**), y la pantalla lee la vista:

```sql
create or replace view public.promo_catalog
with (security_invoker = on) as
  select p.round_id, p.code, p.supplier, p.size, p.description,
         p.qoh, p.qoh_by_store, p.price, p.source_sheet, p.row_no,
         public.promo_private(p.round_id, p.code) as private
    from public.promo_products p;
```

`security_invoker = on`, como manda la 068: la RLS de fila se aplica igual a través de ella. Y la
vista **no nombra** ninguna columna revocada, que es lo que permite a un vendedor leerla.

### El mensaje de error, corregido

La primera versión de este plan decía que un vendedor recibiría **`permission denied for column
cost`**. **No es ese.** Medido al ensayar: es **`permission denied for table promo_products`**.
Postgres comprueba primero el privilegio de tabla; al no haberlo, cae a la comprobación por columna
y el error que levanta nombra la **tabla**. El efecto es el mismo —el costo no sale— pero quien lea
esto buscará el literal, así que va corregido y no reescrito.

**Y de ahí sale una regla para la fase 2:** con `grant` por columna, **ni siquiera un manager puede
hacer `select=*`** sobre `promo_products`. La pantalla **lee `promo_catalog`**, o pide las columnas
por su nombre. Un `select("*")` falla para todo el mundo, no solo para el vendedor.

**El coste de (B), dicho:** una llamada a función por fila. Con 60 productos por ronda es
irrelevante; si una ronda llegara a miles habría que revisarlo, y queda anotado para que nadie crea
que se midió a esa escala.

---

## 8. Las políticas (literales)

Una por comando; **ninguna `ALL`** — una `FOR ALL` también concede SELECT, y entonces la política de
lectura deja de ser la que manda (la lección de la 136).

```sql
revoke all on public.promo_rounds, public.promo_suggestions, public.promo_decisions
  from anon, authenticated;
grant select on public.promo_rounds, public.promo_suggestions to authenticated;
grant select, insert, update on public.promo_decisions to authenticated;
-- sin delete en ningun sitio: una decision se cambia, no se borra. Es historial.

create policy "promo_rounds select" on public.promo_rounds for select to authenticated
  using ((select public.has_promos_access()));

-- TODAS las filas para todo el que tenga el modulo. Lo unico que separa a un vendedor del costo
-- es el privilegio de columna de §7.
create policy "promo_products select" on public.promo_products for select to authenticated
  using ((select public.has_promos_access()));

create policy "promo_suggestions select" on public.promo_suggestions for select to authenticated
  using ((select public.has_promos_access()));

-- Las decisiones las LEE todo el que tiene el modulo (el vendedor necesita el estado por tienda
-- para filtrar) y las ESCRIBE solo quien decide, en su grupo.
create policy "promo_decisions select" on public.promo_decisions for select to authenticated
  using ((select public.has_promos_access()));

create policy "promo_decisions insert" on public.promo_decisions for insert to authenticated
  with check (
    (select public.promo_is_decider())
    and ((select public.is_admin()) or group_code = (select public.promo_group_of_user()))
  );

create policy "promo_decisions update" on public.promo_decisions for update to authenticated
  using      (... lo mismo ...)
  with check (... lo mismo ...);
```

### El `::text[]` que faltaba, y que hizo que la 140 no llegara a ejecutarse

La primera versión escribía `group_code = any ((select public.promo_visible_groups()))`. **Los
paréntesis dobles no la vuelven una expresión de array**: Postgres la lee como la forma
**subconsulta** de `ANY` y compara `text` contra la única **fila**, que es un `text[]` →
`operator does not exist: text = text[]`, y la migración **cae en la primera pasada**, sin ejecutar
nada — ni las autocomprobaciones del final.

Es **el mismo fallo de la 124**, y está escrito con todas las letras en **`131:223-228`** — un
fichero que leí en esta misma sesión, por sus primeras setenta líneas. El arreglo es
`= any ((select f())::text[])`, que conserva el `(select …)` para que se evalúe una vez por consulta
y no una por fila. Con las respuestas del dueño esas dos comparaciones han desaparecido del todo,
pero **el arreglo se deja escrito aquí y en el `.sql`**, porque la próxima función que devuelva
`text[]` volverá a caer en lo mismo.

### La ronda cerrada NO se comprueba en la política — va en el disparador

```sql
if exists (select 1 from public.promo_rounds r where r.id = NEW.round_id and r.closed_at is not null) then
  raise exception 'This promo round is closed; reopen it before changing decisions';
end if;
```

Dos razones, las dos medibles:

1. **Una política de `UPDATE` que no deja pasar la fila no da error**: afecta a **cero** filas y
   PostgREST responde limpio. El cliente creería que guardó. Una excepción del disparador **sí**
   llega a la persona, y dice por qué.
2. **El disparador vale también para la llave de servicio**, que se salta RLS. «Congelada» tiene que
   querer decir congelada por todos los caminos, no solo por el del navegador.

Y vale **también para el admin**: si necesita corregir algo de una ronda cerrada, la reabre. Un acto
explícito, con su marca, en vez de un cambio que nadie sabría que ocurrió.

El resto del guardia es el patrón de `user_prefs_guard` (136): la fila conserva su ronda, su
producto y su grupo, y `decided_by`/`decided_at` los sella la base aunque el cliente mande otra cosa.

---

## 9. Lo que NO debe romperse

| Cosa | Por qué no la rompe |
|---|---|
| `public.profiles` y sus guards | no se añade columna. `promo_group_of_user()` **lee** `profiles.store`, no la escribe |
| `profiles.store` como llave del cruce | ya está guardada: solo un admin la cambia (`guard_profile_privileged_columns`, 099/104/131). **De eso depende que escribir decisiones sea seguro**: sin ese guard, un gerente se pondría otra tienda y decidiría por otro grupo. Mismo argumento que la 131 |
| **`profiles_module_access_known`** | **sí se toca** (§3). Se redefine partiendo de la **095**, conservando las otras cuatro palabras, sin devolver `clockin`, y con tres comprobaciones que lo verifican |
| `public.settings` | **cero DDL**. `stores` ya es `jsonb` (003) |
| `directory_code` / el directorio (D-261) | no se lee ni se escribe. Campo aparte a propósito (§2) |
| Las vistas del ERP y la 068 | `promo_catalog` nace `security_invoker = on` |
| Las políticas de Entregas | `has_promos_access()` es **nueva**; ninguna función existente se redefine |

**Lo que hay que comprobar a mano antes de aplicar** (no se puede medir desde una rama):

1. ~~que **no exista ya** ninguna de las cuatro tablas ni ninguno de los seis nombres de función~~
   — **resuelto por el ensayo del 2026-09-23**: la migración corrió entera contra producción, así
   que ningún nombre chocaba, y el `ROLLBACK` dejó la base sin ellas;
2. ~~que `public.settings` tenga la fila `id = 1`~~ — **resuelto**: el ensayo sembró y comprobó
   `stores` en esa fila, y la dejó intacta;
3. ~~**el estado real de `profiles_module_access_known`**~~ — **resuelto**: la redefinición corrió y
   las tres comprobaciones de §3 pasaron, o sea que lo que había en la base era lo que dice el repo.

**Lo que sigue pendiente y no lo resuelve ningún ensayo:** el respaldo guardado justo antes de
aplicar (y releído antes de revertir, §11 — **qué se guardó de verdad está en la nota de esa
sección**), y **el sí del dueño**.

### Dos cosas que la fase 2 se va a encontrar, medidas ya

- **`constants.ts` tiene su propia lista de módulos conocidos, y filtra al ESCRIBIR.**
  `knownModules()` (`constants.ts:463-465`) deja pasar solo las claves presentes en
  `MODULE_ACCESS`, y `ModuleAccessKey` es una unión cerrada. O sea que **aunque la base ya acepte
  `'promos'`, el diálogo de permisos lo tiraría en silencio** hasta que `promos` entre en
  `MODULE_ACCESS`. No es un descuido: el comentario de `:446-462` explica por qué filtrar y no
  traducir (D-217). Fase 2 tiene que añadirlo ahí **y** en `MODULES` para la tarjeta.
- **`select("*")` sobre `promo_products` falla para todo el mundo**, manager incluido (§7). La
  pantalla lee `promo_catalog` o nombra columnas.

---

## 10. Matriz de pruebas

Contra producción, dentro de `begin … rollback`, haciéndose pasar por cada rol
(`set local role authenticated` + `set local request.jwt.claims to '{"sub":"<uuid>"}'`), como D-053 /
D-057 / D-179. **Ninguna prueba dispara efectos de terceros**: es SQL local. La corre el
**orquestador** — una rama no toca producción, ni para leer.

Hace falta sembrar dentro de la transacción: una ronda, tres productos, cuatro decisiones, y
`promo_group` en tres tiendas de `settings.stores` (dos de ellas compartiendo grupo, para el caso
McAllen+Mission). Todo se deshace con el `ROLLBACK`.

### 10a · El resultado: MEDIDO, 38 de 38

**Corrido por el orquestador contra producción el 2026-09-23, sobre `e90b02c7`, entero y con
`ROLLBACK`.** La base quedó limpia después: sin tablas, `schema_migrations` sin la fila, y `stores`
y los perfiles intactos. Comprobó además que el checksum `129e57e4` coincide con el estampado, y que
el `.sql` no lleva control de transacción ni `D-NEXT`.

**Yo no lo corrí**: una rama no toca producción, ni para leer. Esto es una medición de otra sesión, y
se apunta como tal — no como una comprobación mía.

**Lo que protege el costo:**

| Caso | Resultado |
|---|---|
| **vendedor: ve los 3 productos Y `private` es `null` en los 3** | ✅ / `null` ×3 — **el caso clave**: antes se cumplía por la fila, ahora **solo** por la columna |
| `select *`, `select cost`, `select notes, demand, diff` — vendedor | **los tres denegados** |
| los mismos tres — **manager** | **también denegados**: por eso la pantalla lee `promo_catalog` |
| `promo_catalog.private` — manager | el objeto, con el costo |
| **chofer con el módulo** | ve los 3 y **tampoco le llega el costo** |

**Quién decide, y dónde:**

| Caso | Resultado |
|---|---|
| vendedor decide | ⛔, en ningún grupo. Ve las **4** decisiones |
| manager en su grupo / en otro | ✅ / ⛔ (RLS); el `update` de otro grupo afecta a **cero filas** |
| cambiar el `group_code` de una decisión | ⛔ el guardia |
| `decided_by` con otro uuid desde el cliente | lo **sella la base** |
| **manager sin tienda** | ve los 3 y **no decide** |
| Office de Edinburg | decide en su grupo — la tienda sin gerente queda cubierta |
| McAllen y Mission | **comparten decisión** |
| admin | decide en cualquier grupo |
| insertar productos o rondas por la API normal (admin incluido) | ⛔ solo service-role |
| anónimo | ⛔ en todo |

**El cierre de ronda:**

| Caso | Resultado |
|---|---|
| manager inserta o actualiza en ronda **cerrada** | ⛔ **con excepción**, no con cero filas |
| **admin**, lo mismo | ⛔ igual |
| vendedor con la ronda cerrada | sigue viendo los 3 |
| admin reabre y el manager vuelve a decidir | ✅, y `reopened_at` queda puesto |
| `update` directo de `promo_rounds` (admin) | ⛔ sin grant |
| no-admin llamando a `promo_set_round_closed` | ⛔ `Only an admin can close or reopen a promo round` |

**La restricción:**

| Caso | Resultado |
|---|---|
| conceder `module_access = '{promos}'` a un perfil | ✅ — **antes reventaba** |
| sigue aceptando las otras cuatro, sin resucitar `clockin` | ✅ |

**Lo que esto confirma, y es la razón de dos decisiones de diseño:** el cierre sale con **excepción y
no con cero filas**, que es exactamente por lo que vive en el disparador y no en la política (§8) —
una política habría dejado al manager creyendo que guardó.

### 10b · Una medición anterior que ya no describe esta migración

Antes de las respuestas del dueño hubo otra pasada, **29 de 29**, sobre una copia del diseño viejo.
Se anota para que nadie se tropiece con ese número y crea que falta algo: **no lo contradice, mide
otra cosa.** Allí el vendedor veía **1 de 3** productos y **2 de 4** decisiones, porque entonces solo
veía lo aprobado de su grupo. Con «ven todas las tiendas y todos los productos» esas dos filas pasan
a 3 de 3 y 4 de 4, y así están medidas arriba.

---

## 11. Reversión

**Dos avisos, y el primero muerde:**

1. **Devolver la restricción vieja deja perfiles que ya no la cumplen.** Aunque el `add constraint`
   sea `not valid` y por tanto no re-examine lo existente, **la siguiente escritura de ese perfil sí
   revienta** — días después y en otra pantalla, que es peor. Por eso el paso 1 quita la palabra
   antes. Quitársela a alguien **es quitarle el acceso al módulo**: eso es lo que significa revertir
   esto.
2. **El `drop` de `promo_decisions` borra decisiones ya tomadas.** De eso protege el respaldo.
   Releerlo antes de ejecutar.

> **Nota del 2026-09-23, al aplicar: el respaldo NO fue un `pg_dump`.** Este documento lo pedía así
> en dos sitios, y **en esta máquina no hay `pg_dump` instalado** — un dato operativo que conviene
> saber antes de planear un respaldo que no se puede hacer. Lo que se guardó, en el scratchpad del
> orquestador como `respaldo_antes_de_140.json`, fue **lo único existente que la 140 toca**: la
> definición vieja de `profiles_module_access_known`, el `module_access` de los **41** perfiles, y la
> comprobación de que ningún objeto `promo_*` existía antes.
>
> **Para lo que la 140 hizo, eso alcanza**, y se puede razonar: la migración solo crea, salvo esa
> restricción, y con esos dos datos se reconstruye el estado anterior exacto. **Para el punto 2 de
> arriba NO alcanza**: el día que alguien revierta, las decisiones ya tomadas no están en ese
> `.json` y no hay de dónde sacarlas. Antes de ejecutar la reversión hay que volcar
> `promo_decisions` — con `pg_dump` desde una máquina que lo tenga, o con un `select` guardado a
> fichero. **Se corrige con esta nota y no reescribiendo el texto de arriba**, que es la regla 2 de
> la documentación del proyecto.

```sql
begin;
-- 1. Primero la palabra, o el paso 4 deja perfiles que la restriccion vieja no admite.
update public.profiles
   set module_access = array_remove(module_access, 'promos')
 where 'promos' = any (coalesce(module_access, '{}'));
-- 2. La vista y las tablas.
drop view  if exists public.promo_catalog;
drop table if exists public.promo_decisions;
drop table if exists public.promo_suggestions;
drop table if exists public.promo_products;
drop table if exists public.promo_rounds;
-- 3. Las funciones.
drop function if exists public.promo_set_round_closed(uuid, boolean);
drop function if exists public.promo_decisions_guard();
drop function if exists public.promo_private(uuid, text);
drop function if exists public.promo_can_see_private();
drop function if exists public.promo_is_decider();
drop function if exists public.promo_group_of_user();
drop function if exists public.has_promos_access();
-- 4. La restriccion, EXACTAMENTE como la dejo la 095 (no la 088: esa lleva 'clockin').
alter table public.profiles drop constraint if exists profiles_module_access_known;
alter table public.profiles add constraint profiles_module_access_known
  check (module_access is null or module_access <@ array['deliveries','recruiting','timetracker','erp'])
  not valid;
delete from public.schema_migrations where name = '140_promos.sql';
commit;
-- promo_group dentro de settings.stores puede quedarse: es un campo que nadie mas lee.
```

---

## 12. El lector del Excel — función pura, y dónde se parte

`exceljs` toca ficheros y objetos de celda; eso no se prueba sin un `.xlsx`. Se parte en dos, y la
costura es una estructura tonta:

```
leeLibro(ruta) ── exceljs ──> HojaCruda[] = { nombre, filas: Celda[][] }      (impuro, sin pruebas)
                                   |
                                   v
              leePromo(hojas) ──> { productos, sugerencias, avisos }          (PURO, con pruebas)
```

`Celda` es lo que `exceljs` deja en `cell.value`. Las pruebas construyen esas formas **a mano**
—incluidas las **tres** del hecho 4 de §0— y no necesitan ni fichero ni librería.

**Lo que `leePromo` decide, y sale directo de lo medido:**

1. una hoja es de productos **si su fila 2 son los encabezados esperados**; si no, se ignora y se
   anota. (Así la hoja de reglas se cae sola.)
2. **el lector no conoce ni un nombre de hoja.** Recibe la lista de **grupos ya cruzados en
   Ajustes**; una hoja que se llame como uno de ellos son **sugerencias de ese grupo**, y cualquier
   otra hoja de productos es **universo**. Con la lista vacía —antes de que nadie cruce nada— todo
   es universo y no hay sugerencias, que es lo honesto: sin el cruce no se sabe de quién era la
   hoja. Un grupo conocido **sin** hoja también se anota.
3. una fila sin `Unified Code` **no es un producto**, tenga descripción o no, y se anota.
4. el código se recorta **a los lados** y nada más.
5. un número se lee con una función que trata `""`, `null` y una fórmula sin calcular como
   **ausente** —nunca como cero.
6. un código sugerido que no esté en el universo se anota **y se conserva**: perderlo sería inventar
   que la hoja no lo decía.
7. un código repetido se anota y gana el primero (hoy no pasa: medido, cero duplicados).
8. `avisos` es la lista de todo lo que el lector decidió no meter; la pantalla de subida se la
   enseñará al admin antes de confirmar la ronda.

**Lo que `leePromo` NO hace:** no conoce tiendas, ni nombres de hoja, ni qué columna es de qué
tienda. **Las columnas de tienda se descubren**: las que van entre `MO` y `COST`, con el nombre que
diga el encabezado — así el libro del mes que viene puede abrir o cerrar una tienda sin tocar
código, y ni un código de tienda del dueño entra en el repositorio.

**Comprobado con mutantes** (14 cambios, 14 caen, cada uno por la prueba que lleva su nombre, y el
gemelo —`vacia()` escrita con un bucle en vez de `.every`— se queda en verde). Los tres que de
verdad importan: quitar la regla de la cadena vacía hace caer *«el costo vacío es AUSENTE, nunca
cero»*; leer `.formula` en vez de `.result` hace caer *«lee las TRES formas de celda con fórmula»*; y
quitarle al **código** —y solo al código, dejando `texto()` intacto— sus espacios de dentro hace caer
*«un código que es PREFIJO de otro… siguen siendo dos productos»*.

---

## 13. Qué cambió desde la primera versión de este plan, y por qué

Se anota en vez de reescribir, que es la regla 2 de la documentación del proyecto.

| Decía | Dice | Por qué |
|---|---|---|
| «la 140 **solo CREA**» | toca `profiles_module_access_known` (§3) | era falso: esa restricción prohíbe `'promos'` y haría el módulo imposible de conceder. Nadie la había mirado |
| «el respaldo protege del **drop**, no del alta» | sigue protegiendo sobre todo del drop, **pero ya no es verdad que no proteja de nada del alta** | la reversión de la restricción puede dejar perfiles incumpliéndola (§11) |
| `group_code = any ((select f()))` | `…::text[]`, y de hecho esas comparaciones ya no existen | sin el cast la migración **no llega a ejecutarse**. Es el fallo de la 124, documentado en `131:223-228` |
| «`permission denied for column cost`» | **`permission denied for table promo_products`** | medido al ensayar. El efecto es el mismo; el literal no |
| vendedor: solo su tienda, solo lo aprobado | **todas las tiendas, todos los productos con su estado** | lo contestó el dueño. Mi lectura de «REPS: FILTER BY STORE» era la correcta |
| `promo_visible_groups()` | **eliminada** | con esas respuestas no filtraba nada: era `has_promos_access()` con tres líneas de más |
| `closed_at` sin ninguna política que lo mire | **el guardia lo exige**, admin incluido; y `promo_set_round_closed()` para cerrar/reabrir | lo contestó el dueño |
