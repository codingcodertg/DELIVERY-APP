# Plan · Clientes (migración 180): el Excel maestro de clientes en una app con el tema del ERP

**Fecha:** 2026-10-16 · **Estado:** migración escrita y NO aplicada; carga escrita y NO corrida contra la base.
**Pedido del dueño**, literal: *«HGAMAOS EL CUSTOMER APP ASI COMO EL LEADS PERO CON EL SCHEMA DE EL ERP ASI CON ESE THEME»*,
con el fichero `REAL Master List Customers PRE DEC.xlsx` (fuera del repo).

## 0 · Resumen

El Excel tiene dos hojas. **ALL** es la lista maestra: 1.349 clientes (filas con datos; el orquestador contó 1.350
porque contaba la cabecera) en 28 columnas, repartidos en cinco tiendas por código (MCA, PHR, BRO, EDG, WES). **RHC**
es una «Customer Phone List» de QuickBooks de Rodriguez Home Center del 17/10/2025: 214 clientes, todos activos, con
teléfono, correo, términos, vendedor, límite y saldo.

Se construye un módulo del hub, **«Clientes / Customers»** (`/customers`, clave `customers`), registrado igual que
Leads: tarjeta, casilla por persona, puerta en el servidor, fila en el registro de seguridad. Los datos viven en
**`erp.customers`** —una tabla, en el esquema del ERP— con la **RLS del ERP** (puerta restrictiva por módulo + permisivas
por acción). La pantalla se viste con el ERP: su hoja de estilos, su barra lateral, su paleta clay, su ficha lateral.

Se carga **solo la hoja ALL**. La RHC no aporta: de sus 214 nombres, 205 están en ALL con el mismo ACCOUNT y sus 138
teléfonos están TODOS en ALL (medido, abajo). Los 9 que no casan son erratas («PASO RESIDENCIAL» por «PASEO RESIDENCIAL»,
«AAP DESIGN CONTRUCTION»…) o cuentas que el maestro no tiene; se listan en la sección 2 para que el dueño diga.

## 1 · Decisiones (para que el dueño confirme)

1. **El esquema es `erp`, no uno nuevo `crm`.** «Con el schema del ERP» se lee literal: la tabla va en `erp`, con las
   políticas del ERP. Razones que no son de gusto: PostgREST solo sirve los esquemas listados en «Exposed schemas» del
   panel de Supabase, así que un esquema `crm` obliga a un **paso manual en el panel** antes de que la app lea una sola
   fila (lo mismo que descartó `tracker` en `docs/PLAN-144-tracker-en-la-nube.md`), y a un **cliente de navegador más**
   con su propia instancia de GoTrue (D-185). `erp` ya está expuesto, ya tiene cliente, y un cliente es una entidad
   maestra del ERP igual que `erp.vendors`, `erp.stores` o `erp.salespeople`. Descartado también `public` (donde viven
   los leads): el dueño pidió el esquema del ERP.
2. **Quién lee:** quien tiene la casilla `customers` (y el admin siempre). Lo decide `public.has_customers_access()`,
   calcada de `has_leads_access()`. **Tener el ERP no da la lista de clientes, ni al revés**: la puerta restrictiva mira
   `customers`, no `erp`.
3. **Quién escribe:** admin y manager **del hub** (`profiles.role`), con la casilla. Por `profiles.role` y no por
   `erp_role`, porque el módulo se concede por casilla a gente que puede no tener nivel de ERP, y el dueño pidió «como
   Leads», cuyo escalafón es el del hub. El encargo decía «admin/manager/office»: **no existe un rol `office` en el
   hub** (`UserRole` = admin, manager, sales, warehouse, driver, logistics, accounting). Si «office» quería decir
   `accounting`, es una línea en `erp.customers_can_write()` y otra en `puedeEditar()`. **Borra solo el admin.**
4. **Una fila por (tienda, cuenta).** Es la clave natural del Excel (ACCOUNT + STORE), sin mayúsculas ni espacios de más
   (índice único sobre `upper(btrim(store)), lower(btrim(account))`). El mismo cliente en dos tiendas son dos filas que
   comparten `unified_account`, exactamente como en el Excel (1.274 cuentas distintas, 1.188 unificadas).
