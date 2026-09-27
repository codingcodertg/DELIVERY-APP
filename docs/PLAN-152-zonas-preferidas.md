# Plan 152 · Zonas preferidas por chofer

Plan en papel exigido por `CLAUDE.md` («Antes de tocar RLS, triggers o permisos en producción»: aquí hay **esquema** —una
columna y un `check`— en una tabla con RLS). Molde: `docs/PLAN-151-requisitos-y-encuesta.md`.

**Estado (2026-09-27):** escrito por un worker en un worktree **sin `.env.local` y sin acceso a la base**. Todo sale de
**leer el repo** (`origin/main` = `42bf3f94`, D-420; migraciones hasta la 151 aplicadas según el orquestador) y de las
pruebas del repo. Nada se ha ejecutado contra producción: ni la migración, ni su autocomprobación, ni el ensayo de §6.
**Pendiente de aprobar.**

**Número:** 152, la siguiente libre (en `supabase/migrations/` la última es `151_requisitos_y_encuesta.sql`).

**Pedido del dueño (2026-09-27, T-0412):** *«ernesto is mcallen mission and julio is phar thats their preferences as well
as maximo is brownsville only if possible»*. Preguntado si es regla o preferencia: *«Preferencia, no regla»*.

**La migración está escrita y NO aplicada:** `supabase/migrations/152_zonas_preferidas.sql`.

---

## 0 · Resumen

| | Hoy | Con la 152 |
|---|---|---|
| `driver_settings.preferred_zones` | no existe | `text[] not null default '{}'`, check de forma (≤ 20, sin nulos, cada una con texto y ≤ 60) |
| `zonas_preferidas_validas(text[])` | no existe | función `sql immutable` que usa el check (un `check` no admite subconsultas) |
| Políticas de `driver_settings` (128) | 4, una por comando | **las mismas**: la columna nueva queda bajo ellas |
| Peso de la preferencia | — | `settings.route_weights.zona` (jsonb de la 130): **sin columna** |
| Filas existentes | — | leen `'{}'` por el defecto; **ningún `UPDATE`** |

## 1 · Decisiones (para validar)

1. **Zonas como nombres (`text[]`)**, como `features` (151), y no una tabla de ciudades con FK. La lista que ofrece Ajustes
   sale de los datos (ciudades de las direcciones de las órdenes y de las tiendas, más lo ya guardado); la app compara sin
   mayúsculas. Una ciudad que deja de salir en las órdenes no rompe nada: simplemente no la lleva ninguna entrega.
2. **Una zona es una ciudad de entrega**, la que ya enseña la columna «Ciudad de entrega» del Gestor (D-408,
   `ciudadDeEntrega(delivery_address)`). No hay columna de ciudad en `deliveries`, y no se añade: la base no cambia ahí.
3. **El peso no lleva columna**: vive en `settings.route_weights` como las opciones de reparto de D-415. El único check de
   esa columna (`settings_route_weights_is_object`, 130) sigue valiendo con una clave más.
4. **El check usa una función inmutable** porque mira cada elemento (texto no vacío, ≤ 60). Queda con los privilegios por
   defecto (`execute` para todos): no lee ninguna tabla, solo el array que recibe; y quien actualiza una fila tiene que poder
   ejecutarla. La autocomprobación la prueba con seis arrays.
5. **Quién edita las zonas**: los mismos que editan el resto de la fila (admin y logística, 128). Quién las lee: los mismos
   que leen la fila (admin, logística, gerente, office y almacén con acceso a Entregas). El chofer no.

## 2 · La pantalla y el uso (sin base, en el mismo commit)

- Ajustes → Motor de rutas → tabla de choferes: columna **«Zonas preferidas»** (chips con ✕ y un desplegable «+ zona» con las
  ciudades de los datos y cuántas órdenes van a cada una), **solo si la lectura trajo `preferred_zones`**. Sin la 152 dice
  «falta la actualización de la base» y no la manda al guardar. Peso **«5 · Zona preferida»** junto a los otros cuatro.
- «Planificar el día» y Auto-asignar (`/api/route-plan`, `/api/route-plan/reparto`) piden `preferred_zones` con
  `leeConOpcionales`: sin la columna (`42703`/`PGRST204` nombrándola), leen sin ella y el motor planifica sin zonas, **igual
  que hoy, byte a byte**.
