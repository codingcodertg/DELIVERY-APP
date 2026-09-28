# Plan 153 · El estimado de la competencia en el Estimador

Plan en papel exigido por `CLAUDE.md` («Antes de tocar RLS, triggers o permisos en producción»: aquí hay una **tabla nueva
con RLS**, un **disparador**, dos **funciones definer**, un **cubo de Storage** y **tres políticas de `storage.objects`**).
Molde: `docs/PLAN-152-zonas-preferidas.md`.

**Estado (2026-09-27):** escrito por un worker en un worktree **sin `.env.local` y sin acceso a la base**. Todo sale de
**leer el repo** (`origin/main` = `54d67d61`, D-424; la 148 del Estimador y hasta la 152 aplicadas según el orquestador)
y de las pruebas del repo. Nada se ha ejecutado contra producción: ni la migración, ni su autocomprobación, ni el ensayo
de §6. **Pendiente de aprobar.**

**Número:** 153, la siguiente libre (en `supabase/migrations/` de `origin/main` la última es `152_zonas_preferidas.sql`).
Si otra rama fusiona antes una 153, esta se renumera al fusionar (y se vuelve a sellar su checksum).

**Pedido del dueño (2026-09-27, hija de T-0408):** *«en el estimador app deja que se pueda subir el competitors estimate
upload option»*.

**La migración está escrita y NO aplicada:** `supabase/migrations/153_estimados_competencia.sql`.

---

## 0 · Resumen

| | Hoy | Con la 153 |
|---|---|---|
| Cubo `estimator-competitor-files` | no existe | **privado**, 10 MB por archivo, 6 tipos (PDF, JPEG, PNG, WEBP, HEIC, HEIF) |
| `public.estimator_competitor_files` | no existe | una fila por archivo: cotización, ruta, nombre, tipo, tamaño, quién/cuándo, y opcionales (competidor, su total, nota) |
| Quién **ve** | — | quien ve la cotización (la RLS de `estimator_quotes`, 148, por subconsulta: dueño, su tienda, aprobado, admin) |
| Quién **sube** | — | quien la **edita** según D-413: dueño, aprobado, admin (la tienda **no** basta) |
| Quién **quita** | — | quien lo subió, o el admin |
| Editar lo opcional después | — | **no** (sin `UPDATE`): se escribe al subir |
| Techo | — | 5 archivos por cotización, en la tabla **y** en el cubo (= 50 MB por estimado como mucho) |
| Tablas y políticas existentes | — | **ninguna se toca**; ningún dato |

## 1 · Decisiones (para validar)

1. **10 MB por archivo.** Es el número de `help-files` (119). Una foto de móvil pesa 2-5 MB, un PDF de estimado impreso
   menos de 1 MB; 10 da margen a un escaneo de varias páginas y deja fuera vídeos. **Y 5 por cotización**, que es lo que
   de verdad acota la cuota: el 2026-09-25 producción cayó por cuota. En `DECISIONS.md` solo consta la frase de D-403
   («producción estaba caída por cuota el 2026-09-25»); que fuera el cubo `timetracker-screenshots` llenando el plan de
   Storage lo dice el encargo del orquestador, **no lo medí yo**. Un techo por carpeta no lo puede saltar nadie, tampoco
   subiendo sin pasar por la pantalla.
2. **La primera carpeta de la ruta es el `quote_id`** (`<quote_id>/<sello>-<azar>-<nombre saneado>`). Las políticas del cubo
   viven de eso, igual que las de `help-files` viven de `<user_id>/…`.
3. **«Ve quien ve la cotización» por subconsulta, no copiando la regla.** `exists (select 1 from estimator_quotes q where
   q.id = quote_id)` corre con la sesión de quien pregunta, así que pasa por la RLS de la 148. Si mañana cambia quién ve una
   cotización, los archivos siguen la misma regla sin tocar esta migración.
4. **Subir = editar la cotización** (la política de `UPDATE` de la 148). Un compañero de tienda que la ve **no** sube: para
   eso está la aprobación. Esto va en una función definer `estimator_can_attach(text)` porque la usan la tabla y el cubo.
5. **Quitar del cubo por `owner_id`** del objeto (lo pone Storage con la sesión al subir) o admin; **de la tabla por
   `uploaded_by`** o admin. La app quita primero el archivo y luego la fila: al revés, un fallo dejaría un archivo invisible
   gastando cuota.
