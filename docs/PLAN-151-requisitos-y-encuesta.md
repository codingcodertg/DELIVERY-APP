# Plan 151 · Requisitos del camión y encuesta de satisfacción en el seguimiento

Plan en papel exigido por `CLAUDE.md` («Antes de tocar RLS, triggers o permisos en producción»: aquí hay **esquema**, una
**tabla nueva con RLS** y un **disparador**). Molde: `docs/PLAN-147-prioridad.md`.

**Estado (2026-09-27):** escrito por un worker en un worktree **sin `.env.local` y sin acceso a la base**. Todo sale de
**leer el repo** (`origin/main` = `2a363c60`, D-415, migraciones hasta la 149 aplicadas según el orquestador) y de medir el
**demo local**. Nada se ha ejecutado contra producción: ni la migración, ni su autocomprobación, ni el ensayo de §6.
**Pendiente de aprobar.**

**Número:** 151, no 150. Otra rama (avisos al cliente) está escribiendo la 150. El registro (`schema_migrations`) no exige
números seguidos; `migrate-status` compara por nombre.

**Pedido del dueño (2026-09-27):** tras explicarle OptimoRoute, *«solos haz 1 3 y 4»*. El 4 son dos cosas menores:
(A) requisitos del camión (`skills` / `vehicleFeatures` de OptimoRoute) y (B) una encuesta de 1-5 estrellas en la página
de seguimiento.

**La migración está escrita y NO aplicada:** `supabase/migrations/151_requisitos_y_encuesta.sql`.

---

## 0 · Resumen

| | Hoy | Con la 151 |
|---|---|---|
| `settings.delivery_requirements` | no existe | `text[] not null default '{}'`, ≤ 30, sin nulos. El catálogo; lo escribe el admin (100) |
| `deliveries.requirements` | no existe | `text[] not null default '{}'`, ≤ 30, sin nulos. Quien edita la orden (guard de la 145, **sin tocarlo**) |
| `driver_settings.features` | no existe | `text[] not null default '{}'`, ≤ 30, sin nulos. Admin y logística (128) |
| `delivery_surveys` | no existe | una fila por orden; lee admin/logística/gerente de órdenes que ya ven; **nadie escribe** salvo la llave de servicio |
| Filas existentes | — | leen `'{}'` por el defecto; **ningún `UPDATE`** |
| La app antes de aplicar | — | no pide ni manda las columnas (`leeConOpcionales`, `conRequisitosSiCabe`, `laBaseTieneRequisitos`), no enseña la encuesta ni la tarjeta del Panel: nada falla |

## 1 · Decisiones (para validar)

1. **Los requisitos son nombres (`text[]`), no ids de una tabla de catálogo.** El catálogo es una lista corta del admin, como
   `route_hard_windows` (130). La app compara sin mayúsculas y **solo cuenta lo que está en el catálogo**: quitar
   «Liftgate» de la lista lo apaga en todas las órdenes y camiones a la vez, sin cascadas ni borrados bloqueados. Renombrar
   uno equivale a quitar el viejo y poner el nuevo (hay que volver a marcarlo).
2. **`NOT NULL` con defecto `'{}'`.** Postgres 11+ no reescribe la tabla por una columna con defecto constante. Un `null`
   sería un segundo «no pide nada».
3. **Quién cambia los requisitos de una orden: las mismas reglas que cualquier otro campo.** El guard de etapas de la 145 no
   mira columnas en «misma etapa» (medido para `priority` en el plan 147, §1.3; la autocomprobación de la 151 exige que
   `guard_delivery_stage` y `guard_factura_obligatoria` no mencionen `requirements`). La ficha la edita con `salesFields`,
   como la prioridad.
4. **La encuesta es una tabla aparte, no las columnas `csat_rating`/`csat_comment` de la 021** (siguen ahí, sin usar,
   D-043). Porque (a) la lectura es **más estrecha** que la de la orden: el chofer y ventas leen `deliveries` y no deben ver
   la calificación (D-026, D-043); (b) la escribe la llave de servicio **sin pasar por los guards ni por el rastro de
   ediciones** de la orden; (c) «una por orden» es la clave primaria.
