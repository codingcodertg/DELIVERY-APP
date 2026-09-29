# Plan 155 · Encuestas de clientes: la tabla, la puerta del sitio público, su rol de base y la app del hub

Plan en papel exigido por `CLAUDE.md` («Antes de tocar RLS, triggers o permisos en producción»: aquí son **una tabla nueva
con RLS, cinco funciones, un ROL DE BASE NUEVO con permisos propios y la restricción `profiles_module_access_known`**).
Molde: `docs/PLAN-148-estimator.md` y `docs/PLAN-154-lista-unica.md`.

**Estado (2026-09-29):** escrito por un worker en un worktree sin `.env.local`. Producción se **leyó** (`begin read only`)
para medir privilegios, y la migración y la matriz de §6 se **ensayaron una vez contra producción dentro de una
transacción con `ROLLBACK`** (resultado en §6; comprobado después que no quedó nada: ni el rol, ni la tabla, ni la
palabra en la restricción, ni la fila del registro). **Nada aplicado. Pendiente de aprobar.**

**Pedido del dueño (2026-09-29, pegado en la sesión; extraído del fichero de sesión):**

> *«I need you to build a customer feedback survey in two parts: a new public Vercel site that customers use to fill out
> the survey, and a new app inside RTG hub where I can view the results. All responses must be stored in the RTG hub's
> existing Supabase database. Customers must only ever have access to the Vercel survey site, never to RTG hub or
> anything else in the database.»*

Respuestas del dueño a las preguntas del plan (2026-09-29, por el orquestador): **un solo QR para todas las tiendas** (no se
guarda tienda) y **resultados: solo admin**, con permiso propio de la app, como Promos y el Estimador.

Esta rama hace la **Parte 2 (base)** y la **Parte 3 (app en el hub)**. La Parte 1 (el sitio público) es otro proyecto,
fuera de este repo; el contrato con él está en §2.

**La migración está escrita y NO aplicada:** `supabase/migrations/155_encuestas.sql`.

---

## 0 · Resumen

| | Hoy | Con la 155 |
|---|---|---|
| `profiles_module_access_known` | admite `deliveries, recruiting, timetracker, erp, promos, estimator` (148; medido) | **+ `surveys`** |
| `public.survey_responses` | no existe | una fila por encuesta enviada; CHECK que repiten las reglas |
| Quién escribe una respuesta | — | **solo** `submit_survey_response(jsonb)` (definer); nadie tiene INSERT |
| Quién la lee | — | quien tiene el módulo `surveys` (el admin siempre), por la política de SELECT |
| Quién marca «contactado» | — | `mark_survey_contacted(uuid, boolean)` (definer), con el módulo; nadie tiene UPDATE |
| Quién borra | — | **nadie** desde la API |
| Rol `encuesta_web` | no existe (medido) | `NOLOGIN`; `USAGE` en `public` + `EXECUTE` en submit; nada más |
| `anon` | — | **nada**: ni la tabla ni las funciones |
| La app antes de aplicar | — | `/surveys` dice «falta aplicar la 155» (aviso ámbar); solo el admin entra (nadie más puede tener la palabra) |

## 1 · Decisiones (para validar)

1. **El sitio escribe por una función, no por la tabla.** `submit_survey_response` es `security definer` y corre como el
   dueño de la tabla (postgres), que salta la RLS. El rol del sitio no tiene **ningún** privilegio sobre la tabla: si su
   contraseña se filtrara, lo más que se puede hacer es meter encuestas (válidas). Lo pide la especificación.
2. **La función valida todo y rechaza campos desconocidos.** Un campo que no está en el contrato es un error (`survey:
   unknown field "x"`), no se ignora: si el sitio cambia de forma, se nota el primer día en vez de perder datos en
   silencio. Textos: ausentes, `null`, `""` o solo espacios valen lo mismo (`null`), y se guardan recortados.
3. **La tabla repite las reglas en CHECK.** La función da el mensaje claro; los CHECK garantizan que ni una escritura a
   mano (service-role, SQL) deja una fila incoherente (C1-C6 lo prueban sin pasar por la función).
4. **Marcar «contactado» por función y no por UPDATE.** Con una política de UPDATE y grant de columnas, el navegador podría
   poner cualquier `contacted_at` (una fecha inventada). La función pone `now()`, conserva la primera hora si se vuelve a
   marcar, la borra al desmarcar, y solo actúa sobre filas que **pidieron** contacto. La tabla queda sin ninguna escritura
   por la API. (Descartado: política UPDATE + `grant update (contacted, contacted_at)`.)
5. **Quién ve: `has_surveys_access()` = admin, o la casilla `surveys`.** Es **exactamente** la forma de
   `has_estimator_access()` (148), como pidió el orquestador («imítalo exactamente»). «Solo admin» queda así **de partida**:
   nadie más tiene la casilla (medido: 0 perfiles). **A validar:** si el dueño quiere que NUNCA lo vea un no-admin aunque
   se le marque la casilla, es cambiar `or` por `and` en la función (y la puerta del layout); la tarjeta del hub seguiría
   saliéndole al no-admin con casilla, así que habría que esconder también la casilla en Usuarios.
6. **Sin tienda.** Un solo QR para todas las tiendas: no hay columna `store`.
7. **El rol se crea `NOLOGIN` y el LOGIN con contraseña lo pone el orquestador aparte** (§9): la contraseña no puede vivir en
   el repo. Re-ejecutar la migración **no** toca el LOGIN de un rol que ya exista. `statement_timeout = 5s` para el rol.