- «📍 Mejor lugar» (Gestor) la lee con una consulta directa (`usa-zonas.ts`); si falla, no sugiere nada.

## 3 · Inventario de lecturas y escrituras que toca

| Pieza | Qué | Cambia |
|---|---|---|
| `driver_settings.preferred_zones` | columna + `check` `driver_settings_preferred_zones_shape` | nueva |
| `public.zonas_preferidas_validas(text[])` | función `language sql immutable`, `search_path = public` | nueva |
| Políticas y grants de `driver_settings` | — | **no se tocan** (la autocomprobación exige las 4 de la 128, ninguna `FOR ALL`, RLS puesta) |
| `settings`, `deliveries` | — | **no se tocan** |
| `/api/route-plan` (POST) y `/api/route-plan/reparto` | leen `driver_settings` con columnas enumeradas | piden `preferred_zones` **si existe** |
| Ajustes (`RouteEngineSettings`) | lee `driver_settings` enumerado; `upsert` de la fila | pide y manda `preferred_zones` **si existe** |
| Gestor, «Mejor lugar» (`usa-zonas.ts`) | `select("profile_id, preferred_zones")` | nuevo; si falla, nada |
| `deliveries` (lectura del motor) | columnas enumeradas | añade `delivery_address` (ya existía; es de donde sale la ciudad) |

## 4 · Qué NO debe romperse

- Guardar un chofer en Ajustes **antes** de aplicar la 152 (no se manda `preferred_zones`), y después.
- «Planificar el día», publicar (135) y Auto-asignar sin ninguna zona puesta: mismo plan que `motor-3`.
- Las lecturas de `driver_settings` de los roles que ya leen (gerente, office, almacén): una columna más, misma política.
- El chofer sigue sin leer `driver_settings` (128).

## 5 · El SQL, literal

Ver `152_zonas_preferidas.sql`. La autocomprobación (`do $chk$`) exige: la columna `text[]`, `NOT NULL`, defecto `'{}'`; el
check puesto; que la función acepte `{McAllen,Mission}` y `{}` y rechace un nulo, un texto en blanco, uno de 61 caracteres y
21 elementos; y que `driver_settings` siga con RLS, **4** políticas y ninguna `FOR ALL`.

Sin `begin`/`commit` propios. **Sin el número de la decisión dentro del `.sql`**: numerarla no cambia el checksum.
Checksum del registro: `a4decf34fd39ac75368c87fb2c1c205502a5b1e22e192c1206b6d052ab85fb52`
(`node scripts/db/migrate-status.mjs --sum 152_zonas_preferidas.sql`, 2026-09-27; una prueba del repo lo recalcula).

## 6 · Matriz de pruebas por rol, con ROLLBACK (la corre el orquestador)

**16 casos.** Crea su fila dentro de la transacción si hace falta; no deja nada.

Sustituir: `<UUID-ADMIN>` (`admin`), `<UUID-LOGISTICA>` (`logistics`), `<UUID-GERENTE>` (`manager`), `<UUID-OFFICE>`
(`accounting`), `<UUID-ALMACEN>` (`warehouse`), `<UUID-CHOFER>` (`driver`), `<UUID-VENTAS>` (`sales`); todos con acceso a
Entregas. `<TIENDA>`: una tienda de `settings.stores`.

Se pega entero en `psql` **desde la raíz del repo** (el `\i` es relativo). **Sin `commit` en ningún sitio.**