5. **La escritura pública va por una ruta del servidor, no por un insert anónimo.** `delivery_surveys` no tiene política de
   escritura para nadie y `anon`/`authenticated` no tienen `INSERT`. Solo `POST /api/track/<id>/survey` escribe, con la llave
   de servicio, después de comprobar el id (forma de uuid), el cuerpo (≤ 2 KB, estrellas enteras 1-5, comentario ≤ 500) y
   que la orden esté entregada. La base lo vuelve a exigir: `check` de estrellas y comentario, disparador «solo entregada»,
   clave primaria.
6. **¿El enlace es adivinable?** No. `/track/<id>` identifica la orden por `deliveries.id`, un `uuid` con
   `default gen_random_uuid()` (`supabase/schema.sql:73`): v4, 122 bits al azar. Quien no tiene el enlace no llega. Lo que
   **sí** hay que saber: **cualquiera con el enlace** puede responder (es el diseño: sin login), incluido personal que vea el
   id en la app; y **el GET público ya enseña hoy** la cuenta, la dirección y el chofer de la orden (`PUBLIC_FIELDS`, antes
   de este cambio). La encuesta no añade nada a eso: el GET solo dice `survey: { answered }`, nunca la respuesta.
7. **Quién lee la encuesta:** admin, logística y gerente, con el módulo de Entregas, y **solo de órdenes que ya puede ver**
   (el `exists` sobre `deliveries` corre con la RLS de quien pregunta, así que la visibilidad por tienda de la 131 vale
   sola). El recorte por «sus tiendas» del Panel (D-396) lo hace la pantalla con sus mismas órdenes, como el resto del Panel.
   Office (`accounting`) no la lee: el dueño nombró «admin/logística/gerentes».
8. **Borrar una orden borra su respuesta** (`on delete cascade`). El borrado de la 142 guarda la orden en
   `deliveries_borradas` (`to_jsonb(OLD)`), **no** su encuesta. Aceptado: una respuesta sin orden no se puede leer (la
   política exige ver la orden).

## 2 · La pantalla y el uso (sin base, en el mismo commit)

- **Ajustes → Motor de rutas**: «Requisitos del camión» (el catálogo: añadir, quitar) y, en la tabla de choferes, «Su camión
  tiene» con una casilla por requisito. Sin la columna de `settings`, el catálogo dice que falta la actualización; sin la de
  `driver_settings`, la columna de la tabla no sale y no se manda.
- **Ficha de la orden**: «Requisitos del camión», una casilla por requisito del catálogo, bajo la prioridad. Solo si la base
  tiene la columna **y** hay catálogo.
- **Auto-asignar: NO en esta rama.** El orquestador lo sacó del alcance el 2026-09-27: otra rama lo reescribe para que use
  el motor de «Planificar el día», que ya respeta los requisitos. `dispatch.ts` y `auto-asignar.ts` quedan como en `main`.
- **«Mejor lugar»**: lo que el camión de la ruta elegida no puede llevar ni se coloca ni se asigna al final; el aviso dice
  qué falta. El cálculo del hueco no cambia.
- **«Planificar el día»** (`motor-3`): una orden solo va con un chofer que lo tenga todo; si nadie, fuera con
  `falta_requisito` y lo que falta; «¿Por qué aquí?» dice «Chofer X: no — falta Liftgate». Un chofer **fijado por una
  persona** se respeta aunque no lo tenga.
- **Seguimiento `/track/<id>`**: con la orden entregada, «How was your delivery?» con 5 estrellas y un comentario. Una vez
  respondida: «Thank you for your feedback!». **No se manda por SMS.**
- **Panel**: tarjeta «Satisfacción del cliente» (media, reparto, últimos comentarios) con las órdenes del Panel.

## 3 · Inventario de lecturas y escrituras que toca

