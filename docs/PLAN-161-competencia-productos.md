# Plan 161 · Los productos del estimado de la competencia, y el registro de lecturas automáticas

Plan en papel exigido por `CLAUDE.md` («Antes de tocar RLS, triggers o permisos en producción»): aquí nacen **dos tablas
con RLS** y un disparador. Molde: `docs/PLAN-156-competencia-suelta.md`.

**Estado (2026-10-04):** escrito por un worker en un worktree. Producción se **leyó** (`begin read only`) y la 156 + la
161 + la matriz de §6 se **ensayaron contra producción dentro de una transacción con `ROLLBACK`** (resultado en §6).
**Nada aplicado. Pendiente de aprobar.**

**Pedido del dueño (2026-10-04, cita que trajo el orquestador):**

> *«in the quote builder addd the compettiton pdf or pcicture upload / compettiros company name and also products from the  and the ocr to recognize the images,»*

**La migración está escrita y NO aplicada:** `supabase/migrations/161_competencia_productos.sql`.

**DEPENDE DE LA 156**, que el 2026-10-04 sigue **escrita y sin aplicar** (`migrate-status`: pendientes 156, 157, 158,
159). Orden obligado: **156 → 161**. Aplicada sola, la 161 se para en su primer bloque con
`161: falta la migracion 156 (estimator_competitor_files no tiene customer_name). Aplica la 156 antes que la 161.`
(ensayado, §6).

---

## 0 · Resumen

| | Con la 156 | Con la 161 |
|---|---|---|
| Qué se sabe de un estimado de la competencia | el archivo, y lo escrito al subir: competidor, su total, nota | además: **empresa**, fecha y número del documento, subtotal, impuesto, total y **la lista de productos** (descripción, marca, SKU, cantidad, unidad, precio unitario, total de línea) |
| Dónde vive | `estimator_competitor_files` | `estimator_competitor_extracts`, **una fila por archivo** (`file_id` es la clave; se va con el archivo, `on delete cascade`) |
| Quién **ve** los productos | — | toda persona con el módulo (`has_estimator_access()`), como los archivos |
| Quién **guarda o corrige** | — | quien **subió el archivo**, o el admin |
| Quién **borra** | — | nadie a mano: la fila se va al quitar el archivo |
| Registro de lecturas automáticas | — | `estimator_competitor_reads`: quién, qué archivo, cuándo, modelo, páginas, tokens, cómo acabó. **Solo lo escribe el servidor** (llave de servicio). Lo lee el admin, y cada uno lo suyo |

## 1 · Decisiones (para validar)

1. **Una fila por archivo, con los productos en un `jsonb`** (hasta 200), y no una fila por producto. La pantalla guarda
   la tabla entera de una vez («Guardar»), y así es un solo `upsert`: no hay tabla a medio guardar. El precio: no se
   puede preguntar a la base «¿quién vende el SKU X más barato?» con un índice; hoy nadie lo pide.
2. **Ver = tener el módulo; guardar = haber subido el archivo (o ser admin).** Es la regla de «quitar» de la 156. El
   pedido del orquestador decía «quien tiene el módulo lee y edita los suyos; admin todo; sin módulo nada».
3. **Sin `DELETE`.** Para vaciar una lectura se quita el archivo. (Además, la autocomprobación de la 148 exige que
   ninguna tabla `estimator_%` tenga política `DELETE`; estas dos no la tienen.)
4. **La empresa corregida vive en `extracts.competitor`**, no en `files.competitor`: la tabla de archivos sigue sin
   `UPDATE` (D-425, decisión 4). La pantalla enseña la de la lectura si la hay, y si no, la escrita al subir.
5. **El emparejado con la línea propia va dentro de cada producto** (`matched_line_id`, el `id` de la línea en el `jsonb`
   de la cotización). Lo pone el vendedor a mano; la lectura automática nunca lo trae.
6. **El registro de lecturas no lo puede escribir ni borrar nadie con sesión**: el tope diario se cuenta sobre él, y
   quien pudiera borrar sus filas se saltaría el tope. Lo escribe la ruta del servidor con la llave de servicio.
7. **El tope diario cuenta todas las lecturas empezadas** (también las que fallaron): una llamada que falla a medias
   también pudo cobrarse.

