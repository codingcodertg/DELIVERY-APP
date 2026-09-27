# Plan 148 · El Estimador: cotizaciones guardadas, una por estimado, y la aprobación del dueño

Plan en papel exigido por `CLAUDE.md` («Antes de tocar RLS, triggers o permisos en producción»: aquí son **dos tablas
nuevas, sus políticas, dos disparadores y la restricción `profiles_module_access_known`**). Molde: `docs/PLAN-147-prioridad.md`.

**Estado (2026-09-27):** escrito por un worker en un worktree **sin `.env.local` y sin acceso a la base**. Todo sale de
**leer el repo** (`origin/main` = `aa6e3d85`, D-412) y de medir el **demo local**. Nada se ha ejecutado contra producción: ni
la migración, ni su autocomprobación, ni el ensayo de §6. **Pendiente de aprobar.**

**Pedido del dueño (2026-09-27, T-0408):** *«"C:\Users\andre\Downloads\Estimate print outs app copy.docx" quiero que hagas una
estimator app asi como la de promo»*. El documento describe un «Quote Builder» interno cuya salida es una hoja para el cliente,
y una política con cuatro reglas; dos de ellas necesitan base:

> *«One quote only.»* · *«Do not create competing quotes. Search the estimate number first. If another sales representative
> owns the estimate, obtain their approval before proceeding.»*

**La migración está escrita y NO aplicada:** `supabase/migrations/148_estimator.sql`.

---

## 0 · Resumen

| | Hoy | Con la 148 |
|---|---|---|
| `profiles_module_access_known` | admite `deliveries, recruiting, timetracker, erp, promos` (140) | **+ `estimator`** |
| `public.estimator_quotes` | no existe | una fila por estimado (índice único `lower(btrim(estimate_num))`) |
| `public.estimator_approvals` | no existe | la petición de B al dueño A: `pending → approved / denied` |
| Quién ve una cotización | — | su dueño, los de **su tienda**, quien tenga su aprobación, el admin |
| Quién la edita | — | su dueño, quien tenga su aprobación, el admin (**la tienda no basta**) |
| Quién borra | — | **nadie** desde el cliente (sin `grant delete`) |
| La app antes de aplicar | — | arma e imprime, **no guarda**, y lo dice (`faltaLaTabla`, aviso ámbar); solo el admin entra (nadie más puede tener la palabra) |

## 1 · Decisiones (para validar)

1. **Una tabla con `jsonb` para cliente, entrega y líneas**, no una tabla de líneas. La cotización es un documento que se
   guarda y se reabre entero; nadie consulta «todas las líneas de 24x48». Las columnas que sí se filtran (`estimate_num`,
   `owner_id`, `store`) son columnas.
2. **El índice único es la regla «una sola cotización».** Dos vendedores no pueden tener cada uno la suya del mismo estimado:
   el segundo `insert` da `23505` y la pantalla dice «alguien acaba de guardarla, búscala otra vez».
3. **El dueño lo pone la base.** `estimator_quotes_guard` pone `owner_id = auth.uid()` al crear (salvo un admin que la cree a
   nombre de otro), `prepared_by = auth.uid()` en cada guardado, y la `store` del dueño. Un no-admin no puede cambiar ni el
   dueño ni el número. El cliente **no manda** esas columnas (`filaDeBorrador`).
4. **Ver ≠ editar.** Los de la misma tienda la ven (para no pisarse), pero editarla exige la aprobación del dueño: es lo que
   dice el documento. El admin no necesita permiso.
5. **Buscar cruza tiendas sin enseñar el cliente.** Un vendedor de otra tienda no ve la fila, pero tiene que saber que el
   estimado **existe y de quién es**, o crearía justo la cotización que compite. `estimator_find_estimate(p_num)` (definer)
   devuelve dueño, su tienda y el estado de MI petición; **nada** de `customer`, `lines`, `delivery` ni `sales_ext`.
6. **Las peticiones pendientes, por función**: `estimator_pending_approvals()` (definer) da el nombre de quien pide sin
   depender de la RLS de `profiles`.
7. **Helpers definer entre las dos tablas** (`estimator_is_quote_owner`, `estimator_has_approval`): las políticas de una
   tabla leen la otra, y a través de su RLS Postgres podría dar *infinite recursion detected in policy*. Se crean **después**
   de las tablas porque una función `language sql` se valida al crearla.
8. **Borrar un perfil no queda bloqueado**: `owner_id`/`prepared_by`/`decided_by` son `on delete set null`; sin dueño, solo el
   admin edita. `requested_by` es `on delete cascade` (una petición de alguien que ya no está no significa nada).
9. **Sin escalafón propio** (como promos): no hay `estimator_role`. Si el dueño quiere que un Gerente de Oficina edite las
   de su tienda sin pedir, es una rama más en la política de UPDATE.

