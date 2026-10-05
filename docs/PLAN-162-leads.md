# PLAN 162 · Leads: el banco por tienda, el pool personal con tope y el cierre con resultado

**Estado:** migración `supabase/migrations/162_leads.sql` **ESCRITA Y NO APLICADA**. Ensayada contra producción con
`ROLLBACK` el 2026-10-04 (sección 6): **80 OK, 0 MAL**. Aplicarla es del orquestador, después del merge, con respaldo y
`migrate-status` antes y después. **Los datos NO van en la migración**: los carga un guion aparte (sección 9).

Patrón: `docs/PLAN-155-encuestas.md` (y, antes, `docs/PLAN-A-2a-profiles-rls.md`).

---

## 0 · Resumen

El dueño (2026-10-04) pidió llevar a una app el Excel de leads de permisos de obra (TDLR) que se había limpiado y
clasificado: un **banco** de leads repartido en **pools por tienda más cercana**, un **pool personal de hasta 10 leads**
por vendedor que se sacan del banco, y que el puesto **solo se libere al cerrar el lead con una nota y un resultado**. Lo
que vuelve al banco vuelve con la etiqueta y la nota de quien lo soltó; una venta se queda con quien la logró.

La 162 trae: la palabra `leads` en la restricción de módulos, `has_leads_access()`, tres tablas (`leads`, `lead_events`,
`lead_settings`), RLS de solo lectura para quien tiene el módulo, y nueve funciones `security definer` que son la única
forma de escribir. **No concede el módulo a nadie y no mete ni un lead.**

## 1 · Decisiones (para validar)

1. **Los pools son la columna «Tienda RTG más cercana» del Excel, tal cual** (`RDZ Brownsville`, `RDZ Edinburg`,
   `RDZ McAllen`, `RDZ Mission`, `RDZ Pharr`, `RDZ Weslaco`). Medido en producción (solo lectura): `profiles.store` usa
   exactamente esos nombres, así que el vendedor entra en el pool de su tienda comparando texto con texto. El único lead
   sin tienda (su celda es «—») cae en el pool `No store` («Sin tienda» en pantalla). Hay un pool `RDZ Mission` aunque el
   encargo no lo nombraba: está en el Excel (51 leads) y hay un vendedor con esa tienda.
2. **Un tope, por persona, en la base** (`lead_settings.max_open`, 10 de partida, de 1 a 100). Lo cambia el admin desde la
   pestaña Admin de la propia app (no desde Ajustes del hub: así el módulo no toca `settings`). **Bajarlo no le quita nada
   a nadie**: quien quede por encima no toma otro hasta bajar.
3. **«Visitado – en seguimiento» NO es un resultado de cierre: es una nota de avance** (`lead_note`). El lead sigue
   abierto, sigue a su nombre y **sigue ocupando su puesto**. Razón: el dueño quiere que el puesto se libere cuando el lead
   tiene un fin («qué fin tuvo»); una visita no es un fin, y si liberara puesto, «visitado» sería la forma de acumular
   leads sin cerrarlos. La nota de avance sirve además para que el tablero sepa que el lead no está abandonado.
4. **Cinco resultados de cierre**, todos con nota obligatoria y todos liberan el puesto:

   | Resultado | Estado en que queda | Dueño | ¿En el banco? |
   |---|---|---|---|
   | `sale` Venta lograda | `won` | se queda con quien la logró, para siempre | no |
   | `bad_lead` No es buen lead | `free` | nadie | sí, con la etiqueta roja y la nota |
   | `nothing` No se logró nada | `free` | nadie | sí, con la etiqueta y la nota |
   | `reassign` Mejor reasignarlo | `free` | nadie | sí, con la etiqueta y la nota |
   | `review` Ocupa revisión | `review` | nadie | no: cola del admin, nadie lo puede tomar |

   **«No es buen lead» vuelve al banco, no se archiva solo.** Propuesta razonada: el dueño dijo que eso «regresa a la pool
   pero ya va a ir con esa tag», y la opinión de una persona no debería sacar un lead del banco para todos. Va con etiqueta
   roja y la nota, a la vista del siguiente; **archivarlo es decisión del admin** (`lead_admin_archive`).
5. **La etiqueta se queda puesta cuando otro toma el lead**, hasta el cierre siguiente: es «visible para el siguiente»
   también después de tomarlo. El historial completo vive aparte, en `lead_events`.
6. **Quien cierra un lead puede volver a tomarlo.** No se prohíbe: el tope ya impide acumular, y prohibirlo obligaría a
   guardar «quién no puede tomar qué».
7. **Reasignar (admin) no mira el tope.** Es una decisión del admin; la persona, si queda por encima, no toma otro hasta
   bajar. El admin también puede liberar una venta (corregir un error) y archivar.
8. **El admin entra siempre** y puede tomar leads como cualquiera (su propio tope de 10), igual que en Encuestas y el
   Estimador.
9. **Nombres copiados, sin claves foráneas a `profiles`** (`holder_name`, `last_by_name`, `actor_name`, `subject_name`):
   el historial no se puede modificar (un disparador rechaza `update`/`delete`/`truncate`), así que no puede depender de
   que la persona siga existiendo; y borrar a un usuario no falla ni deja un lead en un estado imposible. Consecuencia
   aceptada: **si se borra a alguien con leads abiertos, siguen a su nombre hasta que el admin los libere**, y si alguien
   cambia de nombre, lo ya escrito conserva el viejo.
10. **La carga va por guion, no por la pantalla.** Medido: el lector normal de `exceljs` (el único que funciona en el
    navegador) revienta con este Excel (`Cannot read properties of undefined (reading 'comments')`); el lector por flujo,
    que solo existe en Node, lo lee bien (566 filas). La función `leads_import(jsonb)` para el admin queda creada por si un
    día se importa desde la pantalla, pero hoy la pantalla solo enseña el comando.
11. **El mapa de columnas vive en la base** (`leads_import_rows`): el guion manda cada fila con las cabeceras del Excel
    como claves y no traduce nada. Así hay una sola copia del mapa, y es la que se ensayó.
12. **Se cargan los 566, también los 213 «No sirve»**; la pantalla entra con el filtro «Sirve + podría servir» (353) y los
    demás están a un toque. Así el banco es el Excel entero («todas las leads en una lista») sin que un vendedor gaste un
    puesto por descuido en una franquicia.
13. **El contacto de un lead que tiene otra persona no se pinta** (la tarjeta sale apagada, bloqueada, con quién lo
    tiene). **Es una regla de la pantalla, no de la base**: la RLS deja leer la fila entera a quien tiene el módulo. Si se
    quiere que de verdad no lo pueda leer, hace falta otra migración (una vista o una función).

## 2 · Datos personales

`leads` guarda **nombre, teléfono y dirección postal del dueño de cada obra**, el nombre y teléfono del inquilino y del
despacho de diseño, y el nombre de quien tramitó el permiso. Son **registros públicos de TDLR (TABS)**, pero quien tiene
el módulo los lee **todos, de todas las tiendas** (los pools son una forma de ordenar, no un permiso). Por eso el módulo
se concede persona por persona y la casilla de Usuarios lo dice. La pantalla no baja la dirección postal del dueño ni el
nombre del tramitador (no los pide), pero la base no se lo impide a quien tenga el módulo.

## 3 · Inventario de lecturas y escrituras