## 2 · La pantalla y la ruta (en el mismo commit)

- En cada estimado de la competencia (sección de la cotización y pestaña) hay un botón **«🧾 Productos»** que abre su
  tabla: **«Leer productos»** pide la lectura a `POST /api/estimator/leer-competencia`, la deja en la tabla **sin
  guardar**, el vendedor corrige, añade o quita filas, y **«Guardar»**.
- **Sin la 161** el botón abre *«Los productos todavía no están disponibles: falta actualizar la base (migración 161)»*;
  subir, abrir y quitar archivos sigue igual. La ruta contesta `503 sin-161` antes de gastar nada.
- **Sin `ANTHROPIC_API_KEY`** la ruta contesta `503 sin-llave` y la tabla queda para teclear a mano (y guardar funciona).

## 3 · Inventario de lecturas y escrituras que toca

| Pieza | Qué | Cambia |
|---|---|---|
| `public.estimator_competitor_extracts` | tabla, 5 `check`, RLS, 3 políticas (`select`, `insert`, `update`) | **nueva** |
| `public.estimator_competitor_extracts_guard()` | pone quién guarda, su nombre y cuándo; no deja cambiar `file_id` | **nueva** |
| `public.estimator_competitor_reads` | tabla, 2 `check`, índice por `read_at`, RLS, 1 política (`select`) | **nueva** |
| `public.estimator_competitor_files` (153, 156) | se **lee** en las políticas; FK desde las dos tablas nuevas | **no se toca** |
| El cubo `estimator-competitor-files` y sus políticas | — | **no se toca** |
| `estimator_quotes`, `estimator_approvals` (148) | — | **no se tocan** |
| `has_estimator_access()`, `is_admin()` | se usan | **no se tocan** |

Quién escribe en la app: `almacenDeLecturasDeLaBase` (`src/lib/estimator/lectura.ts`) hace `select` y `upsert` en
`extracts` con la sesión; la ruta `src/app/api/estimator/leer-competencia/route.ts` hace `select count`, `insert` y
`update` en `reads` con la llave de servicio.

## 4 · Qué NO debe romperse

- Los archivos de la competencia (153, 156): subir, listar, abrir, quitar. La 161 no cambia nada de ellos; quitar un
  archivo se lleva su lectura (C1) y deja su renglón del registro (C2).
- Quien **no** tiene el módulo no ve productos ni registro (S1, S3) ni guarda (S2). anon, nada (N1, N2).
- Nadie con sesión escribe en el registro (R1, R5).

## 5 · El SQL, literal

Ver `161_competencia_productos.sql`. Empieza exigiendo la 153 y la 156. Su autocomprobación final exige: las dos tablas
con RLS, 3 políticas en `extracts` (ninguna `ALL`/`DELETE`), 1 en `reads` (solo `SELECT`), anon sin `select`,
authenticated sin `delete` en `extracts` y sin `insert`/`update`/`delete` en `reads`, `service_role` con
`insert`/`update` en `reads`, y el disparador colgado. Sin `begin`/`commit` propios.

## 6 · Matriz de pruebas por rol, con ROLLBACK (la corre el orquestador)

**30 casos.** Sustituir: `<UUID-ADMIN>` (admin), `<UUID-A>` y `<UUID-B>` (dos vendedores; la matriz les da el módulo
dentro de la transacción), `<UUID-SIN-MODULO>` (vendedor sin `estimator`). Pegar entero en `psql` desde la raíz del repo.
**Sin `commit` en ningún sitio.** Como la 156 no está aplicada, el bloque la aplica primero **dentro de la misma
transacción**; el día que esté aplicada, se quita esa línea `\i`. Los objetos de `storage.objects` son filas sin archivo
detrás, solo dentro de la transacción.

