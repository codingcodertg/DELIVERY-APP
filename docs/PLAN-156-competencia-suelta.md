# Plan 156 · Estimados de la competencia sueltos, y una lista que ven todos los vendedores del Quote Builder

Plan en papel exigido por `CLAUDE.md` («Antes de tocar RLS, triggers o permisos en producción»): aquí se **abre la
lectura** de una tabla y de un cubo de Storage, cambia una **columna a opcional**, se **reescribe un disparador** y
cambian **dos políticas de `storage.objects`**. Molde: `docs/PLAN-153-estimados-competencia.md` y
`docs/PLAN-155-encuestas.md`.

**Estado (2026-09-29):** escrito por un worker en un worktree. Producción se **leyó** (`begin read only`) y la migración y
la matriz de §6 se **ensayaron contra producción dentro de una transacción con `ROLLBACK`** (resultado en §6). **Nada
aplicado. Pendiente de aprobar.**

**Pedido del dueño (2026-09-29, cita que trajo el orquestador):**

> *«THE COMEPTITORS ESTIMATE YOU CAN UPLOAD IT WITHOUT NEEDE TO CREATE AN ESTIMATE*
> *AND I WANT IT TO SHOW ALL ESTIAMTES IN A TAB AND ALL SALES REP COULD SEE IT»*

Se lee «ALL ESTIMATES» como **los estimados de la competencia** (el tema de la frase). Las cotizaciones propias
(`estimator_quotes`) **no** se abren: siguen con la RLS de la 148 (dueño, su tienda, aprobado, admin).

**La migración está escrita y NO aplicada:** `supabase/migrations/156_competencia_suelta.sql`.

---

## 0 · Resumen

| | Con la 153 (hoy en producción) | Con la 156 |
|---|---|---|
| `quote_id` | obligatorio | **opcional** (suelto = sin cotización) |
| Datos de un suelto | — | `customer_name` (obligatorio si no hay cotización), `store`, `estimate_num` opcional, y lo de siempre (competidor, su total, nota) |
| Ruta en el cubo | `<quote_id>/…` | igual, y los sueltos en `general/<uid de quien sube>/…` |
| Quién **ve** filas y objetos | quien ve la cotización | **toda persona con el módulo** (`has_estimator_access()`: admin o la casilla `estimator`), de todas las tiendas |
| Quién **sube** a una cotización | dueño, aprobado, admin | igual |
| Quién **sube** un suelto | — | cualquiera con el módulo, en SU carpeta |
| Quién **quita** | quien lo subió o admin, y viendo la cotización | quien lo subió o admin (ya sin mirar la cotización) |
| Techo | 5 por cotización | igual, y **50 sueltos por persona** (tabla y cubo) |
| `estimate_num` y `store` en los pegados | — | los copia el disparador de la cotización: quien no ve esa cotización ve de qué estimado es |

## 1 · Decisiones (para validar)

1. **Ver = tener el módulo**, sin mirar tienda ni cotización. Es lo que pidió («ALL SALES REP COULD SEE IT»). Incluye los
   archivos **pegados a una cotización**: en la pestaña salen todos; la cotización en sí sigue cerrada (148). Un PDF de la
   competencia puede llevar nombre y dirección del cliente: con esto lo ven todos los vendedores con el módulo.
2. **Un suelto exige el nombre del cliente** (`check` en la tabla y la pantalla). Sin él la lista tendría filas que nadie
   reconoce.
3. **La tienda la elige quien sube** (por defecto la de su perfil; si no manda ninguna, el disparador pone la del perfil).
   Es texto libre en la base (≤ 80), como `estimator_quotes.store`; la pantalla ofrece las tiendas de Ajustes.
4. **50 sueltos por persona** (= 500 MB por persona como mucho). El techo de la 153 era por la caída por cuota
   (D-403). 50 es un número mío, sin medición detrás: el 2026-09-29 hay **0** archivos en el cubo.
5. **Quitar ya no exige ver la cotización**: con la lectura abierta, esa condición ya no decía nada.
6. Sin `UPDATE`, como en la 153.

## 2 · La pantalla (en el mismo commit)

- `/estimator` tiene dos pestañas: **«Quote / Cotización»** (lo de siempre) y **«Competitor estimates / Estimados de la
  competencia»** (`src/app/estimator/EstimadosCompetencia.tsx`).
- La pestaña: un formulario para subir **sin cotización** (archivos, cliente, tienda, # de estimado opcional, competidor,
  su total, nota) y la **lista de todos**, de lo más nuevo a lo más viejo, con filtro por tienda y búsqueda.