| Pieza | Qué | Cambia |
|---|---|---|
| `settings.delivery_requirements` | columna + `check` `settings_delivery_requirements_shape` | nueva |
| `deliveries.requirements` | columna + `check` `deliveries_requirements_shape` | nueva |
| `driver_settings.features` | columna + `check` `driver_settings_features_shape` | nueva |
| `delivery_surveys` | tabla, RLS, 1 política (SELECT), disparador `delivery_surveys_solo_entregada` | nueva |
| `delivery_surveys_solo_entregada()` | función `security definer`, sin `execute` para `public/anon/authenticated` | nueva |
| `guard_delivery_stage` (145), `guard_factura_obligatoria` (146) | la autocomprobación exige que no mencionen `requirements` | **no se tocan** |
| Políticas de `deliveries`, `settings`, `driver_settings`, grants de esas tablas | — | **no se tocan** |
| `deliveries_borradas.fila` | `to_jsonb(OLD)` | lleva `requirements` sola (jsonb) |
| `/api/route-plan` | lee `settings`, `driver_settings` y `deliveries` con columnas enumeradas | pide las nuevas **si existen** (`leeConOpcionales`) |
| `/api/track/[id]` (GET) | lee `delivery_surveys` con la llave de servicio | nuevo: `survey: { answered }` |
| `/api/track/[id]/survey` (POST) | inserta con la llave de servicio | nuevo |
| Cliente: `select("*")` de `deliveries` y `settings` | las trae | — |
| Cliente: `driver_settings` (Ajustes, Gestor, Mapa) | columnas enumeradas | pide `features` si existe |

## 4 · Qué NO debe romperse

- Crear y editar órdenes **antes** de aplicar la 151 (la app no manda `requirements`).
- Toda la matriz de la 145/146/147: ninguna escritura que hoy pasa deja de pasar por las columnas nuevas.
- Ventas poniendo la factura (125) y agregando material (138): comparan la fila entera con una copia; `requirements` va en
  las dos igual.
- Guardar un chofer en Ajustes, publicar la ruta (135), el cron de la 406, deshacer y borrar (142).
- La página de seguimiento de una orden no entregada, y la de una entregada si la tabla no está.

## 5 · El SQL, literal

Ver `151_requisitos_y_encuesta.sql`. La autocomprobación (`do $chk$`) exige: las **tres** columnas `text[]`, `NOT NULL`,
defecto `'{}'`; que los guards de la 145 y la 146 (si está) no mencionen `requirements` (sobre el código sin comentarios,
lección de la 144); RLS puesta en `delivery_surveys`, **una** política y de `SELECT`; ni `anon` lee o inserta, ni
`authenticated` inserta, actualiza, borra o trunca; `authenticated` lee y `service_role` inserta; y el disparador puesto.

Sin `begin`/`commit` propios. **Sin `D-418` dentro del `.sql`**: numerar la decisión no cambia el checksum del registro.
Checksum del registro: `9ef71064704290ef2e3d09da942b85c861970a512fb11e9c6d9dc9dfe4cd719a`
(`node scripts/db/migrate-status.mjs --sum 151_requisitos_y_encuesta.sql`, 2026-09-27; una prueba del repo lo recalcula).

## 6 · Matriz de pruebas por rol, con ROLLBACK (la corre el orquestador)

**27 casos.** Crea sus filas dentro de la transacción; no depende de datos de producción ni los toca.

Sustituir: `<UUID-VENTAS>` (`sales`), `<UUID-OFFICE>` (`accounting`), `<UUID-GERENTE>` (`manager`, que vea `<TIENDA>`),
`<UUID-ALMACEN>` (`warehouse`), `<UUID-LOGISTICA>` (`logistics`), `<UUID-CHOFER>` (`driver`), `<UUID-ADMIN>` (`admin`), y
`<TIENDA>`: una tienda de `settings.stores` que **todos** vean (sin `visible_stores`, o con ella dentro). Las órdenes de
prueba son `Transfer` (no piden factura: la 146 no interviene).

Se pega entero en `psql` **desde la raíz del repo** (el `\i` es relativo). **Sin `commit` en ningún sitio.**