```sql
begin;
-- Borrar en storage.objects como lo hace la API (storage.protect_delete; ver la nota del orquestador en el plan 153).
set local storage.allow_delete_query = 'true';

\i supabase/migrations/156_competencia_suelta.sql
\i supabase/migrations/161_competencia_productos.sql

-- 0. Los dos vendedores con el módulo (dentro de la transacción).
update public.profiles set module_access = array_append(coalesce(module_access, '{}'), 'estimator')
 where id in ('<UUID-A>', '<UUID-B>') and not ('estimator' = any(coalesce(module_access, '{}')));

set local role authenticated;

-- 1. A sube dos archivos sueltos y guarda los productos del primero.
set local request.jwt.claims to '{"sub":"<UUID-A>","role":"authenticated"}';
do $$ declare n int; begin
  insert into storage.objects (bucket_id, name, owner_id, metadata) values
    ('estimator-competitor-files', 'general/<UUID-A>/a.pdf', '<UUID-A>', '{"size": 2048, "mimetype": "application/pdf"}'),
    ('estimator-competitor-files', 'general/<UUID-A>/a2.pdf', '<UUID-A>', '{"size": 2048, "mimetype": "application/pdf"}');
  insert into public.estimator_competitor_files (id, quote_id, path, file_name, mime_type, size_bytes, customer_name) values
    ('00000000-0000-4000-8000-0000000a0161', null, 'general/<UUID-A>/a.pdf', 'a.pdf', 'application/pdf', 2048, 'Ana Garza'),
    ('00000000-0000-4000-8000-0000000a1161', null, 'general/<UUID-A>/a2.pdf', 'a2.pdf', 'application/pdf', 2048, 'Ana Garza');
  -- Manda saved_by de OTRO: el disparador pone el suyo.
  insert into public.estimator_competitor_extracts (file_id, competitor, doc_date, doc_number, subtotal, tax, total, items, source, saved_by)
    values ('00000000-0000-4000-8000-0000000a0161', '  Rival Tiles ', '2026-10-01', 'RT-1', 100, 8.25, 108.25,
            '[{"id":"p1","description":"Tile 24x48","brand":null,"sku":null,"quantity":50,"unit":"SF","unit_price":2,"line_total":100,"matched_line_id":null}]', 'ocr', '<UUID-B>');
  select count(*) into n from public.estimator_competitor_extracts
   where file_id = '00000000-0000-4000-8000-0000000a0161' and saved_by = '<UUID-A>' and competitor = 'Rival Tiles'
     and saved_by_name is not distinct from (select nullif(trim(full_name), '') from public.profiles where id = '<UUID-A>');
  raise notice 'E1  A guarda los productos de SU archivo; quien guarda lo pone la base  esperado 1: %', case when n = 1 then 'OK' else 'MAL '||n end;
  insert into public.estimator_competitor_extracts (file_id, competitor, items, source)
    values ('00000000-0000-4000-8000-0000000a0161', 'Rival Tiles', '[{"id":"p1","description":"Tile 24x48"},{"id":"p2","description":"Grout"}]', 'ocr')
    on conflict (file_id) do update set competitor = excluded.competitor, items = excluded.items, source = excluded.source;
  select count(*) into n from public.estimator_competitor_extracts
   where file_id = '00000000-0000-4000-8000-0000000a0161' and jsonb_array_length(items) = 2;
  raise notice 'E2  A corrige (upsert) y quedan 2 productos                             esperado 1: %', case when n = 1 then 'OK' else 'MAL '||n end;
end $$;
do $$ begin
  begin insert into public.estimator_competitor_extracts (file_id, items)
          select '00000000-0000-4000-8000-0000000a1161', jsonb_agg(jsonb_build_object('id', g)) from generate_series(1, 201) g;
    raise notice 'E3  201 productos                                   esperado ERROR: MAL, paso';
  exception when others then raise notice 'E3  esperado ERROR 23514: %', case when sqlstate = '23514' then 'OK' else 'MAL ('||sqlstate||' '||sqlerrm||')' end; end;
  begin insert into public.estimator_competitor_extracts (file_id, source) values ('00000000-0000-4000-8000-0000000a1161', 'adivinado');
    raise notice 'E4  origen que no es ocr ni manual                  esperado ERROR: MAL, paso';
  exception when others then raise notice 'E4  esperado ERROR 23514: %', case when sqlstate = '23514' then 'OK' else 'MAL ('||sqlstate||' '||sqlerrm||')' end; end;
  begin insert into public.estimator_competitor_extracts (file_id, total) values ('00000000-0000-4000-8000-0000000a1161', -1);
    raise notice 'E5  total negativo                                  esperado ERROR: MAL, paso';
  exception when others then raise notice 'E5  esperado ERROR 23514: %', case when sqlstate = '23514' then 'OK' else 'MAL ('||sqlstate||' '||sqlerrm||')' end; end;
  begin insert into public.estimator_competitor_extracts (file_id, items) values ('00000000-0000-4000-8000-0000000a1161', '{"no":"lista"}');
    raise notice 'E6  items que no es una lista                       esperado ERROR: MAL, paso';
  exception when others then raise notice 'E6  esperado ERROR 23514: %', case when sqlstate = '23514' then 'OK' else 'MAL ('||sqlstate||' '||sqlerrm||')' end; end;
  begin delete from public.estimator_competitor_extracts where file_id = '00000000-0000-4000-8000-0000000a0161';
    raise notice 'E7  A borra su lectura a mano                       esperado ERROR: MAL, paso';
  exception when others then raise notice 'E7  esperado ERROR 42501: %', case when sqlstate = '42501' then 'OK' else 'MAL ('||sqlstate||' '||sqlerrm||')' end; end;
  begin insert into public.estimator_competitor_extracts (file_id) values ('00000000-0000-4000-8000-00000000dead');
    raise notice 'E8  lectura de un archivo que no existe             esperado ERROR: MAL, paso';
  exception when others then raise notice 'E8  esperado ERROR 42501: %', case when sqlstate = '42501' then 'OK' else 'MAL ('||sqlstate||' '||sqlerrm||')' end; end;
end $$;

-- 2. B (con el módulo) VE los productos de A, pero no los cambia ni guarda sobre un archivo de A; sí sobre el suyo.
set local request.jwt.claims to '{"sub":"<UUID-B>","role":"authenticated"}';
do $$ declare n int; begin
  select count(*) into n from public.estimator_competitor_extracts where file_id = '00000000-0000-4000-8000-0000000a0161';
  raise notice 'B1  B ve los productos de A                         esperado 1: %', case when n = 1 then 'OK' else 'MAL '||n end;
  update public.estimator_competitor_extracts set competitor = 'Cambiado por B' where file_id = '00000000-0000-4000-8000-0000000a0161';
  get diagnostics n = row_count;
  raise notice 'B2  B NO corrige los productos de A                 esperado 0: %', case when n = 0 then 'OK' else 'MAL '||n end;
  insert into storage.objects (bucket_id, name, owner_id, metadata)
    values ('estimator-competitor-files', 'general/<UUID-B>/b.jpg', '<UUID-B>', '{"size": 4096, "mimetype": "image/jpeg"}');
  insert into public.estimator_competitor_files (id, quote_id, path, file_name, mime_type, size_bytes, customer_name)
    values ('00000000-0000-4000-8000-0000000b0161', null, 'general/<UUID-B>/b.jpg', 'b.jpg', 'image/jpeg', 4096, 'Luis Pena');
  insert into public.estimator_competitor_extracts (file_id, competitor, source) values ('00000000-0000-4000-8000-0000000b0161', 'Otro Rival', 'manual');
  select count(*) into n from public.estimator_competitor_extracts where file_id = '00000000-0000-4000-8000-0000000b0161' and saved_by = '<UUID-B>';
  raise notice 'B4  B guarda los productos de SU archivo            esperado 1: %', case when n = 1 then 'OK' else 'MAL '||n end;
end $$;
do $$ begin
  begin insert into public.estimator_competitor_extracts (file_id, competitor) values ('00000000-0000-4000-8000-0000000a1161', 'Intruso');
    raise notice 'B3  B guarda productos en un archivo de A           esperado ERROR: MAL, paso';
  exception when others then raise notice 'B3  esperado ERROR 42501: %', case when sqlstate = '42501' then 'OK' else 'MAL ('||sqlstate||' '||sqlerrm||')' end; end;
  begin insert into public.estimator_competitor_reads (file_id, read_by, status) values ('00000000-0000-4000-8000-0000000b0161', '<UUID-B>', 'ok');
    raise notice 'R1  alguien con sesión escribe en el registro       esperado ERROR: MAL, paso';
  exception when others then raise notice 'R1  esperado ERROR 42501: %', case when sqlstate = '42501' then 'OK' else 'MAL ('||sqlstate||' '||sqlerrm||')' end; end;
end $$;

-- 3. El SERVIDOR (llave de servicio) apunta dos lecturas y cierra una.
reset role;
set local role service_role;
do $$ declare n int; begin
  insert into public.estimator_competitor_reads (id, file_id, file_name, read_by, read_by_name, model, pages, bytes) values
    ('00000000-0000-4000-8000-0000000c0161', '00000000-0000-4000-8000-0000000a0161', 'a.pdf', '<UUID-A>', 'A', 'claude-opus-5-5', 1, 2048),
    ('00000000-0000-4000-8000-0000000c1161', '00000000-0000-4000-8000-0000000b0161', 'b.jpg', '<UUID-B>', 'B', 'claude-opus-5-5', null, 4096);
  update public.estimator_competitor_reads set status = 'ok', input_tokens = 3000, output_tokens = 900
   where id = '00000000-0000-4000-8000-0000000c0161'; get diagnostics n = row_count;
  raise notice 'R2  el servidor apunta y cierra una lectura         esperado 1: %', case when n = 1 then 'OK' else 'MAL '||n end;
  select count(*) into n from public.estimator_competitor_reads where read_at > now() - interval '24 hours'
     and id in ('00000000-0000-4000-8000-0000000c0161', '00000000-0000-4000-8000-0000000c1161');
  raise notice 'R3  el servidor cuenta las de las últimas 24 h      esperado 2: %', case when n = 2 then 'OK' else 'MAL '||n end;
end $$;
reset role;
set local role authenticated;

-- 4. Cada uno ve SU renglón del registro, y no lo toca.
set local request.jwt.claims to '{"sub":"<UUID-A>","role":"authenticated"}';
do $$ declare n int; m int; begin
  select count(*) into n from public.estimator_competitor_reads where id in ('00000000-0000-4000-8000-0000000c0161', '00000000-0000-4000-8000-0000000c1161');
  select count(*) into m from public.estimator_competitor_reads where read_by = '<UUID-B>';
  raise notice 'R4  A ve su lectura en el registro y no la de B     esperado 1 y 0: %', case when n = 1 and m = 0 then 'OK' else 'MAL '||n||' '||m end;
  begin delete from public.estimator_competitor_reads where read_by = '<UUID-A>';
    raise notice 'R5  A borra su renglón (se saltaría el tope)        esperado ERROR: MAL, paso';
  exception when others then raise notice 'R5  esperado ERROR 42501: %', case when sqlstate = '42501' then 'OK' else 'MAL ('||sqlstate||' '||sqlerrm||')' end; end;
  begin update public.estimator_competitor_reads set read_at = now() - interval '2 days' where read_by = '<UUID-A>';
    raise notice 'R6  A envejece su renglón (se saltaría el tope)     esperado ERROR: MAL, paso';
  exception when others then raise notice 'R6  esperado ERROR 42501: %', case when sqlstate = '42501' then 'OK' else 'MAL ('||sqlstate||' '||sqlerrm||')' end; end;
end $$;

-- 5. SIN MÓDULO: nada.
set local request.jwt.claims to '{"sub":"<UUID-SIN-MODULO>","role":"authenticated"}';
do $$ declare n int; m int; begin
  select count(*) into n from public.estimator_competitor_extracts;
  select count(*) into m from public.estimator_competitor_reads;
  raise notice 'S1  sin módulo no ve productos                      esperado 0: %', case when n = 0 then 'OK' else 'MAL '||n end;
  raise notice 'S3  sin módulo no ve el registro                    esperado 0: %', case when m = 0 then 'OK' else 'MAL '||m end;
  begin insert into public.estimator_competitor_extracts (file_id, competitor) values ('00000000-0000-4000-8000-0000000a1161', 'X');
    raise notice 'S2  sin módulo guarda productos                     esperado ERROR: MAL, paso';
  exception when others then raise notice 'S2  esperado ERROR 42501: %', case when sqlstate = '42501' then 'OK' else 'MAL ('||sqlstate||' '||sqlerrm||')' end; end;
end $$;

-- 6. El ADMIN ve todo, corrige lo de A y ve todo el registro.
set local request.jwt.claims to '{"sub":"<UUID-ADMIN>","role":"authenticated"}';
do $$ declare n int; m int; begin
  select count(*) into n from public.estimator_competitor_extracts
   where file_id in ('00000000-0000-4000-8000-0000000a0161', '00000000-0000-4000-8000-0000000b0161');
  raise notice 'A1  admin ve los productos de A y de B              esperado 2: %', case when n = 2 then 'OK' else 'MAL '||n end;
  update public.estimator_competitor_extracts set competitor = 'Rival Tiles LLC' where file_id = '00000000-0000-4000-8000-0000000a0161';
  get diagnostics n = row_count;
  select count(*) into m from public.estimator_competitor_extracts
   where file_id = '00000000-0000-4000-8000-0000000a0161' and saved_by = '<UUID-ADMIN>' and competitor = 'Rival Tiles LLC';
  raise notice 'A2  admin corrige los productos de A; queda a su nombre  esperado 1 y 1: %', case when n = 1 and m = 1 then 'OK' else 'MAL '||n||' '||m end;
  update public.estimator_competitor_extracts set file_id = '00000000-0000-4000-8000-0000000a1161' where file_id = '00000000-0000-4000-8000-0000000a0161';
  select count(*) into n from public.estimator_competitor_extracts where file_id = '00000000-0000-4000-8000-0000000a1161';
  raise notice 'A3  una lectura no se muda a otro archivo           esperado 0: %', case when n = 0 then 'OK' else 'MAL '||n end;
  select count(*) into n from public.estimator_competitor_reads where id in ('00000000-0000-4000-8000-0000000c0161', '00000000-0000-4000-8000-0000000c1161');
  raise notice 'A4  admin ve todo el registro                       esperado 2: %', case when n = 2 then 'OK' else 'MAL '||n end;
  insert into public.estimator_competitor_extracts (file_id, competitor) values ('00000000-0000-4000-8000-0000000a1161', 'Puesto por el admin');
  select count(*) into n from public.estimator_competitor_extracts where file_id = '00000000-0000-4000-8000-0000000a1161';
  raise notice 'A5  admin guarda productos en un archivo de A       esperado 1: %', case when n = 1 then 'OK' else 'MAL '||n end;
end $$;

-- 7. A quita su archivo: la lectura se va con él; el renglón del registro se queda, sin archivo y con su nombre.
set local request.jwt.claims to '{"sub":"<UUID-A>","role":"authenticated"}';
do $$ declare n int; m int; begin
  delete from storage.objects where bucket_id = 'estimator-competitor-files' and name = 'general/<UUID-A>/a.pdf';
  delete from public.estimator_competitor_files where id = '00000000-0000-4000-8000-0000000a0161';
  select count(*) into n from public.estimator_competitor_extracts where file_id = '00000000-0000-4000-8000-0000000a0161';
  raise notice 'C1  al quitar el archivo se va su lectura           esperado 0: %', case when n = 0 then 'OK' else 'MAL '||n end;
  select count(*) into m from public.estimator_competitor_reads
   where id = '00000000-0000-4000-8000-0000000c0161' and file_id is null and file_name = 'a.pdf';
  raise notice 'C2  el registro sigue, sin archivo y con su nombre  esperado 1: %', case when m = 1 then 'OK' else 'MAL '||m end;
end $$;

-- 8. anon, nada.
reset role;
set local role anon;
do $$ begin
  begin perform 1 from public.estimator_competitor_extracts limit 1;
    raise notice 'N1  anon lee los productos                          esperado ERROR: MAL, paso';
  exception when others then raise notice 'N1  esperado ERROR 42501: %', case when sqlstate = '42501' then 'OK' else 'MAL ('||sqlstate||' '||sqlerrm||')' end; end;
  begin perform 1 from public.estimator_competitor_reads limit 1;
    raise notice 'N2  anon lee el registro                            esperado ERROR: MAL, paso';
  exception when others then raise notice 'N2  esperado ERROR 42501: %', case when sqlstate = '42501' then 'OK' else 'MAL ('||sqlstate||' '||sqlerrm||')' end; end;
end $$;

reset role;
ROLLBACK;
```