- **Sin la 156** la lista pide columnas que no existen (`42703` / `PGRST204`) y la pestaña dice *«falta actualizar la base
  (migración 156)»*; la sección de la cotización (153) sigue igual, porque pide solo las columnas de la 153.

## 3 · Inventario de lecturas y escrituras que toca

| Pieza | Qué | Cambia |
|---|---|---|
| `public.estimator_competitor_files` | `quote_id` opcional; 3 columnas y 4 `check` nuevos; índice por `uploaded_at` | sí |
| `public.estimator_competitor_files_guard()` | dos rutas (cotización / `general/<uid>/`), techo de 50 sueltos, copia `estimate_num` y `store` | reescrita |
| `public.estimator_competitor_loose_count(text)` | `sql stable security definer`: cuenta objetos de `general/<uid>/` | nueva |
| Políticas de la tabla | `select` (abierta al módulo), `insert` (dos ramas), `delete` (sin la subconsulta) | reescritas |
| `estimator competitor files read` / `insert` en `storage.objects` | leer: módulo; subir: dos ramas | reescritas |
| `estimator competitor files delete` en `storage.objects` | — | **no se toca** |
| `estimator_quotes`, `estimator_approvals`, sus políticas y helpers (148) | se **leen** | **no se tocan** |
| El cubo (límite, tipos, privado) | — | **no se toca** |

## 4 · Qué NO debe romperse

- La sección de la cotización (D-425): subir a una cotización sigue siendo del dueño, el aprobado o el admin; 5 por
  cotización; quitar, quien lo subió o el admin. Casos V5, B6, L* de §6.
- Las cotizaciones siguen cerradas: esta migración no toca ninguna política de `estimator_quotes` (§3).
- Quien **no** tiene el módulo no ve nada (S1, S2) ni sube (S3). anon, nada (N1).
- Los otros cubos: todas las políticas llevan `bucket_id = 'estimator-competitor-files'`.

## 5 · El SQL, literal

Ver `156_competencia_suelta.sql`. Su autocomprobación exige: `quote_id` opcional, las 3 columnas, 3 políticas en la tabla
(ninguna `ALL`/`UPDATE`) con la de `SELECT` sin `estimator_quotes`, sin `select` para anon ni `update` para authenticated,
3 políticas del cubo, el cubo privado y el disparador colgado. Sin `begin`/`commit` propios.

## 6 · Matriz de pruebas por rol, con ROLLBACK (la corre el orquestador)

**26 casos.** Sustituir: `<UUID-ADMIN>` (admin), `<UUID-A>` y `<UUID-B>` (dos vendedores de **tiendas distintas**; la
matriz les da el módulo dentro de la transacción), `<UUID-SIN-MODULO>` (vendedor sin `estimator`). Pegar entero en `psql`
desde la raíz del repo. **Sin `commit` en ningún sitio.** Los objetos de `storage.objects` son filas sin archivo detrás,
solo dentro de la transacción.

