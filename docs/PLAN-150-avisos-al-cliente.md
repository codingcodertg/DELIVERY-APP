# Plan 150 · Avisos al cliente (la noche antes y «en camino»)

Plan en papel exigido por `CLAUDE.md` («Antes de tocar RLS, triggers o permisos en producción» — aquí son **dos tablas
nuevas con RLS y seis columnas**). Molde: `docs/PLAN-147-prioridad.md`.

**Estado (2026-09-27):** escrito por un worker en un worktree **sin `.env.local` y sin acceso a la base**. Todo sale de
**leer el repo** (`origin/main` = `2a363c60`, D-415) y de medir el **demo local**. Nada se ha ejecutado contra
producción: ni la migración, ni su autocomprobación, ni el ensayo de §6. **Pendiente de aprobar.**

**Pedido del dueño (2026-09-27):** tras explicarle OptimoRoute (https://optimoroute.com/customer-notifications/), eligió
*«solos haz 1 3 y 4»*. El 1: un aviso al cliente **la noche antes** de la entrega y otro cuando el chofer **va en
camino**, por SMS o correo según la preferencia del cliente, con el enlace de seguimiento (`/track/<id>`) y opción de
darse de baja.

**La migración está escrita y NO aplicada:** `supabase/migrations/150_avisos_al_cliente.sql`. 147, 148 y 149 están
aplicadas (lo dice el encargo del orquestador; no lo medí yo): 150 es la siguiente libre.

---

## 0 · Resumen

| | Hoy | Con la 150 |
|---|---|---|
| `settings.notify_night_before_enabled` / `notify_on_the_way_enabled` | no existen | `boolean not null default false`: **apagados** |
| `settings.notify_night_before_hour` | no existe | `smallint not null default 18`, check 12-20 (hora de Texas) |
| `deliveries.customer_email` | no existe | `text`, solo check de largo (≤ 320) |
| `deliveries.notify_pref` | no existe | `text not null default 'both'`, check `both / sms / email / none` |
| `deliveries.customer_lang` | no existe | `text`, check `en / es` o null (null = bilingüe) |
| `public.customer_notifications` | no existe | registro: una fila por (orden, tipo, día de entrega), token de baja único |
| `public.customer_notify_optouts` | no existe | bajas por contacto (E.164 o correo en minúsculas) |
| Quién escribe registro y bajas | — | **solo la llave de servicio** (cron y `/api/avisos-cliente/*`) |
| Quién los lee | — | **solo el admin** (`is_admin()`) |
| La app antes de aplicar | — | Ajustes dice «falta aplicar la 150»; la ficha no enseña ni manda los campos; el cron da 502 y no manda nada |

**Hasta que el admin encienda los interruptores en Ajustes no sale ningún aviso**, con la 150 aplicada o sin ella.

## 1 · Decisiones (para validar)

1. **Apagados por defecto, y la autocomprobación lo exige** (`raise exception` si alguno queda encendido al migrar).
2. **Idempotencia en la base, no en la memoria del cron:** `unique (delivery_id, kind, service_date)`. El día entra en la
   clave porque una orden **reprogramada** es otra entrega: su cliente tiene que recibir el aviso de la fecha nueva (el
   encargo decía «un aviso por orden y tipo»; esto lo afina, **para validar**). El envío **reclama** la fila
   (`insert … on conflict do nothing`, vía `upsert(..., { ignoreDuplicates: true })`) **antes** de mandar; si no la
   consigue, no manda. Consecuencia: un envío que falla no se reintenta solo — queda `failed` en el registro. Se prefiere
   un aviso perdido a dos avisos cobrados.
3. **Sin clave foránea** de `customer_notifications.delivery_id` a `deliveries`: borrar una orden (142) no debe llevarse
   el registro de lo que se le mandó y se cobró.
4. **Registro y bajas: solo lectura para el admin; nadie escribe desde la app.** `revoke all` a `anon` y
   `authenticated`, `grant select` a `authenticated`, **una** política `SELECT` con `is_admin()` por tabla. El chofer que
   dispara «en camino» no escribe nada: la ruta del servidor usa la llave de servicio tras `requireUser`.
5. **`customer_email` sin validar el formato en la base.** Un correo mal tecleado no puede tumbar el guardado de la orden
   entera; la validez la decide el envío (`correoValido`), que lo salta.
6. **No se tocan `guard_delivery_stage` (145) ni `guard_factura_obligatoria` (146).** Las columnas nuevas siguen las
   reglas de siempre (mismo razonamiento que la 147, §1.3 de su plan). La autocomprobación exige que no las mencionen.
7. **Las bajas valen por contacto, para todas las órdenes**, no solo para la orden del enlace. Es lo que dice el pedido
   («marca "no avisar" para ese teléfono/correo»).

## 2 · La app (sin base, en el mismo commit)

- **Ajustes** → tarjeta «📨 Avisos al cliente»: dos interruptores (apagados) y la hora (12:00 PM – 8:00 PM). Sin la 150,
  un aviso y nada más (`laBaseTieneAjustesDeAvisos`).
- **Ficha** (`OrderModal.tsx`), solo en órdenes a cliente: correo, «Avisos al cliente» (SMS y correo / Solo SMS / Solo
  correo / No avisar) e idioma (Inglés + español / English / Español). Sin la 150 no se enseñan ni viajan
  (`conAvisosSiCabe`, mismo patrón que `conPrioridadSiCabe`).
- **Noche antes:** `/api/cron/avisos-noche-antes/[franja]`, diez entradas diarias en `vercel.json` (UTC 17…02). Hobby
  solo admite crons diarios; la hora la decide la ruta contra Ajustes. Manda a las órdenes de **mañana** (Texas) en
  `approved / fulfilling / ready / picked_up`, desde la hora elegida hasta antes de las 21:00.
- **En camino:** sin cron. `setStage` (y la cola offline) de `data-provider.tsx` pide `POST /api/avisos-cliente/en-camino`
  al recoger o entregar, si el interruptor está encendido. El servidor rehace la ruta del chofer con las funciones de «Mi
  ruta» y avisa a la siguiente parada si ya va en el camión (`picked_up`).
- **Baja:** `/unsubscribe/<token>` (pública, `route-guard.ts`), con un **botón**; el POST a `/api/avisos-cliente/baja`
  escribe la baja. Abrir la página no da de baja (los antivirus de correo abren los enlaces solos).
- **Proveedor:** `lib/mensajeria.ts` (RingCentral → Twilio para SMS, Resend para correo), el mismo que usa
  `/api/notify`, que se reescribió para llamarlo. En el demo, siempre un stub.

## 3 · Inventario de lecturas y escrituras

| Pieza | Quién | Qué |
|---|---|---|
| `settings` (3 columnas) | admin desde Ajustes (política «settings update admin», 100) | escribe |
| `settings` | cron y `/en-camino` (servicio) | lee `notify_*` y `order_type_rules` |
| `deliveries` (3 columnas) | quien ya edita la orden en su etapa (guard 145) | escribe desde la ficha |
| `deliveries` | cron (servicio) | lee `select *` de mañana, etapas del aviso, `is_training = false` |
| `deliveries` | `/en-camino` (servicio) | lee la orden, y la ruta del chofer ese día |
| `customer_notifications` | cron y `/en-camino` (servicio) | inserta (reclamo) y actualiza (resultado) |
| `customer_notifications` | `/baja` (servicio) | lee por `unsub_token` |
| `customer_notify_optouts` | `/baja` (servicio) | inserta (`on conflict do nothing`) |
| `customer_notify_optouts` | cron y `/en-camino` (servicio) | lee por contacto |
| Las dos tablas nuevas | admin | lee (auditoría, coste) — en SQL; la app no tiene pantalla para esto todavía |
| Políticas de `deliveries`, `settings`, guards, grants existentes | — | **no se tocan** |

## 4 · Qué NO debe romperse

- Crear y editar órdenes **antes** de aplicar la 150 (la app no manda los campos).
- Todo lo de la matriz de la 145, la 146 y la 147.
- Guardar Ajustes (la tarjeta nueva no guarda nada sin la 150).
- El SMS manual y el automático al crear (`/api/notify`): mismas respuestas, mismo proveedor.
- Publicar la ruta (135), el cron de la 406, deshacer, borrar (142).

## 5 · El SQL, literal

Ver `150_avisos_al_cliente.sql`. La autocomprobación (`do $comprueba$`) exige: las 3 columnas de `settings` con su tipo,
defecto y `NOT NULL`, **y ninguna encendida**; las 3 de `deliveries` y todas en `both`; en las dos tablas nuevas RLS
puesta, exactamente una política y de `SELECT`, `anon` sin `SELECT`/`INSERT`, `authenticated` sin
`INSERT/UPDATE/DELETE/TRUNCATE` y con `SELECT`; y que ni `guard_delivery_stage` ni (si existe)
`guard_factura_obligatoria` mencionen las columnas nuevas, mirando el código **sin comentarios** (lección de la 144).

Sin `begin`/`commit` propios. **Sin `D-416` ni `D-4xx` dentro del `.sql`**: numerar la decisión no cambia el checksum.

## 6 · Matriz de pruebas por rol, con ROLLBACK (la corre el orquestador)

**27 casos.** Crea sus filas dentro de la transacción; no depende de datos de producción ni los toca.

Sustituir: `<UUID-VENTAS>` (`sales`), `<UUID-OFFICE>` (`accounting`), `<UUID-GERENTE>` (`manager`), `<UUID-ALMACEN>`
(`warehouse`), `<UUID-LOGISTICA>` (`logistics`), `<UUID-CHOFER>` (`driver`), `<UUID-ADMIN>` (`admin`), `<TIENDA>`
(una tienda que todos vean y que no apruebe sola).

Se pega entero en `psql` **desde la raíz del repo** (el `\i` es relativo). **Sin `commit` en ningún sitio.**

```sql
begin;

-- 0. La migración, dentro de la misma transacción (se deshace con el resto).
\i supabase/migrations/150_avisos_al_cliente.sql

-- P1. Nacen apagados y las órdenes existentes en 'both'.
do $$ declare n int; begin
  select count(*) into n from public.settings where notify_night_before_enabled or notify_on_the_way_enabled;
  raise notice 'P1  avisos encendidos al migrar                     esperado 0: %', case when n = 0 then 'OK' else 'MAL '||n end;
  select count(*) into n from public.deliveries where notify_pref <> 'both' or customer_email is not null or customer_lang is not null;
  raise notice 'P2  órdenes con valores distintos del defecto       esperado 0: %', case when n = 0 then 'OK' else 'MAL '||n end;
end $$;

-- 1. Datos de prueba, como postgres (salta RLS).
insert into public.customer_notifications (id, delivery_id, kind, service_date, sms_to, unsub_token)
  values ('15000000-0000-4000-8000-000000000001', '15000000-0000-4000-8000-0000000000aa', 'night_before', '2026-10-01', '+19565550100', 'EnsayoToken15000');
insert into public.customer_notify_optouts (contact, channel) values ('+19565550100', 'sms');
insert into public.deliveries (id, order_type, stage, store, pickup_name, account, created_by, est_pallets) values
  ('15000000-0000-4000-8000-000000000011','Transfer','draft','<TIENDA>','<TIENDA>','ENSAYO 150','<UUID-VENTAS>',3),   -- D1
  ('15000000-0000-4000-8000-000000000012','Transfer','ready','<TIENDA>','<TIENDA>','ENSAYO 150',null,3);              -- D2

-- R1-R2. Unicidad: el mismo aviso otra vez choca (es el reclamo idempotente).
do $$ begin
  begin insert into public.customer_notifications (delivery_id, kind, service_date, sms_to, unsub_token)
          values ('15000000-0000-4000-8000-0000000000aa', 'night_before', '2026-10-01', '+19565550100', 'OtroToken1500000');
    raise notice 'R1  mismo (orden, tipo, día) dos veces             esperado ERROR: MAL, pasó';
  exception when unique_violation then raise notice 'R1  mismo (orden, tipo, día) dos veces             esperado ERROR: OK'; end;
  begin insert into public.customer_notifications (delivery_id, kind, service_date, sms_to, unsub_token)
          values ('15000000-0000-4000-8000-0000000000bb', 'on_the_way', '2026-10-01', '+19565550100', 'token malo');
    raise notice 'R2  token sin la forma de 16 base64url             esperado ERROR: MAL, pasó';
  exception when check_violation then raise notice 'R2  token sin la forma de 16 base64url             esperado ERROR: OK'; end;
end $$;

set local role authenticated;

-- 2. Cada rol de la app: NO ve el registro ni las bajas, y NO puede escribir. El admin ve, tampoco escribe.
do $$ declare r record; n int; m int; begin
  for r in select * from (values
      ('<UUID-VENTAS>','ventas',0), ('<UUID-OFFICE>','office',0), ('<UUID-GERENTE>','gerente',0), ('<UUID-ALMACEN>','almacén',0),
      ('<UUID-LOGISTICA>','logística',0), ('<UUID-CHOFER>','chofer',0), ('<UUID-ADMIN>','admin',1)) v(uuid, nombre, ve) loop
    perform set_config('request.jwt.claims', json_build_object('sub', r.uuid, 'role', 'authenticated')::text, true);
    select count(*) into n from public.customer_notifications where id = '15000000-0000-4000-8000-000000000001';
    select count(*) into m from public.customer_notify_optouts where contact = '+19565550100';
    raise notice 'L-%  lee registro/bajas                   esperado %/%: %', rpad(r.nombre,10), r.ve, r.ve,
      case when n = r.ve and m = r.ve then 'OK' else 'MAL '||n||'/'||m end;
    begin insert into public.customer_notify_optouts (contact, channel) values ('+19565559999', 'sms');
      raise notice 'W-%  escribe una baja                     esperado ERROR: MAL, pasó', rpad(r.nombre,10);
    exception when insufficient_privilege then raise notice 'W-%  escribe una baja                     esperado ERROR: OK', rpad(r.nombre,10); end;
  end loop;
end $$;

-- 3. Ajustes: el admin enciende; el gerente no puede (0 filas, política de la 100); una hora fuera de rango, error.
do $$ declare n int; begin
  perform set_config('request.jwt.claims', '{"sub":"<UUID-GERENTE>","role":"authenticated"}', true);
  update public.settings set notify_night_before_enabled = true where id = 1; get diagnostics n = row_count;
  raise notice 'S1  gerente enciende el aviso                       esperado 0 filas: %', case when n = 0 then 'OK' else 'MAL '||n end;
  perform set_config('request.jwt.claims', '{"sub":"<UUID-ADMIN>","role":"authenticated"}', true);
  update public.settings set notify_night_before_enabled = true, notify_night_before_hour = 19 where id = 1; get diagnostics n = row_count;
  raise notice 'S2  admin enciende y pone las 19                    esperado 1 fila: %', case when n = 1 then 'OK' else 'MAL '||n end;
  begin update public.settings set notify_night_before_hour = 23 where id = 1;
    raise notice 'S3  hora 23 (fuera de 12-20)                        esperado ERROR: MAL, pasó';
  exception when check_violation then raise notice 'S3  hora 23 (fuera de 12-20)                        esperado ERROR: OK'; end;
end $$;

-- 4. La orden: las columnas siguen las reglas de siempre.
do $$ declare n int; begin
  perform set_config('request.jwt.claims', '{"sub":"<UUID-VENTAS>","role":"authenticated"}', true);
  update public.deliveries set notify_pref = 'sms', customer_email = 'ensayo@correo.com', customer_lang = 'es'
   where id = '15000000-0000-4000-8000-000000000011'; get diagnostics n = row_count;
  raise notice 'O1  ventas: avisos en SU borrador                    esperado 1 fila: %', case when n = 1 then 'OK' else 'MAL '||n end;
  begin update public.deliveries set notify_pref = 'whatsapp' where id = '15000000-0000-4000-8000-000000000011';
    raise notice 'O2  preferencia que no existe                       esperado ERROR: MAL, pasó';
  exception when check_violation then raise notice 'O2  preferencia que no existe                       esperado ERROR: OK'; end;
  begin update public.deliveries set customer_lang = 'fr' where id = '15000000-0000-4000-8000-000000000011';
    raise notice 'O3  idioma que no existe                            esperado ERROR: MAL, pasó';
  exception when check_violation then raise notice 'O3  idioma que no existe                            esperado ERROR: OK'; end;
  begin update public.deliveries set notify_pref = null where id = '15000000-0000-4000-8000-000000000011';
    raise notice 'O4  preferencia NULL                                esperado ERROR: MAL, pasó';
  exception when not_null_violation then raise notice 'O4  preferencia NULL                                esperado ERROR: OK'; end;
  perform set_config('request.jwt.claims', '{"sub":"<UUID-CHOFER>","role":"authenticated"}', true);
  begin update public.deliveries set notify_pref = 'none' where id = '15000000-0000-4000-8000-000000000012'; get diagnostics n = row_count;
    raise notice 'O5  chofer: avisos en una LISTA (guard 145)         esperado ERROR o 0 filas: %', case when n = 0 then 'OK (0 filas)' else 'MAL '||n end;
  exception when others then raise notice 'O5  chofer: avisos en una LISTA (guard 145)         esperado ERROR: %', case when sqlerrm like 'You cannot edit an order in the ready stage%' then 'OK' else 'MAL ('||sqlerrm||')' end; end;
end $$;

-- 5. anon no ve nada.
reset role;
set local role anon;
do $$ begin
  begin perform 1 from public.customer_notifications limit 1;
    raise notice 'A1  anon lee el registro                            esperado ERROR: MAL, pasó';
  exception when insufficient_privilege then raise notice 'A1  anon lee el registro                            esperado ERROR: OK'; end;
end $$;

ROLLBACK;
```

**Resumen — 27 casos, cada línea tiene que decir `OK`:**

| Esperado | Casos | Cuántos |
|---|---|---|
| 0 filas fuera del defecto | P1, P2 | 2 |
| ERROR de unicidad / de forma del token | R1, R2 | 2 |
| Lee 0/0 (seis roles) y 1/1 (admin) | L-ventas … L-admin | 7 |
| ERROR de permiso al escribir una baja (los siete, admin incluido) | W-ventas … W-admin | 7 |
| Ajustes: gerente 0 filas, admin 1 fila, hora 23 error | S1, S2, S3 | 3 |
| Orden: ventas 1 fila; preferencia, idioma y null, error | O1-O4 | 4 |
| Chofer en una lista: error del guard (o 0 filas) | O5 | 1 |
| anon: error de permiso | A1 | 1 |

2 + 2 + 7 + 7 + 3 + 4 + 1 + 1 = **27**.

**Si algún MAL no es de los esperados, parar**: no aplicar.

## 7 · Mediciones de solo lectura (para el orquestador; NO corridas)

```sql
-- M1. Antes de aplicar: que nada de esto exista ya con otra forma.
select table_name, column_name from information_schema.columns
 where table_schema = 'public' and ((table_name = 'settings' and column_name like 'notify_%')
    or (table_name = 'deliveries' and column_name in ('customer_email', 'notify_pref', 'customer_lang')));
select to_regclass('public.customer_notifications'), to_regclass('public.customer_notify_optouts');

-- M2. Cuántas órdenes Customer por día (para el coste; ver la entrada de DECISIONS.md).
select delivery_date, count(*) from public.deliveries
 where delivery_date >= current_date - 30 and stage not in ('canceled', 'rejected', 'draft') and not is_training
 group by 1 order by 1;

-- M3. Después de encenderlo: lo enviado y su coste, por mes.
select date_trunc('month', created_at) mes, kind,
       count(*) filter (where sms_status = 'sent') sms, sum(sms_segments) filter (where sms_status = 'sent') segmentos,
       count(*) filter (where email_status = 'sent') correos,
       count(*) filter (where sms_status = 'failed' or email_status = 'failed') fallidos
  from public.customer_notifications group by 1, 2 order by 1, 2;
```

## 8 · Reversión

En una transacción propia, a mano (también comentada al final del `.sql`). **Antes, guardar las bajas**: si se revierte
y se vuelve a aplicar sin ellas, quien se dio de baja volvería a recibir avisos.

```sql
\copy public.customer_notify_optouts to 'bajas-150.csv' csv header
drop table if exists public.customer_notify_optouts;
drop table if exists public.customer_notifications;
alter table public.deliveries drop constraint if exists deliveries_customer_lang_allowed;
alter table public.deliveries drop constraint if exists deliveries_notify_pref_allowed;
alter table public.deliveries drop constraint if exists deliveries_customer_email_length;
alter table public.deliveries drop column if exists customer_lang;
alter table public.deliveries drop column if exists notify_pref;
alter table public.deliveries drop column if exists customer_email;
alter table public.settings drop constraint if exists settings_notify_night_before_hour_range;
alter table public.settings drop column if exists notify_night_before_hour;
alter table public.settings drop column if exists notify_on_the_way_enabled;
alter table public.settings drop column if exists notify_night_before_enabled;
delete from public.schema_migrations where name = '150_avisos_al_cliente.sql';
```

**La app no se rompe:** Ajustes vuelve a «falta aplicar la 150», la ficha deja de enseñar y mandar los campos, el cron
lee `settings`, falla con 502 y no manda nada, y «en camino» no se pide (el interruptor no existe = apagado).

## 9 · Lo que NO se ha medido

- **Nada contra la base.** Ni la migración, ni su autocomprobación, ni la matriz. `src/lib/avisos-cliente.test.ts` («la
  150») comprueba el texto del `.sql`, el checksum del registro, los defectos apagados y que no haya políticas de
  escritura; no sustituye aplicarla.
- Que `information_schema.columns.column_default` devuelva `'false'` y `'18'` tal cual para esos defectos (así lo
  escribe Postgres 15-17). Si saliera distinto, la autocomprobación falla **y no se aplica**: lado seguro.
- Que `upsert(..., { ignoreDuplicates: true }).select("id")` de supabase-js devuelva **cero filas** cuando choca (es
  `on conflict do nothing` + `return=representation`): probado con la base falsa, no contra PostgREST.
- Que Vercel acepte diez rutas de cron distintas bajo un segmento dinámico (`/api/cron/avisos-noche-antes/[franja]`).
  La página de Vercel (leída para D-406) dice 100 crons por proyecto en todos los planes y diarios en Hobby; estas lo
  cumplen. Lo dirá el primer despliegue.