### Resultado del ensayo

**2026-10-04, worker, contra producción, con `ROLLBACK`** (guion: `scratchpad/w-competencia-ocr/ensayo.mjs`, que extrae
este bloque, sustituye los UUID y los dos `\i`, y comprueba que no hay `commit` y que acaba en `ROLLBACK`). Con
`<UUID-A>` un vendedor de RDZ Pharr, `<UUID-B>` uno de RDZ Brownsville, `<UUID-SIN-MODULO>` uno de RDZ McAllen sin
`estimator` y `<UUID-ADMIN>` un admin (los mismos del ensayo de la 156): **30 de 30 OK**. Las autocomprobaciones de la
156 y de la 161 pasaron dentro de la misma transacción. Después del ensayo se volvió a leer producción: ni
`estimator_competitor_extracts` ni la columna `customer_name` existen — no quedó nada.

**La 161 sola, sin la 156** (`node ensayo.mjs sola`, también con `ROLLBACK`): se para con
`P0001 161: falta la migracion 156 (estimator_competitor_files no tiene customer_name). Aplica la 156 antes que la 161.`

Y ocho mutantes de la migración, cada uno ensayado entero con `ROLLBACK`:

| Mutante | Lo caza |
|---|---|
| la política de `SELECT` de los productos pasa a `using (true)` | S1 (`MAL 2`) |
| la de `INSERT` deja de mirar quién subió el archivo | B3 (`MAL, paso`), y E8 |
| el registro legible por cualquiera | R4 (`MAL 2 1`) y S3 (`MAL 2`) |
| `authenticated` con permiso de escritura en el registro | la autocomprobación (`161: authenticated no debe poder escribir en estimator_competitor_reads`) |
| el disparador respeta el `saved_by` que manda el navegador | E1 (`MAL 0`) |
| el techo de productos pasa a 201 | E3 (`MAL, paso`) |
| el disparador deja cambiar `file_id` | A3 (`MAL 1`) |
| `authenticated` con `delete` en los productos | la autocomprobación (`161: authenticated no debe poder borrar de estimator_competitor_extracts`) |