## 2 · La pantalla (sin base, en el mismo commit)

`/estimator`, módulo `estimator` en `module_access`, tarjeta «Estimator / Estimador» en el hub, versión propia
(`APP_VERSIONS.estimator`, empieza en 0.1.0), puerta en `src/app/estimator/layout.tsx` calcada de la de promos. Lo que decide
vive en `src/lib/estimator/` y está probado sin navegador. Sin la 148, `almacen.buscar` / `pendientes` devuelven `sinTabla`
(PGRST205/PGRST202/42P01/42883 y **solo esos**) y la pantalla enseña el aviso ámbar, esconde «Guardar» y deja generar.

## 3 · Inventario de lecturas y escrituras

| Pieza | Qué | Cambia |
|---|---|---|
| `profiles_module_access_known` | `check` | **se reescribe** desde el cuerpo de la **140** + `'estimator'` |
| `public.has_estimator_access()`, `estimator_my_store()`, `estimator_is_quote_owner(uuid)`, `estimator_has_approval(uuid)` | helpers definer | nuevos |
| `public.estimator_find_estimate(text)`, `estimator_pending_approvals()` | lecturas definer | nuevas |
| `public.estimator_quotes`, `public.estimator_approvals` | tablas + RLS (3 políticas cada una: select/insert/update) | nuevas |
| `estimator_quotes_guard`, `estimator_approvals_guard` | disparadores `before insert or update` | nuevos |
| Cliente: `estimator_quotes` select/insert/update con `.select("id")`; `estimator_approvals` insert/update; las dos rpc | `src/lib/estimator/almacen.ts` | — |
| Cliente: `erp.app_products` (autocompletar por código) | **solo lectura**, con el cliente del ERP; sin el módulo ERP la puerta restrictiva de la 066 da cero filas y se escribe a mano | no se toca |
| `profiles.module_access` (conceder el módulo) | `updateUserEstimatorAccess` | escritura nueva, misma forma que promos |

## 4 · Qué NO debe romperse

- Conceder y quitar **cualquier otro módulo** (la restricción se reescribe: si se perdiera una palabra, esa concesión
  reventaría). La autocomprobación mira las seis y que `clockin` no vuelva.
- Las filas viejas con palabras que ya no valen: `not valid` se conserva (razón de la 095).
- Nada de promos, ERP ni Entregas lee estas tablas.

## 5 · El SQL, literal

Ver `supabase/migrations/148_estimator.sql`. La autocomprobación (`do $comprueba$`) exige: la restricción con las seis
palabras y sin `clockin`; el índice único; sin `DELETE` para `authenticated` ni `SELECT` para `anon`; RLS puesta; **3
políticas por tabla, ninguna `ALL` ni `DELETE`, todas mirando `has_estimator_access`, y las de UPDATE con `with check`**; los
dos disparadores colgados. Sin `begin`/`commit` propios y sin número de decisión dentro (numerar no cambia el checksum).

## 6 · Matriz de pruebas por rol, con ROLLBACK (la corre el orquestador)

**23 casos.** Crea sus filas dentro de la transacción; no toca datos de producción salvo `module_access` de los perfiles de
ensayo, **dentro** de la transacción (se deshace).

Sustituir:

- `<UUID-A>` y `<UUID-B>`: dos vendedores (`sales`) **de la misma tienda** (`profiles.store` igual y no vacía).
- `<UUID-C>`: un vendedor de **otra** tienda. `<UUID-SIN>`: alguien que no es admin, al que NO se le da el módulo.
- `<UUID-ADMIN>`: un admin.

Se pega entero en `psql` **desde la raíz del repo**. **Sin `commit` en ningún sitio.**

