# Plan — A-2a · RLS por fila en `public.profiles`

**Estado:** PLAN EN PAPEL. Nada aplicado. Espera revisión del dueño.
**Fecha:** 2026-09-03 · **Origen:** auditoría `docs/AUDIT-2026-09.md`, hallazgo A-2a (+ A-3).
**Prerrequisito de aplicación:** respaldo activo (F-3 está diferido), que aquí se cumple con un
`pg_dump` manual justo antes de aplicar (ver §7).

---

## El problema, en una línea

`public.profiles` tiene hoy dos políticas: `auth read profiles` (SELECT USING `true`) y
`auth write profiles` (**ALL** USING `true` CHECK `true`). O sea: cualquier autenticado puede
**editar y borrar la fila de cualquier otro**. Los `guard_*` protegen COLUMNAS de rol/acceso,
no la FILA — medido en la auditoría: un vendedor pudo cambiar el `full_name` y el `username`
de otro, y **borrar** su perfil (con cascada a 27 FKs: horas, nómina, capturas). Y por A-3,
un no-admin puede cambiar su **propia** columna `permissions`, que no tiene guard.

Este plan cierra las dos cosas a la vez, con RLS por fila **y** un guard para las columnas
privilegiadas que hoy quedan sin él (`permissions`, `store`, `username`).

---

## 1. Inventario de LECTURAS de `public.profiles`

Todas necesitan un SELECT amplio. Medido con `grep from("profiles").select` y por cliente:

| Quién lee | Para qué | Columnas | ¿Necesita amplio? |
|---|---|---|---|
| `data-provider.tsx:470` (deliveries) | lista de Usuarios del hub + choferes para asignar | id, full_name, username, role, store, permissions, avatar_url, recruiting_role, module_access, timetracker_role | **sí** |
| `(app)/layout.tsx:34` | el propio perfil, para capacidades y scoping | role, store, permissions, module_access, recruiting_role | sí (propio) |
| `recruiting-data-provider:216` | reclutadores (`recruiting_role not null`) | id, full_name, recruiting_role, role… | sí |
| `timetracker-data-provider:366` | empleados de TT (`timetracker_role not null`) | id, full_name, timetracker_role… | sí |
| `erp/requests/page.tsx:48` | nombres de quien pidió un producto | id, full_name (filtrado por ids) | sí |
| clock-in actions (`clock.ts`, etc.) | cuadrilla por empresa/tienda | id, full_name, role, store_id… | van por `clockin.profiles` (vista), **no** por `public.profiles` |

**Columna sensible que hoy leen todos:** `permissions` y `username`.
- `permissions` **no se puede restringir**: la propia app la lee para decidir capacidades
  (`hasCap`/`extraCaps`, `constants.ts:702-711`), y el diálogo de Usuarios (admin) las lee de
  todos. Restringirla rompería el gating de capacidades y el diálogo.
- `username` readable por todos es de bajo riesgo (es un handle de login, no un secreto).

**Decisión:** el **SELECT se queda amplio** (`USING true`) para no romper ninguna lista. El
residuo (todos leen `username`/`permissions`) se documenta como **A-2g**, un ítem aparte:
si se quiere cerrar, la vía es una **vista** para las listas de no-admin que omita esas dos
columnas — no un `REVOKE` de columna, que rompería el diálogo de admin (usa la clave anónima,
no service-role). **Fuera del alcance de este cambio.**

---

## 2. Inventario de ESCRITURAS a `public.profiles`

### 2a. Por cliente ligado a RLS (clave anónima)

| Sitio | Fila | Columnas | Hoy gateado por |
|---|---|---|---|
| `data-provider.tsx:1106-1213` (diálogo Usuarios) | **ajena** (`.eq("id", userId)`) | role, full_name, store, permissions, recruiting_role, module_access, timetracker_role | UI admin (RLS **no** lo exige — el bug) |
| `recruiting-data-provider:803` `updateUserName(userId)` | ajena o propia | full_name | UI (a verificar: ¿solo admin?) |
| `recruiting/settings/page.tsx:44` | **propia** (`.eq("id", me.id)`) | full_name | — |
| `timetracker-data-provider:687` | **propia** (`.eq("id", me.id)`) | full_name | — |