```sql
begin;
-- Borrar en storage.objects como lo hace la API (storage.protect_delete; ver la nota del orquestador en el plan 153).
set local storage.allow_delete_query = 'true';

\i supabase/migrations/156_competencia_suelta.sql

-- 0. Los dos vendedores con el módulo (dentro de la transacción) y una cotización de A.
update public.profiles set module_access = array_append(coalesce(module_access, '{}'), 'estimator')
 where id in ('<UUID-A>', '<UUID-B>') and not ('estimator' = any(coalesce(module_access, '{}')));
insert into public.estimator_quotes (id, estimate_num, owner_id, store)
  select '00000000-0000-4000-8000-000000000156', 'ENSAYO-156', '<UUID-A>', store from public.profiles where id = '<UUID-A>';

set local role authenticated;

-- 1. A sube un SUELTO en su carpeta, sin tienda: la pone el disparador (la de su perfil).
set local request.jwt.claims to '{"sub":"<UUID-A>","role":"authenticated"}';
do $$ declare n int; begin
  insert into storage.objects (bucket_id, name, owner_id, metadata)
    values ('estimator-competitor-files', 'general/<UUID-A>/a.pdf', '<UUID-A>', '{"size": 2048, "mimetype": "application/pdf"}');
  insert into public.estimator_competitor_files (quote_id, path, file_name, mime_type, size_bytes, customer_name, competitor, competitor_total)
    values (null, 'general/<UUID-A>/a.pdf', 'a.pdf', 'application/pdf', 2048, '  Ana Garza ', 'Rival', 1999.50);
  select count(*) into n from public.estimator_competitor_files f
   where f.path = 'general/<UUID-A>/a.pdf' and f.uploaded_by = '<UUID-A>' and f.customer_name = 'Ana Garza'
     and f.store is not distinct from (select nullif(btrim(store), '') from public.profiles where id = '<UUID-A>');
  raise notice 'V1  A sube un suelto; tienda de su perfil           esperado 1: %', case when n = 1 then 'OK' else 'MAL '||n end;
end $$;
do $$ begin
  begin
    insert into storage.objects (bucket_id, name, owner_id, metadata)
      values ('estimator-competitor-files', 'general/<UUID-A>/sin-cliente.pdf', '<UUID-A>', '{"size": 10, "mimetype": "application/pdf"}');
    insert into public.estimator_competitor_files (quote_id, path, file_name, mime_type, size_bytes)
      values (null, 'general/<UUID-A>/sin-cliente.pdf', 'x.pdf', 'application/pdf', 10);
    raise notice 'V2  suelto sin cliente                              esperado ERROR: MAL, paso';
  exception when others then raise notice 'V2  esperado ERROR 23514: %', case when sqlstate = '23514' then 'OK' else 'MAL ('||sqlstate||' '||sqlerrm||')' end; end;
  begin insert into storage.objects (bucket_id, name, owner_id, metadata)
          values ('estimator-competitor-files', 'general/<UUID-B>/intruso.pdf', '<UUID-A>', '{}');
    raise notice 'V3  objeto en la carpeta de OTRO                    esperado ERROR: MAL, paso';
  exception when others then raise notice 'V3  esperado ERROR 42501: %', case when sqlstate = '42501' then 'OK' else 'MAL ('||sqlstate||' '||sqlerrm||')' end; end;
  begin insert into public.estimator_competitor_files (quote_id, path, file_name, mime_type, size_bytes, customer_name)
          values (null, 'general/<UUID-B>/intruso.pdf', 'x.pdf', 'application/pdf', 10, 'X');
    raise notice 'V4  fila suelta con ruta de OTRO                    esperado ERROR: MAL, paso';
  exception when others then raise notice 'V4  esperado ERROR 22023: %', case when sqlstate = '22023' then 'OK' else 'MAL ('||sqlstate||' '||sqlerrm||')' end; end;
end $$;
-- A pega uno a SU cotización: el disparador copia el # de estimado y la tienda.
do $$ declare n int; begin
  insert into storage.objects (bucket_id, name, owner_id, metadata)
    values ('estimator-competitor-files', '00000000-0000-4000-8000-000000000156/q.pdf', '<UUID-A>', '{"size": 10, "mimetype": "application/pdf"}');
  insert into public.estimator_competitor_files (quote_id, path, file_name, mime_type, size_bytes, estimate_num)
    values ('00000000-0000-4000-8000-000000000156', '00000000-0000-4000-8000-000000000156/q.pdf', 'q.pdf', 'application/pdf', 10, 'MENTIRA');
  select count(*) into n from public.estimator_competitor_files
   where path like '00000000-0000-4000-8000-000000000156/%' and estimate_num = 'ENSAYO-156';
  raise notice 'V5  A pega a su cotización; # copiado de ella       esperado 1: %', case when n = 1 then 'OK' else 'MAL '||n end;
end $$;

-- 2. B, de OTRA tienda y sin ver la cotización de A, ve y firma todo; no quita lo de A; sube su suelto.
set local request.jwt.claims to '{"sub":"<UUID-B>","role":"authenticated"}';
do $$ declare n int; m int; c int; begin
  select count(*) into n from public.estimator_competitor_files where uploaded_by = '<UUID-A>';
  raise notice 'B1  B ve las 2 filas de A (suelta y pegada)         esperado 2: %', case when n = 2 then 'OK' else 'MAL '||n end;
  select count(*) into m from storage.objects where bucket_id = 'estimator-competitor-files' and owner_id = '<UUID-A>';
  raise notice 'B2  B ve (puede firmar) los 2 objetos de A          esperado 2: %', case when m = 2 then 'OK' else 'MAL '||m end;
  select count(*) into c from public.estimator_quotes where id = '00000000-0000-4000-8000-000000000156';
  raise notice 'B3  B sigue SIN ver la cotización de A              esperado 0: %', case when c = 0 then 'OK' else 'MAL '||c end;
  delete from public.estimator_competitor_files where uploaded_by = '<UUID-A>'; get diagnostics n = row_count;
  raise notice 'B4  B NO quita filas de A                           esperado 0: %', case when n = 0 then 'OK' else 'MAL '||n end;
  delete from storage.objects where bucket_id = 'estimator-competitor-files' and owner_id = '<UUID-A>'; get diagnostics n = row_count;
  raise notice 'B5  B NO quita objetos de A                         esperado 0: %', case when n = 0 then 'OK' else 'MAL '||n end;
  insert into storage.objects (bucket_id, name, owner_id, metadata)
    values ('estimator-competitor-files', 'general/<UUID-B>/b.jpg', '<UUID-B>', '{"size": 4096, "mimetype": "image/jpeg"}');
  insert into public.estimator_competitor_files (quote_id, path, file_name, mime_type, size_bytes, customer_name, store)
    values (null, 'general/<UUID-B>/b.jpg', 'b.jpg', 'image/jpeg', 4096, 'Luis Pena', 'RDZ Weslaco');
  select count(*) into n from public.estimator_competitor_files where uploaded_by = '<UUID-B>' and store = 'RDZ Weslaco';
  raise notice 'B6  B sube un suelto con la tienda que eligió       esperado 1: %', case when n = 1 then 'OK' else 'MAL '||n end;
end $$;
do $$ begin
  begin insert into storage.objects (bucket_id, name, owner_id, metadata)
          values ('estimator-competitor-files', '00000000-0000-4000-8000-000000000156/b.pdf', '<UUID-B>', '{}');
    raise notice 'B7  B pega a la cotización de A (sin aprobación)    esperado ERROR: MAL, paso';
  exception when others then raise notice 'B7  esperado ERROR 42501: %', case when sqlstate = '42501' then 'OK' else 'MAL ('||sqlstate||' '||sqlerrm||')' end; end;
end $$;

-- 3. SIN MÓDULO: nada.
set local request.jwt.claims to '{"sub":"<UUID-SIN-MODULO>","role":"authenticated"}';
do $$ declare n int; m int; begin
  select count(*) into n from public.estimator_competitor_files;
  select count(*) into m from storage.objects where bucket_id = 'estimator-competitor-files';
  raise notice 'S1  sin módulo no ve filas                          esperado 0: %', case when n = 0 then 'OK' else 'MAL '||n end;
  raise notice 'S2  sin módulo no ve objetos                        esperado 0: %', case when m = 0 then 'OK' else 'MAL '||m end;
end $$;
do $$ begin
  begin insert into storage.objects (bucket_id, name, owner_id, metadata)
          values ('estimator-competitor-files', 'general/<UUID-SIN-MODULO>/s.pdf', '<UUID-SIN-MODULO>', '{}');
    raise notice 'S3  sin módulo sube a su carpeta                    esperado ERROR: MAL, paso';
  exception when others then raise notice 'S3  esperado ERROR 42501: %', case when sqlstate = '42501' then 'OK' else 'MAL ('||sqlstate||' '||sqlerrm||')' end; end;
end $$;

-- 4. Sin UPDATE.
set local request.jwt.claims to '{"sub":"<UUID-A>","role":"authenticated"}';
do $$ begin
  begin update public.estimator_competitor_files set note = 'x' where uploaded_by = '<UUID-A>';
    raise notice 'U1  update                                          esperado ERROR: MAL, paso';
  exception when others then raise notice 'U1  esperado ERROR 42501: %', case when sqlstate = '42501' then 'OK' else 'MAL ('||sqlstate||' '||sqlerrm||')' end; end;
end $$;

-- 5. A quita su suelto (objeto y fila).
do $$ declare n int; m int; begin
  delete from storage.objects where bucket_id = 'estimator-competitor-files' and name = 'general/<UUID-A>/a.pdf'; get diagnostics n = row_count;
  delete from public.estimator_competitor_files where path = 'general/<UUID-A>/a.pdf'; get diagnostics m = row_count;
  raise notice 'Q1  A quita su objeto suelto                        esperado 1: %', case when n = 1 then 'OK' else 'MAL '||n end;
  raise notice 'Q2  A quita su fila suelta                          esperado 1: %', case when m = 1 then 'OK' else 'MAL '||m end;
end $$;

-- 6. El techo de 50 sueltos: tras Q1, A no tiene ninguno (lo de V2 se deshizo con su excepción). Llena hasta 50.
do $$ declare i int; begin
  for i in 1..50 loop
    insert into storage.objects (bucket_id, name, owner_id, metadata)
      values ('estimator-competitor-files', 'general/<UUID-A>/f'||i||'.pdf', '<UUID-A>', '{"size": 10, "mimetype": "application/pdf"}');
  end loop;
  raise notice 'L1  50 objetos sueltos caben                        esperado sin error: OK';
end $$;
do $$ begin
  begin insert into storage.objects (bucket_id, name, owner_id, metadata)
          values ('estimator-competitor-files', 'general/<UUID-A>/f51.pdf', '<UUID-A>', '{}');
    raise notice 'L2  el objeto 51                                    esperado ERROR: MAL, paso';
  exception when others then raise notice 'L2  esperado ERROR 42501: %', case when sqlstate = '42501' then 'OK' else 'MAL ('||sqlstate||' '||sqlerrm||')' end; end;
end $$;
do $$ declare i int; begin
  for i in 1..50 loop
    insert into public.estimator_competitor_files (quote_id, path, file_name, mime_type, size_bytes, customer_name)
      values (null, 'general/<UUID-A>/f'||i||'.pdf', 'f.pdf', 'application/pdf', 10, 'Cliente '||i);
  end loop;
  raise notice 'L3  50 filas sueltas caben                          esperado sin error: OK';
end $$;
-- La fila 51 (con su objeto metido por postgres, saltando el cubo): la para el disparador.
reset role;
insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('estimator-competitor-files', 'general/<UUID-A>/f51.pdf', '<UUID-A>', '{"size": 10, "mimetype": "application/pdf"}');
set local role authenticated;
set local request.jwt.claims to '{"sub":"<UUID-A>","role":"authenticated"}';
do $$ begin
  begin insert into public.estimator_competitor_files (quote_id, path, file_name, mime_type, size_bytes, customer_name)
          values (null, 'general/<UUID-A>/f51.pdf', 'f.pdf', 'application/pdf', 10, 'Cliente 51');
    raise notice 'L4  la fila suelta 51                               esperado ERROR: MAL, paso';
  exception when others then raise notice 'L4  esperado ERROR 23514: %', case when sqlstate = '23514' then 'OK' else 'MAL ('||sqlstate||' '||sqlerrm||')' end; end;
end $$;

-- 7. El ADMIN ve todo y quita lo de B.
set local request.jwt.claims to '{"sub":"<UUID-ADMIN>","role":"authenticated"}';
do $$ declare n int; m int; begin
  select count(*) into n from public.estimator_competitor_files where uploaded_by in ('<UUID-A>', '<UUID-B>');
  raise notice 'A1  admin ve todas (50 sueltas de A, 1 pegada, 1 de B) esperado 52: %', case when n = 52 then 'OK' else 'MAL '||n end;
  delete from storage.objects where bucket_id = 'estimator-competitor-files' and name = 'general/<UUID-B>/b.jpg'; get diagnostics n = row_count;
  delete from public.estimator_competitor_files where path = 'general/<UUID-B>/b.jpg'; get diagnostics m = row_count;
  raise notice 'A2  admin quita el objeto de B                      esperado 1: %', case when n = 1 then 'OK' else 'MAL '||n end;
  raise notice 'A3  admin quita la fila de B                        esperado 1: %', case when m = 1 then 'OK' else 'MAL '||m end;
end $$;

-- 8. anon, nada.
reset role;
set local role anon;
do $$ begin
  begin perform 1 from public.estimator_competitor_files limit 1;
    raise notice 'N1  anon lee la tabla                               esperado ERROR: MAL, paso';
  exception when others then raise notice 'N1  esperado ERROR 42501: %', case when sqlstate = '42501' then 'OK' else 'MAL ('||sqlstate||' '||sqlerrm||')' end; end;
end $$;

reset role;
ROLLBACK;
```

