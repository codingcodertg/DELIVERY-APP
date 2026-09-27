# Plan 149 · El candado de ruta, compartido (`route_locks`)

Plan en papel exigido por `CLAUDE.md` («Antes de tocar RLS, triggers o permisos en producción» — aquí es **esquema y
políticas nuevas**). Molde: `docs/PLAN-147-prioridad.md` y la 128 (`driver_settings`).

**Estado (2026-09-27):** escrito por un worker en un worktree **sin `.env.local` y sin acceso a la base**. Todo sale de
**leer el repo** (`origin/main` = `aa6e3d85`, D-412) y de medir el **demo local**. Nada se ha ejecutado contra producción:
ni la migración, ni su autocomprobación, ni el ensayo de §6. **Pendiente de aprobar.**

**Pedido del dueño (2026-09-26/27, con los enlaces de OptimoRoute):** *«quiero que mires como funciona y lo copies y dime
como funciona para implementarlo en lo de nosotros»* (cita tal como la pasó el orquestador, no extraída del fichero de
sesión). En OptimoRoute una ruta bloqueada (`lockType: ROUTES`) la respeta todo el equipo y el planificador. Aquí, desde
D-411, el candado vivía en el `localStorage` de quien lo ponía.

**La migración está escrita y NO aplicada:** `supabase/migrations/149_route_locks.sql`. **Por qué 149 y no 148:** otra
rama (`/estimator`) puede estar escribiendo la 148; el registro (`schema_migrations`, 102) no exige números seguidos, y
`migrate-status` compara por nombre. Si la 148 no llega a existir, el hueco no molesta a nada.

---

## 0 · Resumen

| | Hoy (D-411) | Con la 149 |
|---|---|---|
| Dónde vive el candado | `localStorage` de quien lo pone | `public.route_locks`, una fila por (día, ruta) |
| Quién lo ve | solo esa persona, en ese navegador | admin, logística, gerente, office y almacén (con Entregas) |
| Quién lo pone y lo quita | cualquiera que abra el Gestor (en su navegador) | admin y logística |
| «Planificar el día» (servidor) | no lo conoce | el chofer bloqueado no entra al motor; sus órdenes quedan fuera del plan |
| «Publicar ruta» | — | si el plan toca una ruta bloqueada **después** de planificar, 409 `ROUTE_LOCKED` |
| La app antes de aplicar | — | sigue con `localStorage` y **lo dice** en el botón y en el aviso |

## 1 · Decisiones (para validar)

1. **Una tabla nueva, no una columna.** Ya se descartaron en D-411 `settings` (solo admin), `user_prefs` (por persona,
   claves con lista), `route_plans` (fotos de un plan) y `driver_availability` (significa «no disponible»).
2. **`lane` es texto: la clave de ruta del Gestor**, que es el NOMBRE del chofer (`deliveries.assigned_driver`) o el de la
   ruta temporal (`settings.route_buckets`). Sin FK a `profiles`: la clave que usa todo el Gestor es el nombre. Un chofer
   renombrado deja un candado huérfano de ese día, que no bloquea a nadie.
3. **Bloquear = insertar, desbloquear = borrar. Sin UPDATE** (ni grant ni política). Dos personas que bloquean a la vez: la
   segunda choca con la clave primaria (`23505`) y la app lo trata como «ya estaba bloqueada».
4. **`locked_by` / `locked_at` los pone la base** (disparador `security definer`, como `driver_settings_stamp` en la 128):
   el navegador no puede firmar por otro.
5. **Leen** los mismos roles que `driver_settings` (128): admin, logística, gerente, office, almacén, con Entregas.
   **Escriben** admin y logística. El chofer y ventas, nada. *Consecuencia:* alguien de otro rol con el permiso extra
   «Planificar rutas» (`route_plan`) ve el Gestor, pero su candado no se guarda en la base: la pantalla dice «No se pudo
   guardar el candado: …» (el fallo de RLS) y no cambia nada.