8. **No es la encuesta de la página de seguimiento.** `delivery_surveys` (151, D-418) son las estrellas de una orden
   entregada; esto es otra tabla y otra app. Nada de aquello cambia.

## 2 · El contrato con el sitio público (fijo)

- Rol: **`encuesta_web`**. Se conecta directo a Postgres (no por PostgREST) y ejecuta **una** sentencia:
  `select public.submit_survey_response($1::jsonb)`. Devuelve el `uuid` de la fila.
- Firma: **`public.submit_survey_response(payload jsonb) returns uuid`**, `security definer`, `set search_path = public, pg_temp`.
- Payload (claves exactas; cualquier otra es error):

  | Clave | Tipo | Regla |
  |---|---|---|
  | `nothing_to_improve` | boolean | obligatoria |
  | `selected_areas` | text[] | obligatoria; claves `staff_service, wait_time, product_availability, product_quality, pricing, delivery_pickup, returns_exchanges, other`; sin repetir; vacía ⇔ `nothing_to_improve` |
  | `other_text` | text/null | obligatoria (no vacía) si hay `other`; si no hay `other`, null. ≤ 500 |
  | `ratings` | object | obligatoria; **exactamente** las claves elegidas; cada valor un número entero 1..5 (no `"3"`, no `3.5`); `{}` con «nada» |
  | `wants_contact` | boolean | obligatoria |
  | `contact_name` | text/null | si `wants_contact`: no vacío, ≤ 120. Si no: null |
  | `contact_phone` | text/null | solo `0-9 + ( ) . - espacio`, ≤ 30, **7-15 dígitos** |
  | `contact_email` | text/null | `algo@algo.algo` sin espacios, ≤ 254 |

  Con `wants_contact`: nombre y (teléfono o correo). Sin él: los tres null. Payload ≤ 8000 caracteres.
- Errores: `SQLSTATE 22023` con mensaje que empieza por `survey: ` (p. ej. `survey: the phone number must have 7 to 15
  digits`). El sitio los puede enseñar tal cual o mapearlos; no traen datos de nadie.
- Honeypot, tiempo mínimo y Turnstile son del sitio: la base no los ve (se descartan antes de llamar).

## 3 · Inventario de lecturas y escrituras

| Pieza | Qué | Cambia |
|---|---|---|
| `profiles_module_access_known` | `check` | **se reescribe** desde el cuerpo de la **148** + `'surveys'` |
| `public.has_surveys_access()` | helper definer | nuevo; `authenticated` |
| `survey_areas_valid(text[])`, `survey_ratings_valid(jsonb, text[])`, `survey_payload_text(jsonb, text)` | validadores (CHECK y submit) | nuevos; **nadie** los ejecuta salvo el dueño |
| `public.survey_responses` | tabla + RLS (1 política: SELECT) | nueva |
| `public.submit_survey_response(jsonb)` | escritura definer | nueva; `encuesta_web`, `service_role` |
| `public.mark_survey_contacted(uuid, boolean)` | escritura definer | nueva; `authenticated` (comprueba el módulo) |
| rol `encuesta_web` | `NOLOGIN`, `statement_timeout 5s` | nuevo |
| Cliente: `survey_responses` select (paginado de 1000 en 1000) y `rpc('mark_survey_contacted', {p_id, p_value})` | `src/lib/encuestas/almacen.ts` | — |
| `profiles.module_access` (conceder el módulo) | `updateUserSurveysAccess` en `data-provider.tsx` | escritura nueva, misma forma que el Estimador |

## 4 · Qué NO debe romperse

- Conceder y quitar **cualquier otro módulo** (la restricción se reescribe: si se perdiera una palabra, esa concesión
  reventaría). La autocomprobación mira las siete y que `clockin` no vuelva.
- Las filas viejas con palabras que ya no valen: `not valid` se conserva (razón de la 095).
- Ningún privilegio de `anon`, `authenticated` ni de ningún otro rol cambia sobre nada que ya exista.
- La encuesta de seguimiento (`delivery_surveys`, 151) no se toca.

## 5 · El SQL, literal

Ver `supabase/migrations/155_encuestas.sql`. La autocomprobación (`do $comprueba$`) exige: la restricción con las siete
palabras y sin `clockin`; RLS puesta y **una** política, de SELECT, con `has_surveys_access`; `anon` y `encuesta_web` sin
ningún privilegio de tabla y `authenticated` solo SELECT; `encuesta_web` ejecuta submit y no mark; `anon`/`authenticated` no
ejecutan submit; `encuesta_web` sin superuser/createrole/createdb/replication/bypassrls y sin pertenecer a ningún rol;
**ninguna tabla, vista ni secuencia a su alcance en ningún esquema**; y **ninguna función a su alcance que devuelva algo
distinto de boolean/text/trigger** salvo submit. Sin `begin`/`commit` propios y sin número de decisión dentro (numerar no
cambia el checksum).

## 6 · Matriz de pruebas por rol, con ROLLBACK (la corre el orquestador)

**73 casos con OK/MAL + 1 informativo (R1).** Crea sus filas dentro de la transacción; lo único de producción que toca es
`module_access` de los perfiles de ensayo, **dentro** de la transacción (se deshace).

Sustituir: `<UUID-ADMIN>` (`admin`), `<UUID-VENTAS>` (`sales`), `<UUID-GERENTE>` (`manager`).

Se pega entero en `psql` **desde la raíz del repo** (el `\i` es relativo). **Sin `commit` en ningún sitio.** Conviene
`set lock_timeout = '3s'` antes: la sección 0 de la migración toma un lock exclusivo sobre `profiles` hasta el ROLLBACK.