### Resultado del ensayo (2026-09-29, worker, contra producción, con ROLLBACK)

Con `<UUID-A>` un vendedor de RDZ Pharr, `<UUID-B>` uno de RDZ Brownsville, `<UUID-SIN-MODULO>` uno de RDZ McAllen sin
`estimator` y `<UUID-ADMIN>` un admin (guion: `scratchpad/w-quote-builder/ensayo.mjs`, que extrae este bloque, sustituye
los UUID y el `\i`, y comprueba que no hay `commit` y que acaba en `ROLLBACK`): **26 de 26 OK**. La autocomprobación de la
156 pasó dentro de la misma transacción.

Y cuatro mutantes de la migración, cada uno ensayado entero con `ROLLBACK`, para ver que la matriz los caza:

| Mutante | Lo caza |
|---|---|
| la política de `SELECT` vuelve a exigir ver la cotización | la autocomprobación (`156: la politica de SELECT aun mira estimator_quotes`) |
| el techo de sueltos en el cubo pasa a `< 51` | L2 (`el objeto 51 … MAL, paso`) |
| la rama suelta del cubo sin mirar que la carpeta sea la propia | V3 y B2 |
| el cubo legible sin el módulo | S2 (`MAL 3`) |

**Qué NO cubre la matriz:** la API de Storage de verdad (límite de tamaño y tipos del cubo, que no cambian), ni la
subida desde la pantalla contra la base: eso se mide después de aplicar, con un PDF pequeño subido como suelto y quitado.