```sql
begin;

-- 0. La migración, dentro de la misma transacción (se deshace con el resto).
\i supabase/migrations/151_requisitos_y_encuesta.sql

-- P. Lo que ya estaba lee '{}' (antes de insertar nada).
do $$ declare a int; b int; c int; begin
  select count(*) into a from public.deliveries where requirements <> '{}';
  select count(*) into b from public.settings where delivery_requirements <> '{}';
  select count(*) into c from public.driver_settings where features <> '{}';
  raise notice 'P1  filas existentes con requisitos                  esperado 0/0/0: %', case when a+b+c = 0 then 'OK' else 'MAL '||a||'/'||b||'/'||c end;
end $$;

-- 1. Datos de prueba, como postgres (auth.uid() null: los guards los dejan pasar).
insert into public.deliveries (id, order_type, stage, store, pickup_name, account, created_by, est_pallets) values
  ('15100000-0000-4000-8000-000000000001','Transfer','delivered','<TIENDA>','<TIENDA>','ENSAYO 151',null,1),           -- entregada
  ('15100000-0000-4000-8000-000000000002','Transfer','ready',    '<TIENDA>','<TIENDA>','ENSAYO 151',null,1),           -- sin entregar
  ('15100000-0000-4000-8000-000000000003','Transfer','approved', '<TIENDA>','<TIENDA>','ENSAYO 151','<UUID-VENTAS>',1),-- de ventas, aprobada
  ('15100000-0000-4000-8000-000000000004','Transfer','approved', '<TIENDA>','<TIENDA>','ENSAYO 151',null,1);           -- office la edita
insert into public.driver_settings (profile_id, base_store) values ('<UUID-CHOFER>', '<TIENDA>')
  on conflict (profile_id) do nothing;

-- 2. La encuesta, escrita como la escribe la ruta (postgres/service_role saltan la RLS; el disparador y los check NO).
do $$ begin
  begin insert into public.delivery_surveys (delivery_id, rating, comment) values ('15100000-0000-4000-8000-000000000001', 5, 'muy bien');
    raise notice 'S1  encuesta de una ENTREGADA                        esperado OK: OK';
  exception when others then raise notice 'S1  MAL: %', sqlerrm; end;
  begin insert into public.delivery_surveys (delivery_id, rating) values ('15100000-0000-4000-8000-000000000001', 1);
    raise notice 'S2  segunda respuesta de la misma orden              esperado ERROR: MAL, paso';
  exception when others then raise notice 'S2  esperado ERROR: %', case when sqlstate='23505' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
  begin insert into public.delivery_surveys (delivery_id, rating) values ('15100000-0000-4000-8000-000000000002', 4);
    raise notice 'S3  encuesta de una SIN ENTREGAR                     esperado ERROR: MAL, paso';
  exception when others then raise notice 'S3  esperado ERROR: %', case when sqlerrm like 'SURVEY_NOT_DELIVERED%' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
  begin insert into public.delivery_surveys (delivery_id, rating) values ('15100000-0000-4000-8000-000000000004', 6);
    raise notice 'S4  6 estrellas                                      esperado ERROR: MAL, paso';
  exception when others then raise notice 'S4  esperado ERROR: %', case when sqlstate='23514' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
  begin insert into public.delivery_surveys (delivery_id, rating, comment) values ('15100000-0000-4000-8000-000000000001', 3, '');
    raise notice 'S5  comentario vacío                                 esperado ERROR: MAL, paso';
  exception when others then raise notice 'S5  esperado ERROR: %', case when sqlstate in ('23514','23505') then 'OK' else 'MAL ('||sqlerrm||')' end; end;
end $$;

set local role authenticated;

-- 3. Quién LEE la encuesta.
set local request.jwt.claims to '{"sub":"<UUID-ADMIN>","role":"authenticated"}';
do $$ declare n int; begin select count(*) into n from public.delivery_surveys where delivery_id='15100000-0000-4000-8000-000000000001';
  raise notice 'R1  admin lee la respuesta                           esperado 1: %', case when n=1 then 'OK' else 'MAL '||n end; end $$;
set local request.jwt.claims to '{"sub":"<UUID-LOGISTICA>","role":"authenticated"}';
do $$ declare n int; begin select count(*) into n from public.delivery_surveys where delivery_id='15100000-0000-4000-8000-000000000001';
  raise notice 'R2  logística la lee                                 esperado 1: %', case when n=1 then 'OK' else 'MAL '||n end; end $$;
set local request.jwt.claims to '{"sub":"<UUID-GERENTE>","role":"authenticated"}';
do $$ declare n int; begin select count(*) into n from public.delivery_surveys where delivery_id='15100000-0000-4000-8000-000000000001';
  raise notice 'R3  gerente (ve <TIENDA>) la lee                     esperado 1: %', case when n=1 then 'OK' else 'MAL '||n end; end $$;
set local request.jwt.claims to '{"sub":"<UUID-OFFICE>","role":"authenticated"}';
do $$ declare n int; begin select count(*) into n from public.delivery_surveys;
  raise notice 'R4  office NO la lee                                 esperado 0: %', case when n=0 then 'OK' else 'MAL '||n end; end $$;
set local request.jwt.claims to '{"sub":"<UUID-VENTAS>","role":"authenticated"}';
do $$ declare n int; begin select count(*) into n from public.delivery_surveys;
  raise notice 'R5  ventas NO la lee                                 esperado 0: %', case when n=0 then 'OK' else 'MAL '||n end; end $$;
set local request.jwt.claims to '{"sub":"<UUID-CHOFER>","role":"authenticated"}';
do $$ declare n int; begin select count(*) into n from public.delivery_surveys;
  raise notice 'R6  chofer NO la lee (D-026)                         esperado 0: %', case when n=0 then 'OK' else 'MAL '||n end; end $$;
set local request.jwt.claims to '{"sub":"<UUID-ALMACEN>","role":"authenticated"}';
do $$ declare n int; begin select count(*) into n from public.delivery_surveys;
  raise notice 'R7  almacén NO la lee                                esperado 0: %', case when n=0 then 'OK' else 'MAL '||n end; end $$;

-- 4. Nadie con sesión la ESCRIBE (ni el admin: solo la ruta, con la llave de servicio).
set local request.jwt.claims to '{"sub":"<UUID-ADMIN>","role":"authenticated"}';
do $$ begin
  begin insert into public.delivery_surveys (delivery_id, rating) values ('15100000-0000-4000-8000-000000000004', 5);
    raise notice 'W1  admin inserta una encuesta                       esperado ERROR: MAL, paso';
  exception when others then raise notice 'W1  esperado ERROR: %', case when sqlstate='42501' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
  begin update public.delivery_surveys set rating = 1;
    raise notice 'W2  admin cambia una respuesta                       esperado ERROR: MAL, paso';
  exception when others then raise notice 'W2  esperado ERROR: %', case when sqlstate='42501' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
  begin delete from public.delivery_surveys;
    raise notice 'W3  admin borra respuestas                           esperado ERROR: MAL, paso';
  exception when others then raise notice 'W3  esperado ERROR: %', case when sqlstate='42501' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
end $$;

-- 5. Requisitos: las reglas de siempre.
set local request.jwt.claims to '{"sub":"<UUID-OFFICE>","role":"authenticated"}';
do $$ declare n int; begin
  begin update public.deliveries set requirements='{Liftgate}' where id='15100000-0000-4000-8000-000000000004'; get diagnostics n = row_count;
    raise notice 'Q1  office: requisitos en una aprobada               esperado 1 fila: %', case when n=1 then 'OK' else 'MAL '||n||' filas' end;
  exception when others then raise notice 'Q1  MAL: %', sqlerrm; end;
  begin update public.deliveries set requirements=array[null]::text[] where id='15100000-0000-4000-8000-000000000004';
    raise notice 'Q2  office: un requisito NULL                        esperado ERROR: MAL, paso';
  exception when others then raise notice 'Q2  esperado ERROR: %', case when sqlstate='23514' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
  begin update public.deliveries set requirements=(select array_agg('r'||g) from generate_series(1,31) g) where id='15100000-0000-4000-8000-000000000004';
    raise notice 'Q3  office: 31 requisitos                            esperado ERROR: MAL, paso';
  exception when others then raise notice 'Q3  esperado ERROR: %', case when sqlstate='23514' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
  begin update public.deliveries set requirements=null where id='15100000-0000-4000-8000-000000000004';
    raise notice 'Q4  office: requisitos NULL                          esperado ERROR: MAL, paso';
  exception when others then raise notice 'Q4  esperado ERROR: %', case when sqlstate='23502' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
end $$;
set local request.jwt.claims to '{"sub":"<UUID-VENTAS>","role":"authenticated"}';
do $$ declare n int; begin
  begin update public.deliveries set requirements='{Liftgate}' where id='15100000-0000-4000-8000-000000000003'; get diagnostics n = row_count;
    raise notice 'Q5  ventas: requisitos en SU aprobada                esperado ERROR: MAL, % filas', n;
  exception when others then raise notice 'Q5  esperado ERROR: %', case when sqlerrm like 'You cannot edit an order in the approved stage%' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
end $$;

-- 6. El catálogo, solo el admin; lo del camión, admin y logística.
set local request.jwt.claims to '{"sub":"<UUID-ADMIN>","role":"authenticated"}';
do $$ declare n int; begin
  update public.settings set delivery_requirements='{Liftgate,Montacargas}' where id=1; get diagnostics n = row_count;
  raise notice 'C1  admin pone el catálogo                           esperado 1 fila: %', case when n=1 then 'OK' else 'MAL '||n||' filas' end;
end $$;
set local request.jwt.claims to '{"sub":"<UUID-LOGISTICA>","role":"authenticated"}';
do $$ declare n int; begin
  begin update public.settings set delivery_requirements='{}' where id=1; get diagnostics n = row_count;
    raise notice 'C2  logística cambia el catálogo                     esperado 0 filas: %', case when n=0 then 'OK' else 'MAL '||n||' filas' end;
  exception when others then raise notice 'C2  esperado 0 filas o ERROR de permiso: %', case when sqlstate='42501' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
  update public.driver_settings set features='{Liftgate}' where profile_id='<UUID-CHOFER>'; get diagnostics n = row_count;
  raise notice 'F1  logística marca lo del camión                    esperado 1 fila: %', case when n=1 then 'OK' else 'MAL '||n||' filas' end;
end $$;
set local request.jwt.claims to '{"sub":"<UUID-GERENTE>","role":"authenticated"}';
do $$ declare n int; begin
  update public.driver_settings set features='{}' where profile_id='<UUID-CHOFER>'; get diagnostics n = row_count;
  raise notice 'F2  gerente NO cambia lo del camión                  esperado 0 filas: %', case when n=0 then 'OK' else 'MAL '||n||' filas' end;
end $$;
set local request.jwt.claims to '{"sub":"<UUID-CHOFER>","role":"authenticated"}';
do $$ declare n int; begin
  update public.driver_settings set features='{Montacargas}' where profile_id='<UUID-CHOFER>'; get diagnostics n = row_count;
  raise notice 'F3  el chofer NO cambia su propio camión             esperado 0 filas: %', case when n=0 then 'OK' else 'MAL '||n||' filas' end;
end $$;

-- 7. anon: ni lee.
reset role;
set local role anon;
do $$ begin
  begin perform 1 from public.delivery_surveys;
    raise notice 'A1  anon lee la encuesta                             esperado ERROR: MAL, paso';
  exception when others then raise notice 'A1  esperado ERROR: %', case when sqlstate='42501' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
end $$;

reset role;
ROLLBACK;
```