**Ensayado el 2026-09-29 contra producción, con ROLLBACK** (admin `acf43ad5…`, ventas `4760e4ef…`, gerente `caf1a337…`):
**73 OK, 0 MAL**, R1 = `t`. Dos errores de la matriz que se corrigieron en ese ensayo y que conviene saber:

- **`set role` desde encuesta_web NO se puede probar así.** `SET ROLE` mira la pertenencia del usuario **de sesión**, que en
  el ensayo es postgres: un `set role authenticated` dentro del bloque de encuesta_web **pasó**, y todo lo de después corrió
  como authenticated (E11 «leyó» 130 tablas). Conectado de verdad como encuesta_web, la sesión es él y no pertenece a ningún
  rol: eso es lo que mide E10 ahora.
- **El `update` de M necesita el sub vacío**: con el del gerente todavía puesto, `guard_clockin_access_change` lo rechaza.

```sql
begin;

-- 0. La migración, dentro de la misma transacción (se deshace con el resto).
\i supabase/migrations/155_encuestas.sql

-- 0b. Preparación, como postgres (todo se deshace con el ROLLBACK):
--   * postgres crea encuesta_web con ADMIN pero sin SET (createrole_self_grant = '', medido): sin esta
--     línea no puede hacer `set role encuesta_web`. INHERIT false: postgres no hereda nada de él.
--   * Ventas y gerente SIN el módulo; el admin tal cual (el admin entra siempre).
grant encuesta_web to postgres with inherit false, set true;
update public.profiles set module_access = array_remove(module_access, 'surveys') where id in ('<UUID-VENTAS>', '<UUID-GERENTE>');

-- C. Los CHECK de la tabla, sin pasar por la función (como postgres, que salta la RLS).
do $$ begin
  begin insert into public.survey_responses (nothing_to_improve, selected_areas, ratings, wants_contact) values (true, '{pricing}', '{"pricing":3}', false);
    raise notice 'C1  tabla: nada + un área                          esperado 23514: MAL, pasó';
  exception when others then raise notice 'C1  tabla: nada + un área                          esperado 23514: %', case when sqlstate = '23514' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
  begin insert into public.survey_responses (nothing_to_improve, selected_areas, ratings, wants_contact) values (false, '{pricing}', '{"pricing":7}', false);
    raise notice 'C2  tabla: calificación 7                          esperado 23514: MAL, pasó';
  exception when others then raise notice 'C2  tabla: calificación 7                          esperado 23514: %', case when sqlstate = '23514' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
  begin insert into public.survey_responses (nothing_to_improve, selected_areas, ratings, wants_contact) values (false, '{pricing,wait_time}', '{"pricing":3}', false);
    raise notice 'C3  tabla: falta una calificación                  esperado 23514: MAL, pasó';
  exception when others then raise notice 'C3  tabla: falta una calificación                  esperado 23514: %', case when sqlstate = '23514' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
  begin insert into public.survey_responses (nothing_to_improve, selected_areas, ratings, wants_contact, contact_phone) values (true, '{}', '{}', true, '9565550100');
    raise notice 'C4  tabla: contacto sin nombre                     esperado 23514: MAL, pasó';
  exception when others then raise notice 'C4  tabla: contacto sin nombre                     esperado 23514: %', case when sqlstate = '23514' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
  begin insert into public.survey_responses (nothing_to_improve, selected_areas, ratings, wants_contact, contacted) values (true, '{}', '{}', false, true);
    raise notice 'C5  tabla: contactado sin hora                     esperado 23514: MAL, pasó';
  exception when others then raise notice 'C5  tabla: contactado sin hora                     esperado 23514: %', case when sqlstate = '23514' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
  begin insert into public.survey_responses (nothing_to_improve, selected_areas, ratings, wants_contact) values (false, '{pricing,pricing}', '{"pricing":3}', false);
    raise notice 'C6  tabla: área repetida                           esperado 23514: MAL, pasó';
  exception when others then raise notice 'C6  tabla: área repetida                           esperado 23514: %', case when sqlstate = '23514' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
end $$;

-- ===========================================================================================
-- E/V. Como el sitio público: el rol encuesta_web, sin sesión de nadie.
-- ===========================================================================================
set local role encuesta_web;

-- V. Cada regla de submit_survey_response: lo bueno entra, lo malo sale con 22023 y su mensaje.
do $$
declare
  c record;
  v uuid;
begin
  for c in select * from (values
    ('V01 bueno: nada que mejorar', '{"nothing_to_improve":true,"selected_areas":[],"ratings":{},"wants_contact":false}', null),
    ('V02 bueno: dos áreas con other, contacto por teléfono', '{"nothing_to_improve":false,"selected_areas":["staff_service","other"],"other_text":"  Parking  ","ratings":{"staff_service":4,"other":2},"wants_contact":true,"contact_name":"Ensayo 155","contact_phone":"(956) 555-0100","contact_email":null}', null),
    ('V03 bueno: contacto solo por correo, vacíos como null', '{"nothing_to_improve":false,"selected_areas":["pricing"],"other_text":"","ratings":{"pricing":5},"wants_contact":true,"contact_name":"Ensayo","contact_phone":"  ","contact_email":"ensayo@example.com"}', null),
    ('V04 nada + un área', '{"nothing_to_improve":true,"selected_areas":["pricing"],"ratings":{"pricing":3},"wants_contact":false}', 'cannot be combined'),
    ('V05 ningún área sin nada', '{"nothing_to_improve":false,"selected_areas":[],"ratings":{},"wants_contact":false}', 'choose at least one area'),
    ('V06 área desconocida', '{"nothing_to_improve":false,"selected_areas":["parking"],"ratings":{"parking":3},"wants_contact":false}', 'unknown area'),
    ('V07 área repetida', '{"nothing_to_improve":false,"selected_areas":["pricing","pricing"],"ratings":{"pricing":3},"wants_contact":false}', 'is repeated'),
    ('V08 other sin texto', '{"nothing_to_improve":false,"selected_areas":["other"],"ratings":{"other":3},"wants_contact":false}', 'needs its text'),
    ('V09 other con texto en blanco', '{"nothing_to_improve":false,"selected_areas":["other"],"other_text":"   ","ratings":{"other":3},"wants_contact":false}', 'needs its text'),
    ('V10 texto sin other', '{"nothing_to_improve":false,"selected_areas":["pricing"],"other_text":"x","ratings":{"pricing":3},"wants_contact":false}', 'only for the "other" area'),
    ('V11 texto de other de 501', jsonb_build_object('nothing_to_improve', false, 'selected_areas', jsonb_build_array('other'), 'other_text', repeat('x', 501), 'ratings', jsonb_build_object('other', 3), 'wants_contact', false)::text, 'longer than 500'),
    ('V12 falta una calificación', '{"nothing_to_improve":false,"selected_areas":["pricing","wait_time"],"ratings":{"pricing":3},"wants_contact":false}', 'missing rating'),
    ('V13 calificación de un área no elegida', '{"nothing_to_improve":false,"selected_areas":["pricing"],"ratings":{"pricing":3,"wait_time":2},"wants_contact":false}', 'which was not selected'),
    ('V14 calificación 0', '{"nothing_to_improve":false,"selected_areas":["pricing"],"ratings":{"pricing":0},"wants_contact":false}', 'whole number from 1 to 5'),
    ('V15 calificación 6', '{"nothing_to_improve":false,"selected_areas":["pricing"],"ratings":{"pricing":6},"wants_contact":false}', 'whole number from 1 to 5'),
    ('V16 calificación 3.5', '{"nothing_to_improve":false,"selected_areas":["pricing"],"ratings":{"pricing":3.5},"wants_contact":false}', 'whole number from 1 to 5'),
    ('V17 calificación "3" (texto)', '{"nothing_to_improve":false,"selected_areas":["pricing"],"ratings":{"pricing":"3"},"wants_contact":false}', 'whole number from 1 to 5'),
    ('V18 nada con calificaciones', '{"nothing_to_improve":true,"selected_areas":[],"ratings":{"pricing":5},"wants_contact":false}', 'which was not selected'),
    ('V19 contacto sin nombre', '{"nothing_to_improve":true,"selected_areas":[],"ratings":{},"wants_contact":true,"contact_phone":"9565550100"}', 'a name is required'),
    ('V20 contacto sin teléfono ni correo', '{"nothing_to_improve":true,"selected_areas":[],"ratings":{},"wants_contact":true,"contact_name":"Ana"}', 'a phone or an email'),
    ('V21 correo sin arroba', '{"nothing_to_improve":true,"selected_areas":[],"ratings":{},"wants_contact":true,"contact_name":"Ana","contact_email":"ana.example.com"}', 'the email is not valid'),
    ('V22 teléfono de 5 dígitos', '{"nothing_to_improve":true,"selected_areas":[],"ratings":{},"wants_contact":true,"contact_name":"Ana","contact_phone":"12345"}', '7 to 15 digits'),
    ('V23 teléfono con letras', '{"nothing_to_improve":true,"selected_areas":[],"ratings":{},"wants_contact":true,"contact_name":"Ana","contact_phone":"555-CALL-NOW"}', 'phone number is not valid'),
    ('V24 teléfono de 16 dígitos', '{"nothing_to_improve":true,"selected_areas":[],"ratings":{},"wants_contact":true,"contact_name":"Ana","contact_phone":"1234567890123456"}', '7 to 15 digits'),
    ('V25 datos de contacto sin pedirlo', '{"nothing_to_improve":true,"selected_areas":[],"ratings":{},"wants_contact":false,"contact_name":"Ana"}', 'only kept when wants_contact'),
    ('V26 nombre de 121', jsonb_build_object('nothing_to_improve', true, 'selected_areas', '[]'::jsonb, 'ratings', '{}'::jsonb, 'wants_contact', true, 'contact_name', repeat('n', 121), 'contact_email', 'a@b.co')::text, 'longer than 120'),
    ('V27 campo desconocido', '{"nothing_to_improve":true,"selected_areas":[],"ratings":{},"wants_contact":false,"store":"RDZ"}', 'unknown field'),
    ('V28 nothing_to_improve como texto', '{"nothing_to_improve":"yes","selected_areas":[],"ratings":{},"wants_contact":false}', 'nothing_to_improve must be true or false'),
    ('V29 selected_areas no es lista', '{"nothing_to_improve":false,"selected_areas":"pricing","ratings":{"pricing":3},"wants_contact":false}', 'must be a list'),
    ('V30 payload null', null, 'must be a JSON object'),
    ('V31 payload lista', '[]', 'must be a JSON object'),
    ('V32 correo de 255', jsonb_build_object('nothing_to_improve', true, 'selected_areas', '[]'::jsonb, 'ratings', '{}'::jsonb, 'wants_contact', true, 'contact_name', 'Ana', 'contact_email', repeat('a', 243) || '@example.com')::text, 'the email is not valid'),
    ('V33 falta wants_contact', '{"nothing_to_improve":true,"selected_areas":[],"ratings":{}}', 'wants_contact must be true or false'),
    ('V34 ratings como lista', '{"nothing_to_improve":true,"selected_areas":[],"ratings":[],"wants_contact":false}', 'ratings must be an object'),
    ('V35 nombre como número', '{"nothing_to_improve":true,"selected_areas":[],"ratings":{},"wants_contact":true,"contact_name":5,"contact_email":"a@b.co"}', 'must be text or null'),
    ('V36 payload de más de 8000', jsonb_build_object('nothing_to_improve', true, 'selected_areas', '[]'::jsonb, 'ratings', '{}'::jsonb, 'wants_contact', false, 'x', repeat('x', 9000))::text, 'too large'),
    ('V37 teléfono de 31 caracteres', '{"nothing_to_improve":true,"selected_areas":[],"ratings":{},"wants_contact":true,"contact_name":"Ana","contact_phone":"(956) 555 0100 - - - - - - - - - - - - -"}', 'phone number is not valid')
  ) as t(caso, p, espera) loop
    begin
      v := public.submit_survey_response(c.p::jsonb);
      if c.caso like 'V02%' then perform set_config('ensayo.v02', v::text, true); end if;
      if c.caso like 'V01%' then perform set_config('ensayo.v01', v::text, true); end if;
      raise notice '% %', rpad(c.caso, 58), case when c.espera is null and v is not null then 'OK' else 'MAL, pasó' end;
    exception when others then
      raise notice '% %', rpad(c.caso, 58),
        case when c.espera is not null and sqlstate = '22023' and sqlerrm like '%' || c.espera || '%' then 'OK'
             else 'MAL (' || sqlstate || ' ' || sqlerrm || ')' end;
    end;
  end loop;
end $$;

-- E. Lo que el rol del sitio NO puede hacer.
do $$
declare
  r record;
  n int := 0;
  leidas int := 0;
  intentos int := 0;
begin
  begin perform 1 from public.survey_responses limit 1;
    raise notice 'E01 leer survey_responses                          esperado 42501: MAL, pasó';
  exception when others then raise notice 'E01 leer survey_responses                          esperado 42501: %', case when sqlstate = '42501' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
  begin insert into public.survey_responses (nothing_to_improve, wants_contact) values (true, false);
    raise notice 'E02 insertar sin la función                        esperado 42501: MAL, pasó';
  exception when others then raise notice 'E02 insertar sin la función                        esperado 42501: %', case when sqlstate = '42501' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
  begin update public.survey_responses set contacted = true;
    raise notice 'E03 actualizar survey_responses                    esperado 42501: MAL, pasó';
  exception when others then raise notice 'E03 actualizar survey_responses                    esperado 42501: %', case when sqlstate = '42501' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
  begin perform 1 from public.profiles limit 1;
    raise notice 'E04 leer profiles                                  esperado 42501: MAL, pasó';
  exception when others then raise notice 'E04 leer profiles                                  esperado 42501: %', case when sqlstate = '42501' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
  begin perform 1 from public.deliveries limit 1;
    raise notice 'E05 leer deliveries                                esperado 42501: MAL, pasó';
  exception when others then raise notice 'E05 leer deliveries                                esperado 42501: %', case when sqlstate = '42501' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
  begin perform 1 from public.settings limit 1;
    raise notice 'E06 leer settings                                  esperado 42501: MAL, pasó';
  exception when others then raise notice 'E06 leer settings                                  esperado 42501: %', case when sqlstate = '42501' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
  begin perform 1 from auth.users limit 1;
    raise notice 'E07 leer auth.users                                esperado 42501: MAL, pasó';
  exception when others then raise notice 'E07 leer auth.users                                esperado 42501: %', case when sqlstate = '42501' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
  begin perform public.mark_survey_contacted(current_setting('ensayo.v02')::uuid, true);
    raise notice 'E08 marcar contactado                              esperado 42501: MAL, pasó';
  exception when others then raise notice 'E08 marcar contactado                              esperado 42501: %', case when sqlstate = '42501' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
  begin execute 'create table public.ensayo_155 (x int)';
    raise notice 'E09 crear una tabla en public                      esperado 42501: MAL, pasó';
  exception when others then raise notice 'E09 crear una tabla en public                      esperado 42501: %', case when sqlstate = '42501' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
  -- E10 NO intenta `set role authenticated`: SET ROLE mira la pertenencia del usuario de SESIÓN, que
  -- en este ensayo es postgres, así que pasaría y contaminaría el resto (medido: pasó y E11 leyó 130
  -- tablas como authenticated). Conectado de verdad como encuesta_web, la sesión es él. Se mide lo que
  -- decide eso: que no pertenece a ningún rol.
  select count(*) into n from pg_auth_members where member = 'encuesta_web'::regrole;
  raise notice 'E10 encuesta_web no pertenece a ningún rol          esperado 0: %', case when n = 0 then 'OK' else 'MAL '||n end;

  -- E11: TODAS las tablas, vistas y vistas materializadas de TODOS los esquemas del proyecto (salvo el
  -- catálogo del sistema), intentando leer cada una. Cero legibles.
  for r in
    select format('%I.%I', s.nspname, c.relname) as rel
      from pg_class c join pg_namespace s on s.oid = c.relnamespace
     where c.relkind in ('r', 'v', 'm', 'p', 'f')
       and s.nspname not in ('pg_catalog', 'information_schema') and s.nspname not like 'pg\_%'
  loop
    intentos := intentos + 1;
    begin
      execute format('select 1 from %s limit 1', r.rel);
      leidas := leidas + 1;
      raise notice '    E11 LEYÓ %', r.rel;
    exception when others then null;
    end;
  end loop;
  raise notice 'E11 leer cada tabla/vista de cada esquema (% intentos) esperado 0 leídas: %', intentos, case when leidas = 0 and intentos > 50 then 'OK' else 'MAL '||leidas end;

  -- E12: las funciones que puede ejecutar fuera del catálogo, y que devuelven algo más que boolean/text.
  select count(*) into n
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname not in ('pg_catalog', 'information_schema')
     and has_schema_privilege(s.oid, 'usage') and has_function_privilege(p.oid, 'execute')
     and p.oid <> 'public.submit_survey_response(jsonb)'::regprocedure
     and (p.proretset or p.prorettype not in ('boolean'::regtype, 'text'::regtype, 'trigger'::regtype));
  raise notice 'E12 funciones a su alcance que devuelven datos      esperado 0: %', case when n = 0 then 'OK' else 'MAL '||n end;
end $$;

-- R. El residuo conocido (plan, sección 9): con el sub de un admin puesto a mano en request.jwt.claims,
-- los helpers booleanos que PUBLIC puede ejecutar le contestan como a ese admin. Lo que importa: ni
-- así lee respuestas ni marca contactado.
set local request.jwt.claims to '{"sub":"<UUID-ADMIN>","role":"authenticated"}';
do $$ declare a boolean; begin
  a := public.is_admin();
  raise notice 'R1  RESIDUO: is_admin() con el sub de un admin   = % (informativo, no es OK/MAL)', a;
  begin perform 1 from public.survey_responses limit 1;
    raise notice 'R2  con el sub del admin, leer respuestas          esperado 42501: MAL, pasó';
  exception when others then raise notice 'R2  con el sub del admin, leer respuestas          esperado 42501: %', case when sqlstate = '42501' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
  begin perform public.mark_survey_contacted(current_setting('ensayo.v02')::uuid, true);
    raise notice 'R3  con el sub del admin, marcar contactado        esperado 42501: MAL, pasó';
  exception when others then raise notice 'R3  con el sub del admin, marcar contactado        esperado 42501: %', case when sqlstate = '42501' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
end $$;

reset role;
reset request.jwt.claims;

-- ===========================================================================================
-- N. anon y authenticated no ejecutan submit.
-- ===========================================================================================
set local role anon;
do $$ begin
  perform public.submit_survey_response('{"nothing_to_improve":true,"selected_areas":[],"ratings":{},"wants_contact":false}');
  raise notice 'N1  anon ejecuta submit                             esperado 42501: MAL, pasó';
exception when others then raise notice 'N1  anon ejecuta submit                             esperado 42501: %', case when sqlstate = '42501' then 'OK' else 'MAL ('||sqlerrm||')' end; end $$;
do $$ begin
  perform 1 from public.survey_responses limit 1;
  raise notice 'N2  anon lee respuestas                             esperado 42501: MAL, pasó';
exception when others then raise notice 'N2  anon lee respuestas                             esperado 42501: %', case when sqlstate = '42501' then 'OK' else 'MAL ('||sqlerrm||')' end; end $$;
reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"<UUID-ADMIN>","role":"authenticated"}';
do $$ begin
  perform public.submit_survey_response('{"nothing_to_improve":true,"selected_areas":[],"ratings":{},"wants_contact":false}');
  raise notice 'N3  authenticated (admin) ejecuta submit            esperado 42501: MAL, pasó';
exception when others then raise notice 'N3  authenticated (admin) ejecuta submit            esperado 42501: %', case when sqlstate = '42501' then 'OK' else 'MAL ('||sqlerrm||')' end; end $$;

-- ===========================================================================================
-- A. El admin: lee, marca, desmarca; y no escribe por la tabla.
-- ===========================================================================================
do $$ declare n int; t1 timestamptz; t2 timestamptz; t3 timestamptz; begin
  select count(*) into n from public.survey_responses where id in (current_setting('ensayo.v01')::uuid, current_setting('ensayo.v02')::uuid);
  raise notice 'A1  el admin lee las respuestas del ensayo          esperado 2: %', case when n = 2 then 'OK' else 'MAL '||n end;
  t1 := public.mark_survey_contacted(current_setting('ensayo.v02')::uuid, true);
  raise notice 'A2  el admin marca contactado y queda la hora       %', case when t1 is not null then 'OK' else 'MAL null' end;
  t2 := public.mark_survey_contacted(current_setting('ensayo.v02')::uuid, true);
  raise notice 'A3  volver a marcar conserva la hora                %', case when t2 = t1 then 'OK' else 'MAL' end;
  t3 := public.mark_survey_contacted(current_setting('ensayo.v02')::uuid, false);
  select count(*) into n from public.survey_responses where id = current_setting('ensayo.v02')::uuid and not contacted and contacted_at is null;
  raise notice 'A4  desmarcar borra la hora                         %', case when t3 is null and n = 1 then 'OK' else 'MAL' end;
  begin perform public.mark_survey_contacted(current_setting('ensayo.v01')::uuid, true);
    raise notice 'A5  marcar una que no pidió contacto                esperado P0002: MAL, pasó';
  exception when others then raise notice 'A5  marcar una que no pidió contacto                esperado P0002: %', case when sqlstate = 'P0002' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
  begin update public.survey_responses set contacted = true, contacted_at = '2000-01-01' where id = current_setting('ensayo.v02')::uuid;
    raise notice 'A6  el admin escribe la tabla directo               esperado 42501: MAL, pasó';
  exception when others then raise notice 'A6  el admin escribe la tabla directo               esperado 42501: %', case when sqlstate = '42501' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
  begin delete from public.survey_responses where id = current_setting('ensayo.v02')::uuid;
    raise notice 'A7  el admin borra                                  esperado 42501: MAL, pasó';
  exception when others then raise notice 'A7  el admin borra                                  esperado 42501: %', case when sqlstate = '42501' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
  select count(*) into n from public.survey_responses where id = current_setting('ensayo.v02')::uuid and other_text = 'Parking' and contact_email is null;
  raise notice 'A8  V02 guardado recortado y con el correo nulo     %', case when n = 1 then 'OK' else 'MAL' end;
end $$;

-- ===========================================================================================
-- S. Ventas y gerente sin el módulo: no leen ni marcan.
-- ===========================================================================================
set local request.jwt.claims to '{"sub":"<UUID-VENTAS>","role":"authenticated"}';
do $$ declare n int; begin
  select count(*) into n from public.survey_responses;
  raise notice 'S1  ventas sin módulo lee                           esperado 0: %', case when n = 0 then 'OK' else 'MAL '||n end;
  begin perform public.mark_survey_contacted(current_setting('ensayo.v02')::uuid, true);
    raise notice 'S2  ventas sin módulo marca                         esperado 42501: MAL, pasó';
  exception when others then raise notice 'S2  ventas sin módulo marca                         esperado 42501: %', case when sqlstate = '42501' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
end $$;
set local request.jwt.claims to '{"sub":"<UUID-GERENTE>","role":"authenticated"}';
do $$ declare n int; begin
  select count(*) into n from public.survey_responses;
  raise notice 'S3  gerente sin módulo lee                          esperado 0: %', case when n = 0 then 'OK' else 'MAL '||n end;
  begin perform public.mark_survey_contacted(current_setting('ensayo.v02')::uuid, true);
    raise notice 'S4  gerente sin módulo marca                        esperado 42501: MAL, pasó';
  exception when others then raise notice 'S4  gerente sin módulo marca                        esperado 42501: %', case when sqlstate = '42501' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
end $$;

-- M. La casilla funciona: ventas CON el módulo lee (se concede como postgres y se deshace).
-- Sin el sub puesto: con el del gerente, guard_clockin_access_change rechaza la escritura (medido).
reset role;
reset request.jwt.claims;
update public.profiles set module_access = array(select distinct unnest(coalesce(module_access, '{}') || array['surveys'])) where id = '<UUID-VENTAS>';
set local role authenticated;
set local request.jwt.claims to '{"sub":"<UUID-VENTAS>","role":"authenticated"}';
do $$ declare n int; begin
  select count(*) into n from public.survey_responses where id = current_setting('ensayo.v02')::uuid;
  raise notice 'M1  ventas con la casilla lee                       esperado 1: %', case when n = 1 then 'OK' else 'MAL '||n end;
end $$;

ROLLBACK;
```

