# Plan A-2b (settings) + A-2c (order_events / historial) — RLS

**Fecha:** 2026-09-03 · **Molde:** §8 de `PLAN-A-2a-profiles-rls.md`, mismo `is_admin()`.
**Respaldo previo:** `rtg-prod-20260903-162939.dump` (4.4 MB, 131 tablas), verificado con
`pg_restore --list` en A-2a el mismo día. RLS no destruye datos; el dump sigue vigente (<1 día).

## Regla
- **settings:** SELECT amplio (la app lee tarifas/tiendas/ventanas en todo el módulo);
  INSERT/UPDATE/DELETE solo el **admin del módulo**. La pantalla ya es admin-only; la base
  lo dice igual.
- **historial:** SELECT amplio; INSERT solo por quien actúa, firmado
  (`WITH CHECK <actor> = auth.uid()`, cf. D-039 — nadie firma a nombre de otro);
  **sin UPDATE ni DELETE, ni para admin** (append-only, como `security_events` en D-039).

## Se APLICA ahora (4 tablas — verificado que no rompe)
| Tabla | ANTES (write) | DESPUÉS | Por qué no rompe |
|---|---|---|---|
| `public.settings` | ALL `has_deliveries_access()` | SELECT `has_deliveries_access()`; INS/UPD/DEL `is_admin()` | Settings UI es admin-only |
| `recruiting.settings` | ALL `has_recruiting_access()` | SELECT `has_recruiting_access()`; write `current_recruiting_role() in ('admin','manager')` | Hoy solo 2 admins tienen `recruiting_role`; write es UPDATE(id=1) que solo llega admin |
| `public.order_events` | ALL `has_deliveries_access()` (incl. UPD/DEL) | SELECT `has_deliveries_access()`; INSERT `has_deliveries_access() AND created_by = auth.uid()`; sin UPD/DEL | App inserta con `created_by = me.id` (= `auth.uid()`) en los 2 sitios; **no** hace UPD/DEL de eventos |
| `recruiting.stage_history` | ALL `has_recruiting_access()` | SELECT `has_recruiting_access()`; sin INS/UPD/DEL desde cliente | Lo escribe `recruiting.log_stage_change` (**SECURITY DEFINER**, salta RLS); la app nunca lo inserta/edita |

## NO se toca (ya correcto)
- `public.security_events` — INSERT `auth.uid()=actor_id`, SELECT admin, sin UPD/DEL (D-039). ✔ append-only.
- `timetracker.settings` — write ya `is_timetracker_admin()`. ✔
- `timetracker.audit` — INSERT/SELECT `is_timetracker_admin()`, sin UPD/DEL. ✔ append-only.
- `clockin.audit_log` — INSERT/SELECT manager con `company_id`, sin UPD/DEL. ✔ append-only.

## SORPRESAS — se FLAGGEAN, NO se aplican a ciegas (fuera del alcance nombrado)
1. **`clockin.employee_settings`, `timetracker.employee_settings`** — NO son la pantalla de
   settings del módulo: son **preferencias por empleado**, editables por el propio usuario
   (`id = auth.uid()` en UPDATE). Forzarlas a admin-only rompería a un usuario guardando lo
   suyo. → sin cambio; distinto de A-2b.
2. **`clockin.notes_log`** — política `notes_rw_self` (ALL): las notas se **editan por su autor
   por diseño**. Append-only contradiría esa UX. → requiere decisión, no se toca.
3. **ERP: `erp.audit_log`, `price_history`, `sales_history`, `qoh_alert_log`, `qoh_reconcile_log`**
   — hoy `ALL has_erp_access()` (cualquier usuario ERP puede UPD/DEL). ERP tiene su **propio
   modelo de rol** (`erp.current_app_role()`, admin/manager/staff) y la garantía de costos
   (decisión #29). No tracé sus escritores; `qoh_reconcile_log` podría actualizar filas por
   diseño. → **A-2c-erp**, pase dedicado con el escritor trazado. No se lockea a ciegas.

## Verificación (real + sintética, con ROLLBACK; una migración = 100)
- Matriz rol×acción ANTES/DESPUÉS sobre las 4 tablas: admin, sales, driver, warehouse,
  accounting reales + sintéticos (recruiting-admin, no-recruiting).
- No roto: mover etapa de una orden como sales/warehouse/driver (INSERT de evento pasa),
  Settings como admin (write pasa), leer tarifas al calcular costo, sesión de driver real.
- Rollback en un comando (políticas actuales capturadas abajo en la migración).