### 2b. Por service-role (SALTA RLS; gateado en la app)

| Ruta | Cliente | Gate de app | Escribe |
|---|---|---|---|
| `/api/invite` | `createAdminClient()` | `me.role === 'admin'` (403 si no) | store, full_name (alta) |
| `/api/user-identity` | `createAdminClient()` | `me.role === 'admin'` | username / email |
| `/api/delete-user` | `createAdminClient()` | `me.role === 'admin'` | **borra `auth.users`** → cascada |

**Ningún camino de cliente hace `DELETE` sobre `public.profiles`** (grep vacío). El borrado
real es service-role borrando `auth.users`, y `profiles_id_fkey ON DELETE CASCADE` se lleva la
fila. Por eso el DELETE desde cliente puede **prohibirse por completo** sin romper nada.

### 2c. Columnas que NUNCA se escriben desde app hoy

`avatar_url` y `active_session_id`: sin ningún `update` en `src` (latentes). `id`, `created_at`:
nunca. Se clasifican como **propias, no privilegiadas** para cuando vuelvan (§4).

---

## 3. Políticas propuestas (literales)

Helper coherente con los `guard_*` (que usan `current_user_role() = 'admin'`):

```sql
create or replace function public.is_admin()
  returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.current_user_role() = 'admin', false);
$$;
```

Reemplazo de las dos políticas actuales por cuatro, una por comando:

```sql
-- Fuera las dos de hoy (ALL USING true / SELECT USING true).
drop policy if exists "auth write profiles" on public.profiles;
drop policy if exists "auth read profiles"  on public.profiles;

-- LECTURA: amplia, como hoy. Las listas de los 4 módulos y el gating de capacidades
-- la necesitan (ver §1). El residuo username/permissions queda como A-2g.
create policy "profiles select" on public.profiles
  for select to authenticated
  using (true);

-- INSERT: solo la propia fila. El alta real la hace handle_new_user (SECURITY DEFINER,
-- salta RLS), asi que esto no la afecta; solo cierra el INSERT arbitrario de terceros.
create policy "profiles insert self" on public.profiles
  for insert to authenticated
  with check ((select auth.uid()) = id);

-- UPDATE: tu propia fila, o cualquiera si eres admin. Que columnas puede tocar un
-- no-admin de SU fila lo restringe el trigger de §4, no esta politica (RLS no filtra
-- por columna). Envuelto en (select ...) por rendimiento (patron de la 080).
create policy "profiles update self or admin" on public.profiles
  for update to authenticated
  using      ((select auth.uid()) = id or (select public.is_admin()))
  with check ((select auth.uid()) = id or (select public.is_admin()));

-- DELETE: NADIE desde cliente. El borrado va por service-role sobre auth.users (cascada).
-- Sin politica de DELETE, queda denegado para 'authenticated'.
```

**Por qué UPDATE no filtra columnas en la política:** una policy `WITH CHECK` ve la fila NEW
entera pero no "qué cambió"; distinguir "solo tocó full_name" de "también tocó role" es tarea
de un trigger. Es justo lo que ya hacen `guard_role_change` y familia. Se sigue ese patrón.

---

## 4. El hueco que RLS por fila NO cierra — columnas privilegiadas sin guard (A-3)

Con "fila propia editable", un no-admin puede tocar cualquier columna de **su** fila. Hay que
guardar las privilegiadas. Estado actual, medido:

| Columna | ¿Guard hoy? | Fuente |
|---|---|---|
| `role` | **sí** | `guard_role_change` |
| `recruiting_role` | **sí** | `guard_recruiting_access_change` |
| `module_access` | **sí** | los guards de recruiting/timetracker/clockin/erp disparan ante *cualquier* cambio de `module_access` de un no-admin |
| `timetracker_role` | **sí** | `guard_timetracker_access_change` + `guard_clockin_access_change` |
| **`permissions`** | **NO** | — (esto es A-3) |
| **`store`** | **NO** | — (decide el scoping por tienda) |
| **`username`** | **NO** | — (deriva el email de login; solo lo escribe `/api/invite`/`user-identity` como admin) |

Columnas **no privilegiadas** (un no-admin puede cambiarlas en su fila): `full_name`,
`avatar_url`, `active_session_id`. `id`, `created_at`: nadie las cambia.

