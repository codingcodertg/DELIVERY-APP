# Plan 136 — `user_prefs`: las columnas de la tabla de órdenes, por usuario y no por navegador

> **Aprobado por el orquestador (2026-09-18), tal cual, con dos añadidos.** (1) La pregunta de §6: **ventas no se
> revierte** — `settings.sales_columns` sigue mandando para ventas. (2) Un caso más: durante una suplantación la sesión
> es la del suplantado, así que un admin dentro de otro usuario lee y escribe la fila de ESE usuario (correcto), y por
> eso **la pantalla no siembra mientras haya suplantación** — ni si no se sabe si la hay. Lo escrito es
> `supabase/migrations/136_user_prefs.sql`, con su matriz de ensayo (16 casos) y su reversión.

**Estado al escribirse: papel. Nada escrito en `supabase/migrations/`, nada aplicado.** Sigue el patrón de
`docs/PLAN-A-2a-profiles-rls.md`. Fecha: 2026-09-18. Pedido por el orquestador (incremento 10 del diseño, §8.3).

## 1. Qué se pide

Que la elección de columnas de la tabla de Órdenes sea **de la persona** —la misma en el teléfono, en el escritorio y
tras borrar el navegador—, sembrada desde lo que hoy tiene guardado en su navegador **para que nadie pierda su
elección**; y quitar «Factura #» de las columnas por defecto de ventas, chofer y almacén, porque la columna `#` ya la
enseña.

## 2. Lo medido, en el código

- **Dónde vive hoy:** `localStorage`, clave `rtg_order_columns_<rol>` (`src/app/(app)/page.tsx:30`), un arreglo JSON de
  claves de columna. Es **por navegador y por ROL**, no por persona: dos personas en el mismo equipo con el mismo rol
  comparten elección, y una persona con dos equipos tiene dos. Se lee en `page.tsx:127-132` y se escribe en `:137-141`.
- **Ventas NO elige** (`page.tsx:123-126`): su lista es una sola para toda la empresa, la pone un admin en Ajustes
  (`settings.sales_columns`, `types.ts:527-530`), y a ventas ni se le enseña el selector. **Es una decisión vigente y
  este plan NO la cambia** — ver §6. «Por usuario» aplica a todos los demás roles.
- **Los defectos por rol** (`constants.ts:683-691`): ventas `type, store, invoice, date, windows, account`; chofer
  `stage, type, store, account, invoice, date, windows, pallets`; almacén igual + `fee, driver`. Los demás roles, los de
  `OrdersTable.tsx:111` (con `so`, sin `invoice`).
- **Por qué sobra «Factura #» ahí:** `OrdersTable.tsx:371` fija `const byInvoice = true` — para TODOS, no solo para esos
  tres roles —, y con eso la columna fija `#` muestra `invoice_num` y, si falta, el número de orden (`:124`). El número
  sale dos veces en la misma fila. Ninguna página pasa `byInvoice` (grep: solo aparece dentro de `OrdersTable.tsx`), así
  que no hay una pantalla donde quitar la columna deje al usuario sin la factura.
- Otras pantallas que usan los defectos por rol: `driver/page.tsx`, `warehouse/page.tsx`, `settings/page.tsx`. Las dos
  primeras no tienen selector y leen el defecto directo: pierden la columna repetida y conservan el número en `#`.

## 3. La tabla (SQL literal propuesto)

> Forma acordada con el orquestador (2026-09-18): mi primer borrador era una fila por persona con un `jsonb` para todo.
> Queda **`(user_id, key)` con `value jsonb`**, para que sirva a más preferencias sin otra migración — pero con una lista
> corta de claves permitidas y un tope de tamaño, para que no sea un cajón donde cualquiera con sesión guarde lo que quiera.

```sql
create table if not exists public.user_prefs (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  -- Qué preferencia es. Lista CERRADA: añadir una es una migración de una línea, a propósito.
  key         text not null,
  -- Para `order_columns`: { "<rol>": ["stage", "type", …] } — por rol, porque un admin que cambia de papel (o el
  -- «ver como» del modo local) no quiere las columnas de almacén cuando mira como gerente.
  value       jsonb not null,
  updated_at  timestamptz not null default now(),
  primary key (user_id, key),
  constraint user_prefs_key_permitida check (key in ('order_columns')),
  -- Es una preferencia, no un almacén.
  constraint user_prefs_tamano check (pg_column_size(value) < 8192)
);

alter table public.user_prefs enable row level security;

-- En esta base una tabla nueva nace con todo concedido a anon y authenticated (medido en la 126).
revoke all on public.user_prefs from anon, authenticated;
grant select, insert, update on public.user_prefs to authenticated;      -- sin DELETE: una preferencia se sobrescribe

create policy "user_prefs select own" on public.user_prefs for select to authenticated
  using (user_id = (select auth.uid()));
create policy "user_prefs insert own" on public.user_prefs for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "user_prefs update own" on public.user_prefs for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
```

Más un disparador `before update` que pone `updated_at = now()` y **rechaza cambiar `user_id` o `key`** (el `with check`
ya impide «regalar» la fila a otro para `authenticated`; el disparador vale también para la llave de servicio).

**Decisiones de forma, y por qué:**
- **Tres políticas, una por comando; ninguna `ALL`.** `user_id` forzado a `auth.uid()` en el `with check` de insert Y de
  update: nadie escribe la fila de otro ni regala la suya. **El admin NO lee las de los demás:** no hace falta, y una
  política de admin sería la única forma de que esto filtrara algo.
- **Sin `has_deliveries_access()`:** es de la persona, no de Entregas; mañana guardará preferencias de otras apps del hub.
- **Lista cerrada de `key` + tope de 8 KB por valor.** Sin la lista, cualquier sesión tendría 8 KB × claves ilimitadas de
  almacenamiento arbitrario en la base.
