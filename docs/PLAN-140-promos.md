# Plan — 140 · RTG PROMOS, fase 1: la base y el lector del Excel

**Estado:** PLAN EN PAPEL. **Nada aplicado.** Espera aprobación del dueño.
**Fecha:** 2026-09-23 · **Rama:** `rtg-promos` desde `e025f6c` (D-363).
**Molde:** `docs/PLAN-A-2a-profiles-rls.md` (inventario → políticas literales → lo que no debe
romperse → matriz por rol con `ROLLBACK` → reversión).
**Prerrequisito de aplicación:** `pg_dump` reciente guardado (CLAUDE.md, «antes de tocar RLS…»).
Aquí es barato de cumplir y se explica por qué en §8.

**Alcance de esta fase:** la base (migración 140) y el **lector del Excel como función pura**.
**No hay pantalla**, no se registra el módulo en `MODULES`/`module_access`, no se toca
`APP_VERSIONS` ni `package.json` (eso es del orquestador al fusionar, y la tarjeta es fase 2).

---

## 0. Lo que medí del Excel, y en qué corrige el inventario de partida

Leído con `exceljs` sobre `9.25.26 Promo (1).xlsx` (43.629 bytes). Confirmo lo que ya estaba
medido —encabezados en la **fila 2**, rótulo `QOH` suelto en la fila 1, `MO` es meses de stock y no
una tienda, las cinco hojas por tienda, `Sheet6` con las reglas del dueño— y añado **siete hechos
nuevos**, todos los cuales son trampas para un lector ingenuo:

| # | Hecho medido | Por qué importa |
|---|---|---|
| 1 | **`other` no tiene 9 filas de producto: tiene 15.** Nueve productos (3-11), tres vacías (12-14) y **tres con descripción pero SIN código** (15-17): `ROCA`, `VINYL`, `TAPETES` | son epígrafes escritos a mano, no productos. Un lector que solo salte las filas vacías se inventa tres productos sin código |
| 2 | **`COST` llega como la cadena vacía `""`**, no como `null`, en cinco de los nueve de `other` | `Number("")` es **0**, no `NaN`. Un `Number(cost)` registra costo 0 y la pantalla enseñaría margen completo sobre un costo inventado |
| 3 | **`PRICE` es `null` en ocho de los nueve de `other`** | un producto de `other` no puede enseñar descuento. Hay que poder guardarlo sin precio |
| 4 | **`DIFF` viene en TRES formas distintas dentro de `ALL`**: `{formula,result}`, `{formula,result,ref,shareType}` (el maestro de una fórmula compartida) y `{result,sharedFormula}` (los seguidores). En `other` es `null` | leer `.formula` devuelve `undefined` en la mayoría de las filas. **Se lee `.result`** |
| 5 | **`FMPGC` y `FMPGC 3.5GAL` son DOS productos distintos**, y el segundo lleva un espacio interno | normalizar espacios los funde en uno. Se recorta a los lados y **no** se toca el interior |
| 6 | **Las cinco hojas por tienda son subconjuntos estrictos de `ALL`** (medido: cero códigos fuera) y **`other` no comparte ni un código con `ALL`** | el universo es la unión limpia: 51 + 9 = **60 productos**, sin duplicados en ninguna hoja |
| 7 | **`Sheet6` se distingue sola**: su fila 2 no son los encabezados | una hoja de productos se reconoce **por su fila 2**, no por su nombre. Así el lector no lleva `"Sheet6"` ni `"BRO"` escritos dentro, y el mes que viene el libro puede renombrar hojas sin tocar código |

Y `Sheet6` entera, que es la fuente de la regla de columnas:

```
MANAGERS CAN / APPROVE / REJECT / WRITE DOWN NOTES (EX. DISCONTINUED ITEM)
REPS / FILTER BY STORE / CANNOT SEE COLUMNS  E,G,H,O,Q
```

