# Plan 147 · Prioridad por orden (baja, normal, alta, crítica)

Plan en papel exigido por `CLAUDE.md` («Antes de tocar RLS, triggers o permisos en producción» — aquí es el **esquema**).
Molde: `docs/PLAN-146-customer-siempre-con-factura.md`.

**Estado (2026-09-26):** escrito por un worker en un worktree **sin `.env.local` y sin acceso a la base**. Todo sale de
**leer el repo** (`origin/main` = `babacb86`, D-410) y de medir el **demo local**. Nada se ha ejecutado contra producción:
ni la migración, ni su autocomprobación, ni el ensayo de §6. **Pendiente de aprobar.**

**Pedido del dueño (2026-09-26):** comparando con OptimoRoute, prioridad por orden — *«las 3 haz»* (la base, la pantalla
y el uso en Auto-asignar). OptimoRoute tiene cuatro niveles, L / M / H / C (`docs/research-route-optimization.md`).

**La migración está escrita y NO aplicada:** `supabase/migrations/147_prioridad_de_la_orden.sql`. Trae **una columna y
una restricción**. No toca `guard_delivery_stage` (la 145 sigue siendo su última definición), ni
`guard_factura_obligatoria` (146), ni políticas, ni grants, ni datos.

---

## 0 · Resumen

| | Hoy | Con la 147 |
|---|---|---|
| `deliveries.priority` | no existe | `text not null default 'normal'`, check en `low / normal / high / critical` |
| Filas existentes | — | **leen `normal`** por el defecto; no hay ningún `UPDATE` |
| Quién la cambia | — | quien ya puede editar la orden en esa etapa (el guard no mira columnas en «misma etapa»); **sin tocar el guard** |
| Disparador de la 146 | — | no se entera: solo mira etapa, tipo y factura |
| La app antes de aplicar | — | no manda el campo (`laBaseTienePrioridad`) y no enseña el selector: nada falla |

## 1 · Decisiones (para validar)

1. **Texto con `check`, no un entero.** Lo leen personas: el orquestador en SQL, un `pg_dump`, el rastro `jsonb` de
   `deliveries_borradas` (142). `'critical'` se entiende solo; un `3`, no. El **orden** (crítica > alta > normal > baja)
   vive en un solo sitio, `src/lib/prioridad.ts` (`PRIORIDADES`, `rangoDePrioridad`), que es donde se ordena y se reparte;
   la base no ordena por esto. Un nivel nuevo es cambiar el `check` y esa lista.
2. **`NOT NULL` con defecto `'normal'`.** En Postgres 11+ una columna nueva con defecto constante **no reescribe** la
   tabla: las filas existentes leen `'normal'` sin que nadie las toque. Un `null` sería un quinto estado («sin decir») que
   la app tendría que tratar como normal en todas partes. La app ya lo hace por si acaso (`prioridadDe`), pero la base no
   lo admite.
3. **Quién la cambia: las mismas reglas que cualquier otro campo.** Leído en la 145 (tramo `new_stage is not distinct
   from old_stage`):

   | Rol | Puede editar la orden (y por tanto su prioridad) en | Fuente |
   |---|---|---|
   | ventas, chofer | `draft`, `pending`, `rejected` | 145:332 |
   | ventas en una ya hecha | **solo** poner la factura que falta (125) o agregar material (138): comparan la fila entera con una copia, así que cambiar la prioridad **no** pasa | 145:337-379 |
   | office (`accounting`), gerente (`manager`) | cualquier etapa | 145:393 |
   | almacén | `approved` → `delivered` | 145:394 |
   | logística | `draft` → `ready` | 145:397 |
   | admin | todo | 145:296 |

   La pantalla la edita con `salesFields` (ventas, office, gerente, admin, y quien crea), el mismo interruptor que el resto
   de campos de la ficha; lo que la pantalla no ofrece (almacén, logística) la base lo permitiría igual que cualquier otro
   campo. **No hace falta tocar el guard.** Si el dueño quiere que logística cambie la prioridad desde el Gestor, es
   pantalla sola: la base ya la deja hasta `ready`.