6. **No se podan filas.** Son decenas al mes. La app lee las de los últimos 14 días (como olvidaba el navegador).
7. **Sin tiempo real: se relee al volver a la pestaña** (foco / `visibilitychange`) y después de cada clic. Tiempo real
   pediría meter la tabla en la publicación `supabase_realtime` (otra sentencia en la migración, y un canal más abierto en
   cada Gestor) para un dato que cambia pocas veces al día. **Lo que no cubre:** dos personas con el Gestor abierto y a la
   vista a la vez no ven el candado de la otra hasta cambiar de pestaña o pulsar uno. Lo que sí está cubierto en el
   servidor: «Planificar» y «Publicar» leen la base en el momento.
8. **Lo que había en el `localStorage` no se sube a la base.** Al aplicar la 149, cada candado del navegador desaparece de
   la pantalla (la base manda). Son candados de un día; se vuelven a poner. Subirlos solos sería escribir en nombre de la
   persona sin que lo pida.

## 2 · Lo que cambia en la app (en el mismo commit; funciona con y sin la 149)

- `src/lib/rutas-bloqueadas.ts` sigue siendo **el único sitio** que lee y escribe el candado: `cargaCandados` (base si hay
  tabla; si no, navegador, con el porqué: `demo` / `sin_tabla` / `error`), `pulsaCandado` (escribe y relee; si falla, no
  cambia nada y devuelve el error; si la tabla desapareció, pasa al navegador), `dondeViveElCandado` (el texto),
  `rutasBloqueadasDelDia` y `choquesAlPublicar` (servidor). «Sin tabla» = `PGRST205` o `42P01` (`faltaLaTabla`);
  cualquier otro fallo es un fallo.
- **Gestor:** mismo botón 🔒/🔓; el título dice dónde vive («Compartido: lo ve todo logística…» / «Solo en este
  navegador: la base aún no tiene la tabla de candados (migración 149)…») y, con la base, **quién** la bloqueó.
- **«Planificar el día»** (`POST /api/route-plan`): lee los candados del día. Con tabla: el chofer bloqueado sale en «Hoy no
  rutean: X (ruta bloqueada 🔒)» y sus órdenes en «Fuera de este plan … (en una ruta bloqueada 🔒, se queda como está)».
  **Sin tabla**, planifica como antes y el panel lo dice en ámbar. **Con otro fallo, 500**: planificar sin saber qué está
  bloqueado movería rutas bloqueadas.
- **«Publicar ruta»**: si hay candados ese día y el plan asigna a una ruta bloqueada o mueve/reordena una orden que HOY está
  en una, **409 `ROUTE_LOCKED`** con las órdenes, y el panel pide planificar de nuevo. Y al chofer bloqueado **no** se le
  manda «Your route … changed: you have no stops now» (sus órdenes siguen siendo suyas).

## 3 · Inventario de lecturas y escrituras

| Quién | Qué | Tabla | Con |
|---|---|---|---|
| Gestor (navegador) | lee los candados de los últimos 14 días | `route_locks` select | sesión |
| Gestor (navegador) | bloquea / desbloquea | `route_locks` insert / delete | sesión |
| `POST /api/route-plan` | lee los del día | `route_locks` select | sesión (admin/logística) |
| `POST /api/route-plan/publish` | lee los del día; a quién están asignadas hoy las órdenes del plan | `route_locks`, `deliveries` select | sesión |
| — | **nada más**: no toca `deliveries`, `route_plans`, políticas ni grants de otras tablas | | |

## 4 · Qué NO debe romperse

- El Gestor antes de aplicar la 149 (D-411 tal cual, con el aviso de «solo en este navegador»).
- «Planificar el día» y «Publicar ruta» sin candados: mismo plan y mismos avisos que hoy (pruebas «sin candados, el mismo
  día se planifica como antes» y «sin candado, sí» en `candado-en-el-plan.test.ts`).
- Las flechas y «Asignar» sobre una ruta bloqueada siguen funcionando (D-411: el candado protege de lo automático).

## 5 · El SQL, literal

Ver `supabase/migrations/149_route_locks.sql`. La autocomprobación (`do $comprueba$`) exige: RLS encendida; **3**
políticas, ninguna `ALL` ni `UPDATE`, y que cubran select, insert y delete; `anon` sin SELECT/INSERT; `authenticated` sin
UPDATE, TRUNCATE, REFERENCES ni TRIGGER y con SELECT, INSERT y DELETE; y el disparador `route_locks_stamp` puesto.
Sin `begin`/`commit` propios. Sin `D-NEXT` dentro (numerar la decisión no cambia el checksum). Checksum en el registro:
`5af9c712f2adc0679fde3222c5cc247724cede84a758186ed2a679f315115abf` (`migrate-status --sum`; lo comprueba una prueba).