5. **Las tiendas se guardan por su código del Excel** (BRO, EDG, MCA, PHR, WES) y la pantalla las traduce al nombre del
   hub (`RDZ Brownsville`, `RDZ Edinburg`, `RDZ McAllen`, `RDZ Pharr`, `RDZ Weslaco`: los nombres de `profiles.store`
   medidos para Leads, D-468). **Mission no está en el Excel.** El mapa vive en `lib/customers/reglas.ts`; un código
   desconocido se enseña tal cual.
6. **La RHC no se carga** (sección 2). Si Rodriguez Home Center es una tienda aparte y hay que tenerla, se carga como
   tienda `RHC` con sus 214 filas: el guion solo necesita que se le diga.
7. **Los valores del Excel se guardan tal cual** (STATUS TYPE, HISTORY TYPE, Terms, Account No.): no se «traducen»
   en la carga; la pantalla pone la etiqueta en cada idioma. Lo que sí se limpia: un `0` en una columna de texto es
   «sin dato» (255 contactos, 63 teléfonos, 154 correos, 185+206 vendedores), `#N/A` es null (1.021 Euler), espacios
   recortados, tienda en mayúsculas.
8. **Re-importar no pisa lo que la app escribió.** Cada columna del Excel se actualiza solo si trae valor
   (`coalesce(excluded.x, x)`); `notes` nunca se toca; nada se borra. Volver a correr el mismo Excel no cambia nada.
9. **La fila duplicada del Excel se fusiona** (PASEO RESIDENCIAL / BRO, filas 947 y 948, HOUSE 787 y 1295: una con
   estado NEW y vendedor, la otra con teléfono y fecha 2026-09-24): la primera manda, la segunda rellena huecos. Queda 1
   fila con todo.
10. **La ficha se guarda con un botón**, no al vuelo como la del producto del ERP: una lista maestra se corrige con
    intención, y el botón solo se enciende cuando algo cambió.
11. **Las columnas de la tabla se recuerdan en el navegador** (`localStorage`, clave `customers_cols`), con el
    `SelectorDeColumnas` de la casa; no en la base.
12. **No se añade una casilla al mapa de apps** (`mapa-de-apps.ts`): el diagrama del jefe no tiene «Customers»; sale en
    «Otras apps». Añadirla es decisión suya.

## 2 · El fichero, medido (2026-10-16, con `exceljs`)

### Hoja ALL — 1.349 filas · 28 columnas