4. **Sin respaldo de datos: no se escribe ninguna fila.** Aun así, `CLAUDE.md` pide `pg_dump` o respaldo activo antes de
   tocar el esquema en producción: vale igual.

## 2 · La pantalla y el uso (sin base, en el mismo commit)

- **Ficha** (`OrderModal.tsx`): selector «Prioridad» (Crítica, Alta, Normal, Baja), Normal si la orden no dice nada, solo si
  la base ya tiene la columna. El guardado pasa por `conPrioridadSiCabe`: **sin la columna, la clave no viaja** — mandarla
  haría fallar el guardado de la orden entera (mismo patrón que `customer_type`, D-316).
- **Órdenes**: columna «Prioridad», elegible en ⚙ (nadie la tiene por defecto). Pastilla roja «‼ Crítica», ámbar «↑ Alta»;
  Baja en gris sin pastilla; Normal, nada. Ordena y filtra por «1 · Crítica … 4 · Baja».
- **Gestor**: la misma celda en «Sin asignar» (`priority`) y en paradas (`p_priority`), las dos escondidas por defecto.
- **Auto-asignar** (`autoAssign`, D-401): reparte en orden crítica → alta → normal → baja, y dentro de cada nivel como
  siempre (ventana más temprana, número). Con capacidad o ventanas justas, lo que se queda fuera es lo de menos prioridad.
  El aviso dice aparte «‼ N alta(s)/crítica(s) sin colocar».
- **Optimizar la ruta** (`/api/optimize-route`): Google `computeRoutes` con `optimizeWaypointOrder` y, sin llave, OSRM
  `trip`. **Ninguno de los dos admite prioridad ni penalización**: resuelven el orden de TODAS las paradas que se les dan.
  No se usa. El motor propio de «Planificar el día» (`route-engine`, D-320) sí tiene pesos (el de builder); meter la
  prioridad ahí es trabajo aparte y **no se hizo** (su lectura enumera columnas y pediría la 147 aplicada antes).

## 3 · Inventario de lecturas y escrituras que toca

| Pieza | Qué | Cambia |
|---|---|---|
| `public.deliveries.priority` | columna nueva | nueva |
| `deliveries_priority_allowed` | `check` | nueva |
| `guard_delivery_stage` (145), `guard_factura_obligatoria` (146) | la autocomprobación exige que no mencionen `priority` | **no se tocan** |
| Políticas de `deliveries`, `deliveries_borradas`, `order_events`, grants | — | **no se tocan** |
| `deliveries_borradas.fila` | `to_jsonb(OLD)` del borrado | lleva la prioridad sola (es `jsonb`, no columnas) |
| Rutas de `/api` que leen `deliveries` con columnas enumeradas (`route-plan`, …) | — | no se tocan: no la piden |
| Cliente: `select("*")` | la trae | — |

## 4 · Qué NO debe romperse

- Crear y editar órdenes **antes** de aplicar la 147 (la app no manda el campo).
- Todo lo de la matriz de la 145 y de la 146: ninguna escritura que hoy pasa deja de pasar por la columna nueva.
- Ventas poniendo la factura (125) y agregando material (138): la fila entera con la copia sigue siendo igual.
- Publicar la ruta (135), el cron de la 406, deshacer, borrar (142).

## 5 · El SQL, literal

Ver `147_prioridad_de_la_orden.sql`. La autocomprobación (`do $chk$`) exige: la columna `text`, `NOT NULL`, defecto
`'normal'`; la restricción con **exactamente** los cuatro valores; ninguna fila fuera de ellos; que el guard de etapas sea
el de la 145 (la rama del gerente) y **no** mencione `priority`; su disparador puesto; y, **si la 146 está aplicada**, que
`guard_factura_obligatoria` tampoco la mencione (si no está, deja un `NOTICE` y sigue: la 147 no depende de la 146). Mira
el código de las funciones **sin las líneas de comentario** (lección de la 144).

Sin `begin`/`commit` propios. **Sin `D-NEXT` dentro del `.sql`**: numerar la decisión no cambia el checksum del registro.

## 6 · Matriz de pruebas por rol, con ROLLBACK (la corre el orquestador)