| Objeto | Quién lee | Quién escribe | Cómo |
|---|---|---|---|
| `public.leads` | `authenticated` con el módulo (política `leads select`) | nadie por la API | solo las funciones |
| `public.lead_events` | ídem (`lead_events select`) | nadie por la API; **nadie** puede `update`/`delete`/`truncate` | solo las funciones insertan |
| `public.lead_settings` | ídem (`lead_settings select`) | nadie por la API | `leads_set_cap` |
| `lead_take(uuid)` | — | quien tiene el módulo | toma un lead libre si le queda puesto |
| `lead_note(uuid, text)` | — | quien lo tiene abierto | nota de avance |
| `lead_close(uuid, text, text)` | — | quien lo tiene abierto | cierra con resultado y nota |
| `lead_admin_release(uuid, text)` | — | admin | devuelve al banco |
| `lead_admin_assign(uuid, uuid, text)` | — | admin | se lo da a alguien con el módulo |
| `lead_admin_archive(uuid, text)` | — | admin | fuera del banco |
| `leads_set_cap(integer)` | — | admin | cambia el tope |
| `leads_import(jsonb)` | — | admin | carga filas (hoy sin pantalla) |
| `leads_import_rows(jsonb, uuid)` | — | **solo `service_role` y postgres** | la carga de verdad; la usa el guion |
| `profiles.module_access` | como hasta ahora | como hasta ahora | la restricción acepta `leads` |

La app lee además `profiles (id, full_name, store, role, module_access)` para la lista «asignar a» del admin: la política
`profiles select` ya es `true` (medido), no cambia.

**Códigos de error propios**, para que la pantalla los traduzca: `LD001` pool lleno · `LD002` el lead no está libre ·
`LD003` falta la nota · `LD004` no está abierto en tu pool. Lo demás: `42501` (sin permiso), `22023` (dato inválido),
`P0002` (no existe).

## 4 · Qué NO debe romperse

- **Los módulos que ya hay.** La restricción se rehace con las siete palabras de la 155 más `leads`, `not valid` como
  siempre. La autocomprobación de la migración falla si falta alguna o si vuelve `clockin`.
- **Nadie gana ni pierde acceso.** La 162 no escribe en `profiles`. Tras el ensayo: 0 perfiles con `leads`.
- **`alter table profiles`** toma un candado exclusivo sobre `profiles` mientras dura la transacción: aplicar con
  `set lock_timeout = '3s'` y fuera de hora punta.
- **La app sin la 162**: la pantalla dice «falta aplicar la migración 162» (códigos `PGRST205`, `PGRST202`, `42P01`,
  `42883`) en vez de un error rojo o un banco vacío.

## 5 · El SQL, literal

`supabase/migrations/162_leads.sql`. Sin `begin`/`commit` propios. Termina con una autocomprobación (`do $comprueba$`) que
aborta la transacción si: la restricción no acepta las ocho palabras o acepta `clockin`; alguna de las tres tablas no
tiene RLS, no tiene exactamente una política o no es de SELECT con `has_leads_access`; `anon` tiene cualquier privilegio
o `authenticated` tiene algo más que SELECT; `anon` puede ejecutar alguna función, o `authenticated` la carga interna;
`lead_settings` no tiene exactamente una fila.

**Sobre la atomicidad de `lead_take`** (lo que el ensayo de una sola sesión NO puede medir, ver sección 10):

- *Dos personas, el mismo lead.* El `update … where id = p_lead and status = 'free'` toma el candado de la fila. La
  segunda transacción espera; cuando la primera confirma, Postgres (READ COMMITTED) reevalúa el `where` sobre la fila
  nueva, ya no está `free`, no actualiza nada y la función lanza `LD002`.
- *Una persona, dos pestañas, dos leads distintos con 9 abiertos.* Sin más, las dos contarían 9 y las dos tomarían. Por
  eso la función toma antes `pg_advisory_xact_lock` con una clave derivada del id de la persona: sus propios intentos se
  ponen en fila, y el segundo cuenta 10.

## 6 · Matriz de pruebas por rol, con ROLLBACK (la corre el orquestador)

**80 casos con OK/MAL + 4 informativos (X1–X4).** Crea sus filas dentro de la transacción; lo único de producción que
toca es `module_access` de los perfiles de ensayo, **dentro** de la transacción (se deshace).

Sustituir: `<UUID-ADMIN>` (`admin`), `<UUID-VENTAS>` (`sales`), `<UUID-GERENTE>` (`manager`), `<UUID-SIN-MODULO>` (cualquiera
que no sea admin: se usó un chofer) y `<FILAS-DEL-EXCEL>` (el JSON de las filas del Excel, como literal `jsonb`; el guion
de ensayo lo saca con `leeFilas()` de `scripts/leads/importa-leads.mjs`. Si se corre a mano sin el Excel, poner
`'[]'::jsonb`: X1–X5 saldrán a cero).

Se pega entero en `psql` **desde la raíz del repo** (el `\i` es relativo). **Sin `commit` en ningún sitio.** Antes:
`set lock_timeout = '3s'`.

**Ensayado el 2026-10-04 contra producción, con ROLLBACK** (admin `acf43ad5…`, ventas `4760e4ef…`, gerente `caf1a337…`, sin
módulo: el primer chofer por id): **80 OK, 0 MAL**. Informativos: X1 `nuevas 566, actualizadas 0, saltadas 0`; X2 por pool
`RDZ Brownsville 140 · RDZ Edinburg 112 · RDZ McAllen 79 · RDZ Mission 51 · RDZ Pharr 68 · RDZ Weslaco 115 · No store 1`;
X3 `sin fecha de registro 0, sin costo 0, sin distancia 1, sin teléfono del dueño 0`; X4 `fechas de registro de 2023-10-02
a 2026-09-23`. Después del rollback se comprobó en producción: `leads` no existe, 0 perfiles con `leads`, la restricción
sigue sin `leads`, y `162_leads.sql` no está en `schema_migrations`.

Un error de la matriz corregido en el ensayo, que conviene saber: la primera versión esperaba `46281 → 2026-09-17`; es
**2026-09-16** (la función estaba bien, la cuenta a mano no).