```sql
begin;

-- 0. La migración, dentro de la misma transacción (se deshace con el resto).
\i supabase/migrations/152_zonas_preferidas.sql

-- P. Lo que ya estaba lee '{}'.
do $$ declare n int; begin
  select count(*) into n from public.driver_settings where preferred_zones <> '{}';
  raise notice 'P1  filas existentes con zonas                       esperado 0: %', case when n = 0 then 'OK' else 'MAL '||n end;
end $$;

-- 1. Una fila del chofer de prueba, como postgres.
insert into public.driver_settings (profile_id, base_store) values ('<UUID-CHOFER>', '<TIENDA>') on conflict (profile_id) do nothing;

set local role authenticated;

-- 2. Quién ESCRIBE: admin y logística sí; los demás, cero filas.
set local request.jwt.claims to '{"sub":"<UUID-ADMIN>","role":"authenticated"}';
do $$ declare n int; begin
  update public.driver_settings set preferred_zones = '{Zona Uno,Zona Dos}' where profile_id = '<UUID-CHOFER>'; get diagnostics n = row_count;
  raise notice 'A1  admin pone dos zonas                              esperado 1: %', case when n = 1 then 'OK' else 'MAL '||n end;
end $$;
do $$ begin
  begin update public.driver_settings set preferred_zones = array['  ']::text[] where profile_id = '<UUID-CHOFER>';
    raise notice 'A2  zona en blanco                                    esperado ERROR: MAL, paso';
  exception when others then raise notice 'A2  esperado ERROR: %', case when sqlstate = '23514' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
  begin update public.driver_settings set preferred_zones = array['Zona Uno', null]::text[] where profile_id = '<UUID-CHOFER>';
    raise notice 'A3  un nulo                                           esperado ERROR: MAL, paso';
  exception when others then raise notice 'A3  esperado ERROR: %', case when sqlstate = '23514' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
  begin update public.driver_settings set preferred_zones = array_fill('z'::text, array[21]) where profile_id = '<UUID-CHOFER>';
    raise notice 'A4  21 zonas                                          esperado ERROR: MAL, paso';
  exception when others then raise notice 'A4  esperado ERROR: %', case when sqlstate = '23514' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
  begin update public.driver_settings set preferred_zones = array[repeat('x', 61)] where profile_id = '<UUID-CHOFER>';
    raise notice 'A5  61 caracteres                                     esperado ERROR: MAL, paso';
  exception when others then raise notice 'A5  esperado ERROR: %', case when sqlstate = '23514' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
end $$;
-- A6: el upsert que hace Ajustes (insert … on conflict do update), con zonas.
do $$ declare n int; begin
  insert into public.driver_settings (profile_id, base_store, preferred_zones) values ('<UUID-CHOFER>', '<TIENDA>', '{Zona Tres}')
    on conflict (profile_id) do update set preferred_zones = excluded.preferred_zones;
  select count(*) into n from public.driver_settings where profile_id = '<UUID-CHOFER>' and preferred_zones = '{Zona Tres}';
  raise notice 'A6  admin, upsert de Ajustes                          esperado 1: %', case when n = 1 then 'OK' else 'MAL '||n end;
end $$;

set local request.jwt.claims to '{"sub":"<UUID-LOGISTICA>","role":"authenticated"}';
do $$ declare n int; begin
  update public.driver_settings set preferred_zones = '{Zona Uno}' where profile_id = '<UUID-CHOFER>'; get diagnostics n = row_count;
  raise notice 'L1  logística cambia las zonas                        esperado 1: %', case when n = 1 then 'OK' else 'MAL '||n end;
end $$;

set local request.jwt.claims to '{"sub":"<UUID-GERENTE>","role":"authenticated"}';
do $$ declare n int; m int; begin
  select count(*) into m from public.driver_settings where profile_id = '<UUID-CHOFER>' and preferred_zones = '{Zona Uno}';
  update public.driver_settings set preferred_zones = '{}' where profile_id = '<UUID-CHOFER>'; get diagnostics n = row_count;
  raise notice 'G1  gerente LEE las zonas                             esperado 1: %', case when m = 1 then 'OK' else 'MAL '||m end;
  raise notice 'G2  gerente NO las cambia                             esperado 0: %', case when n = 0 then 'OK' else 'MAL '||n end;
end $$;

set local request.jwt.claims to '{"sub":"<UUID-OFFICE>","role":"authenticated"}';
do $$ declare n int; m int; begin
  select count(*) into m from public.driver_settings where profile_id = '<UUID-CHOFER>';
  update public.driver_settings set preferred_zones = '{}' where profile_id = '<UUID-CHOFER>'; get diagnostics n = row_count;
  raise notice 'O1  office lee la fila                                esperado 1: %', case when m = 1 then 'OK' else 'MAL '||m end;
  raise notice 'O2  office NO cambia las zonas                        esperado 0: %', case when n = 0 then 'OK' else 'MAL '||n end;
end $$;

set local request.jwt.claims to '{"sub":"<UUID-ALMACEN>","role":"authenticated"}';
do $$ declare n int; begin
  update public.driver_settings set preferred_zones = '{}' where profile_id = '<UUID-CHOFER>'; get diagnostics n = row_count;
  raise notice 'W1  almacén NO cambia las zonas                       esperado 0: %', case when n = 0 then 'OK' else 'MAL '||n end;
end $$;

set local request.jwt.claims to '{"sub":"<UUID-CHOFER>","role":"authenticated"}';
do $$ declare n int; m int; begin
  select count(*) into m from public.driver_settings;
  update public.driver_settings set preferred_zones = '{Zona Cuatro}' where profile_id = '<UUID-CHOFER>'; get diagnostics n = row_count;
  raise notice 'C1  el chofer NO lee driver_settings (128)            esperado 0: %', case when m = 0 then 'OK' else 'MAL '||m end;
  raise notice 'C2  el chofer NO se pone zonas                        esperado 0: %', case when n = 0 then 'OK' else 'MAL '||n end;
end $$;

set local request.jwt.claims to '{"sub":"<UUID-VENTAS>","role":"authenticated"}';
do $$ declare m int; begin
  select count(*) into m from public.driver_settings;
  raise notice 'V1  ventas NO lee driver_settings                     esperado 0: %', case when m = 0 then 'OK' else 'MAL '||m end;
end $$;

reset role;
-- R. Y lo que quedó, visto como postgres: la última escritura buena (L1).
do $$ declare n int; begin
  select count(*) into n from public.driver_settings where profile_id = '<UUID-CHOFER>' and preferred_zones = '{Zona Uno}';
  raise notice 'R1  quedó lo de logística                             esperado 1: %', case when n = 1 then 'OK' else 'MAL '||n end;
end $$;

rollback;
```