```sql
begin;

\i supabase/migrations/148_estimator.sql

-- 0. El módulo a los de ensayo (como postgres; se deshace con el ROLLBACK).
update public.profiles set module_access = array(select distinct unnest(coalesce(module_access, '{}') || array['estimator']))
 where id in ('<UUID-A>', '<UUID-B>', '<UUID-C>');
update public.profiles set module_access = array_remove(module_access, 'estimator') where id = '<UUID-SIN>';

set local role authenticated;

-- 1. A crea
set local request.jwt.claims to '{"sub":"<UUID-A>","role":"authenticated"}';
do $$ declare o uuid; s text; begin
  begin insert into public.estimator_quotes (id, estimate_num, lines) values ('14800000-0000-4000-8000-000000000001', 'ENS-148-1', '[]') returning owner_id, store into o, s;
    raise notice 'A1  A crea: dueño A y la tienda de A          %', case when o = '<UUID-A>' and s is not null then 'OK' else 'MAL '||coalesce(o::text,'null')||' '||coalesce(s,'null') end;
  exception when others then raise notice 'A1  MAL: %', sqlerrm; end;
  begin insert into public.estimator_quotes (id, estimate_num, owner_id) values ('14800000-0000-4000-8000-000000000002', 'ENS-148-2', '<UUID-C>') returning owner_id into o;
    raise notice 'A2  A crea a nombre de C: el dueño sigue A    %', case when o = '<UUID-A>' then 'OK' else 'MAL '||o end;
  exception when others then raise notice 'A2  MAL: %', sqlerrm; end;
  begin insert into public.estimator_quotes (estimate_num) values (' ens-148-1 ');
    raise notice 'A3  la segunda del mismo estimado           esperado ERROR: MAL, pasó';
  exception when others then raise notice 'A3  esperado 23505: %', case when sqlstate = '23505' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
  begin insert into public.estimator_approvals (quote_id) values ('14800000-0000-4000-8000-000000000001');
    raise notice 'A4  pedirse permiso a sí mismo              esperado ERROR: MAL, pasó';
  exception when others then raise notice 'A4  esperado ERROR: %', case when sqlerrm like 'You already own%' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
end $$;

-- 2. B, misma tienda: ve, no edita
set local request.jwt.claims to '{"sub":"<UUID-B>","role":"authenticated"}';
do $$ declare n int; begin
  select count(*) into n from public.estimator_quotes where id = '14800000-0000-4000-8000-000000000001';
  raise notice 'B1  B ve la de su tienda                     esperado 1: %', case when n = 1 then 'OK' else 'MAL '||n end;
  update public.estimator_quotes set project_summary = 'x' where id = '14800000-0000-4000-8000-000000000001'; get diagnostics n = row_count;
  raise notice 'B2  B la edita sin permiso                   esperado 0 filas: %', case when n = 0 then 'OK' else 'MAL '||n end;
end $$;

-- 3. C, otra tienda: no la ve, la encuentra sin datos del cliente, y pide
set local request.jwt.claims to '{"sub":"<UUID-C>","role":"authenticated"}';
do $$ declare n int; nom text; st text; begin
  select count(*) into n from public.estimator_quotes where id = '14800000-0000-4000-8000-000000000001';
  raise notice 'C1  C no ve la de otra tienda                esperado 0: %', case when n = 0 then 'OK' else 'MAL '||n end;
  select owner_name into nom from public.estimator_find_estimate(' ENS-148-1');
  raise notice 'C2  C la encuentra y sabe de quién es        %', case when nom is not null then 'OK ('||nom||')' else 'MAL null' end;
  begin insert into public.estimator_approvals (id, quote_id, status) values ('14800000-0000-4000-8000-0000000000a1', '14800000-0000-4000-8000-000000000001', 'approved') returning status into st;
    raise notice 'C3  C pide (aunque mande approved)           esperado pending: %', case when st = 'pending' then 'OK' else 'MAL '||st end;
  exception when others then raise notice 'C3  MAL: %', sqlerrm; end;
  begin update public.estimator_approvals set status = 'approved' where id = '14800000-0000-4000-8000-0000000000a1';
    raise notice 'C4  C se aprueba solo                        esperado ERROR: MAL, pasó';
  exception when others then raise notice 'C4  esperado ERROR: %', case when sqlerrm like 'Only the estimate owner%' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
  update public.estimator_quotes set project_summary = 'x' where id = '14800000-0000-4000-8000-000000000001'; get diagnostics n = row_count;
  raise notice 'C5  C la edita sin permiso                   esperado 0 filas: %', case when n = 0 then 'OK' else 'MAL '||n end;
end $$;

-- 4. A ve la petición y aprueba
set local request.jwt.claims to '{"sub":"<UUID-A>","role":"authenticated"}';
do $$ declare n int; d uuid; begin
  select count(*) into n from public.estimator_pending_approvals();
  raise notice 'A5  A ve 1 petición pendiente                %', case when n = 1 then 'OK' else 'MAL '||n end;
  update public.estimator_approvals set status = 'approved' where id = '14800000-0000-4000-8000-0000000000a1' returning decided_by into d;
  raise notice 'A6  A aprueba y queda quién                  %', case when d = '<UUID-A>' then 'OK' else 'MAL '||coalesce(d::text,'null') end;
end $$;

-- 5. C, con permiso
set local request.jwt.claims to '{"sub":"<UUID-C>","role":"authenticated"}';
do $$ declare n int; o uuid; p uuid; begin
  update public.estimator_quotes set project_summary = 'por C' where id = '14800000-0000-4000-8000-000000000001' returning owner_id, prepared_by into o, p;
  get diagnostics n = row_count;
  raise notice 'C6  C edita con permiso: dueño A, preparó C  %', case when n = 1 and o = '<UUID-A>' and p = '<UUID-C>' then 'OK' else 'MAL '||n end;
  begin update public.estimator_quotes set owner_id = '<UUID-C>' where id = '14800000-0000-4000-8000-000000000001';
    raise notice 'C7  C se hace dueño                          esperado ERROR: MAL, pasó';
  exception when others then raise notice 'C7  esperado ERROR: %', case when sqlerrm like 'Only an admin can change%' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
  begin update public.estimator_quotes set estimate_num = 'OTRO' where id = '14800000-0000-4000-8000-000000000001';
    raise notice 'C8  C cambia el número                       esperado ERROR: MAL, pasó';
  exception when others then raise notice 'C8  esperado ERROR: %', case when sqlerrm like 'The estimate number%' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
  begin delete from public.estimator_quotes where id = '14800000-0000-4000-8000-000000000001';
    raise notice 'X1  borrar                                   esperado ERROR: MAL, pasó';
  exception when others then raise notice 'X1  esperado 42501: %', case when sqlstate = '42501' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
end $$;

-- 6. Sin el módulo
set local request.jwt.claims to '{"sub":"<UUID-SIN>","role":"authenticated"}';
do $$ declare n int; begin
  select count(*) into n from public.estimator_quotes;
  raise notice 'S1  sin módulo no ve nada                    esperado 0: %', case when n = 0 then 'OK' else 'MAL '||n end;
  select count(*) into n from public.estimator_find_estimate('ENS-148-1');
  raise notice 'S2  sin módulo no encuentra                  esperado 0: %', case when n = 0 then 'OK' else 'MAL '||n end;
  begin insert into public.estimator_quotes (estimate_num) values ('ENS-148-S');
    raise notice 'S3  sin módulo crea                          esperado ERROR: MAL, pasó';
  exception when others then raise notice 'S3  esperado 42501: %', case when sqlstate = '42501' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
end $$;

-- 7. Admin
set local request.jwt.claims to '{"sub":"<UUID-ADMIN>","role":"authenticated"}';
do $$ declare n int; o uuid; begin
  select count(*) into n from public.estimator_quotes where estimate_num like 'ENS-148-%';
  raise notice 'AD1 el admin ve las dos                      esperado 2: %', case when n = 2 then 'OK' else 'MAL '||n end;
  update public.estimator_quotes set owner_id = '<UUID-B>' where id = '14800000-0000-4000-8000-000000000002' returning owner_id into o;
  raise notice 'AD2 el admin cambia el dueño                 %', case when o = '<UUID-B>' then 'OK' else 'MAL' end;
end $$;

-- 8. anon
reset role; set local role anon;
do $$ begin
  perform 1 from public.estimator_quotes limit 1;
  raise notice 'N1  anon lee                                 esperado ERROR: MAL, pasó';
exception when others then raise notice 'N1  esperado 42501: %', case when sqlstate = '42501' then 'OK' else 'MAL ('||sqlerrm||')' end; end $$;

ROLLBACK;
```