| Columna | Llenas | Distintos | Qué es | ¿Va a la app? |
|---|---|---|---|---|
| HOUSE | 1.349 | 1.349 | Número de fila del maestro (1–1370, único) | Sí, `house_no`: para volver a la fila |
| DATE. ADDED | 1.232 | 5 | NO es una fecha: una tanda (`1`=789, `2`=127, `3`=45, `4`=8) o la fecha `2026-09-24` (263, la última remesa) | Sí, `added_batch` texto, tal cual |
| CONCATENATE | 1.349 | 1.348 | STORE+ACCOUNT pegados (fórmula) | No: se recompone |
| STORE | 1.349 | 5 | MCA 361 · PHR 353 · BRO 306 · EDG 249 · WES 80 | Sí, `store` (clave) |
| QB INACTIVE | 1.349 | 2 | `ACTIVE` 1.243 · `NOT FOUND IN UPDATE` 106 | Sí, `qb_status` |
| ACTIVITY STATUS | 225 | 8 | Internal 76 · One time? 55 · Inactive 46 · Competencia 15 · walk in 13 · Supplier 10 · Unknown 7 · One time 3 | Sí, `activity_status` |
| ACCOUNT | 1.349 | 1.274 | El nombre de la cuenta en esa tienda | Sí, `account` (clave) |
| UNIFIED ACCOUNT | 1.349 | 1.188 | El nombre que une la misma cuenta entre tiendas | Sí, `unified_account` |
| Max Group Rep History | 1.059 | 59 | Vendedor histórico del grupo: iniciales o nombre; `0`=185 | Sí, `rep_history` |
| Max Group Rep QB | 1.085 | 42 | Vendedor del grupo en QB; `0`=206 | Sí, `rep_qb` |
| Assigned Store Rep QB | 869 | 42 | Vendedor asignado en QB de la tienda (IM 143, YG 89, FR 87, MR 76…) | Sí, `rep_store` |
| STATUS TYPE: STORE | 1.086 | 5 | LOST 378 · NONE SALE 318 · ACTIVE DEC 246 · ACTIVE INC 74 · NEW 70 | Sí, `status_store` |
| STATUS TYPE: GROUP | 1.086 | 5 | LOST 347 · NONE SALE 296 · ACTIVE DEC 270 · ACTIVE INC 110 · NEW 63 | Sí, `status_group` |
| HISTORY TYPE: STORE | 1.086 | 4 | INSIGNIFICANT 873 · SMALL 165 · MID 36 · LARGE 12 | Sí, `history_store` |
| HISTORY TYPE: GROUP | 1.086 | 4 | INSIGNIFICANT 781 · SMALL 222 · MID 51 · LARGE 32 | Sí, `history_group` |
| CRM TYPE: STORE | 12 | 4 | Casi vacía | No: 12 valores, repite HISTORY |
| CRM TYPE: GROUP | 6 | 3 | Casi vacía | No |
| Associated with | 3 | 1 | «ACERO-SYNERGY» ×3 | No: 3 valores |
| CONTACT | 271 | 13 | `0`=255; 16 nombres reales | Sí, `contact_name` (el `0` es null) |
| TITLE | 4 | 2 | OWNER ×3, «.» | Sí, `contact_title` (campo de la app, aunque hoy vacío) |
| ADRESS | 0 | 0 | Vacía | Sí, `address` (campo de la app, aunque hoy vacío) |
| Main Phone | 858 | 766 | `0`=63; 5 que no son teléfonos («JOSE LLORENTE», «CRR FRIEND», «956-686-772»…) | Sí, `phone`, tal cual |
| Main Email | 746 | 511 | `0`=154; 7 `managementrft@rdztilegroup.net` (internos) | Sí, `email`, tal cual |
| QB Credit Limit | 322 | 41 | 0=144; 10000=30; 6000=19; 5000=14; 20000=13… | Sí, `credit_limit` |
| Terms | 791 | 15 | Due on receipt 392+43 · Net 30 165+77 · 25 Days 48 · Net 15 31+14 · NET 6 · net 7 · CASH · CREDIT · «45 days.» (mayúsculas mezcladas) | Sí, `terms`, tal cual |
| Euler | 1.086 | 14 | `#N/A`=1.021; 65 límites (10000=17, 15000=10, 70000=6…) | Sí, `euler_limit` (null el `#N/A`) |
| Account No. | 314 | 262 | Mezcla: INTERNAL CREDIT 29, NO CREDIT 7, EULER 7, números de Euler, nombres, «DICE $3000 CREDIT» | Sí, `account_no`, tal cual, rotulado «Cuenta / crédito» |
| (col. 28) | 0 | 0 | Sin cabecera, vacía | No |

Cruces que importan:

- **Tienda × estado (tienda):** BRO: 92 sin estado · ACTIVE DEC 75 · ACTIVE INC 21 · LOST 57 · NEW 21 · NONE SALE 40.
  EDG: 26 · 32 · 7 · 68 · 8 · 108. MCA: 38 · 79 · 20 · 115 · 22 · 87. PHR: 97 · 47 · 21 · 128 · 15 · 45.
  WES: 10 · 13 · 5 · 10 · 4 · 38.
- Los 263 sin estado son exactamente los de la remesa `2026-09-24` (todos ACTIVE en QB): la clasificación no se les hizo.
- Los 106 `NOT FOUND IN UPDATE` tienen todos estado.
- **403 filas sin teléfono ni correo** (vacío o `0`).
- Clave ACCOUNT+STORE: 1.348 distintas de 1.349 filas; **1 duplicado** (PASEO RESIDENCIAL / BRO).
- Tipos crudos: DATE ADDED = 969 números + 263 fechas + 138 vacías; QB Credit Limit = 322 números; Euler = 65 números
  + 1.021 `#N/A` + 284 vacías.

### Hoja RHC — 214 filas (cabecera en la fila 4; las 3 primeras son el título de QuickBooks)

Active Status (214 «Active») · Customer (214, únicos) · Main Phone (138) · Main Email (132) · Account No. (53: INTERNAL
CREDIT 30, EULER 7, CREDIT INTERNAL 6, CASH ACCT 3, y 6 números) · Terms (162: Due on receipt 77, 25 Days 48, Net 30 19,
Net 15 15…) · Rep (197: IM 143, RMC 13, CRR 13, EB. 11, JA 6…) · Credit Limit (47) · Balance (214; 168 en 0, 46 con saldo).