- Con `(user_id, key)` dos pestañas que cambian preferencias DISTINTAS ya no se pisan; dos que cambian la MISMA, sí: gana
  la última. Para las columnas de una tabla es aceptable; se dice.
- Sin `begin/commit`; autocomprobación (RLS activa, 3 políticas y ninguna `ALL`, `anon` sin nada, `authenticated` sin
  `DELETE`, las dos restricciones, la clave primaria compuesta); `-- @ledger-below` con checksum; **sin el marcador de
  decisión en el `.sql`**.

## 4. El código

- `src/lib/user-prefs.ts` (puro + cliente): leer la fila propia de `key = 'order_columns'` al cargar; `columnasDe(prefs, rol, defecto)`;
  `conColumnas(prefs, rol, cols)`.
- **La siembra, que es el punto delicado.** Al cargar, **solo si NO hay fila** `order_columns` y el navegador tiene
  alguna `rtg_order_columns_<rol>`, se guarda eso en la base **una vez** (todas las claves de rol que haya en ese
  navegador). **Una vez sembrado, manda la base.** El `localStorage` **no se borra**: queda como red si
  la base no contesta, y como prueba de qué había. Si hay fila, manda la fila. Orden de lectura: base → localStorage →
  defecto del rol. **Nadie pierde su elección**, ni siquiera si la 136 aún no está aplicada: si la tabla no existe todo
  sigue funcionando con `localStorage` como hoy, sin error a la vista.
- **Lo que la siembra NO puede arreglar, dicho:** como hoy es por navegador-y-rol, si dos personas comparten equipo y
  rol, las dos heredan a su fila la elección común — que es lo que ya veían. Nadie pierde nada; tampoco se separan por
  arte de magia hasta que una de las dos cambie algo.
- **Quitar `invoice` de los tres defectos** (`constants.ts`). **No toca a quien ya eligió:** su elección guardada
  (en el navegador o, tras la siembra, en la base) manda sobre el defecto. Para ventas el defecto solo aplica si el
  admin no ha puesto `settings.sales_columns`; si lo puso con `invoice`, ahí sigue, y es suyo quitarlo.
- Guardar con `upsert` de la fila propia y **midiendo que escribió** (`.select("user_id")`: un UPDATE de cero filas no
  es un error en PostgREST). Si falla, la elección se queda en `localStorage` y en pantalla; no se pierde.
- El componente que guarda vive en la página de Órdenes (`(app)/page.tsx`), bajo el layout de `(app)`: no se monta nada
  en un sitio nuevo (D-321).

## 5. Qué NO debe romperse

- Ventas sigue sin selector y con la lista del admin (§6).
- Los anchos de columna (`OrdersTable`, otra clave de `localStorage`) no se tocan en este incremento.
- Quien hoy tiene `invoice` elegida a mano la conserva: solo cambian los DEFECTOS.

## 6. La decisión vigente que este plan respeta, y la pregunta

**Ventas no personaliza columnas**: una lista, puesta por un admin, igual para todos (`settings.sales_columns`). El
encargo dice «por usuario». Leído literal, contradice esa decisión. **Propongo NO revertirla**: `user_prefs` guarda la
elección de quien ya podía elegir (todos menos ventas), y ventas sigue como está. Si lo que se quiere es que ventas
también elija, es una decisión de negocio distinta —la razón original era que todos los vendedores vieran lo mismo— y
conviene que sea consciente, no un efecto de este cambio. **Es lo que pido que mires.**

## 7. Matriz de ensayo por rol, con `ROLLBACK`

| | Caso | Esperado |
|---|---|---|
| 1 | A inserta su fila; la lee | 1 fila |
| 2 | A lee con B ya con fila | **1 fila, la suya** — menos que el total (contar antes como postgres: 2) |
| 3 | A inserta una fila con `user_id` de B | BLOQUEADO (RLS) |
| 4 | A actualiza la fila de B | 0 filas |
| 5 | A cambia `user_id` de su fila al de B | BLOQUEADO (with check; y el disparador con service role) |
| 6 | A borra su fila | permiso denegado (sin grant de DELETE) |
| 7 | admin lee la fila de A | 0 filas: tampoco un admin |
| 8 | `anon` select / insert | permiso denegado |
| 9 | `key` = `'lo_que_sea'` | BLOQUEADO (lista cerrada de claves) |
| 10 | `value` de 20 KB | BLOQUEADO (check de tamaño) |
| 10b | A cambia la `key` de su fila | BLOQUEADO (disparador) |
| 11 | borrar el perfil de A | su fila se va en cascada; no bloquea el borrado |
| 12 | re-aplicar la 136 | sin error; `pg_policies` de la tabla: 3, ninguna `ALL` |

## 8. Reversión

```sql
drop table if exists public.user_prefs;
```

Borra las elecciones guardadas en la base. **Nadie pierde nada visible**: el `localStorage` no se borró nunca, y el
código cae a él si la tabla no existe.

## 9. Lo que este plan NO cubre, dicho

- Anchos de columna, idioma, tema y demás preferencias: la tabla está pensada para recibirlas, pero este incremento
  guarda solo las columnas de Órdenes.
- Dos pestañas cambiando la MISMA preferencia a la vez: gana la última (§3).
- Nada de esto ha corrido. En particular `pg_column_size` sobre un `jsonb` como tope de tamaño está leído en la
  documentación, no ejecutado; y con qué código contesta PostgREST a una tabla que no existe tampoco está medido contra
  esta base (el de función inexistente, `PGRST202`, sí lo midió el orquestador en D-324) — por eso el código no
  dependerá del código de error: cualquier fallo al leer la fila cae a `localStorage`.