6. **El disparador toma tamaño y tipo del objeto real** (`storage.objects.metadata`), no de lo que dice el navegador, y
   exige que el objeto exista: una fila sin archivo sería una lista que miente.
7. **`uploaded_by_name` copiado** al subir, porque leer el nombre de otro perfil depende de la RLS de `profiles`.
8. **Sin `UPDATE`.** Lo opcional (competidor, total, nota) se escribe al subir. Si hace falta corregirlo, se quita y se
   sube otra vez. Es una política y un grant más si se quiere.

## 2 · La pantalla (sin base, en el mismo commit)

- Sección **«🕵️ Competitor's estimate / Estimado de la competencia»** en `/estimator`, entre «Entrega» y «Copia del
  cliente», con el aviso «Interno — nunca sale en la copia del cliente».
- **Sin cotización guardada** (no se ha buscado y guardado el estimado, o es de otro sin aprobación): no deja subir y lo dice.
- **Sin la 153** (`PGRST205` en la tabla o «Bucket not found» en el cubo) o **sin la 148**: la sección se ve apagada con
  «falta actualizar la base (migración 153)» y el resto del Estimador funciona igual.
- Abrir: enlace firmado de **60 s** (`createSignedUrl`), en pestaña nueva.
- **Nunca en la hoja impresa**: `HojaCliente` solo recibe `HojaDelCliente`, que no lleva nada de esto; y `@media print`
  además la quita con `display: none`. Prueba explícita en `src/lib/estimator/competencia.test.ts`.
- Demo (`NEXT_PUBLIC_LOCAL_MODE`): en memoria, abrir da un `blob:`; `?sinTabla=1` imita la base sin la 153.

## 3 · Inventario de lecturas y escrituras que toca

| Pieza | Qué | Cambia |
|---|---|---|
| `storage.buckets` | fila `estimator-competitor-files` (`on conflict do update` de `public`, límite y tipos) | nueva |
| `public.estimator_competitor_files` | tabla + índice por `quote_id` + `unique (path)` + 7 `check` | nueva |
| `public.estimator_competitor_object_count(text)` | `sql stable security definer`: cuenta objetos de la carpeta | nueva |
| `public.estimator_can_attach(text)` | `sql stable security definer`: módulo + (admin, dueño o aprobado) | nueva |
| `public.estimator_competitor_files_guard()` + disparador `BEFORE INSERT` | ruta, objeto real, techo de 5, quién y cuándo | nueva |
| Políticas de la tabla | `select`, `insert`, `delete` (ninguna `ALL` ni `UPDATE`) | nuevas |
| Políticas de `storage.objects` | `estimator competitor files read / insert / delete` | nuevas |
| `estimator_quotes`, `estimator_approvals`, sus políticas y helpers (148) | se **leen** desde las nuevas | **no se tocan** |
| `/estimator` (cliente) | `select` / `insert` / `delete` de la tabla; `upload` / `createSignedUrl` / `remove` del cubo | nuevo |

## 4 · Qué NO debe romperse

- Todo el Estimador de la 148: buscar, guardar, aprobar, imprimir. Esta migración no toca ninguna de sus piezas.
- Los otros cubos (`help-files`, `resumes`, `hr-docs`, `exception-photos`, `timetracker-screenshots`, `po-docs`): sus
  políticas son por `bucket_id`; las nuevas también, y todas llevan `bucket_id = 'estimator-competitor-files'`.
- **Aviso:** la autocomprobación de la **148** exige que ninguna tabla `estimator\_%` tenga política `DELETE`. Esta tiene
  una. Solo importa si alguien re-ejecuta la 148 entera a mano después de aplicar la 153.

## 5 · El SQL, literal

Ver `153_estimados_competencia.sql`. La autocomprobación (`do $comprueba$`) exige: el cubo privado con 10485760 y
exactamente los 6 tipos; la tabla con RLS, sin `select` para `anon` ni `update` para `authenticated`; **3** políticas en la
tabla y ninguna `ALL`/`UPDATE`; **3** políticas del cubo en `storage.objects`; el disparador colgado; y que
`storage.objects.owner_id` exista (la política de DELETE del cubo lo usa).