**Qué se repite con ALL:** 205 de los 214 nombres están en ALL por ACCOUNT exacto; 0 más por UNIFIED; los **138
teléfonos de la RHC están todos en ALL**. Los 9 que no casan: AAP DESIGN CONTRUCTION, BRN DEVELOPMENTS, EASY SOLUTIONS,
GALLERY HOMES, KMR BUILDERS, PASO RESIDENCIAL, SEAL CONSTRUCTION, TLAPALERIA, WM BURNS CONSTRUCTION.
**Lo que SOLO tiene la RHC:** el saldo (`Balance`), que es una foto del 17/10/2025 y envejece; y el vendedor `Rep` de
RHC, que en ALL ya está como `Assigned Store Rep QB` (IM 143 en los dos). Por eso no se carga.

## 3 · Correspondencia al esquema (`erp.customers`)

Lo de arriba, columna a columna, está en la cabecera de `supabase/migrations/180_clientes.sql` y en `MAPA` de
`scripts/importa-clientes.mjs` (23 columnas del Excel → 23 columnas de la tabla). Lo que añade la app: `notes`,
`source` (qué fichero y cuándo), `imported_at`, `created_at/by`, `updated_at/by` (los pone un disparador).

Restricciones cerradas: `qb_status`, `status_*`, `history_*` solo admiten los valores del Excel (y null); los límites no
negativos; cuenta y tienda no vacías. Índices: el único por clave natural; por cuenta unificada; por (tienda, estado).

## 4 · Inventario de lecturas y escrituras

| Quién | Qué | Cómo |
|---|---|---|
| Pantalla `/customers` | lee todo `erp.customers` (paginado de 1.000) | cliente del ERP del navegador, sesión de quien mira; política `customers read` + puerta |
| Pantalla, ficha | `update … eq(id) … select()` / `insert … select()` | políticas `(writers)`; cero filas de vuelta se cuenta como «no se guardó» |
| `scripts/importa-clientes.mjs --escribe` | `insert … on conflict do update` | `SUPABASE_DB_URL` (postgres, salta RLS); del orquestador, tras aplicar la 180 |
| Usuarios (hub) | `profiles.module_access` += 'customers' | `updateUserCustomersAccess`, con fila en el registro de seguridad |

## 5 · Qué NO debe romperse

- Nadie sin la casilla (ni con solo `erp`) lee una fila: la puerta restrictiva lo garantiza aunque mañana alguien añada
  una permisiva sin pensar.
- Ventas con la casilla lee y **no** escribe (`customers_can_write()` da false): el UPDATE vuelve con cero filas.
- `profiles_module_access_known` sigue siendo `not valid` y sigue sin `clockin`; una casilla desconocida sigue fallando.
- Las otras ocho escrituras de módulo del provider siguen filtrando `clockin` (`module-access-write.test.ts`, ahora nueve).
- El ERP no cambia de aspecto ni de menú: `SideNav` solo acepta `otra` opcional; sin él es la barra de siempre.

## 6 · Matriz de pruebas por rol, con ROLLBACK (la corre el orquestador)

Sustituir `<UUID-ADMIN>`, `<UUID-GERENTE>` (`manager`), `<UUID-VENTAS>` (`sales`) y `<UUID-SIN-MODULO>` (cualquiera que
no sea admin). Se pega entero en `psql` **desde la raíz del repo**. **Sin `commit` en ningún sitio.** Antes:
`set lock_timeout = '3s'`.