**Lo que debe salir — 73 líneas `OK` y la R1 informativa:** C1-C6, V01-V37, E01-E12, R2-R3, N1-N3, A1-A8, S1-S4, M1. Antes
sale un `NOTICE` de `drop policy if exists` («does not exist, skipping»), que es normal. **Si alguna dice `MAL`, parar: no
aplicar.**

## 7 · Mediciones de solo lectura (hechas el 2026-09-29; repetirlas antes de aplicar)

```sql
-- M1. Que no exista nada con estos nombres (una 155 a medias). Medido: null, null, 0.
select to_regclass('public.survey_responses'), to_regprocedure('public.submit_survey_response(jsonb)'),
       (select count(*) from pg_roles where rolname = 'encuesta_web');
-- M2. La restricción tal cual. Medido: la de la 148 (deliveries…estimator), NOT VALID.
select pg_get_constraintdef(oid) from pg_constraint where conname = 'profiles_module_access_known';
-- M3. Qué alcanza PUBLIC en public (lo hereda encuesta_web y no se puede revocar por rol). Medido: 30 funciones, 19 de
--     ellas disparadores; las 11 restantes devuelven boolean o text. Ninguna tabla de un esquema con USAGE para PUBLIC.
select p.oid::regprocedure, pg_get_function_result(p.oid) from pg_proc p
 where p.pronamespace = 'public'::regnamespace and has_function_privilege('public', p.oid, 'execute') order by 1;
-- M4. El ACL de los esquemas. Medido: solo public tiene USAGE para PUBLIC (`=U/pg_database_owner`); recruiting, erp,
--     clockin, timetracker, auth, storage, extensions, cron y vault, no.
select nspname, nspacl from pg_namespace where nspname not like 'pg\_%' and nspname <> 'information_schema';
```