`E,G,H,O,Q` con A=1 son **NOTES(5), DEMAND(7), MO(8), COST(15), DIFF(17)**. Contado columna por
columna: **`PRICE` (P, 16) NO está en la lista — un vendedor SÍ ve el precio.** Lo digo porque es
fácil leer «no ven costo ni precio» y cerrar una columna de más.

### La pregunta que este plan NO decide sola

El dueño escribió **«REPS: FILTER BY STORE»**, que se lee como *ven varias tiendas y filtran*. La
decisión que traigo es **«los vendedores ven solo lo aprobado de SU tienda»**. Son cosas distintas y
la diferencia es de seguridad, no de comodidad. **No la resuelvo por mi cuenta**: el diseño la deja
en **una sola función** (`promo_visible_groups()`, §4), así que la respuesta del dueño cambia una
función de tres líneas y ni una tabla ni una política. Hay que preguntársela antes de aplicar.

---

## 1. Las cinco tiendas, los seis códigos, y dónde vive el cruce

El Excel trae **seis** columnas de existencias (`BRO WES PHR MCA MIS EDG`) pero **cinco** hojas de
sugerencias (`BRO WES PHR MCAMIS EDG`): McAllen y Mission comparten hoja. El dueño confirmó que
**deciden juntas**. O sea que la unidad de decisión es el **grupo**, no la tienda: cinco grupos.

**Las tiendas de Ajustes no llevan ese código.** El cruce lo pone el admin, como dato:

```
settings.stores[] (jsonb, ya existente) gana un campo opcional:
  promo_group?: string | null    // "el grupo de promociones al que pertenece esta tienda"
```

Dos o más tiendas con el mismo valor deciden juntas. McAllen y Mission llevan las dos el mismo
código; las otras tres, uno cada una. **Ni un nombre de tienda aparece en el código ni en las
pruebas** (regla del proyecto), y la migración **no cambia el esquema de `settings`**: `stores` ya es
`jsonb` (003), así que un campo nuevo dentro de cada objeto no necesita DDL.

### Por qué un campo nuevo y no `directory_code`

`NamedLocation` **ya tiene** `directory_code` (D-261), y ya sirve para agrupar varias tiendas en una
(`almacen-de-tienda.ts:44`). La forma encaja exactamente. **Aun así, no se reusa**, y la razón es
concreta: si el directorio de la empresa se reagrupa por cualquier motivo, las decisiones de
promociones se reagruparían con él, en silencio y sin que nadie relacione las dos cosas. Un campo
propio cuesta una línea en un tipo y desacopla dos calendarios que no tienen por qué coincidir.
Queda escrito aquí para que nadie lo «simplifique» después sin saber qué se pierde.

---

## 2. Las cuatro tablas

Todas nuevas. **La migración 140 no modifica ni una sola cosa existente** — ni una política, ni un
guard, ni una columna. Eso es lo que hace que su reversión sea un `drop` y que el riesgo de aplicarla
sea el más bajo posible para un cambio con RLS (§8).

| Tabla | Qué guarda | Quién escribe |
|---|---|---|
| `public.promo_rounds` | una **ronda** = un Excel subido («9.25.26 Promo»). Las viejas se quedan | **solo service-role** (la subida del admin, por ruta de API) |
| `public.promo_products` | los 60 productos de esa ronda, con costo. **La tabla delicada** | solo service-role |
| `public.promo_suggestions` | qué productos sugería la hoja de cada grupo. Información del Excel que si no se pierde | solo service-role |
| `public.promo_decisions` | una decisión por **(ronda, producto, grupo)**: `pending`/`approved`/`rejected` + nota | **el cliente**, con RLS (es lo único que el navegador escribe) |

Claves: `promo_products` pk `(round_id, code)`; `promo_suggestions` pk `(round_id, code, group_code)`;
`promo_decisions` pk `(round_id, code, group_code)`. El código del producto es la clave natural y
**se guarda tal cual viene** (con su espacio interno si lo trae, hecho 5 de §0).

