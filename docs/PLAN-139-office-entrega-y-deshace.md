# Plan 139 · Office y gerente entregan de inmediato y deshacen un paso

Plan en papel exigido por `CLAUDE.md` («Antes de tocar RLS, triggers o permisos en producción»).
Aprobado por el dueño el 2026-09-22: *«quiero que office people puedan darle deliver a una orden de
inmediato y revertir stages si fue un error»* y, preguntado si incluía al gerente, *«si office
incluye al gerente»*.

**La migración de este plan está escrita y NO aplicada.** Aplicarla es del orquestador, después del
merge, con respaldo hecho y `migrate-status` antes y después.

## 1 · Inventario: qué lee y qué escribe

Un cambio de etapa es un `update public.deliveries set stage = ...`. Lo deciden dos sitios:

| Capa | Fichero | Qué decide |
|---|---|---|
| Cliente | `src/lib/constants.ts` → `LEGAL_TRANSITIONS` | qué saltos **existen** |
| Cliente | `src/lib/constants.ts` → `puedeEntregarYa`, `puedeDeshacer` | **quién** los ve (qué botón se pinta) |
| Base | `public.guard_delivery_stage()` (trigger `deliveries_guard_stage`) | quién los **puede hacer de verdad** |

La RLS de `deliveries` **no se toca**: quién ve y quién escribe una fila sigue igual (083, 131). Lo
único que cambia es qué transiciones de etapa acepta el guard para dos roles.

## 2 · La política literal que cambia

Dentro de la rama `if r in ('sales','driver','manager','accounting')`, en el sub-bloque
`if r in ('manager','accounting')`, se añaden dos condiciones:

```sql
if new_stage = 'delivered' and old_stage in ('approved','fulfilling','ready','picked_up') then return NEW; end if;
if (old_stage = 'delivered'  and new_stage = 'picked_up')
or (old_stage = 'picked_up'  and new_stage = 'ready')
or (old_stage = 'ready'      and new_stage = 'fulfilling')
or (old_stage = 'fulfilling' and new_stage = 'approved') then return NEW; end if;
```

Nada más. Se parte de la definición **vigente** (la de la 138, leída con `pg_get_functiondef`),
porque `create or replace` reemplaza la función entera y partir de una versión vieja borraría en
silencio lo de la 123, 125, 127 y 138.

## 3 · Qué NO debe romperse

1. **Ventas, chofer, almacén y logística: idénticos.** Ni un salto nuevo.
2. **Una entregada sigue sin poder anularse**, tampoco para el admin (invariante de la 122, que va
   **antes** de la salida de admin). El bloque de comprobación del `.sql` verifica que sigue ahí y
   que sigue estando antes.
3. **No se pierde nada de las migraciones anteriores**: 122, 123, 125, 127 y 138 se comprueban por
   texto sobre la definición resultante.
4. **El disparador sigue puesto** sobre `public.deliveries`.
5. **Dos pasos atrás de golpe siguen prohibidos**: `delivered → ready` falla.

## 4 · Matriz de pruebas con ROLLBACK

Los 12 casos están escritos al final del `.sql`, listos para pegar en una transacción abierta a
mano y cerrarla con `ROLLBACK`. Resumen: 4 casos de «entregar ya» (office, desde las cuatro
etapas), 4 de «deshacer» (gerente, los cuatro pasos), y 4 que **tienen que fallar** — ventas
entregando, ventas deshaciendo, office saltando dos pasos, y anular una entregada.

El bloque **no lleva `begin`/`commit` propios**, a propósito: un `commit` dentro cerraría la
transacción de fuera y el ensayo dejaría de serlo (pasó con la 124).

## 5 · SQL de reversión

Volver a aplicar `138_agregar_material.sql` tal cual. Reemplaza el guard entero por la definición
anterior a esta, que es exactamente lo que había. No hay columnas ni datos que revertir: esta
migración **no crea, no borra y no escribe ninguna fila**.

## 6 · Antes de aplicar

- `pg_dump` reciente guardado, o respaldo activo (regla de `CLAUDE.md`).
- `node scripts/db/migrate-status.mjs` antes y después; después tiene que decir «todo al día».
- Esta laptop **no tiene acceso a producción** (el clasificador de permisos lo niega), así que lo
  aplica el dueño o el orquestador desde la otra máquina.

## 7 · Lo que esta migración acepta a sabiendas

- Una orden entregada por office **no lleva firma ni GPS**. La app avisa de eso en el propio
  diálogo antes de confirmar, y el motivo obligatorio queda en `order_events`.
- Al deshacer una entregada, **lo que se firmó no se borra**: solo vuelve la etapa. Queda una orden
  en `picked_up` con POD, que es raro pero es el estado real y es reversible.
