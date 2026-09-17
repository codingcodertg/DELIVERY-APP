# Plan — 118 · Office (`accounting`) crea y mueve órdenes en la base, igual que el gerente

**Estado:** PLAN EN PAPEL. Nada aplicado. La migración está escrita
(`supabase/migrations/118_office_crea_ordenes.sql`) y espera respaldo, ensayo y visto bueno del dueño.
**Fecha:** 2026-09-17 · **Rama:** `rol-accounting-es-office` · **Decisión:** la entrada `D-NEXT` de esa
rama en `DECISIONS.md` (opción (a) del orquestador).
**Prerrequisito de aplicación:** un `pg_dump` de la función, o de `public`, justo antes de aplicar (§6).

---

## El problema, en una línea

El dueño renombró `accounting` a «Office» y pidió que *«toda la gente de office debe poder crear
órdenes»*. La app se lo da por rol (`ROLE_CAPS.accounting = ["create", "approve"]`), pero
`public.guard_delivery_stage()` no tiene **ninguna** rama para `accounting`. Hoy la base le rechaza crear,
editar, enviar, aprobar y rechazar. El orquestador lo midió en producción con `pg_get_functiondef` el
2026-09-17: la función vigente es la de la 048, sin cambios. D-044 ya había medido lo de crear el
2026-08-16.

---

## 1. Inventario de ESCRITURAS a `public.deliveries`

Todas van por el cliente, con la clave anónima, así que el trigger se ejecuta con el rol de quien actúa.
Medido con `grep 'from("deliveries")'` en `src` el 2026-09-17:

| Sitio | Qué escribe | Pasa por el guard como |
|---|---|---|
| `data-provider.tsx:891` `addDelivery` (insert `:933`) | orden nueva, carga partida, re-entrega | INSERT del rol |
| `data-provider.tsx:962` `updateDelivery` (`:995`, `:1074`) | campos de la orden, misma etapa | UPDATE, misma etapa |
| `data-provider.tsx:1199` `setStage` (`:1230`) | cambio de etapa | UPDATE, cambio de etapa |
| `data-provider.tsx:377` `flushOutbox` (`:390`) | reenvío sin conexión de un parche + etapa | UPDATE del rol |
| `data-provider.tsx:1193` borrar | DELETE (solo admin en la UI) | el guard no cubre DELETE: sin cambio |

Rutas de servidor: `api/track/[id]`, `api/version` y `api/notion-summary` solo leen. El `service_role`
(con `auth.uid()` null) salta el guard en su primera línea, y eso no cambia.

En `deliveries` no hay más triggers que `deliveries_guard_stage` y `deliveries_touch` (este último solo
pone `updated_at`). El paso 0 del ensayo lo comprueba en producción, por si hubiera un webhook.

---

## 2. La función vigente, literal (048 = producción)