## 8 · Reversión

Comentada al final del `.sql`: quitar la palabra de los perfiles **antes**, `drop` de las funciones y de la tabla (**borra
las respuestas**: de eso protege el `pg_dump`), la restricción **exactamente** como la dejó la 148, y `drop role
encuesta_web` (antes: `alter role encuesta_web nologin;` y cortar sus conexiones, o el drop falla). La app no se rompe: sin la
tabla dice «falta aplicar la 155».

## 9 · Lo que le toca al orquestador (en este orden)

1. **Respaldo** (`pg_dump` o el respaldo activo) y `node scripts/db/migrate-status.mjs` (debe salir la 155 pendiente, sola).
2. **§6 entera con ROLLBACK**: 73 OK. Si algo sale MAL, parar.
3. **Aplicar** `supabase/migrations/155_encuestas.sql` en una transacción; `migrate-status` después (0 pendientes).
4. **Darle LOGIN y contraseña al rol — fuera del repo**, con una contraseña larga y aleatoria (p. ej. 32 bytes base64),
   que va SOLO a las variables de entorno del proyecto de Vercel del sitio (sin `NEXT_PUBLIC_`):

   ```sql
   alter role encuesta_web login password '<CONTRASEÑA-LARGA-ALEATORIA>';
   ```

   Si el editor SQL de Supabase guarda el historial, mejor desde `psql` con `\password encuesta_web`, que no deja la
   contraseña en ningún registro de sentencias.
   Cadena de conexión para el sitio: el **pooler** de Supabase (Supavisor, modo transacción, puerto 6543) con usuario
   `encuesta_web.<project-ref>`; la directa (`db.<ref>.supabase.co:5432`) es solo IPv6. **No verificado** que el pooler
   acepte el rol nuevo a la primera: si da «tenant or user not found», probar la directa o el modo sesión (5432 del pooler).