Las seis existencias por tienda van en **un `jsonb`** (`qoh_by_store`), no en seis columnas: los
códigos de columna son del libro, no del esquema, y el mes que viene puede haber otra tienda. Una
columna por tienda obligaría a una migración por tienda nueva.

---

## 3. Inventario de lecturas y escrituras — por rol

Hoy no hay ninguna: las tablas no existen. Este es el inventario **de destino**, que es contra lo que
se traza la matriz de §7.

| Quién | `promo_rounds` | `promo_products` | `promo_suggestions` | `promo_decisions` |
|---|---|---|---|---|
| **admin** | lee todo · escribe por service-role | lee todo, **con las 5 columnas privadas** | lee todo | lee y escribe **de cualquier grupo** |
| **manager / accounting con grupo** (el que decide) | lee | lee todo, **con las 5 privadas** | lee | lee y escribe **solo su grupo** |
| **sales (vendedor) con grupo** | lee | **solo lo aprobado para su grupo, y SIN las 5 privadas** | lee | lee solo su grupo |
| **sales sin grupo** (o `profiles.store` vacío) | lee | **nada** | lee | nada |
| **cualquiera sin el módulo** | nada | nada | nada | nada |
| **service-role** (la subida) | escribe | escribe | escribe | — |

Las **cinco columnas privadas** son las de `Sheet6`: `notes`, `demand`, `months_of_stock`, `cost`,
`diff`.

---

## 4. Los helpers (literales)

Mismo idioma que `has_deliveries_access()` (083) e `is_admin()` (099): `sql stable security definer
set search_path = public`, y `revoke execute … from public, anon`.

```sql
-- La puerta del modulo, calcada de has_deliveries_access() (083).
create or replace function public.has_promos_access()
  returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select role = 'admin' or 'promos' = any(coalesce(module_access, '{}'))
    from public.profiles where id = auth.uid()
  ), false);
$$;

-- El grupo de quien pregunta: su tienda (profiles.store, que es el NOMBRE) buscada en
-- settings.stores. Null si no tiene tienda, si la tienda no existe, o si no tiene grupo.
-- Null es el valor SEGURO: sin grupo no se ve nada y no se decide nada.
create or replace function public.promo_group_of_user()
  returns text language sql stable security definer set search_path = public as $$
  select nullif(trim(s->>'promo_group'), '')
    from public.settings cfg
    cross join lateral jsonb_array_elements(coalesce(cfg.stores, '[]'::jsonb)) as s
   where cfg.id = 1
     and lower(trim(s->>'name')) = lower(trim((select store from public.profiles where id = auth.uid())))
   limit 1;
$$;

-- Quien DECIDE: el admin en cualquier grupo; gerente de oficina y oficina, en el suyo.
-- Los dos roles los nombro el dueno; 'sales' no esta, y por eso un vendedor no aprueba.
create or replace function public.promo_is_decider()
  returns boolean language sql stable security definer set search_path = public as $$
  select public.has_promos_access() and (
    public.is_admin()
    or (public.current_user_role() in ('manager', 'accounting')
        and public.promo_group_of_user() is not null)
  );
$$;

-- Quien ve las CINCO columnas privadas. Es el mismo conjunto que decide, pero se escribe
-- aparte a proposito: "puede aprobar" y "puede ver el costo" son dos hechos, y el dia que
-- uno cambie no debe arrastrar al otro. Es la leccion de A-2d en el ERP, donde "ve costo"
-- viajaba pegado a "es gerente de Entregas" porque nadie los separo.
create or replace function public.promo_can_see_private()
  returns boolean language sql stable security definer set search_path = public as $$
  select public.has_promos_access()
     and (public.is_admin() or public.current_user_role() in ('manager', 'accounting'));
$$;

-- LOS GRUPOS QUE UN VENDEDOR VE. Aqui, y solo aqui, vive la pregunta abierta de §0.
-- Como esta escrito ahora: el suyo y ninguno mas.
-- Si el dueno contesta "que filtren entre todas", el cuerpo pasa a
--   select array(select distinct nullif(trim(s->>'promo_group'),'') from ... )
-- y no cambia ni una tabla ni una politica.
create or replace function public.promo_visible_groups()
  returns text[] language sql stable security definer set search_path = public as $$
  select case
    when public.is_admin() then array(
      select distinct nullif(trim(s->>'promo_group'), '')
        from public.settings cfg
        cross join lateral jsonb_array_elements(coalesce(cfg.stores, '[]'::jsonb)) as s
       where cfg.id = 1 and nullif(trim(s->>'promo_group'), '') is not null)
    when public.promo_group_of_user() is null then '{}'::text[]
    else array[public.promo_group_of_user()]
  end;
$$;
```