**Lo que debe salir — 23 líneas, todas `OK`:** A1-A6, B1-B2, C1-C8, X1, S1-S3, AD1-AD2, N1. **Si alguna dice `MAL`, parar:
no aplicar.**

## 7 · Mediciones de solo lectura (para el orquestador; NO corridas)

```sql
-- M1. Antes: que no exista ya nada con estos nombres (una 148 a medias).
select to_regclass('public.estimator_quotes'), to_regclass('public.estimator_approvals'), to_regprocedure('public.has_estimator_access()');
-- M2. Antes y después: la restricción tal cual.
select pg_get_constraintdef(oid) from pg_constraint where conname = 'profiles_module_access_known';
-- M3. Que la 140 sigue siendo la última que la tocó (si otra rama la reescribió, fusionar las palabras a mano).
```

## 8 · Reversión

Comentada al final del `.sql`: quitar la palabra de los perfiles **antes**, `drop` de las tablas (**borra las cotizaciones**:
de eso protege el `pg_dump`) y de las funciones, y la restricción **exactamente** como la dejó la 140. La app no se rompe: sin
la tabla vuelve al modo «arma e imprime, no guarda».

## 9 · Lo que NO se ha medido

- **Nada contra la base.** Ni la migración, ni su autocomprobación, ni la matriz. Las pruebas del repo
  (`src/lib/estimator/modulo.test.ts`) miran el texto del `.sql` (palabras de la restricción, índice único, políticas, que la
  búsqueda no devuelva el cliente, el checksum); no sustituyen aplicarla.
- Que el orden «disparador `BEFORE` → `WITH CHECK`» ponga el dueño antes de la política de INSERT (A1/A2 lo prueban).
- Que un `update ... returning` de C6 pase la política de SELECT por `estimator_has_approval` (C es de otra tienda).
- **Otra rama que toque `profiles_module_access_known`** a la vez (otro módulo nuevo) chocaría aquí: la última en fusionarse
  tiene que llevar las palabras de las dos.
