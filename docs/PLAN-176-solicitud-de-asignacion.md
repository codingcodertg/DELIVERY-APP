# Plan 176 · «📅 Pedir para hoy»: la tabla `assign_requests` (solicitudes de asignación)

Plan en papel exigido por `CLAUDE.md` («Antes de tocar RLS, triggers o permisos en producción»): esta migración crea **una
tabla nueva con RLS**, **dos disparadores** (un guard invoker y los avisos definer) y sus grants. No toca ninguna tabla,
política ni función que ya exista. Molde: `docs/PLAN-A-2a-profiles-rls.md` y `docs/PLAN-173-reprogramar-orden.md`.
**Nada de esto se ha aplicado ni ensayado en ninguna base** (el worktree no tiene `.env.local`): lo aplica el orquestador
después de fusionar, con `migrate-status` antes y después, y con un respaldo o `pg_dump` reciente.

**Lo que pidió el dueño (2026-10-15), literal:** *«vamos a hacer un assign order request para employees y office que van or
ejemplo sale una orden para manna pero el driver tiene spacio hoy ellos pueden pedir que sa orden se asgine para hoy
hadciendo un reschedue y un assgin request»*.

## 0 · Qué hace y qué NO hace la base

- **Guarda la petición y en qué quedó.** Nada más. «Aprobar» no se hace en la base: la app reprograma con
  `reprogramar_orden` (173; la 172 saca la orden de la ruta vieja) y asigna con el mismo `UPDATE deliveries set
  assigned_driver = …` que el «Asignar a…» del Gestor, cada uno con sus permisos de siempre (guard 173). Así la 176 no abre
  ninguna escritura nueva sobre `deliveries`.
- Por eso la decisión se marca **después** de mover la orden: si reprogramar o asignar fallan, la solicitud sigue abierta.
  El hueco que queda (la orden se movió y la marca de la solicitud falla) se ve en la bandeja: sigue abierta, y al volver a
  aprobar `pasosAlAprobar` ya no reprograma (la fecha coincide).

## 1 · Inventario de lecturas y escrituras

| Quién | Qué | Dónde (app) | Camino |
|---|---|---|---|
| ventas / Office / gerente | INSERT de su solicitud | `PedirAsignacion` → `useSolicitudesDeAsignacion.pedir` | cliente con RLS |
| quien pidió | SELECT de las suyas | ficha (`PedirAsignacion`) | cliente con RLS |
| quien pidió | UPDATE `status = 'canceled'` de su abierta | ficha («Cancelar») | cliente con RLS, `.select("id")` |
| logística / admin | SELECT de todas | Gestor (`BandejaDeSolicitudes`) | cliente con RLS |
| logística / admin | UPDATE `approved` (+ `assigned_driver`) / `rejected` (+ `decision_note`) | Gestor | cliente con RLS, `.select("id")` |
| disparador `assign_requests_avisa` | INSERT en `public.notifications` | — | definer |
| disparador `assign_requests_guard` | SELECT de la orden (etapa, fecha, dueñez) | — | invoker: RLS de quien pide |

Nadie borra (sin política ni grant de DELETE). Las filas se van solas si se borra la orden (`on delete cascade`).

## 2 · Lo que se crea (literal)

Ver `supabase/migrations/176_solicitudes_de_asignacion.sql`. Las políticas, tal cual:

```sql
create policy "assign_requests select" on public.assign_requests for select to authenticated
  using (requested_by = (select auth.uid()) or (select public.current_user_role()) in ('logistics', 'admin'));

create policy "assign_requests insert" on public.assign_requests for insert to authenticated
  with check (requested_by = (select auth.uid())
              and (select public.current_user_role()) in ('sales', 'accounting', 'manager', 'admin'));

create policy "assign_requests update" on public.assign_requests for update to authenticated
  using (requested_by = (select auth.uid()) or (select public.current_user_role()) in ('logistics', 'admin'))
  with check (requested_by = (select auth.uid()) or (select public.current_user_role()) in ('logistics', 'admin'));
```

Lo fino lo decide el guard (BEFORE INSERT OR UPDATE, **security invoker**):

- **INSERT:** rol en `sales, accounting, manager, admin` (el admin, que la app no ofrece, para que «ver como» no falle: la
  base ve el rol de verdad); la orden existe **para quien pide** (invoker); etapa abierta (`draft…ready`); ventas solo la
  suya (`created_by` o `assigned_sales_rep`, con `coalesce` — lección de la 173); fecha ≥ hoy (Chicago) y distinta de la
  que tiene. La base pone `requested_by`, `from_date`, `status = 'open'` y vacía la decisión.