## 7 · Mediciones de solo lectura (para el orquestador; NO corridas)

```sql
-- M1. Antes de aplicar: que no exista ya con otra forma (una 152 a medias).
select column_name, data_type, is_nullable, column_default from information_schema.columns
 where table_schema = 'public' and table_name = 'driver_settings' and column_name = 'preferred_zones';
select to_regprocedure('public.zonas_preferidas_validas(text[])');

-- M2. Las ciudades que saldrían en Ajustes (la app las saca con ciudadDeEntrega; esto es solo para ver qué hay):
select delivery_address from public.deliveries where delivery_date >= current_date - 60 and delivery_address is not null limit 50;

-- M3. Después: todo vacío, recién aplicada.
select count(*) from public.driver_settings where preferred_zones <> '{}';
```

**Tras aplicarla**, el orquestador escribe las zonas que pidió el dueño (ver el informe del worker: los valores exactos van
con la grafía de la columna «Ciudad de entrega» que salga en M2 para McAllen, Mission, Pharr y Brownsville).

## 8 · Reversión

En una transacción propia, a mano (también comentada al final del `.sql`):

```sql
alter table public.driver_settings drop constraint if exists driver_settings_preferred_zones_shape;
alter table public.driver_settings drop column if exists preferred_zones;
drop function if exists public.zonas_preferidas_validas(text[]);
delete from public.schema_migrations where name = '152_zonas_preferidas.sql';
```

Se pierden las zonas puestas (respaldo antes, si interesan:
`create table driver_settings_zonas_backup as select profile_id, preferred_zones from public.driver_settings;`). **La app no
se rompe**: sin la columna no la pide ni la manda, y el motor planifica sin zonas. El peso guardado en
`route_weights.zona` puede quedarse: sin zonas no decide nada.

## 9 · Lo que NO se ha medido

- **Nada contra la base.** Ni la migración, ni su autocomprobación, ni la matriz. Las pruebas del repo
  (`src/lib/route-plan/zonas-en-el-plan.test.ts`, «la migración 152») comprueban el texto del `.sql` y el checksum.
- Que un `check` que llama a una función `sql` con `not exists (… unnest …)` se acepte y se evalúe como se espera en la
  versión de Postgres de producción. Es lo habitual (una función `immutable` puede llevar subconsultas; el `check` no mira
  dentro), pero no se ha ejecutado. Si fallara, la migración entera falla y no se aplica — lado seguro.
- Que la función quede ejecutable para `authenticated` con los privilegios por defecto de Supabase: la matriz (A1, L1) lo
  prueba; si fallara, el síntoma sería un error de permisos al guardar zonas, no un dato mal guardado.
- Los códigos con que PostgREST dice «la columna no existe» (`42703`/`PGRST204`) se midieron contra producción en
  D-412/D-415, no en esta rama.