```sql
create or replace function public.guard_delivery_stage()
  returns trigger language plpgsql security definer set search_path = public as $$
declare
  r text := coalesce(public.current_user_role(), 'sales');
  old_stage text := case when TG_OP = 'UPDATE' then OLD.stage else null end;
  new_stage text := NEW.stage;
  auto boolean := public.store_auto_approves(NEW.store);
  -- Scratch copy of NEW used to prove that a location-stamp patch changed
  -- nothing else.
  probe public.deliveries%rowtype;
begin
  if auth.uid() is null then return NEW; end if;
  if r = 'admin' then return NEW; end if;

  if TG_OP = 'INSERT' then
    if NEW.order_suffix is not null then
      if r in ('warehouse','driver','logistics','manager') and new_stage in ('ready','approved','fulfilling') then
        return NEW;
      end if;
      raise exception 'Not allowed to create this split load';
    end if;
    if NEW.redelivery_of is not null then
      if r in ('warehouse','manager','driver') and new_stage in ('approved','pending') then return NEW; end if;
      raise exception 'Not allowed to log this re-delivery';
    end if;
    if r = 'manager' then
      if new_stage in ('draft','pending','approved') then return NEW; end if;
      raise exception 'New orders start as draft, pending or approved';
    end if;
    if r in ('sales','driver') then
      if new_stage in ('draft','pending') then return NEW; end if;
      if new_stage = 'approved' and auto then return NEW; end if;  -- auto-approve store
      raise exception 'New orders start as draft or pending';
    end if;
    raise exception 'Only sales, managers or drivers can create orders';
  end if;

  if new_stage is not distinct from old_stage then
    if r in ('sales','driver') and old_stage in ('draft','pending','rejected') then return NEW; end if;
    -- A late GPS fix on the driver's own closed stop: allowed only when the
    -- location stamps are the ONLY difference between the two rows.
    if r = 'driver' and old_stage in ('picked_up','delivered') then
      probe := NEW;
      probe.pickup_lat    := OLD.pickup_lat;
      probe.pickup_lng    := OLD.pickup_lng;
      probe.pickup_gps_at := OLD.pickup_gps_at;
      probe.pod_lat       := OLD.pod_lat;
      probe.pod_lng       := OLD.pod_lng;
      probe.pod_accuracy  := OLD.pod_accuracy;
      probe.updated_at    := OLD.updated_at;
      if probe is not distinct from OLD then return NEW; end if;
    end if;
    if r = 'manager' then return NEW; end if;
    if r = 'warehouse'  and old_stage in ('approved','fulfilling','ready','picked_up','delivered') then return NEW; end if;
    -- Logistics can dispatch (same-stage edits) any order it can see in Routes
    -- Manager, including ones not yet approved/prepared (draft/pending).
    if r = 'logistics'  and old_stage in ('draft','pending','approved','fulfilling','ready') then return NEW; end if;
    raise exception 'You cannot edit an order in the % stage', old_stage;
  end if;

  if r in ('sales','driver','manager') then
    if (old_stage = 'draft'    and new_stage = 'pending')
    or (old_stage = 'pending'  and new_stage = 'draft')
    or (old_stage = 'rejected' and new_stage = 'pending')
    or (old_stage = 'draft'    and new_stage = 'canceled')
    or (old_stage = 'rejected' and new_stage = 'canceled')
    or (r in ('sales','driver') and new_stage = 'approved' and old_stage in ('draft','pending') and auto)  -- auto-approve store
    or (r = 'driver' and old_stage = 'ready'     and new_stage = 'picked_up')
    or (r = 'driver' and old_stage = 'picked_up' and new_stage = 'delivered')
    or (r = 'driver' and old_stage = 'picked_up' and new_stage = 'ready') then
      return NEW;
    end if;
    if r = 'manager' then
      if (old_stage = 'pending'  and new_stage = 'approved')
      or (old_stage = 'pending'  and new_stage = 'rejected')
      or (old_stage = 'approved' and new_stage = 'pending') then return NEW; end if;
    end if;
    raise exception '% cannot move an order from % to %', r, old_stage, new_stage;
  elsif r = 'warehouse' then
    if (old_stage = 'approved'   and new_stage = 'fulfilling')
    or (old_stage = 'fulfilling' and new_stage = 'ready')
    or (old_stage = 'ready'      and new_stage = 'picked_up')
    or (old_stage = 'picked_up'  and new_stage = 'delivered')
    or (old_stage = 'ready'      and new_stage = 'fulfilling')
    or (old_stage = 'picked_up'  and new_stage = 'ready')
    or (old_stage = 'delivered'  and new_stage = 'picked_up') then return NEW; end if;
    raise exception 'Warehouse cannot move an order from % to %', old_stage, new_stage;
  end if;

  raise exception 'Not allowed';
end $$;
```

---

## 3. El cambio

`accounting` entra en las **seis** listas donde está `'manager'`, y en ninguna otra:

| # | Rama | 048 | 118 |
|---|---|---|---|
| 1 | INSERT carga partida | `r in ('warehouse','driver','logistics','manager')` | `… 'manager','accounting')` |
| 2 | INSERT re-entrega | `r in ('warehouse','manager','driver')` | `r in ('warehouse','manager','accounting','driver')` |
| 3 | INSERT orden (draft, pending, approved) | `r = 'manager'` | `r in ('manager','accounting')` |
| 4 | UPDATE misma etapa, cualquiera | `r = 'manager'` | `r in ('manager','accounting')` |
| 5 | Enviar, volver a borrador, cancelar | `r in ('sales','driver','manager')` | `… 'manager','accounting')` |
| 6 | Aprobar, rechazar, desbloquear | `r = 'manager'` | `r in ('manager','accounting')` |

La función se genera por programa desde la 048. Una prueba (`src/lib/rol-office.test.ts`) quita
`accounting` de cada lista y exige que el resultado sea la 048 carácter a carácter. Otra exige que las
listas con `manager` y las listas con `accounting` sean exactamente las mismas seis.

La firma no cambia: `create or replace`, sin `drop`, y el trigger no se toca. Los mensajes de error
tampoco: el de crear sigue diciendo «managers».

---

## 4. Lo que NO debe romperse

| Cosa | Cómo funciona | Contra el cambio |
|---|---|---|
| admin | primera línea: `if r = 'admin' then return NEW` | ✅ igual |
| manager | sus seis listas | ✅ siguen teniéndolo; solo se añade un rol al lado |
| sales, driver | ramas propias y la lista 5 compartida | ✅ igual; la tienda auto-aprobada sigue siendo solo de sales y driver |
| warehouse | rama `elsif r = 'warehouse'` | ✅ igual |
| logistics | misma etapa en draft…ready; carga partida | ✅ igual (ver §7: sigue sin poder aprobar) |
| GPS tardío del chofer (048) | la comparación `probe` | ✅ igual, es parte de la copia |
| `service_role` y SQL editor | `auth.uid()` null → `return NEW` | ✅ igual |
| El trigger | `deliveries_guard_stage` apunta a la función por nombre | ✅ `create or replace` lo conserva |