**19 casos.** Crea sus órdenes dentro de la transacción; no depende de datos de producción ni los toca. Todas las
órdenes de prueba son `Transfer` (no piden factura: la 146, esté o no, no interviene), salvo F1, que es justo la de la
146.

Sustituir:

- `<UUID-VENTAS>` (`sales`), `<UUID-OFFICE>` (`accounting`), `<UUID-GERENTE>` (`manager`), `<UUID-ALMACEN>`
  (`warehouse`, con tienda), `<UUID-LOGISTICA>` (`logistics`), `<UUID-CHOFER>` (`driver`), `<UUID-ADMIN>` (`admin`).
- `<TIENDA>`: una tienda de `settings.stores` que **todos** vean (sin `visible_stores`, o con ella dentro) y que **no**
  apruebe sola. Las de almacén van a la tienda del almacenista; las del chofer, a su nombre.
- Si un caso sale `MAL 0 filas`, la lectura escondió la fila (RLS): revisar tienda y usuarios, no la regla.

Se pega entero en `psql` **desde la raíz del repo** (el `\i` es relativo). **Sin `commit` en ningún sitio.**

```sql
begin;

-- 0. La migración, dentro de la misma transacción (se deshace con el resto).
\i supabase/migrations/147_prioridad_de_la_orden.sql

-- P1. Las filas que YA estaban leen 'normal' (antes de insertar las de prueba).
do $$ declare n int; begin
  select count(*) into n from public.deliveries where priority <> 'normal';
  raise notice 'P1  filas existentes distintas de normal           esperado 0: %', case when n = 0 then 'OK' else 'MAL '||n end;
end $$;

-- 1. Datos de prueba, como postgres (auth.uid() null: los guards los dejan pasar sin mirar).
insert into public.deliveries (id, order_type, stage, store, pickup_name, account, created_by, est_pallets, invoice_num, assigned_driver) values
  ('14700000-0000-4000-8000-000000000001','Transfer','draft',    '<TIENDA>','<TIENDA>','ENSAYO 147','<UUID-VENTAS>',3,null,null),  -- V1
  ('14700000-0000-4000-8000-000000000002','Transfer','pending',  '<TIENDA>','<TIENDA>','ENSAYO 147','<UUID-VENTAS>',3,null,null),  -- V2
  ('14700000-0000-4000-8000-000000000003','Transfer','approved', '<TIENDA>','<TIENDA>','ENSAYO 147','<UUID-VENTAS>',3,null,null),  -- V3
  ('14700000-0000-4000-8000-000000000004','Customer','approved', '<TIENDA>','<TIENDA>','ENSAYO 147','<UUID-VENTAS>',3,null,null),  -- V4 (125)
  ('14700000-0000-4000-8000-000000000005','Transfer','delivered','<TIENDA>','<TIENDA>','ENSAYO 147',null,3,null,null),             -- O1
  ('14700000-0000-4000-8000-000000000006','Transfer','approved', '<TIENDA>','<TIENDA>','ENSAYO 147',null,3,null,null),             -- G1
  ('14700000-0000-4000-8000-000000000007','Transfer','approved', (select store from public.profiles where id='<UUID-ALMACEN>'),(select store from public.profiles where id='<UUID-ALMACEN>'),'ENSAYO 147',null,3,null,null), -- W1
  ('14700000-0000-4000-8000-000000000008','Transfer','pending',  (select store from public.profiles where id='<UUID-ALMACEN>'),(select store from public.profiles where id='<UUID-ALMACEN>'),'ENSAYO 147',null,3,null,null), -- W2
  ('14700000-0000-4000-8000-000000000009','Transfer','ready',    '<TIENDA>','<TIENDA>','ENSAYO 147',null,3,null,null),             -- L1
  ('14700000-0000-4000-8000-000000000010','Transfer','picked_up','<TIENDA>','<TIENDA>','ENSAYO 147',null,3,null,null),             -- L2
  ('14700000-0000-4000-8000-000000000011','Transfer','pending',  '<TIENDA>','<TIENDA>','ENSAYO 147',null,3,null,(select full_name from public.profiles where id='<UUID-CHOFER>')), -- D1
  ('14700000-0000-4000-8000-000000000012','Transfer','ready',    '<TIENDA>','<TIENDA>','ENSAYO 147',null,3,null,(select full_name from public.profiles where id='<UUID-CHOFER>')), -- D2
  ('14700000-0000-4000-8000-000000000013','Transfer','delivered','<TIENDA>','<TIENDA>','ENSAYO 147',null,3,null,null),             -- A1
  ('14700000-0000-4000-8000-000000000014','Customer','delivered','<TIENDA>','<TIENDA>','ENSAYO 147',null,3,null,null),             -- F1 (vieja sin factura)
  ('14700000-0000-4000-8000-000000000015','Transfer','approved', '<TIENDA>','<TIENDA>','ENSAYO 147',null,3,null,null);             -- C1, C2

set local role authenticated;

-- 2. VENTAS
set local request.jwt.claims to '{"sub":"<UUID-VENTAS>","role":"authenticated"}';
do $$ declare n int; p text; begin
  begin update public.deliveries set priority='high' where id='14700000-0000-4000-8000-000000000001'; get diagnostics n = row_count;
    raise notice 'V1  ventas: prioridad en SU borrador                esperado 1 fila: %', case when n=1 then 'OK' else 'MAL '||n||' filas' end;
  exception when others then raise notice 'V1  MAL: %', sqlerrm; end;
  begin update public.deliveries set priority='critical' where id='14700000-0000-4000-8000-000000000002'; get diagnostics n = row_count;
    raise notice 'V2  ventas: prioridad en SU pendiente               esperado 1 fila: %', case when n=1 then 'OK' else 'MAL '||n||' filas' end;
  exception when others then raise notice 'V2  MAL: %', sqlerrm; end;
  begin update public.deliveries set priority='critical' where id='14700000-0000-4000-8000-000000000003'; get diagnostics n = row_count;
    raise notice 'V3  ventas: prioridad en SU aprobada                esperado ERROR: MAL, % filas', n;
  exception when others then raise notice 'V3  esperado ERROR: %', case when sqlerrm like 'You cannot edit an order in the approved stage%' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
  begin update public.deliveries set invoice_num='ENS-V4' where id='14700000-0000-4000-8000-000000000004'; get diagnostics n = row_count;
    raise notice 'V4  ventas: pone la factura que falta (125, igual)  esperado 1 fila: %', case when n=1 then 'OK' else 'MAL '||n||' filas' end;
  exception when others then raise notice 'V4  MAL: %', sqlerrm; end;
  begin insert into public.deliveries (order_type, stage, store, pickup_name, account, est_pallets, priority) values ('Transfer','draft','<TIENDA>','<TIENDA>','ENSAYO 147',3,'critical') returning priority into p;
    raise notice 'I2  ventas: crea borrador CRÍTICA                   esperado critical: %', case when p='critical' then 'OK' else 'MAL '||coalesce(p,'null') end;
  exception when others then raise notice 'I2  MAL: %', sqlerrm; end;
end $$;

-- 3. OFFICE
set local request.jwt.claims to '{"sub":"<UUID-OFFICE>","role":"authenticated"}';
do $$ declare n int; p text; begin
  begin update public.deliveries set priority='low' where id='14700000-0000-4000-8000-000000000005'; get diagnostics n = row_count;
    raise notice 'O1  office: prioridad en una ENTREGADA              esperado 1 fila: %', case when n=1 then 'OK' else 'MAL '||n||' filas' end;
  exception when others then raise notice 'O1  MAL: %', sqlerrm; end;
  begin update public.deliveries set priority='urgente' where id='14700000-0000-4000-8000-000000000015';
    raise notice 'C1  office: un valor que no existe                  esperado ERROR: MAL, paso';
  exception when others then raise notice 'C1  esperado ERROR: %', case when sqlstate='23514' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
  begin update public.deliveries set priority=null where id='14700000-0000-4000-8000-000000000015';
    raise notice 'C2  office: prioridad NULL                          esperado ERROR: MAL, paso';
  exception when others then raise notice 'C2  esperado ERROR: %', case when sqlstate='23502' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
  begin insert into public.deliveries (order_type, stage, store, pickup_name, account, est_pallets) values ('Transfer','approved','<TIENDA>','<TIENDA>','ENSAYO 147',3) returning priority into p;
    raise notice 'I1  office: crea SIN decir prioridad                esperado normal: %', case when p='normal' then 'OK' else 'MAL '||coalesce(p,'null') end;
  exception when others then raise notice 'I1  MAL: %', sqlerrm; end;
  begin update public.deliveries set priority='high' where id='14700000-0000-4000-8000-000000000014'; get diagnostics n = row_count;
    raise notice 'F1  office: prioridad en Customer vieja SIN factura (146 no se entera) esperado 1 fila: %', case when n=1 then 'OK' else 'MAL '||n||' filas' end;
  exception when others then raise notice 'F1  MAL: %', sqlerrm; end;
end $$;

-- 4. GERENTE
set local request.jwt.claims to '{"sub":"<UUID-GERENTE>","role":"authenticated"}';
do $$ declare n int; begin
  begin update public.deliveries set priority='critical' where id='14700000-0000-4000-8000-000000000006'; get diagnostics n = row_count;
    raise notice 'G1  gerente: prioridad en una aprobada              esperado 1 fila: %', case when n=1 then 'OK' else 'MAL '||n||' filas' end;
  exception when others then raise notice 'G1  MAL: %', sqlerrm; end;
end $$;

-- 5. ALMACÉN
set local request.jwt.claims to '{"sub":"<UUID-ALMACEN>","role":"authenticated"}';
do $$ declare n int; begin
  begin update public.deliveries set priority='high' where id='14700000-0000-4000-8000-000000000007'; get diagnostics n = row_count;
    raise notice 'W1  almacén: prioridad en una aprobada              esperado 1 fila: %', case when n=1 then 'OK' else 'MAL '||n||' filas' end;
  exception when others then raise notice 'W1  MAL: %', sqlerrm; end;
  begin update public.deliveries set priority='high' where id='14700000-0000-4000-8000-000000000008'; get diagnostics n = row_count;
    raise notice 'W2  almacén: prioridad en una PENDIENTE             esperado ERROR (o 0 filas si no la ve): %', case when n=0 then 'OK (0 filas)' else 'MAL '||n||' filas' end;
  exception when others then raise notice 'W2  esperado ERROR: %', case when sqlerrm like 'You cannot edit an order in the pending stage%' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
end $$;

-- 6. LOGÍSTICA
set local request.jwt.claims to '{"sub":"<UUID-LOGISTICA>","role":"authenticated"}';
do $$ declare n int; begin
  begin update public.deliveries set priority='critical' where id='14700000-0000-4000-8000-000000000009'; get diagnostics n = row_count;
    raise notice 'L1  logística: prioridad en una lista (ready)       esperado 1 fila: %', case when n=1 then 'OK' else 'MAL '||n||' filas' end;
  exception when others then raise notice 'L1  MAL: %', sqlerrm; end;
  begin update public.deliveries set priority='critical' where id='14700000-0000-4000-8000-000000000010'; get diagnostics n = row_count;
    raise notice 'L2  logística: prioridad en una RECOGIDA            esperado ERROR: MAL, % filas', n;
  exception when others then raise notice 'L2  esperado ERROR: %', case when sqlerrm like 'You cannot edit an order in the picked_up stage%' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
end $$;

-- 7. CHOFER
set local request.jwt.claims to '{"sub":"<UUID-CHOFER>","role":"authenticated"}';
do $$ declare n int; begin
  begin update public.deliveries set priority='high' where id='14700000-0000-4000-8000-000000000011'; get diagnostics n = row_count;
    raise notice 'D1  chofer: prioridad en una pendiente suya         esperado 1 fila: %', case when n=1 then 'OK' else 'MAL '||n||' filas' end;
  exception when others then raise notice 'D1  MAL: %', sqlerrm; end;
  begin update public.deliveries set priority='high' where id='14700000-0000-4000-8000-000000000012'; get diagnostics n = row_count;
    raise notice 'D2  chofer: prioridad en una LISTA suya             esperado ERROR: MAL, % filas', n;
  exception when others then raise notice 'D2  esperado ERROR: %', case when sqlerrm like 'You cannot edit an order in the ready stage%' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
end $$;

-- 8. ADMIN
set local request.jwt.claims to '{"sub":"<UUID-ADMIN>","role":"authenticated"}';
do $$ declare n int; begin
  begin update public.deliveries set priority='critical' where id='14700000-0000-4000-8000-000000000013'; get diagnostics n = row_count;
    raise notice 'A1  admin: prioridad en una entregada               esperado 1 fila: %', case when n=1 then 'OK' else 'MAL '||n||' filas' end;
  exception when others then raise notice 'A1  MAL: %', sqlerrm; end;
end $$;

ROLLBACK;
```