```sql
begin;

-- 0. La migración, dentro de la misma transacción (se deshace con el resto).
\i supabase/migrations/162_leads.sql

-- 0b. Preparación, como postgres (todo se deshace con el ROLLBACK): VENTAS y GERENTE con el módulo,
--     SIN-MODULO sin él. Sin sub puesto (con uno, guard_clockin_access_change rechaza la escritura).
update public.profiles set module_access = array_append(array_remove(coalesce(module_access, '{}'), 'leads'), 'leads') where id in ('<UUID-VENTAS>', '<UUID-GERENTE>');
update public.profiles set module_access = array_remove(module_access, 'leads') where id = '<UUID-SIN-MODULO>';

-- P. La carga, con 13 filas INVENTADAS (más una sin TABS, que se salta). Claves = cabeceras del Excel.
do $$
declare r jsonb; filas jsonb := '[]'::jsonb; i int;
begin
  for i in 1..13 loop
    filas := filas || jsonb_build_object(
      'TABS Project #', 'ENSAYO-' || lpad(i::text, 2, '0'), U&'Tienda RTG m\00E1s cercana', case when i = 13 then U&'\2014' else 'RDZ Ensayo' end,
      'Distancia aprox. (millas)', i * 1.5, U&'Categor\00EDa', 'Sirve', 'Tipo de proyecto', 'Ensayo', 'Project Name', 'Proyecto de ensayo ' || i,
      'Registered Date', 46281, 'Est. Start Date', '2026-11-01', 'Estimated Cost', '$1,250,000', 'Square Footage', 1980,
      'Site Address', i || ' Calle Inventada', 'Site City', 'Ensayo', 'Owner Name', 'Dueño Inventado', 'Owner Phone', '(956) 555-01' || lpad(i::text, 2, '0'));
  end loop;
  filas := filas || jsonb_build_object('Project Name', 'sin TABS');
  r := public.leads_import_rows(filas, null);
  raise notice 'P1  carga: 13 nuevas, 0 actualizadas, 1 saltada                    %', case when r->>'inserted' = '13' and r->>'updated' = '0' and r->>'skipped' = '1' then 'OK' else 'MAL ' || r::text end;
  raise notice 'P2  la tienda «—» cae en el pool «No store»; el resto en el suyo   %', case when r->'by_pool'->>'No store' = '1' and r->'by_pool'->>'RDZ Ensayo' = '12' then 'OK' else 'MAL ' || r::text end;
  for i in 1..13 loop
    perform set_config('ensayo.l' || lpad(i::text, 2, '0'), (select id::text from public.leads where tabs_project = 'ENSAYO-' || lpad(i::text, 2, '0')), true);
  end loop;
end $$;
do $$ begin raise notice 'P3  46281 -> 2026-09-16; texto AAAA-MM-DD; «$1,250,000» -> número  %', case when ((select registered_date = date '2026-09-16' and est_start_date = date '2026-11-01' and estimated_cost = 1250000 and square_footage = 1980 from public.leads where id = current_setting('ensayo.l01')::uuid)) then 'OK' else 'MAL' end; exception when others then raise notice 'P3  46281 -> 2026-09-16; texto AAAA-MM-DD; «$1,250,000» -> número  MAL (% %)', sqlstate, sqlerrm; end $$;
do $$ begin raise notice 'P4  todos nacen libres, sin dueño, y con su evento «imported»      %', case when ((select count(*) from public.leads where status = 'free' and holder is null) = 13 and (select count(*) from public.lead_events where kind = 'imported') = 13) then 'OK' else 'MAL' end; exception when others then raise notice 'P4  todos nacen libres, sin dueño, y con su evento «imported»      MAL (% %)', sqlstate, sqlerrm; end $$;

-- C. Las restricciones de las tablas, sin pasar por las funciones (como postgres).
do $$ begin update public.leads set status = 'taken' where id = current_setting('ensayo.l01')::uuid; raise notice 'C1  tabla: tomado sin dueño                                        esperado 23514: MAL, pasó'; exception when others then raise notice 'C1  tabla: tomado sin dueño                                        esperado 23514: %', case when sqlstate = '23514' then 'OK' else 'MAL (' || sqlstate || ' ' || sqlerrm || ')' end; end $$;
do $$ begin update public.leads set holder = '<UUID-VENTAS>' where id = current_setting('ensayo.l01')::uuid; raise notice 'C2  tabla: libre con dueño                                         esperado 23514: MAL, pasó'; exception when others then raise notice 'C2  tabla: libre con dueño                                         esperado 23514: %', case when sqlstate = '23514' then 'OK' else 'MAL (' || sqlstate || ' ' || sqlerrm || ')' end; end $$;
do $$ begin update public.leads set status = 'lost' where id = current_setting('ensayo.l01')::uuid; raise notice 'C3  tabla: estado desconocido                                      esperado 23514: MAL, pasó'; exception when others then raise notice 'C3  tabla: estado desconocido                                      esperado 23514: %', case when sqlstate = '23514' then 'OK' else 'MAL (' || sqlstate || ' ' || sqlerrm || ')' end; end $$;
do $$ begin insert into public.leads (tabs_project, pool) values ('ENSAYO-01', 'x'); raise notice 'C4  tabla: TABS repetido                                           esperado 23505: MAL, pasó'; exception when others then raise notice 'C4  tabla: TABS repetido                                           esperado 23505: %', case when sqlstate = '23505' then 'OK' else 'MAL (' || sqlstate || ' ' || sqlerrm || ')' end; end $$;
do $$ begin update public.lead_events set note = 'x'; raise notice 'C5  historial: update                                              esperado 42501: MAL, pasó'; exception when others then raise notice 'C5  historial: update                                              esperado 42501: %', case when sqlstate = '42501' then 'OK' else 'MAL (' || sqlstate || ' ' || sqlerrm || ')' end; end $$;
do $$ begin delete from public.lead_events; raise notice 'C6  historial: delete                                              esperado 42501: MAL, pasó'; exception when others then raise notice 'C6  historial: delete                                              esperado 42501: %', case when sqlstate = '42501' then 'OK' else 'MAL (' || sqlstate || ' ' || sqlerrm || ')' end; end $$;
do $$ begin truncate public.lead_events; raise notice 'C7  historial: truncate                                            esperado 42501: MAL, pasó'; exception when others then raise notice 'C7  historial: truncate                                            esperado 42501: %', case when sqlstate = '42501' then 'OK' else 'MAL (' || sqlstate || ' ' || sqlerrm || ')' end; end $$;
do $$ begin update public.lead_settings set max_open = 0; raise notice 'C8  tope: 0 no vale                                                esperado 23514: MAL, pasó'; exception when others then raise notice 'C8  tope: 0 no vale                                                esperado 23514: %', case when sqlstate = '23514' then 'OK' else 'MAL (' || sqlstate || ' ' || sqlerrm || ')' end; end $$;
do $$ begin insert into public.lead_settings (id) values (false); raise notice 'C9  tope: segunda fila                                             esperado 23514: MAL, pasó'; exception when others then raise notice 'C9  tope: segunda fila                                             esperado 23514: %', case when sqlstate = '23514' then 'OK' else 'MAL (' || sqlstate || ' ' || sqlerrm || ')' end; end $$;

-- N. anon: nada.
set local role anon;
do $$ begin perform 1 from public.leads limit 1; raise notice 'N1  anon lee leads                                                 esperado 42501: MAL, pasó'; exception when others then raise notice 'N1  anon lee leads                                                 esperado 42501: %', case when sqlstate = '42501' then 'OK' else 'MAL (' || sqlstate || ' ' || sqlerrm || ')' end; end $$;
do $$ begin perform 1 from public.lead_events limit 1; raise notice 'N2  anon lee el historial                                          esperado 42501: MAL, pasó'; exception when others then raise notice 'N2  anon lee el historial                                          esperado 42501: %', case when sqlstate = '42501' then 'OK' else 'MAL (' || sqlstate || ' ' || sqlerrm || ')' end; end $$;
do $$ begin perform public.lead_take(current_setting('ensayo.l01')::uuid); raise notice 'N3  anon toma                                                      esperado 42501: MAL, pasó'; exception when others then raise notice 'N3  anon toma                                                      esperado 42501: %', case when sqlstate = '42501' then 'OK' else 'MAL (' || sqlstate || ' ' || sqlerrm || ')' end; end $$;
do $$ begin perform public.leads_import('[]'::jsonb); raise notice 'N4  anon importa                                                   esperado 42501: MAL, pasó'; exception when others then raise notice 'N4  anon importa                                                   esperado 42501: %', case when sqlstate = '42501' then 'OK' else 'MAL (' || sqlstate || ' ' || sqlerrm || ')' end; end $$;
reset role;

-- S. Con sesión pero SIN el módulo: no ve ni una fila y no escribe.
set local role authenticated;
set local request.jwt.claims to '{"sub":"<UUID-SIN-MODULO>","role":"authenticated"}';
do $$ begin raise notice 'S1  sin módulo: 0 leads, 0 eventos, 0 ajustes                      %', case when ((select count(*) from public.leads) = 0 and (select count(*) from public.lead_events) = 0 and (select count(*) from public.lead_settings) = 0) then 'OK' else 'MAL' end; exception when others then raise notice 'S1  sin módulo: 0 leads, 0 eventos, 0 ajustes                      MAL (% %)', sqlstate, sqlerrm; end $$;
do $$ begin perform public.lead_take(current_setting('ensayo.l01')::uuid); raise notice 'S2  sin módulo: tomar                                              esperado 42501: MAL, pasó'; exception when others then raise notice 'S2  sin módulo: tomar                                              esperado 42501: %', case when sqlstate = '42501' then 'OK' else 'MAL (' || sqlstate || ' ' || sqlerrm || ')' end; end $$;
do $$ begin perform public.lead_note(current_setting('ensayo.l01')::uuid, 'x'); raise notice 'S3  sin módulo: nota                                               esperado 42501: MAL, pasó'; exception when others then raise notice 'S3  sin módulo: nota                                               esperado 42501: %', case when sqlstate = '42501' then 'OK' else 'MAL (' || sqlstate || ' ' || sqlerrm || ')' end; end $$;
do $$ begin perform public.lead_close(current_setting('ensayo.l01')::uuid, 'nothing', 'x'); raise notice 'S4  sin módulo: cerrar                                             esperado 42501: MAL, pasó'; exception when others then raise notice 'S4  sin módulo: cerrar                                             esperado 42501: %', case when sqlstate = '42501' then 'OK' else 'MAL (' || sqlstate || ' ' || sqlerrm || ')' end; end $$;
do $$ begin insert into public.leads (tabs_project, pool) values ('X', 'x'); raise notice 'S5  sin módulo: insert directo                                     esperado 42501: MAL, pasó'; exception when others then raise notice 'S5  sin módulo: insert directo                                     esperado 42501: %', case when sqlstate = '42501' then 'OK' else 'MAL (' || sqlstate || ' ' || sqlerrm || ')' end; end $$;
do $$ begin perform public.leads_import_rows('[]'::jsonb, null); raise notice 'S6  sin módulo: carga interna                                      esperado 42501: MAL, pasó'; exception when others then raise notice 'S6  sin módulo: carga interna                                      esperado 42501: %', case when sqlstate = '42501' then 'OK' else 'MAL (' || sqlstate || ' ' || sqlerrm || ')' end; end $$;

-- A. VENTAS, con el módulo.
reset role;
reset request.jwt.claims;
set local role authenticated;
set local request.jwt.claims to '{"sub":"<UUID-VENTAS>","role":"authenticated"}';
do $$ begin raise notice 'A1  con módulo: lee los 13 leads y el tope (10)                    %', case when ((select count(*) from public.leads) = 13 and (select max_open from public.lead_settings) = 10) then 'OK' else 'MAL' end; exception when others then raise notice 'A1  con módulo: lee los 13 leads y el tope (10)                    MAL (% %)', sqlstate, sqlerrm; end $$;
do $$ begin perform public.lead_take(current_setting('ensayo.l01')::uuid); raise notice 'A2  A toma L01: queda tomado, a su nombre                          %', case when ((select status = 'taken' and holder = '<UUID-VENTAS>' and holder_name is not null and taken_at is not null from public.leads where id = current_setting('ensayo.l01')::uuid)) then 'OK' else 'MAL' end; exception when others then raise notice 'A2  A toma L01: queda tomado, a su nombre                          MAL (% %)', sqlstate, sqlerrm; end $$;
do $$ begin perform public.lead_take(current_setting('ensayo.l01')::uuid); raise notice 'A3  A vuelve a tomar L01                                           esperado LD002: MAL, pasó'; exception when others then raise notice 'A3  A vuelve a tomar L01                                           esperado LD002: %', case when sqlstate = 'LD002' then 'OK' else 'MAL (' || sqlstate || ' ' || sqlerrm || ')' end; end $$;
do $$ begin update public.leads set status = 'free', holder = null where id = current_setting('ensayo.l01')::uuid; raise notice 'A4  update directo de leads                                        esperado 42501: MAL, pasó'; exception when others then raise notice 'A4  update directo de leads                                        esperado 42501: %', case when sqlstate = '42501' then 'OK' else 'MAL (' || sqlstate || ' ' || sqlerrm || ')' end; end $$;
do $$ begin insert into public.lead_events (lead_id, kind) values (current_setting('ensayo.l01')::uuid, 'taken'); raise notice 'A5  insert directo en el historial                                 esperado 42501: MAL, pasó'; exception when others then raise notice 'A5  insert directo en el historial                                 esperado 42501: %', case when sqlstate = '42501' then 'OK' else 'MAL (' || sqlstate || ' ' || sqlerrm || ')' end; end $$;
do $$ begin perform public.leads_import_rows('[]'::jsonb, null); raise notice 'A6  A: carga interna                                               esperado 42501: MAL, pasó'; exception when others then raise notice 'A6  A: carga interna                                               esperado 42501: %', case when sqlstate = '42501' then 'OK' else 'MAL (' || sqlstate || ' ' || sqlerrm || ')' end; end $$;
do $$ begin perform public.leads_import('[]'::jsonb); raise notice 'A7  A: importar (solo admin)                                       esperado 42501: MAL, pasó'; exception when others then raise notice 'A7  A: importar (solo admin)                                       esperado 42501: %', case when sqlstate = '42501' then 'OK' else 'MAL (' || sqlstate || ' ' || sqlerrm || ')' end; end $$;
do $$ begin perform public.leads_set_cap(50); raise notice 'A8  A: cambiar el tope (solo admin)                                esperado 42501: MAL, pasó'; exception when others then raise notice 'A8  A: cambiar el tope (solo admin)                                esperado 42501: %', case when sqlstate = '42501' then 'OK' else 'MAL (' || sqlstate || ' ' || sqlerrm || ')' end; end $$;
do $$ begin perform public.lead_admin_release(current_setting('ensayo.l01')::uuid, 'x'); raise notice 'A9  A: liberar (solo admin)                                        esperado 42501: MAL, pasó'; exception when others then raise notice 'A9  A: liberar (solo admin)                                        esperado 42501: %', case when sqlstate = '42501' then 'OK' else 'MAL (' || sqlstate || ' ' || sqlerrm || ')' end; end $$;
do $$ begin perform public.lead_admin_assign(current_setting('ensayo.l02')::uuid, '<UUID-VENTAS>', 'x'); raise notice 'A10 A: asignar (solo admin)                                        esperado 42501: MAL, pasó'; exception when others then raise notice 'A10 A: asignar (solo admin)                                        esperado 42501: %', case when sqlstate = '42501' then 'OK' else 'MAL (' || sqlstate || ' ' || sqlerrm || ')' end; end $$;
do $$ begin perform public.lead_admin_archive(current_setting('ensayo.l01')::uuid, 'x'); raise notice 'A11 A: archivar (solo admin)                                       esperado 42501: MAL, pasó'; exception when others then raise notice 'A11 A: archivar (solo admin)                                       esperado 42501: %', case when sqlstate = '42501' then 'OK' else 'MAL (' || sqlstate || ' ' || sqlerrm || ')' end; end $$;

-- B. GERENTE, con el módulo: lo de A no es suyo.
set local role authenticated;
set local request.jwt.claims to '{"sub":"<UUID-GERENTE>","role":"authenticated"}';
do $$ begin perform public.lead_take(current_setting('ensayo.l01')::uuid); raise notice 'B1  B toma L01, que tiene A                                        esperado LD002: MAL, pasó'; exception when others then raise notice 'B1  B toma L01, que tiene A                                        esperado LD002: %', case when sqlstate = 'LD002' then 'OK' else 'MAL (' || sqlstate || ' ' || sqlerrm || ')' end; end $$;
do $$ begin perform public.lead_close(current_setting('ensayo.l01')::uuid, 'sale', 'mío'); raise notice 'B2  B cierra L01, que tiene A                                      esperado LD004: MAL, pasó'; exception when others then raise notice 'B2  B cierra L01, que tiene A                                      esperado LD004: %', case when sqlstate = 'LD004' then 'OK' else 'MAL (' || sqlstate || ' ' || sqlerrm || ')' end; end $$;
do $$ begin perform public.lead_note(current_setting('ensayo.l01')::uuid, 'x'); raise notice 'B3  B anota L01, que tiene A                                       esperado LD004: MAL, pasó'; exception when others then raise notice 'B3  B anota L01, que tiene A                                       esperado LD004: %', case when sqlstate = 'LD004' then 'OK' else 'MAL (' || sqlstate || ' ' || sqlerrm || ')' end; end $$;
do $$ begin perform public.lead_take(current_setting('ensayo.l12')::uuid); raise notice 'B4  B toma L12                                                     %', case when ((select status from public.leads where id = current_setting('ensayo.l12')::uuid) = 'taken' and (select count(*) from public.leads where holder = '<UUID-GERENTE>' and status = 'taken') = 1) then 'OK' else 'MAL' end; exception when others then raise notice 'B4  B toma L12                                                     MAL (% %)', sqlstate, sqlerrm; end $$;

-- T. El tope.
set local role authenticated;
set local request.jwt.claims to '{"sub":"<UUID-VENTAS>","role":"authenticated"}';
do $$ begin perform public.lead_take(current_setting('ensayo.l02')::uuid); perform public.lead_take(current_setting('ensayo.l03')::uuid); perform public.lead_take(current_setting('ensayo.l04')::uuid); perform public.lead_take(current_setting('ensayo.l05')::uuid); perform public.lead_take(current_setting('ensayo.l06')::uuid); perform public.lead_take(current_setting('ensayo.l07')::uuid); perform public.lead_take(current_setting('ensayo.l08')::uuid); perform public.lead_take(current_setting('ensayo.l09')::uuid); perform public.lead_take(current_setting('ensayo.l10')::uuid); raise notice 'T1  A toma L02..L10: 10 abiertos                                   %', case when ((select count(*) from public.leads where holder = '<UUID-VENTAS>' and status = 'taken') = 10) then 'OK' else 'MAL' end; exception when others then raise notice 'T1  A toma L02..L10: 10 abiertos                                   MAL (% %)', sqlstate, sqlerrm; end $$;
do $$ begin perform public.lead_take(current_setting('ensayo.l11')::uuid); raise notice 'T2  el 11.º se rechaza                                             esperado LD001: MAL, pasó'; exception when others then raise notice 'T2  el 11.º se rechaza                                             esperado LD001: %', case when sqlstate = 'LD001' then 'OK' else 'MAL (' || sqlstate || ' ' || sqlerrm || ')' end; end $$;
do $$ begin raise notice 'T3  y L11 sigue libre                                              %', case when ((select status from public.leads where id = current_setting('ensayo.l11')::uuid) = 'free') then 'OK' else 'MAL' end; exception when others then raise notice 'T3  y L11 sigue libre                                              MAL (% %)', sqlstate, sqlerrm; end $$;
do $$ begin perform public.lead_note(current_setting('ensayo.l01')::uuid, '   '); raise notice 'T4  nota de avance vacía                                           esperado LD003: MAL, pasó'; exception when others then raise notice 'T4  nota de avance vacía                                           esperado LD003: %', case when sqlstate = 'LD003' then 'OK' else 'MAL (' || sqlstate || ' ' || sqlerrm || ')' end; end $$;
do $$ begin perform public.lead_note(current_setting('ensayo.l01')::uuid, '  Visitado, vuelvo el lunes  '); raise notice 'T5  nota de avance: sigue abierto y queda escrita                  %', case when ((select status = 'taken' and follow_up_note = 'Visitado, vuelvo el lunes' from public.leads where id = current_setting('ensayo.l01')::uuid) and (select count(*) from public.leads where holder = '<UUID-VENTAS>' and status = 'taken') = 10) then 'OK' else 'MAL' end; exception when others then raise notice 'T5  nota de avance: sigue abierto y queda escrita                  MAL (% %)', sqlstate, sqlerrm; end $$;
do $$ begin perform public.lead_take(current_setting('ensayo.l11')::uuid); raise notice 'T6  la nota de avance NO libera puesto: el 11.º sigue rechazado    esperado LD001: MAL, pasó'; exception when others then raise notice 'T6  la nota de avance NO libera puesto: el 11.º sigue rechazado    esperado LD001: %', case when sqlstate = 'LD001' then 'OK' else 'MAL (' || sqlstate || ' ' || sqlerrm || ')' end; end $$;
do $$ begin perform public.lead_close(current_setting('ensayo.l01')::uuid, 'nothing', null); raise notice 'T7  cerrar sin nota                                                esperado LD003: MAL, pasó'; exception when others then raise notice 'T7  cerrar sin nota                                                esperado LD003: %', case when sqlstate = 'LD003' then 'OK' else 'MAL (' || sqlstate || ' ' || sqlerrm || ')' end; end $$;
do $$ begin perform public.lead_close(current_setting('ensayo.l01')::uuid, 'sale', '   '); raise notice 'T8  cerrar con nota en blanco                                      esperado LD003: MAL, pasó'; exception when others then raise notice 'T8  cerrar con nota en blanco                                      esperado LD003: %', case when sqlstate = 'LD003' then 'OK' else 'MAL (' || sqlstate || ' ' || sqlerrm || ')' end; end $$;
do $$ begin perform public.lead_close(current_setting('ensayo.l01')::uuid, 'visited', 'x'); raise notice 'T9  cerrar con un resultado que no existe                          esperado 22023: MAL, pasó'; exception when others then raise notice 'T9  cerrar con un resultado que no existe                          esperado 22023: %', case when sqlstate = '22023' then 'OK' else 'MAL (' || sqlstate || ' ' || sqlerrm || ')' end; end $$;
do $$ begin perform public.lead_close(current_setting('ensayo.l01')::uuid, 'nothing', repeat('x', 2001)); raise notice 'T10 nota de 2001 caracteres                                        esperado 22023: MAL, pasó'; exception when others then raise notice 'T10 nota de 2001 caracteres                                        esperado 22023: %', case when sqlstate = '22023' then 'OK' else 'MAL (' || sqlstate || ' ' || sqlerrm || ')' end; end $$;
do $$ begin perform public.lead_close(current_setting('ensayo.l01')::uuid, 'nothing', 'No contestan'); raise notice 'T11 «no se logró nada»: vuelve al banco con etiqueta, nota y quién %', case when ((select status = 'free' and holder is null and last_outcome = 'nothing' and last_note = 'No contestan' and last_by = '<UUID-VENTAS>' and last_by_name is not null and follow_up_note is null from public.leads where id = current_setting('ensayo.l01')::uuid)) then 'OK' else 'MAL' end; exception when others then raise notice 'T11 «no se logró nada»: vuelve al banco con etiqueta, nota y quién MAL (% %)', sqlstate, sqlerrm; end $$;
do $$ begin perform public.lead_take(current_setting('ensayo.l11')::uuid); raise notice 'T12 cerrar libera el puesto: ahora sí toma L11                     %', case when ((select status from public.leads where id = current_setting('ensayo.l11')::uuid) = 'taken' and (select count(*) from public.leads where holder = '<UUID-VENTAS>' and status = 'taken') = 10) then 'OK' else 'MAL' end; exception when others then raise notice 'T12 cerrar libera el puesto: ahora sí toma L11                     MAL (% %)', sqlstate, sqlerrm; end $$;
do $$ begin perform public.lead_close(current_setting('ensayo.l01')::uuid, 'nothing', 'otra vez'); raise notice 'T13 cerrar dos veces el mismo                                      esperado LD004: MAL, pasó'; exception when others then raise notice 'T13 cerrar dos veces el mismo                                      esperado LD004: %', case when sqlstate = 'LD004' then 'OK' else 'MAL (' || sqlstate || ' ' || sqlerrm || ')' end; end $$;
do $$ begin perform public.lead_close(current_setting('ensayo.l02')::uuid, 'sale', 'Vendido: 1,200 sqft'); raise notice 'T14 «venta lograda»: queda suyo, fuera del banco, y libera puesto  %', case when ((select status = 'won' and holder = '<UUID-VENTAS>' and last_outcome = 'sale' from public.leads where id = current_setting('ensayo.l02')::uuid) and (select count(*) from public.leads where holder = '<UUID-VENTAS>' and status = 'taken') = 9) then 'OK' else 'MAL' end; exception when others then raise notice 'T14 «venta lograda»: queda suyo, fuera del banco, y libera puesto  MAL (% %)', sqlstate, sqlerrm; end $$;
do $$ begin perform public.lead_close(current_setting('ensayo.l03')::uuid, 'review', 'El teléfono no es de la obra'); raise notice 'T15 «ocupa revisión»: a la cola del admin, sin dueño               %', case when ((select status = 'review' and holder is null and last_outcome = 'review' from public.leads where id = current_setting('ensayo.l03')::uuid)) then 'OK' else 'MAL' end; exception when others then raise notice 'T15 «ocupa revisión»: a la cola del admin, sin dueño               MAL (% %)', sqlstate, sqlerrm; end $$;
do $$ begin perform public.lead_close(current_setting('ensayo.l04')::uuid, 'reassign', 'Queda en Weslaco'); raise notice 'T16 «mejor reasignarlo»: vuelve al banco con la etiqueta           %', case when ((select status = 'free' and last_outcome = 'reassign' from public.leads where id = current_setting('ensayo.l04')::uuid)) then 'OK' else 'MAL' end; exception when others then raise notice 'T16 «mejor reasignarlo»: vuelve al banco con la etiqueta           MAL (% %)', sqlstate, sqlerrm; end $$;
do $$ begin perform public.lead_close(current_setting('ensayo.l05')::uuid, 'bad_lead', 'Es una franquicia'); raise notice 'T17 «no es buen lead»: vuelve al banco con la etiqueta             %', case when ((select status = 'free' and last_outcome = 'bad_lead' from public.leads where id = current_setting('ensayo.l05')::uuid) and (select count(*) from public.leads where holder = '<UUID-VENTAS>' and status = 'taken') = 6) then 'OK' else 'MAL' end; exception when others then raise notice 'T17 «no es buen lead»: vuelve al banco con la etiqueta             MAL (% %)', sqlstate, sqlerrm; end $$;

-- V. Lo que ve y puede el siguiente.
set local role authenticated;
set local request.jwt.claims to '{"sub":"<UUID-GERENTE>","role":"authenticated"}';
do $$ begin perform public.lead_take(current_setting('ensayo.l02')::uuid); raise notice 'V1  la venta de A no vuelve al banco: B no la toma                 esperado LD002: MAL, pasó'; exception when others then raise notice 'V1  la venta de A no vuelve al banco: B no la toma                 esperado LD002: %', case when sqlstate = 'LD002' then 'OK' else 'MAL (' || sqlstate || ' ' || sqlerrm || ')' end; end $$;
do $$ begin perform public.lead_take(current_setting('ensayo.l03')::uuid); raise notice 'V2  lo que está en revisión no se toma                             esperado LD002: MAL, pasó'; exception when others then raise notice 'V2  lo que está en revisión no se toma                             esperado LD002: %', case when sqlstate = 'LD002' then 'OK' else 'MAL (' || sqlstate || ' ' || sqlerrm || ')' end; end $$;
do $$ begin perform public.lead_take(current_setting('ensayo.l04')::uuid); raise notice 'V3  B toma el reasignado y SIGUE viendo la etiqueta y la nota de A %', case when ((select status = 'taken' and holder = '<UUID-GERENTE>' and last_outcome = 'reassign' and last_note = 'Queda en Weslaco' and last_by = '<UUID-VENTAS>' from public.leads where id = current_setting('ensayo.l04')::uuid)) then 'OK' else 'MAL' end; exception when others then raise notice 'V3  B toma el reasignado y SIGUE viendo la etiqueta y la nota de A MAL (% %)', sqlstate, sqlerrm; end $$;
do $$ begin raise notice 'V4  B ve en el historial de L01: imported, taken, progress, closed %', case when ((select array_agg(kind order by id) from public.lead_events where lead_id = current_setting('ensayo.l01')::uuid) = array['imported', 'taken', 'progress', 'closed']) then 'OK' else 'MAL' end; exception when others then raise notice 'V4  B ve en el historial de L01: imported, taken, progress, closed MAL (% %)', sqlstate, sqlerrm; end $$;
do $$ begin raise notice 'V5  y el cierre lleva resultado, nota y nombre                     %', case when ((select outcome = 'nothing' and note = 'No contestan' and actor = '<UUID-VENTAS>' and actor_name is not null from public.lead_events where lead_id = current_setting('ensayo.l01')::uuid and kind = 'closed')) then 'OK' else 'MAL' end; exception when others then raise notice 'V5  y el cierre lleva resultado, nota y nombre                     MAL (% %)', sqlstate, sqlerrm; end $$;

-- D. El admin.
set local role authenticated;
set local request.jwt.claims to '{"sub":"<UUID-ADMIN>","role":"authenticated"}';
do $$ begin perform public.leads_set_cap(3); raise notice 'D1  bajar el tope a 3                                              %', case when ((select max_open from public.lead_settings) = 3) then 'OK' else 'MAL' end; exception when others then raise notice 'D1  bajar el tope a 3                                              MAL (% %)', sqlstate, sqlerrm; end $$;
do $$ begin perform public.leads_set_cap(0); raise notice 'D2  tope 0                                                         esperado 22023: MAL, pasó'; exception when others then raise notice 'D2  tope 0                                                         esperado 22023: %', case when sqlstate = '22023' then 'OK' else 'MAL (' || sqlstate || ' ' || sqlerrm || ')' end; end $$;
set local role authenticated;
set local request.jwt.claims to '{"sub":"<UUID-VENTAS>","role":"authenticated"}';
do $$ begin perform public.lead_take(current_setting('ensayo.l01')::uuid); raise notice 'D3  con el tope en 3, A (6 abiertos) no toma otro                  esperado LD001: MAL, pasó'; exception when others then raise notice 'D3  con el tope en 3, A (6 abiertos) no toma otro                  esperado LD001: %', case when sqlstate = 'LD001' then 'OK' else 'MAL (' || sqlstate || ' ' || sqlerrm || ')' end; end $$;
do $$ begin raise notice 'D4  y bajar el tope no le quitó ninguno                            %', case when ((select count(*) from public.leads where holder = '<UUID-VENTAS>' and status = 'taken') = 6) then 'OK' else 'MAL' end; exception when others then raise notice 'D4  y bajar el tope no le quitó ninguno                            MAL (% %)', sqlstate, sqlerrm; end $$;
set local role authenticated;
set local request.jwt.claims to '{"sub":"<UUID-ADMIN>","role":"authenticated"}';
do $$ begin perform public.leads_set_cap(10); raise notice 'D5  volver a 10                                                    %', case when ((select max_open from public.lead_settings) = 10) then 'OK' else 'MAL' end; exception when others then raise notice 'D5  volver a 10                                                    MAL (% %)', sqlstate, sqlerrm; end $$;
do $$ begin perform public.lead_admin_release(current_setting('ensayo.l03')::uuid, 'Teléfono corregido'); raise notice 'D6  liberar con nota lo que estaba en revisión: libre, etiqueta del admin %', case when ((select status = 'free' and holder is null and last_outcome = 'admin' and last_note = 'Teléfono corregido' from public.leads where id = current_setting('ensayo.l03')::uuid)) then 'OK' else 'MAL' end; exception when others then raise notice 'D6  liberar con nota lo que estaba en revisión: libre, etiqueta del admin MAL (% %)', sqlstate, sqlerrm; end $$;
do $$ begin perform public.lead_admin_release(current_setting('ensayo.l03')::uuid, null); raise notice 'D7  liberar lo que ya está libre                                   esperado LD002: MAL, pasó'; exception when others then raise notice 'D7  liberar lo que ya está libre                                   esperado LD002: %', case when sqlstate = 'LD002' then 'OK' else 'MAL (' || sqlstate || ' ' || sqlerrm || ')' end; end $$;
do $$ begin perform public.lead_admin_release(current_setting('ensayo.l04')::uuid, null); raise notice 'D8  liberar SIN nota un lead tomado conserva la etiqueta que traía %', case when ((select status = 'free' and last_outcome = 'reassign' and last_note = 'Queda en Weslaco' from public.leads where id = current_setting('ensayo.l04')::uuid)) then 'OK' else 'MAL' end; exception when others then raise notice 'D8  liberar SIN nota un lead tomado conserva la etiqueta que traía MAL (% %)', sqlstate, sqlerrm; end $$;
do $$ begin perform public.lead_admin_assign(current_setting('ensayo.l13')::uuid, '<UUID-VENTAS>', 'Es de tu zona'); raise notice 'D9  asignar L13 a A: tomado a su nombre                            %', case when ((select status = 'taken' and holder = '<UUID-VENTAS>' from public.leads where id = current_setting('ensayo.l13')::uuid) and (select count(*) from public.leads where holder = '<UUID-VENTAS>' and status = 'taken') = 7) then 'OK' else 'MAL' end; exception when others then raise notice 'D9  asignar L13 a A: tomado a su nombre                            MAL (% %)', sqlstate, sqlerrm; end $$;
do $$ begin perform public.lead_admin_assign(current_setting('ensayo.l01')::uuid, '<UUID-SIN-MODULO>', null); raise notice 'D10 asignar a quien no tiene el módulo                             esperado 22023: MAL, pasó'; exception when others then raise notice 'D10 asignar a quien no tiene el módulo                             esperado 22023: %', case when sqlstate = '22023' then 'OK' else 'MAL (' || sqlstate || ' ' || sqlerrm || ')' end; end $$;
do $$ begin perform public.lead_admin_archive(current_setting('ensayo.l05')::uuid, 'Franquicia'); raise notice 'D11 archivar L05: fuera del banco                                  %', case when ((select status = 'archived' and holder is null from public.leads where id = current_setting('ensayo.l05')::uuid)) then 'OK' else 'MAL' end; exception when others then raise notice 'D11 archivar L05: fuera del banco                                  MAL (% %)', sqlstate, sqlerrm; end $$;
do $$ begin perform public.lead_admin_release(current_setting('ensayo.l02')::uuid, 'No era venta'); raise notice 'D12 liberar una venta (corrección): vuelve al banco                %', case when ((select status = 'free' and holder is null from public.leads where id = current_setting('ensayo.l02')::uuid)) then 'OK' else 'MAL' end; exception when others then raise notice 'D12 liberar una venta (corrección): vuelve al banco                MAL (% %)', sqlstate, sqlerrm; end $$;
do $$ begin perform public.lead_take(current_setting('ensayo.l01')::uuid); raise notice 'D13 el admin, sin la casilla, toma un lead (entra siempre)         %', case when ((select holder = '<UUID-ADMIN>' from public.leads where id = current_setting('ensayo.l01')::uuid)) then 'OK' else 'MAL' end; exception when others then raise notice 'D13 el admin, sin la casilla, toma un lead (entra siempre)         MAL (% %)', sqlstate, sqlerrm; end $$;
set local role authenticated;
set local request.jwt.claims to '{"sub":"<UUID-VENTAS>","role":"authenticated"}';
do $$ begin perform public.lead_take(current_setting('ensayo.l05')::uuid); raise notice 'D14 lo archivado no se toma                                        esperado LD002: MAL, pasó'; exception when others then raise notice 'D14 lo archivado no se toma                                        esperado LD002: %', case when sqlstate = 'LD002' then 'OK' else 'MAL (' || sqlstate || ' ' || sqlerrm || ')' end; end $$;

-- R. Re-importar NO pisa lo tomado ni el historial. Y luego, el Excel de verdad.
reset role;
reset request.jwt.claims;
do $$
declare r jsonb; antes bigint; despues bigint; filas jsonb := '[]'::jsonb; i int;
begin
  select count(*) into antes from public.lead_events;
  for i in 1..13 loop
    filas := filas || jsonb_build_object('TABS Project #', 'ensayo-' || lpad(i::text, 2, '0'), U&'Tienda RTG m\00E1s cercana', 'RDZ Ensayo', 'Project Name', 'Nombre nuevo ' || i);
  end loop;
  r := public.leads_import_rows(filas, null);
  select count(*) into despues from public.lead_events;
  raise notice 'R1  re-import: 0 nuevas, 13 actualizadas (TABS sin mirar mayúsculas) %', case when r->>'inserted' = '0' and r->>'updated' = '13' and r->>'total' = '13' then 'OK' else 'MAL ' || r::text end;
  raise notice 'R2  los datos del Excel sí cambian (nombre, pool)                  %', case when (select project_name = 'Nombre nuevo 13' and pool = 'RDZ Ensayo' from public.leads where id = current_setting('ensayo.l13')::uuid) then 'OK' else 'MAL' end;
  raise notice 'R3  lo tomado sigue tomado, por quien era, con su etiqueta         %', case when (select status = 'taken' and holder = '<UUID-VENTAS>' from public.leads where id = current_setting('ensayo.l13')::uuid) and (select status = 'archived' from public.leads where id = current_setting('ensayo.l05')::uuid) and (select last_note = 'Teléfono corregido' from public.leads where id = current_setting('ensayo.l03')::uuid) and (select count(*) from public.leads where holder = '<UUID-VENTAS>' and status = 'taken') = 7 then 'OK' else 'MAL' end;
  raise notice 'R4  y el historial no ganó ni perdió filas                         %', case when antes = despues then 'OK' else 'MAL ' || antes || ' -> ' || despues end;
end $$;

-- X. El Excel real. <FILAS-DEL-EXCEL> es el JSON de las filas (lo pone el guion de ensayo, leyéndolo con
--    scripts/leads/importa-leads.mjs). A mano y con la 162 ya aplicada, lo mismo se mide con:
--    node scripts/leads/importa-leads.mjs <xlsx> --ensayo
do $$
declare r jsonb; r2 jsonb;
begin
  r := public.leads_import_rows(<FILAS-DEL-EXCEL>, null);
  raise notice 'X1  Excel: nuevas %, actualizadas %, saltadas %, total en la tabla %', r->>'inserted', r->>'updated', r->>'skipped', r->>'total';
  raise notice 'X2  por pool: %', r->'by_pool';
  raise notice 'X3  sin fecha de registro: %, sin costo: %, sin distancia: %, sin teléfono del dueño: %',
    (select count(*) from public.leads where tabs_project not like 'ENSAYO-%' and registered_date is null),
    (select count(*) from public.leads where tabs_project not like 'ENSAYO-%' and estimated_cost is null),
    (select count(*) from public.leads where tabs_project not like 'ENSAYO-%' and distance_miles is null),
    (select count(*) from public.leads where tabs_project not like 'ENSAYO-%' and owner_phone is null);
  raise notice 'X4  fechas de registro: de % a %', (select min(registered_date) from public.leads where tabs_project not like 'ENSAYO-%'), (select max(registered_date) from public.leads where tabs_project not like 'ENSAYO-%');
  r2 := public.leads_import_rows(<FILAS-DEL-EXCEL>, null);
  raise notice 'X5  cargar el mismo Excel otra vez: 0 nuevas                       %', case when r2->>'inserted' = '0' and r2->>'updated' = r->>'inserted' and r2->>'total' = r->>'total' then 'OK' else 'MAL ' || (r2 - 'by_pool')::text end;
end $$;

-- M. Nadie recibió el módulo por la migración (los dos del ensayo se pusieron a mano arriba).
do $$ begin raise notice 'M1  perfiles con «leads» = los 2 del ensayo                        %', case when (select count(*) from public.profiles where 'leads' = any(coalesce(module_access, '{}'))) = 2 then 'OK' else 'MAL' end; end $$;

ROLLBACK;
```