5. **Comprobar el rol conectado DE VERDAD como él** (lo que el ensayo con `set role` no puede medir, ver §6):
   con la cadena del sitio, `select public.submit_survey_response('{"nothing_to_improve":true,"selected_areas":[],"ratings":{},"wants_contact":false}');`
   debe devolver un uuid (**es una fila real: borrarla después como postgres**), y `select 1 from public.profiles limit 1;`,
   `select 1 from public.survey_responses limit 1;` y `set role authenticated;` deben dar `permission denied`.
6. **Conceder el módulo a los admins — es un cambio de DATOS en producción, con su sí.** No hace falta para la base (el
   admin ya lee por `has_surveys_access()`), pero sin la casilla la **tarjeta** no le sale en el hub (`accessibleModules`
   mira solo `module_access`). Mejor desde **Usuarios → cada admin → casilla «Encuestas»**, que deja la línea en el
   registro de seguridad (`surveys_access_changed`). Por SQL, sin esa línea:

   ```sql
   update public.profiles
      set module_access = array(select distinct unnest(coalesce(module_access, '{}') || array['surveys']))
    where role = 'admin';   -- medido: 4 perfiles admin
   ```

   Y que recarguen (un módulo nuevo no se ve hasta recargar).

### El residuo conocido: lo que PUBLIC le da a cualquier rol