## 6 · Matriz de pruebas por rol, con ROLLBACK (la corre el orquestador)

**14 casos.** Crea sus filas dentro de la transacción; no depende de datos de producción ni los toca. Sustituir
`<UUID-ADMIN>`, `<UUID-LOGISTICA>`, `<UUID-GERENTE>`, `<UUID-OFFICE>` (`accounting`), `<UUID-ALMACEN>`, `<UUID-VENTAS>`,
`<UUID-CHOFER>` por perfiles de ese rol **con acceso al módulo de Entregas**. Se pega entero en `psql` desde la raíz del
repo. **Sin `commit` en ningún sitio.**

```sql
begin;

-- 0. La migración, dentro de la misma transacción (se deshace con el resto).
\i supabase/migrations/149_route_locks.sql

set local role authenticated;

-- A. LOGÍSTICA: bloquea, la base firma, no puede firmar por otro, desbloquea.
set local request.jwt.claims to '{"sub":"<UUID-LOGISTICA>","role":"authenticated"}';
do $$ declare n int; quien uuid; begin
  begin insert into public.route_locks (plan_date, lane, locked_by) values ('2099-01-01', 'ENSAYO 149 A', '<UUID-ADMIN>');
    select locked_by into quien from public.route_locks where plan_date = '2099-01-01' and lane = 'ENSAYO 149 A';
    raise notice 'A1  logística bloquea (firma la base, no el cliente) esperado <UUID-LOGISTICA>: %', case when quien = '<UUID-LOGISTICA>' then 'OK' else 'MAL '||coalesce(quien::text,'null') end;
  exception when others then raise notice 'A1  MAL: %', sqlerrm; end;
  begin insert into public.route_locks (plan_date, lane) values ('2099-01-01', 'ENSAYO 149 A');
    raise notice 'A2  bloquear lo ya bloqueado                      esperado ERROR 23505: MAL, pasó';
  exception when others then raise notice 'A2  esperado 23505: %', case when sqlstate = '23505' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
  begin insert into public.route_locks (plan_date, lane) values ('2099-01-01', '   ');
    raise notice 'A3  ruta en blanco                                esperado ERROR 23514: MAL, pasó';
  exception when others then raise notice 'A3  esperado 23514: %', case when sqlstate = '23514' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
  begin update public.route_locks set lane = 'otra' where plan_date = '2099-01-01';
    raise notice 'A4  UPDATE                                         esperado ERROR 42501: MAL, pasó';
  exception when others then raise notice 'A4  esperado 42501: %', case when sqlstate = '42501' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
end $$;

-- B. GERENTE, OFFICE, ALMACÉN: leen, no escriben.
set local request.jwt.claims to '{"sub":"<UUID-GERENTE>","role":"authenticated"}';
do $$ declare n int; begin
  select count(*) into n from public.route_locks where plan_date = '2099-01-01';
  raise notice 'B1  gerente lee                                    esperado 1: %', case when n = 1 then 'OK' else 'MAL '||n end;
  begin insert into public.route_locks (plan_date, lane) values ('2099-01-01', 'ENSAYO 149 B');
    raise notice 'B2  gerente bloquea                                esperado ERROR RLS: MAL, pasó';
  exception when others then raise notice 'B2  esperado 42501: %', case when sqlstate = '42501' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
  delete from public.route_locks where plan_date = '2099-01-01'; get diagnostics n = row_count;
  raise notice 'B3  gerente desbloquea                             esperado 0 filas: %', case when n = 0 then 'OK' else 'MAL '||n end;
end $$;
set local request.jwt.claims to '{"sub":"<UUID-OFFICE>","role":"authenticated"}';
do $$ declare n int; begin
  select count(*) into n from public.route_locks where plan_date = '2099-01-01';
  raise notice 'B4  office lee                                     esperado 1: %', case when n = 1 then 'OK' else 'MAL '||n end;
end $$;
set local request.jwt.claims to '{"sub":"<UUID-ALMACEN>","role":"authenticated"}';
do $$ declare n int; begin
  select count(*) into n from public.route_locks where plan_date = '2099-01-01';
  raise notice 'B5  almacén lee                                    esperado 1: %', case when n = 1 then 'OK' else 'MAL '||n end;
end $$;

-- C. VENTAS y CHOFER: ni leen ni escriben.
set local request.jwt.claims to '{"sub":"<UUID-VENTAS>","role":"authenticated"}';
do $$ declare n int; begin
  select count(*) into n from public.route_locks;
  raise notice 'C1  ventas lee                                     esperado 0: %', case when n = 0 then 'OK' else 'MAL '||n end;
end $$;
set local request.jwt.claims to '{"sub":"<UUID-CHOFER>","role":"authenticated"}';
do $$ declare n int; begin
  select count(*) into n from public.route_locks;
  raise notice 'C2  chofer lee                                     esperado 0: %', case when n = 0 then 'OK' else 'MAL '||n end;
  begin insert into public.route_locks (plan_date, lane) values ('2099-01-01', 'ENSAYO 149 C');
    raise notice 'C3  chofer bloquea                                 esperado ERROR RLS: MAL, pasó';
  exception when others then raise notice 'C3  esperado 42501: %', case when sqlstate = '42501' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
end $$;

-- D. ADMIN: bloquea y desbloquea lo que puso logística.
set local request.jwt.claims to '{"sub":"<UUID-ADMIN>","role":"authenticated"}';
do $$ declare n int; begin
  insert into public.route_locks (plan_date, lane) values ('2099-01-01', 'ENSAYO 149 D');
  delete from public.route_locks where plan_date = '2099-01-01'; get diagnostics n = row_count;
  raise notice 'D1  admin bloquea y desbloquea (la suya y la de logística) esperado 2 filas: %', case when n = 2 then 'OK' else 'MAL '||n end;
exception when others then raise notice 'D1  MAL: %', sqlerrm; end $$;

reset role;
ROLLBACK;
```