Sin `begin`/`commit` propios. Sin número de decisión dentro del `.sql` (numerarla no cambia el checksum).
Checksum del registro: `e96016bc1a36f8559fa6e21a57c90a35021c90a6329a188786e13b840df0fda0`
(`node scripts/db/migrate-status.mjs --sum 153_estimados_competencia.sql`, 2026-09-27; una prueba del repo lo recalcula).

## 6 · Matriz de pruebas por rol, con ROLLBACK (la corre el orquestador)

**24 casos.** Crea sus cotizaciones y objetos dentro de la transacción; no deja nada. Los objetos de `storage.objects` se
insertan **como filas** (sin archivo detrás) solo dentro de esta transacción, para ensayar políticas y disparador: el
`rollback` los quita y nunca llegan al almacenamiento.

Sustituir: `<UUID-ADMIN>` (`admin`), `<UUID-DUENO>` y `<UUID-TIENDA>` (dos vendedores **con** `estimator` en
`module_access` y la **misma** `store`), `<UUID-APROBADO>` (vendedor con `estimator`, **otra** tienda), `<UUID-AJENO>`
(vendedor con `estimator`, otra tienda, sin aprobación), `<UUID-SIN-MODULO>` (sin `estimator`, no admin).

Se pega entero en `psql` **desde la raíz del repo** (el `\i` es relativo). **Sin `commit` en ningún sitio.**

> **Nota del orquestador (2026-09-27, al ensayarla):** Supabase bloquea el `delete` directo en `storage.objects`
> (`storage.protect_delete`: *«Direct deletion from storage tables is not allowed»*) salvo con
> `storage.allow_delete_query = true`, que es lo que hace el Storage API al borrar. Para que los casos de borrado prueben
> las políticas, antes de la matriz y dentro de la misma transacción: `set local storage.allow_delete_query = 'true';`.
> Así se ensayó: 24/24 OK con ROLLBACK. Los vendedores de prueba no tenían el módulo: se les dio dentro de la transacción.

