# Plan — Pase de seguridad del ERP: escalafón propio (`erp_role`), costo cerrado (A-2d) e historial append-only (A-2c-erp)

**Fecha:** 2026-09-03 · **Estado:** PLAN EN PAPEL, sin implementar. No se toca el ERP hasta revisión.
**Origen:** `docs/AUDIT-2026-09.md` A-2d + A-2c-erp + escalafón. Molde de D-179/D-180 (matriz rol×acción con `ROLLBACK`, real+sintético; helpers en el mismo idioma que los guards).
**Respaldo:** `rtg-prod-20260903-162939.dump` (4.4 MB) sirve hoy; si al aplicar ha pasado más de un día, `pg_dump` nuevo antes de tocar nada.

Los tres hallazgos son **un solo problema**: el ERP no tiene su modelo de permisos cerrado. Hoy deriva todo del rol de Deliveries (`public.profiles.role`), así que el permiso "ve costo del ERP" viaja pegado a "es gerente de oficina de Entregas" — dos hechos distintos que nadie unió a propósito.

## Reversión consciente de una decisión registrada

El diseño actual **es deliberado y está documentado**: `src/lib/constants.ts` (entrada ERP de `MODULE_ACCESS`) y D-057 dicen que el ERP **no** tiene `roleColumn` porque "quién ve el costo lo decide `role` siendo admin/manager, columna que el bloque de Deliveries ya edita — el ERP lee la misma en vez de guardar una segunda copia del mismo hecho".

Este plan **revierte esa nota** (no D-057 entero; su regla de *columna única por módulo* se respeta y se refuerza). Razón por la que la premisa cambió: la "misma copia del hecho" resultó **no ser el mismo hecho**. `role='manager'` de Entregas (5 personas, gerentes de oficina de reparto) **no** es lo mismo que "puede ver costo y margen del ERP", y hoy lo hereda solo. Medido: `can_see_cost()` = `role in ('admin','manager')` ⇒ 5 managers + 2 admin ven costo por la vista, y **cualquier** usuario con ERP lo lee crudo de la tabla base (A-2d). El dueño pide separarlos. Se registrará como decisión que reemplaza la nota anterior (regla 2 de CLAUDE.md).

---

## §1 · Inventario y `erp_role` propuesto

