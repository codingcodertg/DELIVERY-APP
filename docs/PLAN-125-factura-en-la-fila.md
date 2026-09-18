# PLAN 125 — Ventas pone la factura que falta, desde la fila

> Plan en papel **antes** de tocar el guard, como pide `CLAUDE.md` («Antes de tocar RLS, triggers o
> permisos en producción»). La migración está escrita y **no aplicada**: la ensaya y la aplica el
> orquestador. Fecha: 2026-09-18.

## 1. El pedido

El dueño: *«en el table de órdenes las órdenes que no tengan invoice number tengan un distintivo… los de
sales no pueden editar, pero si les falta el invoice solo eso pueden ingresar, directo en la orden sin
abrirla, ahí en el table, que puedan ingresar el invoice number y guardar… un nuevo filtro al lado del
search bar que diga invoice pending»*.

## 2. Lo medido, y por qué hace falta la base

- **La pantalla sola no basta.** Medido por el orquestador en producción con `ROLLBACK` (2026-09-18): un
  vendedor actualizando **solo** `invoice_num` en **su** orden queda bloqueado en `approved`, `ready` y
  `delivered` — *«You cannot edit an order in the <stage> stage»*. Es la rama de «misma etapa» de
  `guard_delivery_stage`, que a `sales` solo le deja editar en `draft`, `pending` y `rejected`
  (`123_cuentas_con_aprobacion.sql:122-142`).
- **La definición vigente del guard es la 123.** `grep "function public.guard_delivery_stage"` sobre
  las migraciones: 009, 017, 019, 020, 042, 048, 118, 122 y 123 — la última manda, porque
  `create or replace` reemplaza entero. Comprobado con `diff` del cuerpo de la función entre la 123 y
  la 125: la única diferencia son las 14 líneas de la excepción. La 124 no está en `main`; leída desde su rama (333d0ef) no
  redefine el guard, y además el orquestador la revirtió en producción el 2026-09-18.
- **RLS de `deliveries`** (vigente, `083`): lectura por rol; escritura `auth write deliveries` con
  `has_deliveries_access()`. Un vendedor con Entregas pasa la RLS y llega al guard, que es quien decide.
  Esta migración **no toca ninguna política**.

## 3. Inventario: qué lee y escribe la excepción

| Qué | Dónde | Nota |
|---|---|---|
| `auth.uid()` | JWT de la petición | sin él el guard ya devuelve NEW (service role) |
| `current_user_role()` | `profiles.role` | ya lo leía el guard |
| `OLD.created_by`, `OLD.assigned_sales_rep` | `deliveries` | los dos `uuid` (`schema.sql:116`, `008:13`) |
| `OLD.invoice_num`, `NEW.invoice_num` | `deliveries` | `text` |
| `probe` | copia de `NEW` | patrón de la rama del chofer (048 → 123:126-135) |
| escribe | nada propio | solo deja pasar el `UPDATE` que llegó |

**Columnas automáticas.** Un solo trigger toca columnas en `UPDATE`: `deliveries_touch` →
`updated_at = now()` (`schema.sql:154-160`). Los `BEFORE` disparan por orden alfabético, y
`deliveries_guard_stage` va antes que `deliveries_touch`: el guard ve el `updated_at` viejo salvo que
el cliente lo mande, y no lo manda (`data-provider.tsx`, `.update(patch)`). Se excluye igualmente de la
comparación. No hay más triggers `BEFORE UPDATE` en `deliveries` (medido en `migrations/` y
`schema.sql`).

## 4. La excepción, literal

En la rama `if new_stage is not distinct from old_stage`, después de la línea de `sales`/`driver` en
draft/pending/rejected y **antes** del rechazo por etapa:

```sql
if r = 'sales'
   and old_stage not in ('draft','rejected','canceled')
   and (OLD.created_by = auth.uid() or OLD.assigned_sales_rep = auth.uid())
   and coalesce(btrim(OLD.invoice_num), '') = ''
   and coalesce(btrim(NEW.invoice_num), '') <> '' then
  probe := NEW;
  probe.invoice_num := OLD.invoice_num;
  probe.updated_at  := OLD.updated_at;
  if probe is not distinct from OLD then return NEW; end if;
end if;
```

Cada condición, y qué cierra:

- `r = 'sales'` — los demás roles no ganan nada: manager/office ya editan, chofer y almacén no deben.
- `old_stage not in (…)` — en draft y rejected ventas ya edita; una anulada no se toca.
- **dueño de la orden** — las que un vendedor ve en su tabla (`orderOwner` = `assigned_sales_rep ??
  created_by`). Se descartó «de su tienda o grupo»: esas órdenes ni aparecen en su lista, y el grupo
  vive en `settings.stores[*].group`, un JSON que el guard no debería leer para esto.
- **vacía → no vacía** — no sobrescribe una factura ya puesta, ni la vacía, ni la deja en espacios.
- **`probe`** — `invoice_num` es lo único que cambia. Con etapa distinta ni se entra en esta rama.

**Solo `invoice_num`, no «el documento de su tipo».** El documento que exige cada tipo está en
`settings.order_type_rules` con valores por defecto por palabra clave que hoy viven solo en TypeScript
(`orderTypeRule`, `required.ts:49`). Duplicarlos en SQL sería tener dos sitios decidiendo lo mismo.
`po2` y `estimate_num` los captura quien ya edita.

## 5. Qué NO debe romperse

- Todo lo de la 118 (office como gerente), la 122 (anular con motivo, invariantes antes de la salida de
  admin) y la 123 (cuentas con aprobación). El `.sql` lleva una **autocomprobación** que lee
  `pg_get_functiondef` tras aplicar y revienta si falta cualquiera de esas piezas o la excepción nueva.
- La rama del chofer (GPS tardío): intacta, va después de la excepción y usa su propio `probe`.
- El trigger `deliveries_guard_stage`: no se toca; la autocomprobación confirma que sigue colgado.
- Ninguna política RLS, ningún grant, ninguna columna, ningún dato.

## 6. Matriz de ensayo por rol, con `ROLLBACK`

Está escrita como comentario al final del `.sql`, con `pg_temp.intenta` (el mismo ayudante de la 123).
Resumen de lo que tiene que salir **después** de aplicar:

| # | Quién | Qué intenta | Resultado |
|---|---|---|---|
| 1 | vendedor | factura que falta en **su** orden `approved` | **PERMITIDO** |
| 1b | vendedor | lo mismo en `delivered` | **PERMITIDO** (donde están casi todas) |
| 1c | vendedor | lo mismo en `canceled` | BLOQUEADO |
| 2 | vendedor | cambiar una factura ya puesta | BLOQUEADO |
| 3 | vendedor | factura + otro campo (`delivery_fee`) | BLOQUEADO |
| 4 | vendedor | factura + cambio de etapa | BLOQUEADO (`sales cannot move…`) |
| 5 | vendedor | dejarla en espacios | BLOQUEADO |
| 6 | vendedor | la factura de una orden **ajena** | BLOQUEADO |
| 7 | vendedor | solo otro campo | BLOQUEADO |
| 8 | chofer | factura en su orden `picked_up` | BLOQUEADO (antes y después) |
| 9 | office | cambiar una factura ya puesta | PERMITIDO (antes y después) |

**Antes** de aplicar, los casos 1–7 salen todos BLOQUEADO: esa diferencia es el ensayo.

## 7. Orden de despliegue

**Migración primero, código después.** Es aditiva —solo permite algo más—: con la 125 aplicada y la
pantalla vieja no pasa nada; con la pantalla nueva y sin la 125, el vendedor vería un input que la base
le rechaza. `migrate-status` antes y después; respaldo activo o `pg_dump` reciente antes de aplicar.

## 8. Reversión

Re-ejecutar el bloque `create or replace function public.guard_delivery_stage()` de
`123_cuentas_con_aprobacion.sql`. Una sentencia, sin `drop`. No hay columnas ni datos que deshacer; las
facturas que un vendedor haya puesto mientras tanto se quedan, que son datos buenos.

## 9. Lo no verificado

- **Nada de esto se ha corrido.** Una rama no toca producción; la matriz la ensaya el orquestador.
- Que `authenticated` pueda llamar a una función de `pg_temp` creada por `postgres` en la misma sesión
  (misma duda que dejó escrita la 123). Si no, el cuerpo va en un `do $$…$$` por intento.
- El orden de disparo `deliveries_guard_stage` → `deliveries_touch` se dedujo del orden alfabético que
  documenta Postgres, no se midió en vivo. No importa para el resultado: `updated_at` se excluye igual.