**Resumen de lo que debe salir — 27 casos, cada línea tiene que decir `OK`:**

| Esperado | Casos | Cuántos |
|---|---|---|
| 0 filas con requisitos antes | P1 | 1 |
| la encuesta de una entregada entra | S1 | 1 |
| ERROR de la clave / disparador / `check` | S2 (23505), S3 (`SURVEY_NOT_DELIVERED`), S4, S5 | 4 |
| la lee | R1, R2, R3 | 3 |
| no la lee | R4, R5, R6, R7 | 4 |
| ERROR de permiso (42501) al escribirla con sesión | W1, W2, W3, A1 | 4 |
| requisitos: la regla de siempre | Q1 (1 fila), Q5 (ERROR del guard) | 2 |
| requisitos: `check` / `NOT NULL` | Q2, Q3 (23514), Q4 (23502) | 3 |
| catálogo y camiones | C1 (1), C2 (0), F1 (1), F2 (0), F3 (0) | 5 |

1 + 1 + 4 + 3 + 4 + 4 + 2 + 3 + 5 = **27**.

**Recomendado:** correr Q5 cambiando `requirements='{Liftgate}'` por `delivery_notes='ensayo'` y ver el **mismo** error: eso
prueba que los requisitos siguen las reglas de siempre. **Si algún MAL no es de los esperados, parar**: no aplicar.