```sql
begin;

-- 0. La migración, dentro de la misma transacción (se deshace con el resto).
\i supabase/migrations/153_estimados_competencia.sql

-- 1. Una cotización del dueño y la aprobación del aprobado, como postgres (auth.uid() nulo: el disparador de la 148 no reescribe).
insert into public.estimator_quotes (id, estimate_num, owner_id, store)
  select '00000000-0000-4000-8000-000000000153', 'ENSAYO-153', '<UUID-DUENO>', store from public.profiles where id = '<UUID-DUENO>';
insert into public.estimator_approvals (quote_id, requested_by, status)
  values ('00000000-0000-4000-8000-000000000153', '<UUID-APROBADO>', 'approved');

set local role authenticated;

-- 2. El DUEÑO sube: el objeto (lo que haría Storage) y la fila.
set local request.jwt.claims to '{"sub":"<UUID-DUENO>","role":"authenticated"}';
do $$ declare n int; begin
  insert into storage.objects (bucket_id, name, owner_id, metadata)
    values ('estimator-competitor-files', '00000000-0000-4000-8000-000000000153/a.pdf', '<UUID-DUENO>', '{"size": 2048, "mimetype": "application/pdf"}');
  insert into public.estimator_competitor_files (quote_id, path, file_name, mime_type, size_bytes, competitor, competitor_total)
    values ('00000000-0000-4000-8000-000000000153', '00000000-0000-4000-8000-000000000153/a.pdf', 'a.pdf', 'image/png', 1, 'Rival', 1999.50);
  select count(*) into n from public.estimator_competitor_files
   where path like '00000000-0000-4000-8000-000000000153/%' and uploaded_by = '<UUID-DUENO>' and size_bytes = 2048 and mime_type = 'application/pdf';
  raise notice 'D1  dueño sube; tamaño y tipo del objeto real       esperado 1: %', case when n = 1 then 'OK' else 'MAL '||n end;
end $$;
do $$ begin
  begin insert into public.estimator_competitor_files (quote_id, path, file_name, mime_type, size_bytes)
          values ('00000000-0000-4000-8000-000000000153', '00000000-0000-4000-8000-000000000153/no-existe.pdf', 'x.pdf', 'application/pdf', 10);
    raise notice 'D2  fila sin objeto                                 esperado ERROR: MAL, paso';
  exception when others then raise notice 'D2  esperado ERROR: %', case when sqlstate = '22023' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
  begin insert into public.estimator_competitor_files (quote_id, path, file_name, mime_type, size_bytes)
          values ('00000000-0000-4000-8000-000000000153', 'otra-carpeta/a.pdf', 'x.pdf', 'application/pdf', 10);
    raise notice 'D3  ruta fuera de la carpeta                        esperado ERROR: MAL, paso';
  exception when others then raise notice 'D3  esperado ERROR: %', case when sqlstate = '22023' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
  begin insert into storage.objects (bucket_id, name, owner_id, metadata)
          values ('estimator-competitor-files', 'ffffffff-ffff-4fff-8fff-ffffffffffff/a.pdf', '<UUID-DUENO>', '{}');
    raise notice 'D4  objeto en carpeta de cotización inexistente     esperado ERROR: MAL, paso';
  exception when others then raise notice 'D4  esperado ERROR: %', case when sqlstate = '42501' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
  begin insert into storage.objects (bucket_id, name, owner_id, metadata)
          values ('estimator-competitor-files', 'no-es-uuid/a.pdf', '<UUID-DUENO>', '{}');
    raise notice 'D5  carpeta que no es uuid (no revienta el cast)    esperado ERROR 42501: MAL, paso';
  exception when others then raise notice 'D5  esperado ERROR: %', case when sqlstate = '42501' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
end $$;

-- 3. El APROBADO (otra tienda) ve y sube; el compañero de TIENDA ve pero NO sube.
set local request.jwt.claims to '{"sub":"<UUID-APROBADO>","role":"authenticated"}';
do $$ declare n int; begin
  select count(*) into n from public.estimator_competitor_files where quote_id = '00000000-0000-4000-8000-000000000153';
  raise notice 'P1  aprobado ve la fila                              esperado 1: %', case when n = 1 then 'OK' else 'MAL '||n end;
  select count(*) into n from storage.objects where bucket_id = 'estimator-competitor-files' and name like '00000000-0000-4000-8000-000000000153/%';
  raise notice 'P2  aprobado ve el objeto (puede firmar)             esperado 1: %', case when n = 1 then 'OK' else 'MAL '||n end;
  insert into storage.objects (bucket_id, name, owner_id, metadata)
    values ('estimator-competitor-files', '00000000-0000-4000-8000-000000000153/b.jpg', '<UUID-APROBADO>', '{"size": 4096, "mimetype": "image/jpeg"}');
  insert into public.estimator_competitor_files (quote_id, path, file_name, mime_type, size_bytes)
    values ('00000000-0000-4000-8000-000000000153', '00000000-0000-4000-8000-000000000153/b.jpg', 'b.jpg', 'image/jpeg', 4096);
  select count(*) into n from public.estimator_competitor_files where uploaded_by = '<UUID-APROBADO>';
  raise notice 'P3  aprobado sube                                    esperado 1: %', case when n = 1 then 'OK' else 'MAL '||n end;
  -- Quitar lo del dueño: cero filas en los dos sitios.
  delete from public.estimator_competitor_files where path like '%/a.pdf'; get diagnostics n = row_count;
  raise notice 'P4  aprobado NO quita la fila del dueño              esperado 0: %', case when n = 0 then 'OK' else 'MAL '||n end;
  delete from storage.objects where bucket_id = 'estimator-competitor-files' and name like '%/a.pdf'; get diagnostics n = row_count;
  raise notice 'P5  aprobado NO quita el objeto del dueño            esperado 0: %', case when n = 0 then 'OK' else 'MAL '||n end;
end $$;

set local request.jwt.claims to '{"sub":"<UUID-TIENDA>","role":"authenticated"}';
do $$ declare n int; begin
  select count(*) into n from public.estimator_competitor_files where quote_id = '00000000-0000-4000-8000-000000000153';
  raise notice 'T1  compañero de tienda VE los archivos              esperado 2: %', case when n = 2 then 'OK' else 'MAL '||n end;
end $$;
do $$ begin
  begin insert into storage.objects (bucket_id, name, owner_id, metadata)
          values ('estimator-competitor-files', '00000000-0000-4000-8000-000000000153/t.pdf', '<UUID-TIENDA>', '{}');
    raise notice 'T2  compañero de tienda NO sube al cubo              esperado ERROR: MAL, paso';
  exception when others then raise notice 'T2  esperado ERROR: %', case when sqlstate = '42501' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
end $$;

-- 4. El AJENO (otra tienda, sin aprobación) no ve nada ni sube; el SIN MÓDULO tampoco.
set local request.jwt.claims to '{"sub":"<UUID-AJENO>","role":"authenticated"}';
do $$ declare n int; m int; begin
  select count(*) into n from public.estimator_competitor_files;
  select count(*) into m from storage.objects where bucket_id = 'estimator-competitor-files';
  raise notice 'J1  ajeno no ve filas                                esperado 0: %', case when n = 0 then 'OK' else 'MAL '||n end;
  raise notice 'J2  ajeno no ve objetos (no puede firmar)            esperado 0: %', case when m = 0 then 'OK' else 'MAL '||m end;
end $$;
do $$ begin
  begin insert into storage.objects (bucket_id, name, owner_id, metadata)
          values ('estimator-competitor-files', '00000000-0000-4000-8000-000000000153/j.pdf', '<UUID-AJENO>', '{}');
    raise notice 'J3  ajeno NO sube                                    esperado ERROR: MAL, paso';
  exception when others then raise notice 'J3  esperado ERROR: %', case when sqlstate = '42501' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
end $$;

set local request.jwt.claims to '{"sub":"<UUID-SIN-MODULO>","role":"authenticated"}';
do $$ declare n int; begin
  select count(*) into n from public.estimator_competitor_files;
  raise notice 'S1  sin módulo no ve                                 esperado 0: %', case when n = 0 then 'OK' else 'MAL '||n end;
end $$;

-- 5. El techo de 5: el DUEÑO sube hasta llenar la carpeta (ya hay 2 objetos: a.pdf y b.jpg).
set local request.jwt.claims to '{"sub":"<UUID-DUENO>","role":"authenticated"}';
do $$ declare i int; begin
  for i in 3..5 loop
    insert into storage.objects (bucket_id, name, owner_id, metadata)
      values ('estimator-competitor-files', '00000000-0000-4000-8000-000000000153/f'||i||'.pdf', '<UUID-DUENO>', '{"size": 10, "mimetype": "application/pdf"}');
    insert into public.estimator_competitor_files (quote_id, path, file_name, mime_type, size_bytes)
      values ('00000000-0000-4000-8000-000000000153', '00000000-0000-4000-8000-000000000153/f'||i||'.pdf', 'f.pdf', 'application/pdf', 10);
  end loop;
  raise notice 'L1  cinco archivos caben                             esperado sin error: OK';
end $$;
do $$ begin
  begin insert into storage.objects (bucket_id, name, owner_id, metadata)
          values ('estimator-competitor-files', '00000000-0000-4000-8000-000000000153/f6.pdf', '<UUID-DUENO>', '{}');
    raise notice 'L2  el sexto objeto                                  esperado ERROR: MAL, paso';
  exception when others then raise notice 'L2  esperado ERROR: %', case when sqlstate = '42501' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
end $$;

-- 6. Sin UPDATE; el dueño quita lo suyo (objeto y fila).
do $$ begin
  begin update public.estimator_competitor_files set note = 'x' where path like '%/a.pdf';
    raise notice 'U1  update                                           esperado ERROR: MAL, paso';
  exception when others then raise notice 'U1  esperado ERROR: %', case when sqlstate = '42501' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
end $$;
do $$ declare n int; m int; begin
  delete from storage.objects where bucket_id = 'estimator-competitor-files' and name like '%/a.pdf'; get diagnostics n = row_count;
  delete from public.estimator_competitor_files where path like '%/a.pdf'; get diagnostics m = row_count;
  raise notice 'Q1  dueño quita su objeto                            esperado 1: %', case when n = 1 then 'OK' else 'MAL '||n end;
  raise notice 'Q2  dueño quita su fila                              esperado 1: %', case when m = 1 then 'OK' else 'MAL '||m end;
end $$;

-- 7. El ADMIN quita lo de otro.
set local request.jwt.claims to '{"sub":"<UUID-ADMIN>","role":"authenticated"}';
do $$ declare n int; m int; begin
  delete from storage.objects where bucket_id = 'estimator-competitor-files' and name like '%/b.jpg'; get diagnostics n = row_count;
  delete from public.estimator_competitor_files where path like '%/b.jpg'; get diagnostics m = row_count;
  raise notice 'A1  admin quita el objeto del aprobado               esperado 1: %', case when n = 1 then 'OK' else 'MAL '||n end;
  raise notice 'A2  admin quita la fila del aprobado                 esperado 1: %', case when m = 1 then 'OK' else 'MAL '||m end;
end $$;

-- 8. anon, nada.
reset role;
set local role anon;
do $$ begin
  begin perform 1 from public.estimator_competitor_files limit 1;
    raise notice 'N1  anon lee la tabla                                esperado ERROR: MAL, paso';
  exception when others then raise notice 'N1  esperado ERROR: %', case when sqlstate = '42501' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
end $$;

reset role;
rollback;
```