```sql
begin;
\i supabase/migrations/180_clientes.sql

-- Preparación (se deshace): GERENTE y VENTAS con la casilla; SIN-MODULO sin ella.
update public.profiles set module_access = array_append(array_remove(coalesce(module_access, '{}'), 'customers'), 'customers') where id in ('<UUID-GERENTE>', '<UUID-VENTAS>');
update public.profiles set module_access = array_remove(module_access, 'customers') where id = '<UUID-SIN-MODULO>';

-- Dos filas de ensayo, como postgres.
insert into erp.customers (store, account, status_store) values ('MCA', 'Ensayo Uno', 'NEW'), ('BRO', 'Ensayo Dos', 'LOST');

-- 1. La clave natural no distingue mayúsculas ni espacios. Esperado: unique_violation.
savepoint s1; insert into erp.customers (store, account) values ('mca', ' ENSAYO UNO '); rollback to s1;
-- 2. Un estado fuera de la lista. Esperado: check_violation.
savepoint s2; insert into erp.customers (store, account, status_store) values ('MCA', 'Ensayo Tres', 'RARO'); rollback to s2;

-- 3. Como VENTAS (con casilla): lee 2; no escribe (0 filas); no borra (0 filas).
set role authenticated; set request.jwt.claims = '{"sub":"<UUID-VENTAS>","role":"authenticated"}';
select count(*) = 2 as ok_lee_ventas from erp.customers;
update erp.customers set notes = 'x' where account = 'Ensayo Uno';           -- UPDATE 0
delete from erp.customers where account = 'Ensayo Dos';                      -- DELETE 0
-- 4. Como GERENTE (con casilla): lee 2; escribe (1 fila, updated_by = él); inserta; no borra (0 filas).
set request.jwt.claims = '{"sub":"<UUID-GERENTE>","role":"authenticated"}';
select count(*) = 2 as ok_lee_gerente from erp.customers;
update erp.customers set notes = 'gerente' where account = 'Ensayo Uno' returning updated_by = '<UUID-GERENTE>' as ok_updated_by;  -- UPDATE 1
insert into erp.customers (store, account) values ('WES', 'Ensayo Gerente') returning created_by = '<UUID-GERENTE>' as ok_created_by;
delete from erp.customers where account = 'Ensayo Dos';                      -- DELETE 0
-- 5. Como SIN-MODULO: lee 0; no escribe (0); un insert falla con la puerta (42501).
set request.jwt.claims = '{"sub":"<UUID-SIN-MODULO>","role":"authenticated"}';
select count(*) = 0 as ok_lee_nadie from erp.customers;
update erp.customers set notes = 'x' where account = 'Ensayo Uno';           -- UPDATE 0
savepoint s5; insert into erp.customers (store, account) values ('WES', 'Colado'); rollback to s5;  -- 42501
-- 6. Como ADMIN (sin casilla explícita): lee 3; borra 1.
set request.jwt.claims = '{"sub":"<UUID-ADMIN>","role":"authenticated"}';
select count(*) = 3 as ok_lee_admin from erp.customers;
delete from erp.customers where account = 'Ensayo Dos';                      -- DELETE 1
-- 7. Como anon: nada (sin grant).
set role anon; savepoint s7; select count(*) from erp.customers; rollback to s7;  -- 42501
reset role;

-- 8. La carga, en seco contra esta transacción: desde otra terminal NO; aquí, con el guion:
--    node scripts/importa-clientes.mjs "<ruta al xlsx>" --ensayo   (abre su propia transacción y hace ROLLBACK)
--    Esperado: nuevas 1348 · actualizadas 0; una segunda pasada: nuevas 0 · actualizadas 1348.

rollback;
```

Después del rollback, comprobar: `erp.customers` no existe, 0 perfiles con `customers`, la restricción sigue sin
`customers`, y `180_clientes.sql` no está en `schema_migrations`.

## 7 · Reversión

En la cola de la migración, comentada, en orden. Lo único con cuidado: quitar la palabra de los perfiles ANTES de
volver a poner la restricción vieja.

## 8 · Lo que le toca al orquestador (en este orden)

1. `APP_VERSIONS.customers = "0.1.0"` en `src/lib/app-versions.ts` y `["/customers", "customers"]` en
   `src/lib/app-for-path.ts` (la rama no toca ninguno de los dos; sin ellos `/customers` enseña el sello de deliveries).
2. Numerar `D-NEXT` en `DECISIONS.md`.
3. Respaldo; `migrate-status`; aplicar la 180; `migrate-status`.
4. `node scripts/importa-clientes.mjs "<xlsx>" --ensayo` y luego `--escribe` desde el checkout principal (necesita
   `SUPABASE_DB_URL`). Esperado: 1.348 nuevas.
5. Conceder la casilla a quien toque (el admin la tiene) y recargar.

## 9 · Lo que NO se ha medido

- Nada contra producción: la rama no tiene `.env.local` a propósito. La restricción actual de `profiles` se lee del
  fichero de la 162, no de la base.
- La pantalla en un navegador: `tsc`, `vitest` y el `next build` sí; abrirla, no.
- `on conflict (upper(btrim(store)), lower(btrim(account)))` contra el índice de expresiones: Postgres infiere el
  índice por la expresión exacta; se confirma en el `--ensayo`.