**Si R3 da 0**: el gerente de prueba no ve `<TIENDA>` (131, `visible_stores`). Es la política haciendo su trabajo; cambiar
de gerente, no la regla.

## 7 · Mediciones de solo lectura (para el orquestador; NO corridas)

```sql
-- M1. Antes de aplicar: que nada de esto exista ya con otra forma (una 151 a medias).
select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns
 where table_schema = 'public' and (table_name, column_name) in
   (('settings','delivery_requirements'), ('deliveries','requirements'), ('driver_settings','features'));
select to_regclass('public.delivery_surveys');

-- M2. Que nadie use ya las columnas viejas de la 021 (D-043 midió 0 de 53 el 2026-08-16).
select count(*) filter (where csat_rating is not null) as con_estrellas, count(*) filter (where csat_comment is not null) as con_comentario
  from public.deliveries;

-- M3. Después: todo vacío, recién aplicada.
select (select count(*) from public.deliveries where requirements <> '{}') as ordenes,
       (select count(*) from public.driver_settings where features <> '{}') as camiones,
       (select count(*) from public.delivery_surveys) as respuestas;
```

## 8 · Reversión

En una transacción propia, a mano (también comentada al final del `.sql`):

```sql
drop table if exists public.delivery_surveys;
drop function if exists public.delivery_surveys_solo_entregada();
alter table public.driver_settings drop constraint if exists driver_settings_features_shape;
alter table public.driver_settings drop column if exists features;
alter table public.deliveries drop constraint if exists deliveries_requirements_shape;
alter table public.deliveries drop column if exists requirements;
alter table public.settings drop constraint if exists settings_delivery_requirements_shape;
alter table public.settings drop column if exists delivery_requirements;
delete from public.schema_migrations where name = '151_requisitos_y_encuesta.sql';
```

Se pierden el catálogo, lo marcado y las respuestas (respaldo antes, si interesan:
`create table delivery_surveys_backup as select * from public.delivery_surveys;`). **La app no se rompe**: sin columnas no
las pide ni las manda, y sin la tabla no enseña la encuesta ni la tarjeta del Panel.

## 9 · Lo que NO se ha medido

- **Nada contra la base.** Ni la migración, ni su autocomprobación, ni la matriz. Las pruebas del repo
  (`src/lib/encuesta.test.ts`, «la migración 151») comprueban el texto del `.sql` y el checksum; no sustituyen aplicarla.
- Que `information_schema.columns.column_default` escriba el defecto como `'{}'::text[]` (la autocomprobación busca
  `'{}'%`). Si alguna versión lo escribiera distinto, la autocomprobación fallaría **y no se aplicaría** — lado seguro.
- Que `service_role` tenga ya `INSERT` en tablas nuevas por los privilegios por defecto de Supabase: el `grant` explícito lo
  asegura igual, y la autocomprobación lo mira.
- Los códigos con que PostgREST dice «la tabla no existe» (`PGRST205`) y «la columna no existe» (`42703`/`PGRST204`) se
  midieron contra producción en D-412/D-415 y D-414, no en esta rama.