## 7 · Mediciones de solo lectura (2026-09-29, `begin read only`)

- `estimator_competitor_files`: **0 filas**; objetos en el cubo: **0**. `estimator_quotes`: **1** fila.
- La 153 está aplicada (`schema_migrations`, 2026-09-28 17:29 UTC); la 155 también, así que el siguiente número es 156.
- Con el módulo `estimator` hoy: **4** perfiles, los 4 admin. Ningún vendedor lo tiene: hasta que se les conceda la
  casilla, la pestaña solo la ven los admin.

## 8 · Reversión (a la 153)

En una transacción propia, a mano. **Antes**, quitar los sueltos (`quote_id is null`): sus archivos con la API de Storage
y luego sus filas; si no, el `set not null` falla.

```sql
begin;
drop policy if exists "estimator_competitor_files select" on public.estimator_competitor_files;
drop policy if exists "estimator_competitor_files insert" on public.estimator_competitor_files;
drop policy if exists "estimator_competitor_files delete" on public.estimator_competitor_files;
create policy "estimator_competitor_files select" on public.estimator_competitor_files for select to authenticated
  using ((select public.has_estimator_access()) and exists (select 1 from public.estimator_quotes q where q.id = quote_id));
create policy "estimator_competitor_files insert" on public.estimator_competitor_files for insert to authenticated
  with check (public.estimator_can_attach(quote_id::text) and uploaded_by = (select auth.uid()));
create policy "estimator_competitor_files delete" on public.estimator_competitor_files for delete to authenticated
  using ((select public.has_estimator_access()) and ((select public.is_admin()) or uploaded_by = (select auth.uid()))
         and exists (select 1 from public.estimator_quotes q where q.id = quote_id));
drop policy if exists "estimator competitor files read"   on storage.objects;
drop policy if exists "estimator competitor files insert" on storage.objects;
create policy "estimator competitor files read" on storage.objects for select to authenticated
  using (bucket_id = 'estimator-competitor-files' and (select public.has_estimator_access())
         and exists (select 1 from public.estimator_quotes q where q.id::text = (storage.foldername(name))[1]));
create policy "estimator competitor files insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'estimator-competitor-files' and public.estimator_can_attach((storage.foldername(name))[1])
              and public.estimator_competitor_object_count((storage.foldername(name))[1]) < 5);
-- El disparador de la 153, literal: pegar la función estimator_competitor_files_guard() de 153_estimados_competencia.sql.
drop function if exists public.estimator_competitor_loose_count(text);
alter table public.estimator_competitor_files drop constraint if exists estimator_competitor_files_suelto;
alter table public.estimator_competitor_files drop constraint if exists estimator_competitor_files_cliente;
alter table public.estimator_competitor_files drop constraint if exists estimator_competitor_files_tienda;
alter table public.estimator_competitor_files drop constraint if exists estimator_competitor_files_estimado;
alter table public.estimator_competitor_files drop column if exists customer_name, drop column if exists store, drop column if exists estimate_num;
drop index if exists public.estimator_competitor_files_uploaded_idx;
alter table public.estimator_competitor_files alter column quote_id set not null;
delete from public.schema_migrations where name = '156_competencia_suelta.sql';
commit;
```

**La app no se rompe al revertir:** la pestaña vuelve a decir «falta actualizar la base (migración 156)» y la sección de
la cotización sigue como con la 153.

## 9 · Lo que NO se ha medido

- La subida por la API de Storage contra la base (el servicio, no Postgres): se mide tras aplicar.
- Cuánto ocupará: hoy 0 archivos.