**Resumen de lo que debe salir — 19 casos, cada línea tiene que decir `OK`:**

| Esperado | Casos | Cuántos |
|---|---|---|
| 0 filas distintas de normal | P1 | 1 |
| 1 fila / el valor pedido | V1, V2, V4, I2, O1, I1, F1, G1, W1, L1, D1, A1 | 12 |
| ERROR del guard (`You cannot edit an order in the … stage`) | V3, W2 (o 0 filas si la RLS no le deja ver la pendiente), L2, D2 | 4 |
| ERROR de la restricción (`23514`) / de `NOT NULL` (`23502`) | C1, C2 | 2 |

18 escrituras + P1 = **19**.

**Nada de la matriz cambia respecto de hoy salvo que la columna existe**: los cuatro ERROR del guard son las mismas reglas
que ya rechazan cualquier otro campo en esas etapas. **Recomendado:** correr los casos V3, L2 y D2 cambiando
`priority='…'` por `delivery_notes='ensayo'` y ver el **mismo** error: eso prueba que la prioridad sigue las reglas de
siempre.

**Si algún MAL no es de los esperados, parar**: no aplicar.

## 7 · Mediciones de solo lectura (para el orquestador; NO corridas)

```sql
-- M1. Antes de aplicar: que la columna no exista ya con otra forma (una 147 a medias).
select column_name, data_type, is_nullable, column_default from information_schema.columns
 where table_schema = 'public' and table_name = 'deliveries' and column_name = 'priority';

-- M2. Después: el reparto (todas normal, recién aplicada).
select priority, count(*) from public.deliveries group by 1 order by 1;

-- M3. La 146 aplicada o no (la autocomprobación de la 147 lo dice con un NOTICE si no).
select to_regprocedure('public.guard_factura_obligatoria()');
```