**Propuesta — un guard NUEVO** (no se tocan los cuatro existentes; añadir es más seguro y es
el patrón que la auditoría aprobó):

```sql
create or replace function public.guard_profile_privileged_columns()
  returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Solo un admin cambia estas columnas. Un no-admin editando SU fila puede tocar
  -- full_name/avatar_url/active_session_id y nada mas. Mismo idioma que los guard_*.
  if coalesce(public.current_user_role(), 'sales') <> 'admin'
     and auth.uid() is not null
     and ( NEW.permissions is distinct from OLD.permissions
        or NEW.store       is distinct from OLD.store
        or NEW.username    is distinct from OLD.username ) then
    raise exception 'Only an admin can change permissions, store or username';
  end if;
  return NEW;
end $$;

drop trigger if exists profiles_guard_privileged on public.profiles;
create trigger profiles_guard_privileged
  before update on public.profiles
  for each row execute function public.guard_profile_privileged_columns();
```

Tras esto, **ninguna columna privilegiada de `public.profiles` queda sin guard**. Y como los
guards solo disparan para no-admin, el diálogo de Usuarios (admin, clave anónima) sigue
escribiendo todo sin cambio.

---

## 5. Lo que NO debe romperse — trazado contra las políticas

| Cosa | Cómo funciona | Contra el plan |
|---|---|---|
| `handle_new_user` (alta) | trigger en `auth.users`, **SECURITY DEFINER** → salta RLS | ✅ INSERT de RLS no lo afecta |
| `ensure_clockin_settings` | trigger `AFTER UPDATE OF timetracker_role`, SECURITY DEFINER, escribe `clockin.employee_settings` | ✅ no escribe `public.profiles` |
| "primer usuario = admin" | **no hay** código que lo imponga (solo un texto i18n); `handle_new_user` pone `role` del metadata o `sales` | ✅ nada que romper; si se hace manual, es admin → pasa |
| single-device (`active_session_id`) | **latente hoy** (ningún writer en `src`); si vuelve, escribe la propia fila | ✅ `id = auth.uid()` + columna no privilegiada → permitido |
| Diálogo Usuarios (admin edita a otros) | clave anónima, usuario admin | ✅ `is_admin()` → UPDATE de cualquier fila; guards no disparan para admin |
| Editar el propio nombre (TT, recruiting) | `.eq("id", me.id)` | ✅ `id = auth.uid()`, `full_name` no privilegiada |
| `updateUserName(userId)` recruiting | clave anónima | ⚠️ **verificar antes de aplicar** que solo se ofrece a admin; si un no-admin lo llama sobre otro id → ahora **bloqueado** (que es el arreglo). No hay columna privilegiada, así que no rompe guards, solo el alcance de fila |
| `/api/invite`, `/api/user-identity`, `/api/delete-user` | service-role, gate admin | ✅ saltan RLS; gate de app ≥ que el trigger que saltan |
| Listas de los 4 módulos | SELECT | ✅ SELECT sigue `USING true` |
| Capacidades (`hasCap`) | lee `me.permissions` | ✅ SELECT amplio; propio `permissions` legible |

**Único punto a confirmar con `grep`/lectura antes de aplicar:** que `updateUserName` (recruiting)
y cualquier `.update` de `full_name`/`store` sobre fila ajena esté detrás de UI de admin. Si
alguno fuera de un no-admin sobre otro, dejaría de funcionar — y ese es justo el comportamiento
que se quiere.

---

## 6. Matriz de pruebas — se escribe y se corre ANTES de aplicar

Contra producción, en una transacción con **`ROLLBACK`**, haciéndose pasar por cada rol
(`set local role authenticated` + su `sub`), como en D-053/D-057. **Ninguna prueba dispara
efectos de terceros** (regla nueva de CLAUDE.md): esto es solo SQL local.

Leyenda: ✅ permitido esperado · ⛔ bloqueado esperado.