Los casos que pidió el encargo, y dónde están: **A toma** (A2) · **B no puede tomar el mismo** (B1) · **el 11.º se
rechaza** (T2, y T6 tras una nota de avance) · **cerrar libera** (T12) · **venta no vuelve al banco** (T14, V1) · **«no se
logró» vuelve con etiqueta** (T11) · **sin módulo nada** (S1–S6; anon N1–N4) · **sin nota no cierra** (T7, T8).

## 7 · Mediciones de solo lectura (hechas el 2026-10-04; repetirlas antes de aplicar)

- `schema_migrations`: aplicadas hasta `155_encuestas.sql`. Las 156–161 están en el repo sin aplicar; **la 162 no depende
  de ninguna de ellas** (ninguna toca `profiles_module_access_known`: la definen la 088, 095, 140, 148, 155 y ahora la 162).
- La restricción en producción es exactamente la de la 155:
  `CHECK ((module_access IS NULL) OR (module_access <@ ARRAY['deliveries','recruiting','timetracker','erp','promos','estimator','surveys'])) NOT VALID`.
- `profiles.store` usa los mismos nombres que el Excel (`RDZ Brownsville`, `RDZ Edinburg`, `RDZ McAllen`, `RDZ Mission`,
  `RDZ Pharr`, `RDZ Weslaco`); 12 de ventas con tienda (ninguno en RDZ Weslaco) y 2 sin ella; 4 admins sin tienda.