**Qué NO cubre la matriz:** que la API de Storage (el servicio, no la tabla) respete `file_size_limit` y
`allowed_mime_types` — eso lo hace el servicio al subir, no Postgres. Se mide **después** de aplicar, con la app, subiendo
un PDF de 11 MB y un `.txt` (ambos deben rechazarse) y luego quitándolos si entraran.

## 7 · Mediciones de solo lectura (para el orquestador; NO corridas)

```sql
-- M1. Antes: que no exista ya (una 153 a medias) y cuánto ocupa Storage hoy, por cubo.
select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'estimator-competitor-files';
select to_regclass('public.estimator_competitor_files');
select bucket_id, count(*), pg_size_pretty(sum((metadata->>'size')::bigint)) from storage.objects group by 1 order by 3 desc;

-- M2. Que storage.objects tenga owner_id (la política de DELETE del cubo lo usa; la autocomprobación también lo exige).
select column_name, data_type from information_schema.columns where table_schema = 'storage' and table_name = 'objects' and column_name in ('owner', 'owner_id');

-- M3. Después: el cubo con sus límites, y cero filas.
select id, public, file_size_limit, array_length(allowed_mime_types, 1) from storage.buckets where id = 'estimator-competitor-files';
select count(*) from public.estimator_competitor_files;
```