**Lo que el código distingue HOY** (no inventado — leído de `pg_policies` del esquema `erp` y de las 23 pantallas):
- **Costo/margen** (decisión #29): lo enmascara la vista `erp.app_products` con `CASE WHEN erp.can_see_cost() THEN p.cost ELSE NULL` y `erp.app_store_products` igual con `store_cost`. `can_see_cost() = current_app_role() in ('admin','manager')`.
- **Catálogo (publicar/editar)**: `products UPDATE (mgr/admin)`, `sku_aliases INSERT (mgr/admin)`. El resto (`products INSERT draft`, `product_requests`) lo puede cualquier usuario con ERP.
- **Auditoría**: `audit_log SELECT (mgr/admin)`.
- **Todo lo demás** (compras/POs, recepción, inventario, categorías, analytics, saved_views) está hoy tras un único `erp module gate = has_erp_access()`: **cualquier** usuario con ERP escribe. Esa amplitud es parte del problema.

**23 pantallas → tier mínimo (propuesta, a confirmar por el dueño):**

| Pantallas | Qué hacen | Tier mínimo propuesto |
|---|---|---|
| `catalog`, `product/[id]`, `inventory`, `dashboard`, `analytics/*` (5), `decisions`, `review*` (3) | Consultar catálogo/stock/analítica (sin costo) | **staff** |
| `request`, `requests` | Pedir alta de producto (borrador) | **staff** |
| `po-upload`, `purchasing`, `purchasing/*` (5), `master` | Crear/editar POs, recibir, exportar maestro | **buyer** *(ver pregunta abierta)* |
| Ver **costo/margen** en cualquiera de las anteriores | #29 | **manager** |
| `product/[id]` editar/publicar, `sku_aliases`, leer `audit_log` | Autoridad de catálogo | **manager** |
| Cambiar ajustes del ERP / administrar | — | **admin** |

**`erp_role` propuesto (columna nueva en `public.profiles`, `text NULL`):** espina de 3 tiers heredada del ERP original (`admin`/`manager`/`staff`, de donde vino este esquema — plan `peaceful-zooming-stonebraker`), con **`buyer` como pregunta abierta**:
- **`staff`** — entra al ERP, lee catálogo/inventario/analítica **sin costo**, crea solicitudes y borradores, gestiona sus `saved_views`. Default seguro.
- **`manager`** — staff + **ve costo/margen**, publica/edita productos, `sku_aliases`, lee `audit_log`, compras y recepción.
- **`admin`** — manager + acciones de administración del ERP.

Encaje con la regla de **columna única de D-057**: `roleColumn: "erp_role"` es una columna **nueva**, no compartida — el test `new Set(columns).size === columns.length` (`erp-module.test.ts`, `landing-route.test.ts`) sigue verde. `accessColumn` sigue `module_access`. **Nota:** `erp-module.test.ts` hoy **afirma** `erp.roleColumn === undefined` y `landing-route.test.ts` exige `roleNote` cuando no hay `roleColumn`; ambas aserciones **se invierten a propósito** en este plan (dejan de aplicar al ERP) — es el cambio, no una rotura silenciosa.

**Pregunta abierta 1 (compras/recepción):** ¿`buyer` separado de `manager`, o compras/recepción entran en `manager`? Comprar bien necesita ver costo, así que lo natural es plegar compras en `manager` y **no** crear `buyer` hasta que exista una persona real que compre sin ver costo (YAGNI; la base no distingue "buyer" hoy). Recomendación: **3 tiers** (`staff`/`manager`/`admin`), compras = `manager`. Confirmar.

---

## §2 · Migración de lo existente (nadie GANA costo por accidente)

Hoy tienen ERP (`'erp' = any(module_access)` o `role='admin'`): se cuenta en la aplicación. Al migrar:
- **Default el más bajo:** todo usuario con ERP → `erp_role = 'staff'`. Sin costo, sin publicar.
- **Dueño(s) → `erp_role = 'admin'`** explícito (por id, no por heurística).
- **Nadie más recibe `manager`/`admin` automáticamente.** Los 7 que hoy ven costo por `role in ('admin','manager')` **caen a staff** salvo que el dueño los suba a mano. Esto es el punto: es una **pérdida de visibilidad para 5 gerentes de Entregas que nunca debieron tenerla** — cambio de comportamiento **visible y buscado**, no una regresión. Se listan por nombre para que el dueño confirme quién sube a `manager`.
- Usuarios sin ERP → `erp_role = NULL` (no aplica).

`erp_role` **NOT NULL no**: NULL = sin tier (coherente con `recruiting_role`/`timetracker_role`, que son NULL cuando no hay módulo).

---

## §3 · A-2d — cerrar el costo de raíz (la vista es cosmética)

**El hueco medido:** `erp.products` (6,859 filas) tiene política `[SELECT] products read USING (record_status='published')` y el gate `ALL has_erp_access()`. La vista `app_products` es **`security_invoker`**, así que enmascara costo por columna pero **no impide** que un vendedor con ERP consulte `erp.products` directo por PostgREST y lea `cost` (+ `price_erp/price_mgr/price_sales/price_vol/...`). Lo mismo con `erp.store_products.store_cost` (política `store_products read USING true`).

**Trazado de lectores (grep):** *todas* las lecturas de la app pasan por las vistas `app_products`/`app_store_products` (catalog, product/[id], requests, review*, po-draft, product-drawer, product-family, request-form, `lib/erp/actions.ts:34-35`). **Ningún** código de cliente lee `erp.products`/`erp.store_products` directo para costo. El único service-role del ERP (`actions.ts:561`) es storage de `po-docs`, no costo. ⇒ cerrar la base **no rompe ninguna pantalla**; solo tapa el acceso directo por API.

**Opciones:**
- **(A) Vista `security_definer` + revoke total de la base.** La vista pasa a definer (lee la base como su dueño), se replica el filtro de fila (`record_status='published'`…) dentro del `WHERE` de la vista, y se revoca `SELECT` de `erp.products` a `authenticated`. Contra: la vista definer **salta la RLS de fila** de la base, así que hay que **duplicar** ese filtro en la vista y mantenerlo sincronizado — superficie que se desincroniza.
- **(B) — RECOMENDADA — costo detrás de una función definer + revoke de columna.** La RLS de **fila** se queda intacta (sin duplicar). Solo la **columna** costo se mueve:
  1. `REVOKE SELECT (cost, price_erp, price_mgr, price_sales, price_vol, price_kind, price_mode, price_source) ON erp.products FROM authenticated;` (mantener `GRANT SELECT` de las columnas no-costo). Igual con `store_products.store_cost`.
  2. Nueva `erp.product_cost(p_id uuid) returns numeric SECURITY DEFINER`: `select case when erp.can_see_cost() then cost else null end from erp.products where id = p_id`. La vista `app_products` deja de referir `p.cost` y usa `erp.product_cost(p.id)` — así la vista **invoker** ya no toca la columna revocada (no se rompe) y el costo sale enmascarado igual que hoy. Análogo `erp.store_product_cost(...)` para `app_store_products`.
  3. Resultado: consulta directa a `erp.products` por un vendedor → `permission denied for column cost`. Vista → costo enmascarado por `can_see_cost()`. Cero cambio para las pantallas.

**A trazar antes de aplicar (B):** la columna-privilegio también afecta **INSERT/UPDATE** de esas columnas. Hay que verificar (a) `actions.ts:272 from("products").insert(row)` (¿el borrador de staff incluye `cost`? si sí, necesita `GRANT INSERT(cost)` o ir por definer), y (b) la edición de precio de `manager` (`products UPDATE (mgr/admin)` — `GRANT UPDATE(price_*/cost)` a quien deba). Se traza cada `insert`/`update` de `erp.products` y se decide grant por columna o vía función definer.

---

## §4 · Guard de `erp_role` + RLS del ERP reescrita sobre `erp_role`

**Guard (patrón `guard_recruiting_access`):** trigger `before update on public.profiles` que impide cambiar `erp_role` salvo a un **admin de Deliveries** (`current_user_role()='admin'`). Igual que el rol de recruiting/timetracker: el dueño reparte tiers de todos los módulos desde /home/users; nadie se auto-asciende en el ERP. Se **añade** al guard existente de columnas privilegiadas (D-179, `guard_profile_privileged_columns`) — añadir `erp_role` a esa lista, no un trigger nuevo.

**RLS reescrita:** redefinir `erp.current_app_role()` para leer **`erp_role`** en vez de `role`:
```
select erp_role from public.profiles where id = auth.uid()   -- antes: select role
```
`can_see_cost()` no cambia de forma (`current_app_role() in ('admin','manager')`), pero ahora habla de `erp_role`. Efecto inmediato: un `role='manager'` de Entregas **sin** `erp_role` deja de ver costo.

**Tabla → política propuesta (reemplazar el `ALL has_erp_access()` amplio donde haya autoridad):**

| Tabla(s) | Hoy | Propuesto |
|---|---|---|
| `products` UPDATE/publish, `sku_aliases` INSERT | `current_app_role() in (mgr/admin)` (ya) | igual, pero ahora sobre `erp_role` |
| costo (`product_cost`, `store_product_cost`) | `can_see_cost()` sobre `role` | `can_see_cost()` sobre `erp_role` |
| `purchase_orders`, `po_lines`, `po_receipts`, `order_acknowledgments`, `ack_lines`, `reservations`, `cycle_counts`, `inventory_*` (escritura) | `ALL has_erp_access()` (cualquiera) | **INSERT/UPDATE `erp_role in ('manager','admin')`**; SELECT amplio (has_erp_access) |
| catálogo de lectura (`categories`, `stores`, `vendors`, `lots`, …) | SELECT `true` / gate | SELECT sin cambio (lectura amplia) |
| `saved_views`, `product_requests` | por dueño de fila (ya) | sin cambio |

*(La lista completa tabla-por-tabla se cierra en la fase de aplicación, con la matriz; aquí queda el criterio: **lectura amplia dentro del módulo; escritura de compras/inventario/catálogo a `manager`+; costo a `manager`+; admin para lo administrativo**.)*

---

## §5 · A-2c-erp — historial append-only

**Trazado de escritores (todas SECURITY DEFINER, todas solo INSERT):** `erp.audit_row`→`audit_log`; `erp.capture_price_history`/`capture_store_price_history`→`price_history`; `erp.reconcile_qoh`/`reconcile_qoh_repair`→`qoh_reconcile_log`. **Ninguna hace UPDATE** de esas tablas (verificado contra `pg_get_functiondef`).

⇒ **La hipótesis de que `qoh_reconcile_log` necesita UPDATE queda descartada por el trazado:** `reconcile_qoh_repair` **inserta** una fila de reparación, no actualiza. Así que **las cinco son append-only limpias**, igual que `stage_history` en D-180:

| Tabla | Escritor | Propuesto |
|---|---|---|
| `erp.audit_log` | `audit_row` (definer) | SELECT (mgr/admin, ya); **sin INSERT/UPDATE/DELETE de cliente** (lo escribe el trigger) |
| `erp.price_history` | `capture_*` (definer) | SELECT amplio; **sin escritura de cliente** |
| `erp.qoh_reconcile_log` | `reconcile_qoh*` (definer) | SELECT amplio; **sin escritura de cliente** |
| `erp.qoh_alert_log` | *(confirmar escritor en la fase de aplicación — mismo patrón esperado)* | append-only |
| `erp.sales_history` | *(idem)* | append-only |

Como el escritor es definer (salta RLS), quitar el `ALL` de cliente **no** frena el registro — se verifica en vivo con `ROLLBACK` (disparar un cambio de precio y ver crecer `price_history` con el INSERT de cliente ya bloqueado), tal como se probó `stage_history` en D-180.

---

## §6 · UI — /home/users (D-057 lo hace genérico)

El diálogo ya renderiza el selector de rol por `roleColumn` (`UserDialog.tsx:266` `{m.roleColumn ? <select>…}`) y despacha por un `switch` exhaustivo. Agregar el ERP es:
1. `MODULE_ACCESS` entrada ERP: `roleColumn:"erp_role"`, `roleKeys:['staff','manager','admin']`, `roleLabel`, quitar `roleNote`. Añadir `"erp_role"` al union de `roleColumn` en `ModuleAccessConfig`.
2. `setModuleRole`: el `case "erp"` (hoy no-op) llama una acción nueva `updateUserErpRole(u.id, roleValue)` (espejo de `updateUserRecruitingAccess`).
3. `case "erp"` de `setModuleAccess` sigue igual (grant/revoke de `module_access`); al conceder, default `erp_role='staff'`.
4. Tipo `Profile` gana `erp_role`; `u[m.roleColumn]` ya lo resuelve genérico.

El selector aparece solo por ser data-driven. Coste real: la entrada + una acción + el `case`. Actualizar `erp-module.test.ts`/`landing-route.test.ts` a la nueva verdad (ERP **con** roleColumn).

---

## §7 · Matriz de pruebas (real + sintética, con `ROLLBACK`)

Foco en los invariantes que el dueño nombró:
1. **Vendedor con ERP (`erp_role='staff'`) NO lee costo** — ni por la vista (NULL) ni por `erp.products` directo (`permission denied for column cost`). Sintético: sales + module_access erp + erp_role staff.
2. **Gerente de Entregas (`role='manager'`) SIN `erp_role` no entra al ERP** y no ve costo — `has_erp_access()` falso si no tiene `module_access` erp; y si lo tuviera con `erp_role` NULL/staff, sin costo.
3. **`erp_role='manager'` SÍ ve costo** y edita catálogo/compras; `admin` además administra.
4. **Las 23 pantallas cargan con cada tier** (staff/manager/admin) — smoke de que ninguna revienta por la RLS nueva (lectura amplia preservada).
5. **Historial**: cliente no inserta/edita/borra `audit_log`/`price_history`/`qoh_reconcile_log`; el trigger definer sí escribe (verificado con cambio real en `ROLLBACK`).
6. **Guard**: no-admin no puede cambiar `erp_role` de nadie (ni el suyo); admin de Deliveries sí.

Sesiones sintéticas montadas como `postgres` antes de `set local role authenticated` (lección D-056: probar solo lo que existe no prueba la política).

---

## §8 · Riesgo y rollback

- **Riesgo principal:** la reescritura de RLS del ERP toca ~30 tablas; un `WITH CHECK` de más rompe una escritura legítima de compras/inventario. Mitigación: matriz ANTES/DESPUÉS por tabla, y **lectura amplia intacta** (el smoke de 23 pantallas es lectura).
- **Cambio de comportamiento buscado:** 5–7 personas pierden visibilidad de costo hasta que el dueño las suba a `manager`. Se comunica antes.
- **Rollback en un comando** (como D-180): el script guarda las políticas actuales y las vuelve a crear; `current_app_role()` se restaura a `select role`; el `REVOKE`/`GRANT` de columnas se revierte; `erp_role` se puede dejar (columna nueva inerte) o dropear.
- **Respaldo:** `pg_dump` completo **inmediatamente antes** de aplicar (el de hoy sirve si es <1 día), verificado con `pg_restore --list`. Si falla, PARA.
- **Orden de aplicación:** (1) `erp_role` columna + guard + migración de valores (default staff, dueño admin) → (2) `current_app_role()` a `erp_role` → (3) A-2d (revoke columna + funciones definer + vistas) → (4) RLS de escritura por tabla → (5) A-2c-erp append-only → (6) UI. Matriz entre cada paso.

---

## Preguntas abiertas para el dueño (bloquean la aplicación)
1. **Tiers:** ¿3 (`staff`/`manager`/`admin`, compras=manager) o hace falta `buyer` aparte? (Recomiendo 3.)
2. **Quién sube a `manager`/`admin`:** lista de los 5 gerentes + 2 admin actuales — ¿quién conserva costo? Default: solo el/los dueño(s) como admin, el resto staff.
3. **`recruiting.settings` (de D-180):** ¿HR-settings solo `admin`, o `admin`+`manager` como quedó? (Cambio de una línea; anotado en D-180.)