---

## 5. Cómo se cierran las cinco columnas — y por qué NO con una vista

**El hueco que hay que cerrar:** un vendedor con el módulo puede pedirle a PostgREST
`promo_products?select=*`. Si el costo está en esa tabla y él puede leerla, lo recibe, pinte la
pantalla lo que pinte. Es literalmente el hallazgo **A-2d** del ERP
(`docs/PLAN-A-2d-erp-role-cost.md` §3): allí la vista enmascaraba el costo y la tabla base lo seguía
sirviendo crudo.

Ese mismo documento evaluó las dos salidas y **recomendó la (B)**, y aquí se aplica tal cual:

- **(A) vista `security_definer` + revocar la base entera.** Descartada. Una vista definer **se salta
  la RLS de fila** de la tabla, así que el filtro de fila habría que **duplicarlo** dentro del
  `WHERE` de la vista y mantener las dos copias sincronizadas. Y va justo contra la migración **068**,
  que existe porque las vistas del ERP nacieron sin `security_invoker` y por eso la puerta del módulo
  no se aplicaba.
- **(B) — la que se usa — privilegio de COLUMNA + una función definer.** La RLS de fila se queda en
  un solo sitio (la política de la tabla) y **solo las columnas** se mueven:

```sql
-- 1. La tabla base sirve todo MENOS las cinco privadas. Esto no lo decide una politica:
--    lo decide el privilegio de columna, y se aplica aunque la consulta venga a pelo.
revoke all on public.promo_products from anon, authenticated;
grant select (round_id, code, supplier, size, description, qoh, qoh_by_store, price,
              source_sheet, row_no)
  on public.promo_products to authenticated;
-- notes, demand, months_of_stock, cost, diff: NO se conceden a nadie. Ni a un admin:
-- tambien el admin las lee por la funcion de abajo, para que haya UN solo camino.

-- 2. Las cinco, juntas y en UNA llamada por fila (no cinco), enmascaradas por rol.
create or replace function public.promo_private(p_round uuid, p_code text)
  returns jsonb language sql stable security definer set search_path = public as $$
  select case when public.promo_can_see_private() then
    jsonb_build_object('notes', p.notes, 'demand', p.demand,
                       'months_of_stock', p.months_of_stock, 'cost', p.cost, 'diff', p.diff)
  else null end
  from public.promo_products p
  where p.round_id = p_round and p.code = p_code;
$$;

-- 3. La vista por la que lee la pantalla. security_invoker = ON, como manda la 068:
--    la RLS de fila de la tabla se aplica IGUAL a traves de ella. Y no nombra ni una
--    de las cinco columnas revocadas — por eso no falla al leerla un vendedor.
create or replace view public.promo_catalog
with (security_invoker = on) as
  select p.round_id, p.code, p.supplier, p.size, p.description,
         p.qoh, p.qoh_by_store, p.price, p.source_sheet, p.row_no,
         public.promo_private(p.round_id, p.code) as private
    from public.promo_products p;

grant select on public.promo_catalog to authenticated;
```

**Lo que consigue, medible con una consulta:** un vendedor que pida
`promo_products?select=cost` recibe **`permission denied for column cost`**, no un `null` amable. Y
`promo_catalog` le devuelve `private: null`. El costo no llega a su navegador por ningún camino.