- **UPDATE:** lo pedido no cambia (`SOLICITUD_INMUTABLE`); solo desde `open` (`SOLICITUD_CERRADA`); `canceled` solo quien
  pidió; `approved`/`rejected` solo logística/admin; `rejected` con motivo de 3 letras. La base pone `decided_by` y
  `decided_at`.
- **Una abierta por orden:** índice único parcial `(delivery_id) where status = 'open'` (la segunda da `23505`).

Los avisos (AFTER INSERT OR UPDATE OF status, **security definer** porque ventas no lee los perfiles de logística, 099): la
nueva, a cada perfil `logistics`/`admin` menos quien pidió (`kind = 'assign_request'`); la aprobada o rechazada, a quien
pidió salvo que decidiera él mismo (`assign_request_approved` / `assign_request_rejected`). Texto en inglés y español en la
misma línea, como no hay idioma por persona en la base.

## 3 · Qué no debe romperse

1. Ninguna política existente cambia: `deliveries`, `notifications`, `profiles` siguen igual. La 176 solo añade.
2. La app funciona **sin** la 176: el gancho reconoce la tabla ausente (`42P01` / `PGRST205`, `tablaAusente`) y ni el botón
   ni la bandeja se pintan. Revertir no exige desplegar nada.
3. Reprogramar (D-500/D-549) y «Asignar a…» siguen con sus permisos: aprobar los llama, no los rodea.
4. El modo enseñanza y el demo no escriben solicitudes (el gancho se apaga).
5. Las solicitudes no se pueden borrar ni reescribir: son historial (regla 2 de la documentación).

## 4 · Ensayo por rol, con ROLLBACK (script listo para el orquestador)

Para pegar en `psql` contra producción (o un respaldo) **dentro de una transacción que termina en ROLLBACK**. Elige solo
sus actores y su orden con `\gset`; si alguna consulta de elección no devuelve fila, `psql` avisa y hay que elegir a mano.
Cada prueba que debe fallar va en su `savepoint`. **No manda nada fuera:** los avisos son filas en `notifications`, que el
ROLLBACK se lleva (no hay push ni correo en la 176).