- La política `profiles select` es `true`: cualquiera con sesión lee los nombres (la app los usa para «asignar a»).
- `is_admin()` existe y es `security definer`. `public.leads` y `public.lead_events` no existen.
- El Excel (`RTG-permit-leads-CATEGORIAS-2026-09-24.xlsx`): 566 filas, 566 TABS distintos, 0 sin TABS. Por categoría:
  286 «Sirve – usa piso», 67 «Might be useful», 54 «No sirve – no lleva piso», 159 «No sirve – cadena / franquicia».

## 8 · Reversión

Al final de `162_leads.sql`, comentada, para pegar a mano en una transacción propia. **Borra los leads, su estado y su
historial**: de eso protege el `pg_dump`. Primero quita `leads` de los perfiles que lo tengan (si no, la siguiente
escritura de esos perfiles falla contra la restricción vieja), luego funciones y tablas, y deja la restricción
**exactamente** como la dejó la 155. La app no se rompe: sin las tablas dice que falta la 162.

## 9 · Lo que le toca al orquestador (en este orden)

1. **Respaldo** (`pg_dump` reciente guardado, o respaldo activo).
2. `node scripts/db/migrate-status.mjs` → la 162 sale como pendiente (junto a las 156–161 si siguen sin aplicar).
3. Repetir el ensayo de la sección 6 (sigue dando 80 OK) y las mediciones de la sección 7.
4. Aplicar `supabase/migrations/162_leads.sql` dentro de una transacción, con `set lock_timeout = '3s'`. La
   autocomprobación aborta sola si algo no cuadra.