**El precio de (B), dicho:** una llamada a función por fila del catálogo. Con 60 productos por ronda
es irrelevante; si una ronda creciera a miles habría que revisarlo, y queda anotado aquí para que
quien lo vea no crea que se midió a esa escala.

---

## 6. Las políticas (literales)

Una por comando; **ninguna `ALL`**, como en la 136 — y por la razón de la 136: una `FOR ALL` también
concede SELECT, y entonces la política de lectura deja de ser la que manda.

```sql
alter table public.promo_rounds      enable row level security;
alter table public.promo_products    enable row level security;
alter table public.promo_suggestions enable row level security;
alter table public.promo_decisions   enable row level security;

-- En esta base una tabla nueva nace con todo concedido a anon/authenticated
-- (medido al ensayar la 126, y por eso la 136 lo revoca explicitamente).
revoke all on public.promo_rounds, public.promo_suggestions, public.promo_decisions
  from anon, authenticated;
grant select on public.promo_rounds, public.promo_suggestions to authenticated;
grant select, insert, update on public.promo_decisions to authenticated;
-- (promo_products lleva su grant POR COLUMNA, arriba en §5.)

-- ---------- rondas: las ve quien tiene el modulo; las escribe la llave de servicio ----------
create policy "promo_rounds select" on public.promo_rounds for select to authenticated
  using ((select public.has_promos_access()));
-- sin insert/update/delete: la subida va por service-role, que se salta RLS.

-- ---------- productos: el que decide ve la ronda entera; el vendedor, lo aprobado ----------
create policy "promo_products select" on public.promo_products for select to authenticated
  using (
    (select public.has_promos_access())
    and (
      (select public.promo_is_decider())
      or exists (
        select 1 from public.promo_decisions d
         where d.round_id = promo_products.round_id
           and d.code     = promo_products.code
           and d.status   = 'approved'
           and d.group_code = any ((select public.promo_visible_groups()))
      )
    )
  );
-- sin insert/update/delete desde cliente.

-- ---------- sugerencias: informativas, las ve quien tiene el modulo ----------
create policy "promo_suggestions select" on public.promo_suggestions for select to authenticated
  using ((select public.has_promos_access()));

-- ---------- decisiones: se leen las de los grupos que te tocan; se escriben las tuyas ----------
create policy "promo_decisions select" on public.promo_decisions for select to authenticated
  using (
    (select public.has_promos_access())
    and group_code = any ((select public.promo_visible_groups()))
  );

create policy "promo_decisions insert" on public.promo_decisions for insert to authenticated
  with check (
    (select public.promo_is_decider())
    and ((select public.is_admin()) or group_code = (select public.promo_group_of_user()))
  );

create policy "promo_decisions update" on public.promo_decisions for update to authenticated
  using (
    (select public.promo_is_decider())
    and ((select public.is_admin()) or group_code = (select public.promo_group_of_user()))
  )
  with check (
    (select public.promo_is_decider())
    and ((select public.is_admin()) or group_code = (select public.promo_group_of_user()))
  );
-- sin DELETE: una decision se cambia, no se borra. Es historial.
```

**Por qué el `exists` de `promo_products` no se muerde la cola:** mira `promo_decisions`, que tiene su
propia RLS, y la política de lectura de decisiones se resuelve con funciones `security definer`
(`promo_visible_groups`), no volviendo a `promo_products`. No hay ciclo.

**Guard de `promo_decisions`** — el mismo patrón que `user_prefs_guard` (136): la fila conserva su
identidad y el sello lo pone la base, no el navegador.

```sql
create or replace function public.promo_decisions_guard()
  returns trigger language plpgsql set search_path = public as $$
begin
  if TG_OP = 'UPDATE' and (NEW.round_id is distinct from OLD.round_id
                        or NEW.code     is distinct from OLD.code
                        or NEW.group_code is distinct from OLD.group_code) then
    raise exception 'A decision keeps its round, its product and its group';
  end if;
  NEW.decided_by := auth.uid();
  NEW.decided_at := now();
  return NEW;
end $$;
```