**Qué NO cubre la matriz:** la API REST (PostgREST) de verdad, ni la ruta del servidor contra la base: eso se mide
después de aplicar, guardando a mano una tabla de productos desde la pantalla.

## 7 · Mediciones de solo lectura

2026-10-04, `begin read only`:

- `estimator_competitor_files`: **0 filas**; objetos en el cubo: **0**. No hay nada que leer todavía.
- Última migración registrada: `155_encuestas.sql`. **La 156 no está aplicada** (`customer_name` no existe).
- Con el módulo `estimator`: **4** perfiles, los 4 admin. Ningún vendedor lo tiene: hasta que se les dé la casilla, todo
  esto solo lo ven los admin.

## 8 · Reversión

En una transacción propia, a mano. Se pierden los productos guardados y el registro de lecturas (el tope diario vuelve
a no poder contarse: la ruta contesta `sin-161` y no lee). Los archivos no se tocan.

```sql
begin;
drop table if exists public.estimator_competitor_reads;
drop table if exists public.estimator_competitor_extracts;
drop function if exists public.estimator_competitor_extracts_guard();
delete from public.schema_migrations where name = '161_competencia_productos.sql';
commit;
```

**La app no se rompe al revertir:** «Productos» vuelve a decir «falta actualizar la base (migración 161)» y lo demás
sigue como con la 156.

## 9 · Lo que NO se ha medido

- **Ninguna lectura real**: la API de Anthropic no se ha llamado nunca desde este código (no hay llave, y la regla de
  CLAUDE.md prohíbe gastar en pruebas). El coste por documento es una estimación, no una medición.
- `upsert` por PostgREST (`on conflict (file_id)`) desde la pantalla contra la base: en el ensayo se hizo el mismo
  `insert … on conflict do update` en SQL (E2), no por la API REST.
- Que `service_role` conserve sus permisos por defecto sobre tablas nuevas en ESTE proyecto: lo comprueba la propia
  migración (se para si no puede `insert`/`update` en `reads`) y el caso R2.