**Resumen — cada línea tiene que decir `OK`:** A1-A4 (4), B1-B5 (5), C1-C3 (3), D1 (1) = **13 líneas** con `raise notice`
(A2/A3/A4 son errores esperados). Más la autocomprobación de la migración, que se lanza sola en el paso 0: si falla, el
`\i` aborta y nada de lo demás cuenta.

**Si algún MAL no es de los esperados, parar**: no aplicar.

## 7 · Mediciones de solo lectura (para el orquestador; NO corridas)

```sql
-- M1. Antes de aplicar: que no exista ya (una 149 a medias).
select to_regclass('public.route_locks');
-- M2. Después: las políticas, literales.
select policyname, cmd, qual, with_check from pg_policies where schemaname = 'public' and tablename = 'route_locks' order by 1;
```

Y en la app, después de aplicar y con Vercel desplegado: bloquear una ruta en el Gestor → el título del botón dice
«Compartido…»; abrir el Gestor con otra cuenta de logística → la ve bloqueada (tras enfocar la pestaña).

## 8 · Reversión

En una transacción propia, a mano (también comentada al final del `.sql`):

```sql
drop table if exists public.route_locks;
drop function if exists public.route_locks_stamp();
delete from public.schema_migrations where name = '149_route_locks.sql';
```

Se pierden los candados puestos. **La app no se rompe:** sin la tabla, `faltaLaTabla` lo reconoce y la pantalla vuelve al
navegador y lo dice; «Planificar» y «Publicar» vuelven a no conocer los candados (como en D-411).

## 9 · Lo que NO se ha medido

- **Nada contra la base.** Ni la migración, ni su autocomprobación, ni la matriz.
- Que PostgREST conteste `PGRST205` para la tabla que falta en **esta** versión de Supabase: es lo que dice su
  documentación y lo que ya se vio con otras tablas; si contestara otro código, la pantalla lo leería como `error` (sigue
  con el navegador y lo dice igual, con otro texto) y «Planificar» devolvería **500** en vez de planificar sin candados.
  Lado seguro, pero hasta aplicar la 149 «Planificar el día» dejaría de funcionar: **comprobarlo justo después de fusionar**,
  antes de aplicar (un «Planificar el día» en producción, que no escribe órdenes ni avisa).