Vale también para la llave de servicio, que se salta RLS **pero no los disparadores**.

---

## 7. Lo que NO debe romperse

La propiedad que lo hace corto: **la 140 solo CREA.** No hay una sola sentencia que altere algo que
ya existe. Aun así, lo trazo, porque «solo crea» es justo lo que uno cree antes de descubrir que no.

| Cosa | Por qué no la toca |
|---|---|
| `public.profiles` y sus guards | no se añade columna ninguna. `promo_group_of_user()` **lee** `profiles.store`, no la escribe |
| `profiles.store` como llave del cruce | ya está guardada: solo un admin la cambia (`guard_profile_privileged_columns`, 099/104/131). **De eso depende que esto sea seguridad**: sin ese guard, un vendedor se pondría otra tienda y leería las aprobaciones de otro grupo. Igual que argumenta la 131 |
| `public.settings` | **cero DDL**. `stores` ya es `jsonb` (003); `promo_group` es un campo dentro de cada objeto. Las pantallas que no lo conocen lo ignoran |
| `directory_code` / el directorio (D-261) | no se lee ni se escribe. Campo aparte, a propósito (§1) |
| `almacen-de-tienda.ts` (agrupa por `directory_code`) | no se toca; por eso mismo |
| Las vistas del ERP y la 068 | `promo_catalog` nace `security_invoker = on`, que es la regla que la 068 estableció |
| `has_deliveries_access()` y las políticas de Entregas | `has_promos_access()` es una función **nueva**; ninguna existente se redefine (nada de `create or replace` sobre algo vigente) |
| Módulo `promos` en `module_access` | la columna es `text[]` sin restricción de valores: añadir `'promos'` no necesita DDL. Registrarlo en `MODULES` es **fase 2** |
| Suplantación | la sesión ES la del suplantado, así que un admin dentro de un vendedor ve **lo del vendedor**. Es lo correcto y es el mismo comportamiento que documenta la 136 |

**Lo único que hay que comprobar a mano antes de aplicar** (no lo puedo medir desde una rama):
1. que **no exista ya** ninguna de las cuatro tablas ni ninguno de los cinco nombres de función;
2. que `public.settings` tenga la fila `id = 1` (todas las lecturas de la app la asumen, pero el
   helper devolvería `null` si no, y `null` es el valor seguro, así que esto es una comprobación, no
   un riesgo).

---

## 8. Matriz de pruebas — se corre ANTES de aplicar, en una transacción con `ROLLBACK`

Contra producción, dentro de `begin … rollback`, haciéndose pasar por cada rol
(`set local role authenticated` + `set local request.jwt.claims to '{"sub":"<uuid>"}'`), como D-053 /
D-057 / D-179. **Ninguna prueba dispara efectos de terceros**: es SQL local y nada más.

Hace falta sembrar dentro de la transacción: una ronda, dos productos (uno que se aprobará para el
grupo A y otro que no), y `promo_group` en dos tiendas de `settings.stores` (una compartida por dos
tiendas, para el caso McAllen+Mission). **Todo eso se deshace con el `ROLLBACK`.**

Leyenda: ✅ permitido esperado · ⛔ bloqueado esperado · `∅` devuelve cero filas (que no es lo mismo
que un error, y por eso se distingue).