5. `node scripts/db/migrate-status.mjs` → la 162 aplicada, checksum igual.
6. **Cargar los leads** (desde el checkout principal, que tiene `.env.local` con `SUPABASE_DB_URL`):

   ```bash
   node scripts/leads/importa-leads.mjs "C:/Users/andre/Downloads/RTG-permit-leads-CATEGORIAS-2026-09-24.xlsx"            # solo lee: 566 filas
   node scripts/leads/importa-leads.mjs "C:/Users/andre/Downloads/RTG-permit-leads-CATEGORIAS-2026-09-24.xlsx" --ensayo   # carga y ROLLBACK
   node scripts/leads/importa-leads.mjs "C:/Users/andre/Downloads/RTG-permit-leads-CATEGORIAS-2026-09-24.xlsx" --aplicar  # carga de verdad
   ```

   Debe decir `inserted 566, updated 0, skipped 0` y por pool: Brownsville 140, Edinburg 112, McAllen 79, Mission 51,
   Pharr 68, Weslaco 115, No store 1. Volver a correrlo con un Excel más nuevo actualiza los datos y añade los nuevos; no
   toca quién tiene cada lead, su etiqueta ni su historial (ensayado: R1–R4, X5).
7. **Conceder el módulo.** La 162 no se lo da a nadie; los admins entran siempre. A ventas, desde Usuarios (la casilla
   «Leads», que además deja la fila en el registro de seguridad), o de una vez, **revisando antes la lista**:

   ```sql
   -- A quién se le daría (solo lectura):
   select id, full_name, role, store from public.profiles
    where role = 'sales' and not ('leads' = any(coalesce(module_access, '{}'))) order by store, full_name;

   -- Darlo a todo ventas (sin sub puesto: con uno, guard_clockin_access_change puede rechazar la escritura):
   begin;
   update public.profiles
      set module_access = array_append(coalesce(module_access, '{}'), 'leads')
    where role = 'sales' and not ('leads' = any(coalesce(module_access, '{}')));
   select count(*) from public.profiles where 'leads' = any(coalesce(module_access, '{}'));
   commit;
   ```

   Los gerentes, si también deben verlo: lo mismo con `role in ('sales', 'manager')`. **Es decisión del dueño** (ver
   sección 2: quien lo tiene ve nombre y teléfono de todos los leads de todas las tiendas).