Postgres no deja revocar a un rol lo que está concedido a `PUBLIC`. Medido (M3/M4) lo que eso le da a `encuesta_web`:

- **USAGE en el esquema `public`** (el `grant` de la 155 es redundante; se deja por explícito).
- **EXECUTE en 11 funciones que devuelven boolean o text** (`is_admin()`, `current_user_role()`, `has_*_access()`,
  `store_auto_approves(text)`, `zonas_preferidas_validas(text[])`…) y en 19 disparadores (que no se pueden llamar a mano).
  Como `auth.uid()` lee `request.jwt.claims`, y cualquier rol puede ponerse esa variable, **con el uuid de alguien** esas
  funciones le contestan como a esa persona (R1: `is_admin()` = `t` con el sub de un admin). Lo que obtiene es **un sí/no
  o un nombre de rol sobre un uuid que ya tiene que conocer** — y no puede descubrir ninguno, porque no lee ninguna tabla.
  Ni con el sub del admin lee respuestas ni marca contactado (R2, R3).
- Leer el **catálogo** (`pg_catalog`: nombres de tablas, cuerpos de funciones) y crear **tablas temporales**: lo tiene
  cualquier rol de Postgres. Metadatos, no datos.

**Endurecimiento opcional H1 (NO está en la 155, es decisión aparte):** quitarle a PUBLIC esas 11 funciones dándoselas antes
por nombre a quien las usa, para que no cambie nada para ellos:

```sql
-- Para cada una de las 11 (lista de M3 sin los disparadores):
grant execute on function public.is_admin() to anon, authenticated, service_role;
revoke execute on function public.is_admin() from public;
-- … y lo mismo con las otras diez.
```

No se hace aquí porque toca funciones que usan **todas** las políticas del hub, y no está medido qué roles internos de
Supabase (`supabase_storage_admin`, `supabase_auth_admin`, `authenticator`) las llaman por la vía de PUBLIC. Si se decide,
va con su propio plan y su ensayo. Tampoco se toca el `alter default privileges … revoke execute on functions from public`,
por lo mismo.

## 10 · Lo que NO se ha medido

- **El rol conectado como él mismo** (§9 paso 5): el ensayo usa `set role` desde postgres, y eso no prueba ni el login ni
  el `set role` hacia otro rol (ver §6).
- **Que el pooler de Supabase acepte `encuesta_web`**, y que el `statement_timeout` por rol se aplique a través de él.
- **El sitio público**: la otra mitad del contrato. Lo que aquí se garantiza es que la base rechaza todo lo que no cumpla §2,
  sea cual sea el sitio.
- **La pantalla contra la base real**: se midió en el demo (datos inventados) y con pruebas; la lectura real depende de la
  RLS, que sí está en §6 (A1, S1, S3, M1).
- **Otra rama que toque `profiles_module_access_known`** a la vez chocaría aquí: la última en fusionarse tiene que llevar las
  palabras de las dos (`encuestas/modulo.test.ts` exige que la última migración que la define liste MODULE_ACCESS entero).