| Acción \ Quién | admin | manager grupo A | accounting grupo A | manager grupo B | sales grupo A | sales sin grupo | con módulo pero rol `driver` | **sin el módulo** |
|---|---|---|---|---|---|---|---|---|
| `select * from promo_rounds` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | `∅` |
| `select cost from promo_products` | ⛔ *denied for column* | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ |
| `select code from promo_products` (ronda entera) | ✅ 2 filas | ✅ 2 | ✅ 2 | ✅ 2 | `∅` (nada aprobado aún) | `∅` | `∅` | `∅` |
| `select private from promo_catalog` | ✅ objeto | ✅ objeto | ✅ objeto | ✅ objeto | ✅ **`null`** | `∅` | `∅` | `∅` |
| insertar decisión en **grupo A** | ✅ | ✅ | ✅ | ⛔ RLS | ⛔ RLS | ⛔ | ⛔ | ⛔ |
| insertar decisión en **grupo B** | ✅ | ⛔ RLS | ⛔ RLS | ✅ | ⛔ | ⛔ | ⛔ | ⛔ |
| cambiar `status` de una decisión propia | ✅ | ✅ | ✅ | ✅ (la suya) | ⛔ | ⛔ | ⛔ | ⛔ |
| cambiar el `group_code` de una decisión | ⛔ guard | ⛔ guard | ⛔ guard | ⛔ guard | ⛔ | ⛔ | ⛔ | ⛔ |
| escribir `decided_by` con otro uuid | ✅ pero **se pisa** con `auth.uid()` | idem | idem | idem | ⛔ | ⛔ | ⛔ | ⛔ |
| `delete from promo_decisions` | ⛔ sin política | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ |
| `insert into promo_products` | ⛔ sin política | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ |
| **tras aprobar el producto 1 en grupo A:** `select code from promo_products` | ✅ 2 | ✅ 2 | ✅ 2 | ✅ 2 | ✅ **1** | `∅` | `∅` | `∅` |
| …y su `private` | ✅ objeto | ✅ | ✅ | ✅ | ✅ **`null`** | `∅` | `∅` | `∅` |
| **el caso McAllen+Mission:** manager de la tienda hermana ve/edita la MISMA decisión | — | ✅ | ✅ | — | — | — | — | — |

Las dos filas que de verdad prueban el plan son **`select cost` → error** (no `null`: un `null` se
puede conseguir por accidente, un *permission denied* solo se consigue si el privilegio está puesto)
y **la penúltima**, que enseña a un vendedor apareciendo una fila **solo después** de que alguien la
apruebe.

El script se guarda en el scratchpad, lo corre el **orquestador** (una rama no toca producción, ni
para leer, ni con `ROLLBACK`, sin que él lo pida) y su salida se pega en el commit de aplicación.

---

## 9. Reversión

Todo es nuevo, así que la reversión es completa y no restaura nada: **deja la base exactamente como
estaba**.

```sql
-- Deshacer la 140 entera:
drop view     if exists public.promo_catalog;
drop table    if exists public.promo_decisions;
drop table    if exists public.promo_suggestions;
drop table    if exists public.promo_products;
drop table    if exists public.promo_rounds;
drop function if exists public.promo_decisions_guard();
drop function if exists public.promo_private(uuid, text);
drop function if exists public.promo_visible_groups();
drop function if exists public.promo_can_see_private();
drop function if exists public.promo_is_decider();
drop function if exists public.promo_group_of_user();
drop function if exists public.has_promos_access();
delete from public.schema_migrations where name = '140_promos.sql';
-- `promo_group` dentro de settings.stores puede quedarse: es un campo que nadie mas lee.
```

**El respaldo, y por qué se pide igual.** Nada existente se modifica, así que el `pg_dump` no protege
de esta migración: protege del **`drop` de la reversión**, que sí borra decisiones ya tomadas si se
ejecuta tarde. Ese es el momento peligroso, no el de aplicar. Dump reciente guardado antes de
aplicar, y **releído antes de revertir**.

---

## 10. El lector del Excel — función pura, y dónde se parte

`exceljs` toca ficheros y objetos de celda; eso no se puede probar sin un `.xlsx`. Así que se parte
en dos, y la costura es una estructura tonta:

```
leeLibro(ruta) ── exceljs ──> HojaCruda[] = { nombre, filas: Celda[][] }      (impuro, sin pruebas)
                                   |
                                   v
              leePromo(hojas) ──> { productos, sugerencias, avisos }          (PURO, con pruebas)
```