8. Probar con una sesión de verdad (sección 10) y apuntarlo en el tracker.

## 10 · Lo que NO se ha medido

- **La concurrencia de verdad.** El ensayo corre en una sola sesión: «B no puede tomar lo que tiene A» se midió en serie
  (B1), no con dos transacciones abiertas a la vez. Que de dos tomas simultáneas gane una sola, y que dos pestañas de la
  misma persona no pasen del tope, se apoya en el razonamiento de la sección 5 (candado de fila + `pg_advisory_xact_lock`),
  no en una medición. Medirlo exige dos conexiones contra una base con la 162 puesta de verdad.
- **La app contra la base.** La pantalla se recorrió en el modo demo (58 medidas con clics de persona a 390 px), que no
  tiene base: usa un almacén en memoria que aplica las mismas reglas. Que `supabase.rpc("lead_take", …)` devuelva el lead
  como la pantalla lo espera (un objeto con las columnas de la tabla), que los `numeric` lleguen como número y que el código
  de error llegue en `error.code` **no se ha visto**. Tampoco la puerta de `/leads` con una sesión real.
- **El guion con `--ensayo`/`--aplicar`** no se ha corrido (necesita la 162 aplicada). Su lectura del Excel sí (566 filas),
  y la función que llama se ensayó con esas mismas 566 filas dentro del ROLLBACK (X1–X5).
- **Rendimiento con muchos más leads.** La pantalla baja todos los leads (566 hoy, ~40 columnas) y filtra en el
  navegador. Con decenas de miles habría que paginar en la base.
- **Borrar a un usuario con leads abiertos**: no se ensayó; por diseño (sin clave foránea) los leads siguen a su nombre
  hasta que el admin los libere.
