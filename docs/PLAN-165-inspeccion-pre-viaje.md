# Plan 165 · La inspección pre-viaje del chofer (`vehicle_inspections`)

Plan en papel exigido por `CLAUDE.md` («Antes de tocar RLS, triggers o permisos en producción» — aquí es **una tabla, un
disparador, dos políticas y dos funciones nuevas**). Molde: `docs/PLAN-149-candado-compartido.md`.

**Estado (2026-10-11):** escrito por un worker en un worktree. **Nada se ha ejecutado contra producción.** El ensayo con
ROLLBACK de `scripts/db/aplica-migracion.mjs` pasó sus guardas (checksum del cuerpo, sin transacción propia) pero **no
pudo conectar**: `password authentication failed for user "postgres"` con el `SUPABASE_DB_URL` del `.env.local` de esta
PC (el traspaso del 2026-10-11 dice que la contraseña de la base se iba a rotar). En su lugar se ensayó en un **Postgres 17
local y desechable** (un clúster nuevo en la carpeta del worker, en su propio puerto), con un esquema mínimo copiado de las
migraciones del repo: `auth.uid()` leído de los claims, los roles `anon`/`authenticated` con los privilegios por defecto de
Supabase, `profiles`, `has_deliveries_access`, `current_user_role` y `clockin.companies/vehicles/employee_settings`.
**La migración y su autocomprobación corren, y la matriz de §6 da 29 de 29 `OK`** (con dos vehículos y con uno solo).
**Pendiente de aprobar.**

**Pedido del dueño (2026-10-11), literal:** *«AGREGA UN NUEVO VIEW QUE SE LLAMARA PRE TRIP INSPECTION CHECKLIST Y
INVESTIGAME ALGO PARA HACER UN FIRST DRAFT»*.

**La migración está escrita y NO aplicada:** `supabase/migrations/165_inspeccion_pre_viaje.sql`.

---

## 0 · Resumen

| | Sin la 165 | Con la 165 |
|---|---|---|
| El chofer abre «Inspección pre-viaje» | ve la lista entera y la puede recorrer; «Aún no se puede guardar» y **Enviar apagado** | la llena y la envía; hecha, se ve hecha con su hora |
| «Mi ruta» | sin aviso | «Haz tu inspección pre-viaje» hasta que haya una hoy (avisa, no bloquea) |
| Logística / admin | «Las inspecciones aún no se pueden guardar» | las del día, los defectos abiertos arriba, con su foto, y «Marcar corregido» |
| Vehículos para elegir | se escribe a mano | los activos de `clockin.vehicles`, con el asignado ya elegido |

## 1 · Decisiones (para validar)

1. **Una tabla con las respuestas en `jsonb`**, no una tabla de puntos: la lista vive en el código
   (`src/lib/inspeccion/puntos.ts`) y es un primer borrador. Cada fila guarda `checklist_version`.
2. **Una por chofer, por día y por vehículo**: índice único sobre `(driver_id, inspection_date, vehículo)`, donde el
   vehículo es su id o, escrito a mano, el texto sin mayúsculas ni espacios de más (la misma clave que
   `claveDeVehiculo`; una prueba compara las dos).
3. **Lo que no decide el teléfono lo pone la base** (disparador): quién (`auth.uid()`), su nombre (`profiles`), el día
   (hoy en `America/Chicago`), la hora y `repairs` vacío.
4. **Lee** el chofer las suyas; **leen todas** admin y logística (`ROLES_QUE_REVISAN`). **Inserta** cualquiera con el
   módulo de Entregas, solo a su nombre. **Nadie actualiza ni borra**: un reporte firmado no se edita, y 49 CFR 396.11
   pide guardarlo tres meses (aquí no se poda nada).
5. **Corregir un defecto es una función** (`marca_defecto_corregido`, `security definer`), no un UPDATE: solo admin y
   logística, solo sobre un punto que es «defecto», y la base sella quién y cuándo. Es lo único que cambia después de
   insertar, y solo toca `repairs`.
6. **Los vehículos por una función** (`vehiculos_para_inspeccion`): la RLS de Clock-in (`vehicles_read`) solo deja ver
   los vehículos a quien tiene ficha de fichaje en la compañía; un chofer sin ficha no vería ninguno. Devuelve solo
   `id, name, plate, assigned`. Sin ficha, usa la única compañía si hay una sola (la regla de la 079).
7. **Las fotos dentro del `jsonb`** (data URL comprimida por `PhotoUpload`), como `deliveries.photos`: sin cubo ni
   políticas de storage nuevas. Tope: 2 por defecto en la app, 4 MB por fila en la base.
8. **`safe` lo calcula la app** (`esSeguroParaSalir`) y se guarda tal cual: es el veredicto que el chofer firmó.
9. `driver_id` con `on delete set null`: borrar un usuario no borra sus reportes.

## 2 · Lo que cambia en la app (en el mismo commit; funciona con y sin la 165)

- `src/lib/inspeccion/almacen.ts` es **el único sitio** que lee y escribe: `leeInspecciones`, `guardaInspeccion`,
  `marcaCorregido`, `leeVehiculos`. Sin la tabla, `faltaLaTabla` (`PGRST205`/`42P01`) → `sin_tabla`; sin la función,
  `faltaLaFuncion` (`PGRST202`/`42883`) → el vehículo se escribe a mano.
- En el demo y en el modo práctica, el mismo contrato sobre `localStorage`.

## 3 · Inventario de lecturas y escrituras