| Acción \ Rol | sales | driver | warehouse | accounting | **admin** |
|---|---|---|---|---|---|
| SELECT su propia fila | ✅ | ✅ | ✅ | ✅ | ✅ |
| SELECT fila ajena | ✅ | ✅ | ✅ | ✅ | ✅ |
| UPDATE propio `full_name` (no priv.) | ✅ | ✅ | ✅ | ✅ | ✅ |
| UPDATE propio `permissions` (priv.) | ⛔ guard | ⛔ | ⛔ | ⛔ | ✅ |
| UPDATE propio `store` (priv.) | ⛔ guard | ⛔ | ⛔ | ⛔ | ✅ |
| UPDATE propio `username` (priv.) | ⛔ guard | ⛔ | ⛔ | ⛔ | ✅ |
| UPDATE propio `role` (priv.) | ⛔ guard viejo | ⛔ | ⛔ | ⛔ | ✅ |
| UPDATE propio `module_access` | ⛔ guard viejo | ⛔ | ⛔ | ⛔ | ✅ |
| UPDATE `full_name` de OTRO | ⛔ RLS | ⛔ | ⛔ | ⛔ | ✅ |
| UPDATE `role`/`permissions` de OTRO | ⛔ RLS | ⛔ | ⛔ | ⛔ | ✅ |
| DELETE su propia fila | ⛔ RLS | ⛔ | ⛔ | ⛔ | ⛔ (nadie; va por API) |
| DELETE fila de OTRO | ⛔ RLS | ⛔ | ⛔ | ⛔ | ⛔ |
| INSERT una fila arbitraria | ⛔ (salvo id propio) | ⛔ | ⛔ | ⛔ | ⛔ |

El script de la matriz se guarda como `scratchpad` y su salida se pega en el commit de
aplicación. Se corre **dos veces**: contra las políticas actuales (para ver el ✅ que hoy no
debería ser ✅) y contra las nuevas, para demostrar el antes/después.

---

## 7. Rollback y prerrequisito

**Prerrequisito de aplicación (obligatorio):**
1. **`pg_dump` manual** justo antes de aplicar, guardado en la carpeta permanente de respaldos:
   ```
   pg_dump "<cadena de conexión de producción>" \
     --schema=public --table=public.profiles --no-owner \
     -f "<carpeta-de-respaldos>/profiles-YYYY-MM-DD.sql"
   ```
   (Confirmar la ruta exacta de la carpeta de respaldos con el dueño; F-3 sigue diferido, así
   que este dump ES el respaldo de esta operación.)
2. La verificación de §5 (que ninguna escritura de fila ajena venga de un no-admin).

**Reversión en un comando** — restaurar las políticas de hoy tal cual estaban (capturadas
literalmente de `pg_policies` el 2026-09-03):

```sql
-- Deshacer el plan:
drop trigger if exists profiles_guard_privileged on public.profiles;
drop function if exists public.guard_profile_privileged_columns();
drop policy if exists "profiles select" on public.profiles;
drop policy if exists "profiles insert self" on public.profiles;
drop policy if exists "profiles update self or admin" on public.profiles;
-- (is_admin() puede quedarse; es inofensiva y la reusa A-2b/A-2c)

-- Restaurar el estado original:
create policy "auth read profiles"  on public.profiles for select using (true);
create policy "auth write profiles" on public.profiles for all using (true) with check (true);
```

---

## 8. Reusabilidad — A-2b (settings) y A-2c (order_events)

Son la misma familia ("solo la oficina escribe") y reusan `is_admin()` / el patrón de
partir `ALL` en políticas por comando. **No se aplican en este ítem** (cada uno es su propia
aprobación), pero el plan deja el helper y el molde listos:

```sql
-- A-2b · public.settings: leer amplio (la app lo necesita), escribir solo admin.
drop policy if exists "auth write settings" on public.settings;
create policy "settings select" on public.settings for select
  using ((select public.has_deliveries_access()));
create policy "settings write admin" on public.settings for all
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- A-2c · public.order_events: es historial. Leer e INSERTAR miembros; NUNCA update/delete.
drop policy if exists "auth write order_events" on public.order_events;
create policy "order_events select" on public.order_events for select
  using ((select public.has_deliveries_access()));
create policy "order_events insert"  on public.order_events for insert
  with check ((select public.has_deliveries_access()));
-- sin UPDATE ni DELETE -> el historial no se reescribe ni se borra desde cliente.
```

Mismo helper, mismo molde, sin rehacer nada.