## 8 · Reversión

En una transacción propia, a mano (también comentada al final del `.sql`):

```sql
alter table public.deliveries drop constraint if exists deliveries_priority_allowed;
alter table public.deliveries drop column if exists priority;
delete from public.schema_migrations where name = '147_prioridad_de_la_orden.sql';
```

Se pierde la prioridad que se haya puesto. **La app no se rompe**: sin la columna, `laBaseTienePrioridad` da `false`, la
ficha deja de enseñar el selector y de mandar el campo, y todas las órdenes se leen como normal (la columna de la tabla
sale vacía, Auto-asignar vuelve a su orden de siempre).

## 9 · Lo que NO se ha medido

- **Nada contra la base.** Ni la migración, ni su autocomprobación, ni la matriz. Una prueba del repo
  (`src/lib/prioridad.test.ts`, «la 147») comprueba el texto del `.sql`, el checksum del registro y que los guards de la
  145 y la 146 no mencionan `priority`; no sustituye aplicarla.
- Que `pg_get_constraintdef` devuelva el `check` con cuatro `::text` (así lo escribe Postgres 15-17 para un `IN` de
  literales de texto): si alguna versión lo escribiera distinto, la autocomprobación fallaría **y no se aplicaría** — lado
  seguro, pero habría que ajustar esa línea.
- Las inserciones de la matriz (I1, I2) asumen que las políticas dejan insertar a office y ventas con esas columnas.