```sql
begin;
\i supabase/migrations/176_solicitudes_de_asignacion.sql   -- sin begin/commit propios: queda dentro de esta transacción

-- Actores y órdenes (como postgres, antes de cambiar de rol)
select id as ventas from public.profiles where role = 'sales' order by created_at limit 1 \gset
select id as ventas2 from public.profiles where role = 'sales' and id <> :'ventas' order by created_at limit 1 \gset
select id as oficina from public.profiles where role = 'accounting' limit 1 \gset
select id as logistica from public.profiles where role = 'logistics' limit 1 \gset
select id as chofer from public.profiles where role = 'driver' limit 1 \gset
select id as suya from public.deliveries
 where stage in ('approved','fulfilling','ready') and (created_by = :'ventas' or assigned_sales_rep = :'ventas')
   and delivery_date > (now() at time zone 'America/Chicago')::date order by delivery_date limit 1 \gset
select id as ajena from public.deliveries
 where stage in ('approved','fulfilling','ready') and created_by is distinct from :'ventas'
   and assigned_sales_rep is distinct from :'ventas' and delivery_date > (now() at time zone 'America/Chicago')::date limit 1 \gset
select id as entregada from public.deliveries where stage = 'delivered' limit 1 \gset
select count(*) as avisos_antes from public.notifications \gset

set local role authenticated;

-- P1 ventas pide SU orden para hoy → pasa; la base pone requested_by, from_date y status
select set_config('request.jwt.claims', json_build_object('sub', :'ventas', 'role', 'authenticated')::text, true);
insert into public.assign_requests (delivery_id, requested_date, suggested_driver, note)
  values (:'suya', (now() at time zone 'America/Chicago')::date, '  Max  ', ' el   cliente puede hoy ');
select requested_by = :'ventas' as quien_ok, from_date is not null as de_ok, status, suggested_driver, note
  from public.assign_requests where delivery_id = :'suya';                      -- t, t, open, 'Max', 'el cliente puede hoy'
-- P2 una segunda abierta para la misma orden → 23505
savepoint s; insert into public.assign_requests (delivery_id, requested_date) values (:'suya', (now() at time zone 'America/Chicago')::date + 1); rollback to s;
-- P3 ventas, orden AJENA → SOLICITUD_NO_ES_SUYA (o SOLICITUD_SIN_ORDEN si su RLS no la deja verla)
savepoint s; insert into public.assign_requests (delivery_id, requested_date) values (:'ajena', (now() at time zone 'America/Chicago')::date); rollback to s;
-- P4 fecha pasada → SOLICITUD_FECHA_PASADA; entregada → SOLICITUD_ETAPA (o SIN_ORDEN)
savepoint s; insert into public.assign_requests (delivery_id, requested_date) values (:'suya', current_date - 1); rollback to s;   -- el guard corre antes que el índice único
savepoint s; insert into public.assign_requests (delivery_id, requested_date) values (:'entregada', (now() at time zone 'America/Chicago')::date); rollback to s;
-- P5 ventas intenta aprobar la suya → SOLICITUD_NO_PERMITIDA; y reescribir la fecha → SOLICITUD_INMUTABLE
savepoint s; update public.assign_requests set status = 'approved' where delivery_id = :'suya'; rollback to s;
savepoint s; update public.assign_requests set requested_date = requested_date + 1 where delivery_id = :'suya'; rollback to s;
-- P6 no se borra → permission denied
savepoint s; delete from public.assign_requests where delivery_id = :'suya'; rollback to s;

-- P7 otro vendedor: no la ve, y su UPDATE toca 0 filas
select set_config('request.jwt.claims', json_build_object('sub', :'ventas2', 'role', 'authenticated')::text, true);
select count(*) as ve_ajena from public.assign_requests where delivery_id = :'suya';           -- 0
update public.assign_requests set status = 'canceled' where delivery_id = :'suya';            -- UPDATE 0

-- P8 chofer: ni pide (SOLICITUD_NO_PERMITIDA) ni ve (0)
select set_config('request.jwt.claims', json_build_object('sub', :'chofer', 'role', 'authenticated')::text, true);
savepoint s; insert into public.assign_requests (delivery_id, requested_date) values (:'suya', (now() at time zone 'America/Chicago')::date + 2); rollback to s;
select count(*) as chofer_ve from public.assign_requests;                                      -- 0

-- P9 logística: ve todas; los avisos de P1 le llegaron
select set_config('request.jwt.claims', json_build_object('sub', :'logistica', 'role', 'authenticated')::text, true);
select count(*) as logistica_ve from public.assign_requests where delivery_id = :'suya';       -- 1
select count(*) as su_aviso from public.notifications where user_id = :'logistica' and kind = 'assign_request' and delivery_id = :'suya';  -- 1
-- P10 rechazar sin motivo → SOLICITUD_SIN_MOTIVO; cancelar la de otro → SOLICITUD_NO_PERMITIDA
savepoint s; update public.assign_requests set status = 'rejected', decision_note = ' x ' where delivery_id = :'suya'; rollback to s;
savepoint s; update public.assign_requests set status = 'canceled' where delivery_id = :'suya'; rollback to s;
-- P11 aprobar → pasa; decided_by = logística; aviso a ventas
update public.assign_requests set status = 'approved', assigned_driver = 'Max' where delivery_id = :'suya' and status = 'open';
select status, decided_by = :'logistica' as quien_decide, decided_at is not null as cuando from public.assign_requests where delivery_id = :'suya';
-- P12 decidir otra vez → SOLICITUD_CERRADA
savepoint s; update public.assign_requests set status = 'rejected', decision_note = 'otra vez' where delivery_id = :'suya'; rollback to s;

-- P13 ventas ve en qué quedó y recibió su aviso
select set_config('request.jwt.claims', json_build_object('sub', :'ventas', 'role', 'authenticated')::text, true);
select status, assigned_driver from public.assign_requests where delivery_id = :'suya';         -- approved, Max
select count(*) as aviso_aprobada from public.notifications where user_id = :'ventas' and kind = 'assign_request_approved';  -- ≥ 1

-- P14 Office pide una orden que no creó (no es ventas: no se mira la dueñez) y la cancela él → sí
select set_config('request.jwt.claims', json_build_object('sub', :'oficina', 'role', 'authenticated')::text, true);
insert into public.assign_requests (delivery_id, requested_date) values (:'ajena', (now() at time zone 'America/Chicago')::date);
update public.assign_requests set status = 'canceled' where delivery_id = :'ajena' and status = 'open';
select status from public.assign_requests where delivery_id = :'ajena';                        -- canceled

-- P15 anon no lee
reset role; set local role anon;
savepoint s; select count(*) from public.assign_requests; rollback to s;                        -- permission denied

rollback;
```

## 5 · Reversión

```sql
drop table if exists public.assign_requests;            -- arrastra índices, políticas y disparadores
drop function if exists public.assign_requests_guard();
drop function if exists public.assign_requests_avisa();
delete from public.schema_migrations where name = '176_solicitudes_de_asignacion.sql';
```

Los avisos ya enviados se quedan en `public.notifications` (historial). Las órdenes que se aprobaron ya están reprogramadas
y asignadas: cada cambio dejó sus eventos («edited», la nota de la reprogramación y «Assigned to …»). La app sigue
funcionando sin la tabla (no pinta ni el botón ni la bandeja), así que revertir no exige desplegar nada.