Lo que cambia **a propósito** en la app, en la misma rama: `ordersLikeOfficeManager` (manager y
accounting) decide `canEditFields`, elegir vendedor, los campos de ventas, crear ya aprobada y registrar
re-entregas. Así la app ofrece a office lo mismo que la base le deja.

---

## 5. Matriz de pruebas — se corre ANTES de aplicar, con `ROLLBACK`

El procedimiento está literal al final de la 118: filas de ensayo con `is_training` y la tienda
`ENSAYO-118`, un intento por acción que siempre se deshace, y el recuento de filas (cero filas es
«SIN FILAS», no «permitido»). Se corre dos veces en la misma transacción: sin la 118, y con la 118
aplicada dentro. **Ningún efecto de terceros:** es SQL, y el `rollback` se lleva también cualquier cola
de `pg_net`.

Leyenda: ✅ permitido · ⛔ bloqueado. En la columna accounting, *antes → después*. Las demás columnas son
iguales antes y después.

| Acción \ Rol | admin | manager | **accounting** | sales | warehouse | driver | logistics |
|---|---|---|---|---|---|---|---|
| crear draft | ✅ | ✅ | ⛔ → ✅ | ✅ | ⛔ | ✅ | ⛔ |
| crear pending | ✅ | ✅ | ⛔ → ✅ | ✅ | ⛔ | ✅ | ⛔ |
| crear approved (tienda sin auto-aprobar) | ✅ | ✅ | ⛔ → ✅ | ⛔ | ⛔ | ⛔ | ⛔ |
| editar un draft | ✅ | ✅ | ⛔ → ✅ | ✅ | ⛔ | ✅ | ✅ |
| editar un approved | ✅ | ✅ | ⛔ → ✅ | ⛔ | ✅ | ⛔ | ✅ |
| enviar (draft → pending) | ✅ | ✅ | ⛔ → ✅ | ✅ | ⛔ | ✅ | ⛔ |
| cancelar un borrador | ✅ | ✅ | ⛔ → ✅ | ✅ | ⛔ | ✅ | ⛔ |
| reenviar (rejected → pending) | ✅ | ✅ | ⛔ → ✅ | ✅ | ⛔ | ✅ | ⛔ |
| aprobar (pending → approved) | ✅ | ✅ | ⛔ → ✅ | ⛔ | ⛔ | ⛔ | ⛔ |
| rechazar (pending → rejected) | ✅ | ✅ | ⛔ → ✅ | ⛔ | ⛔ | ⛔ | ⛔ |
| desbloquear (approved → pending) | ✅ | ✅ | ⛔ → ✅ | ⛔ | ⛔ | ⛔ | ⛔ |
| re-entrega (approved) | ✅ | ✅ | ⛔ → ✅ | ⛔ | ✅ | ✅ | ⛔ |
| carga partida (ready) | ✅ | ✅ | ⛔ → ✅ | ⛔ | ✅ | ✅ | ✅ |

**La matriz esperada sale de leer la 048, no de medirla.** El ensayo es la medición: una celda que no
coincida se para y se mira antes de aplicar. Las filas de ensayo son `is_training`, que la política de
lectura (083) deja ver a todos los roles, así que no debería salir «SIN FILAS». Si sale, es un dato que
no se interpreta como permiso.

---

## 6. Respaldo y reversión

**Antes de aplicar (obligatorio):** guardar la definición vigente, que es lo único que cambia:

```sql
select pg_get_functiondef('public.guard_delivery_stage'::regproc);
```

Mejor aún, un `pg_dump --schema=public --no-owner` en la carpeta de respaldos, si ya se toma para otra
cosa.

**Reversión en una sentencia:** volver a ejecutar el bloque `create or replace function
public.guard_delivery_stage()` de `048_driver_late_gps.sql` (§2 de este plan). Sin `drop` y sin tocar el
trigger. Las órdenes que office haya creado mientras tanto se quedan.

---

## 7. Fuera de alcance, dicho

- **`logistics` tiene `approve` en la app** (`ROLE_CAPS.logistics = ["route_plan", "approve"]`), y el
  guard tampoco le deja pasar `pending → approved`: la columna logistics de la matriz lo muestra.
  Visto al leer la 048, no se arregla aquí.
- **`driver` crea en la base, pero no en la app** (`ROLE_CAPS.driver = ["deliver"]`). Es anterior y no
  se toca.
- **Lo que office sigue sin tener y el gerente sí:** el panel, las notas privadas de órdenes ajenas
  (`OrderModal.tsx:1429`), las posiciones de los choferes (043) y los puntos manuales (105). Nada de eso
  va por este guard.