| Quién | Qué | Cómo |
|---|---|---|
| Chofer (y quien tenga Entregas) | lee las suyas del día | `select * … where inspection_date = ? and driver_id = ?` |
| Chofer | guarda una | `insert … returning *` (el RETURNING pasa la política de lectura: es suya) |
| Admin, logística | leen las del día | `select * … where inspection_date = ?` |
| Admin, logística | corrigen / reabren | `rpc marca_defecto_corregido(p_inspeccion, p_punto, p_corregido, p_nota)` |
| Cualquiera con Entregas | vehículos | `rpc vehiculos_para_inspeccion()` |

## 4 · Qué NO debe romperse

- Ninguna otra tabla, política ni función cambia. `clockin.vehicles` solo se **lee** (por la función) y se referencia
  (FK `on delete set null`).
- La app sin aplicar la 165 (§0, columna izquierda).

## 5 · El SQL, literal

Ver `supabase/migrations/165_inspeccion_pre_viaje.sql`. La autocomprobación exige: RLS encendida; **2** políticas (select
e insert), ninguna `ALL`, `UPDATE` ni `DELETE`; `anon` sin SELECT/INSERT; `authenticated` con SELECT e INSERT y sin UPDATE,
DELETE, TRUNCATE, REFERENCES ni TRIGGER; el disparador y el índice único puestos; las dos funciones `security definer`,
ejecutables por `authenticated` y no por `anon`; el disparador no ejecutable por `authenticated`. Sin `begin`/`commit`
propios; sin el número de la decisión dentro. El checksum de su línea de registro lo comprueba
`src/lib/inspeccion/pantalla.test.ts` con los mismos guardas de `scripts/db/ledger.mjs`.

## 6 · Matriz de pruebas por rol, con ROLLBACK (la corre el orquestador)

**29 casos** en `docs/PLAN-165-matriz-por-rol.sql`. Crea sus filas dentro de la transacción (la tabla nace en ella) y
termina en `rollback`; **sin `commit` en ningún sitio**. Se sustituyen los `<UUID-…>` por perfiles reales (lo dice su
cabecera) y se corre desde la raíz del repo:

```bash
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f docs/PLAN-165-matriz-por-rol.sql
```

| Bloque | Quién | Qué comprueba |
|---|---|---|
| A1–A11 | chofer con ficha | vehículos (el asignado primero); la base firma quién, nombre, día y `repairs` aunque el cliente mande otros; la misma (chofer, día, vehículo) → 23505, también a mano con mayúsculas/espacios; lee solo las suyas; UPDATE y DELETE → 42501; marcar corregido → 42501; sin certificar o sin vehículo → 23514 |
| B1–B3 | chofer sin ficha | ve los vehículos (compañía única), ninguno asignado; no ve las de otro; inserta la suya |
| C1–C6 | logística | lee todas; marca corregido (sella quién, nombre, nota); algo que no es defecto → 22023; desmarca; inexistente → P0002; UPDATE directo → 42501 |
| D1 | admin | lee todas y marca |
| E1–E2, F1 | ventas, gerente | no ven ninguna; marcar → 42501 |
| G1–G3 | sin el módulo | no ve, no inserta, no lee vehículos |
| H1–H2 | anon | nada |

**Cada línea tiene que decir `OK`.** Si alguna dice `MAL`, parar: no aplicar.

## 7 · Mediciones de solo lectura (para el orquestador; NO corridas)

```sql
-- M1. Antes: que no exista ya.
select to_regclass('public.vehicle_inspections');
-- M2. Cuántos choferes con Entregas NO tienen ficha de fichaje (sin la función no verían ningún vehículo).
select count(*) filter (where es.id is null) as sin_ficha, count(*) as choferes
  from public.profiles p left join clockin.employee_settings es on es.id = p.id
 where p.role = 'driver' and 'deliveries' = any(coalesce(p.module_access, '{}'));
-- M3. Vehículos activos y compañías (la función usa la única compañía para quien no tiene ficha).
select (select count(*) from clockin.vehicles where active) as vehiculos_activos, (select count(*) from clockin.companies) as companias;
-- M4. Después: las políticas, literales.
select policyname, cmd, qual, with_check from pg_policies where schemaname = 'public' and tablename = 'vehicle_inspections' order by 1;
```

## 8 · Reversión

En una transacción propia (también al final del `.sql`). **Se pierden las inspecciones guardadas**: antes, un
`\copy (select * from public.vehicle_inspections) to 'inspecciones.csv' csv header`.

```sql
drop function if exists public.marca_defecto_corregido(uuid, text, boolean, text);
drop function if exists public.vehiculos_para_inspeccion();
drop table if exists public.vehicle_inspections;
drop function if exists public.vehicle_inspections_stamp();
delete from public.schema_migrations where name = '165_inspeccion_pre_viaje.sql';
```

La app no se rompe: vuelve a «aún no se puede guardar» y «Mi ruta» deja de avisar.

## 9 · Lo que NO se ha medido

- **Nada contra producción**: ni la migración, ni la matriz, ni M1–M4. El esquema de Supabase se imitó; la base real
  puede diferir en lo que el stub no copia (por ejemplo, otras políticas de `profiles` que afecten a las subconsultas de
  la matriz).
- Que PostgREST conteste `PGRST205` / `PGRST202` en esta versión de Supabase (es lo que ya lee `rutas-bloqueadas.ts`).
- El peso real de una fila con fotos de un teléfono (PhotoUpload: 1280 px, JPEG 0.7).