`Celda` es lo que `exceljs` deja en `cell.value`: `string | number | null | { result } | { richText }`.
Las pruebas construyen esas formas **a mano** —incluidas las **tres** del hecho 4 de §0— y no
necesitan ni un fichero ni la librería.

**Lo que `leePromo` decide, y que sale directo de lo medido:**

1. una hoja es de productos **si su fila 2 son los 17 encabezados esperados**; si no, se ignora y se
   anota en `avisos`. (Así `Sheet6` se cae sola y ningún nombre de hoja vive en el código.)
2. **el lector no conoce ni un nombre de hoja.** Recibe además la lista de **grupos ya cruzados en
   Ajustes**; una hoja que se llame como uno de ellos son **sugerencias de ese grupo**, y cualquier
   otra hoja de productos es **universo**. Con la lista vacía —el día que se estrena esto, antes de
   que nadie cruce nada— todo es universo y no hay sugerencias, que es lo honesto: sin el cruce no
   se puede saber de quién era esa hoja. Un grupo conocido **sin** hoja también se anota.
3. una fila sin `Unified Code` **no es un producto**, tenga descripción o no (`ROCA`, `VINYL`,
   `TAPETES`), y se anota.
4. el código se recorta **a los lados** y nada más: `FMPGC 3.5GAL` sigue siendo distinto de `FMPGC`.
5. un número se lee con una función que trata `""`, `null` y `undefined` como **ausente** —nunca como
   cero— y que acepta el `{ result }` de una celda con fórmula.
6. un código sugerido que no esté en el universo se anota en `avisos` **y se conserva**: perderlo en
   silencio sería inventar que la hoja no lo decía.
7. un código repetido dentro de una hoja se anota y gana el primero (hoy no pasa: medido, cero
   duplicados; la regla existe para que el día que pase se sepa).
8. `avisos` **nunca está vacío por diseño**: es la lista de todo lo que el lector decidió no meter. La
   pantalla de subida la enseñará al admin antes de confirmar la ronda (fase 2).

**Lo que `leePromo` NO hace:** no conoce tiendas, ni nombres de hoja, ni qué columna es de qué
tienda. Las **columnas de tienda se descubren**: son las que van entre `MO` y `COST`, y se llaman
como diga el encabezado — así el libro del mes que viene puede abrir o cerrar una tienda sin tocar
código, y ni un código de tienda del dueño entra en el repositorio.

**Comprobado con mutantes** (14 cambios, 14 caen, cada uno por la prueba que lleva su nombre, y el
gemelo —`vacia()` escrita con un bucle en vez de `.every`— se queda en verde). Los tres que de
verdad importan: quitar la regla de la cadena vacía hace caer *«el costo vacío es AUSENTE, nunca
cero»*; leer `.formula` en vez de `.result` hace caer *«lee las TRES formas de celda con fórmula»*; y
quitarle al **código** —y solo al código, dejando `texto()` intacto— sus espacios de dentro hace caer
*«un código que es PREFIJO de otro… siguen siendo dos productos»*.

---

## 11. Preguntas abiertas — las tres, y ninguna bloquea escribir el código

1. **La de §0**, la única de verdad: ¿un vendedor ve solo su tienda, o filtra entre todas? Cambia el
   cuerpo de `promo_visible_groups()` y nada más.
2. **¿Una ronda se cierra?** El esquema lleva `closed_at` para poder decir «esta ya no se decide»,
   pero **ninguna política lo mira todavía**. Si el dueño la quiere, es un `and closed_at is null` en
   las dos políticas de escritura de decisiones.
3. **¿Qué pasa con un producto de `other` sin precio?** Se guarda (columna nullable) y la pantalla
   decidirá si lo enseña. Aquí no se decide: guardarlo con un cero sería inventar un dato, y esa es la
   trampa del hecho 2 de §0.