## 8 · Reversión

En una transacción propia, a mano (también comentada al final del `.sql`). **Antes**, vaciar el cubo **con la API de
Storage** (panel o `storage.from('estimator-competitor-files').remove([...])`): un `DELETE` en `storage.objects` quita la
fila y deja el archivo en el almacenamiento, gastando cuota sin que nada lo vea.

```sql
begin;
drop policy if exists "estimator competitor files read"   on storage.objects;
drop policy if exists "estimator competitor files insert" on storage.objects;
drop policy if exists "estimator competitor files delete" on storage.objects;
drop table    if exists public.estimator_competitor_files;
drop function if exists public.estimator_competitor_files_guard();
drop function if exists public.estimator_can_attach(text);
drop function if exists public.estimator_competitor_object_count(text);
delete from storage.buckets where id = 'estimator-competitor-files';  -- solo si ya está vacío
delete from public.schema_migrations where name = '153_estimados_competencia.sql';
commit;
```

**La app no se rompe**: sin la tabla, la sección dice «falta actualizar la base» y el resto del Estimador sigue igual.

## 9 · Lo que NO se ha medido

- **Nada contra la base.** Ni la migración, ni su autocomprobación, ni la matriz. Las pruebas del repo
  (`src/lib/estimator/competencia.test.ts`, «la migración 153») comprueban el texto del `.sql` y el checksum.
- Que `storage.objects.metadata` traiga `size` y `mimetype` con esos nombres en la versión de Storage de producción. Si no,
  el disparador cae al valor del navegador (`coalesce`), que los `check` de la tabla siguen acotando.
- Que el servicio de Storage, al subir, evalúe la política de `INSERT` con la función definer que cuenta objetos (es SQL
  normal; la matriz L1/L2 lo ensaya en Postgres, no a través del servicio).
- Que la API de `remove` devuelva la lista vacía (y no un error) cuando la política no deja borrar: así se comporta hoy y
  así lo trata la app (`0 files removed`), pero no se midió en esta rama.
