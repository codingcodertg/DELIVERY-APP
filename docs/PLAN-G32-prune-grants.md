# Plan — G-32: cerrar la ejecución pública de `prune_driver_locations`

**Fecha:** 2026-09-05 · **Origen:** hallazgo del auditor al preparar G-23 (no estaba en
`docs/AUDIT-2026-09-05.md`; se añade como **G-32 · P1 · Clase A**) · **Estado:** plan en
papel, pendiente de aprobación · **Decisión:** `D-NEXT` al aplicar

## 1. Lo medido (solo lectura, `pg_proc` en producción, 2026-09-05)

`public.prune_driver_locations(keep_days int default 30)` (migración 043:59) es
**`security definer`** y su ACL es la de fábrica:
`{=X/postgres, anon=X, authenticated=X, service_role=X}`.
`has_function_privilege`: **anon → true, authenticated → true**, service_role → true.
PostgREST expone las funciones de `public` como `rpc`. Es decir: **con la clave anon
que viaja en la app, cualquiera puede llamar `rpc("prune_driver_locations",
{ keep_days: 0 })` y vaciar los recorridos de los choferes**, sin respaldo (F-3).

Hoy la tabla tiene **92 filas** (desde 2026-08-14). El daño posible es pequeño; la
exposición no lo es, y crece con la tabla. El repo ya conoce el patrón: 077 y 078
revocan EXECUTE a `public`/`anon` en otras funciones definer. Esta se quedó fuera.

## 2. El cambio (migración `103_prune_driver_locations_grants.sql`)

```sql
revoke execute on function public.prune_driver_locations(int) from public, anon, authenticated;
grant  execute on function public.prune_driver_locations(int) to service_role;
```

No toca datos. No toca RLS de la tabla. La poda programada (G-23, lote 2) la llama
el cron **con service_role**, así que sigue funcionando.

## 3. Reversión

```sql
grant execute on function public.prune_driver_locations(int) to anon, authenticated;
```

## 4. Respaldo

`C:\Users\andre\Documents\CLAUDE\RESPALDOS-DB\driver_locations-2026-09-05.json` (las 92
filas, exportadas antes de aplicar). El cambio no borra nada, pero la regla de
CLAUDE.md pide respaldo antes de tocar permisos, y este es el único objeto afectado.

## 5. Matriz de pruebas (con la conexión directa, sin ejecutar la poda)

| Rol | Antes | Después esperado |
|---|---|---|
| anon | EXECUTE true | **false** |
| authenticated | EXECUTE true | **false** |
| service_role | EXECUTE true | true |

Se mide con `has_function_privilege` antes y después, en la misma transacción que
el cambio, y se hace `ROLLBACK` si algo no cuadra. Nadie ejecuta la función.

## 6. Registro

Bloque `-- @ledger-below` con el checksum de `migrate-status.mjs --sum`; estado
"todo al día" antes y después.
