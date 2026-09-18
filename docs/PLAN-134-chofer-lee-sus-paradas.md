# Plan 134 — que el chofer lea SUS paradas del plan publicado

> **Decidido (orquestador, 2026-09-18): la opción (b) de §5, SOLA.** Una función `my_published_stops(p_date)`
> `security definer` y **cero políticas nuevas**; la función `route_plan_is_published` y la política de §3 NO se
> hacen. Lo escrito es `supabase/migrations/134_my_published_stops.sql`, con su propia matriz de ensayo (12 casos)
> y su reversión (`drop function`). Las §3, §4, §6 y §7 de abajo quedan como el camino que se descartó, y por qué
> se llegó a él; no se reescriben. También decidido: al chofer se le enseñan secuencia y ventanas, y las horas
> como «estimado», sin minutos de retraso, hasta que el reporte de precisión diga cuánto se equivocan.

**Estado al escribirse: papel. Nada escrito en `supabase/migrations/`, nada aplicado.** Sigue el patrón de
`docs/PLAN-A-2a-profiles-rls.md`. Fecha: 2026-09-18. Pedido por el orquestador tras D-322.

## 1. Qué se pide

Que un chofer pueda leer, del plan **publicado** de una fecha, **sus** paradas —y solo las suyas—: la secuencia
P/D con su hora de llegada, su ventana y la carga. Hoy no lee ninguna (133: `driver` no está en la política de
`route_plans`, y las paradas se ven «si se ve su plan»). «Mi ruta» sale de `deliveries.assigned_driver /
route_seq / load_no`, que publicar escribe; eso **no cambia** y sigue siendo la fuente de qué órdenes lleva.
Esto añade las HORAS y el orden de recogidas, que en `deliveries` no están.

## 2. Lo leído, y lo que condiciona el diseño

Todo de `supabase/migrations/133_route_plans.sql` (aplicada; ensayada por el orquestador el 2026-09-18):

- `route_plans select` (133:265-268): admin, logistics, manager, accounting; `warehouse` solo `published`.
- `route_plan_stops select` (133:287-288): `exists (select 1 from route_plans p where p.id = plan_id)`. La
  subconsulta pasa por la RLS de `route_plans`: **se ven las paradas de los planes que se ven.**
- Grants (133:258-259): `authenticated` ya tiene `select` en las dos tablas. No hace falta ningún grant.

**La trampa, y es la razón de este papel.** El camino obvio —añadir `driver` a la política de `route_plans`
para los publicados— está **mal por dos motivos**:

1. La fila de `route_plans` lleva `input` (TODAS las órdenes del día, con las coordenadas de todos los
   clientes), `writes` (qué chofer lleva cada orden) y `result`. Un chofer que lee la fila del plan lee el día
   entero de la empresa. D-315/131 existen justo para que cada uno vea lo suyo.
2. Por la política de paradas de arriba, quien ve el plan ve **todas** sus paradas: las de los otros choferes.

Así que el chofer **no debe poder leer `route_plans`**, y entonces la política de paradas no puede preguntarle a
`route_plans` si el plan está publicado: esa subconsulta, hecha como chofer, devuelve cero filas. Hace falta una
función `security definer` que conteste **solo un booleano**.

Identidad: `route_plan_stops.driver_id` es `uuid → profiles(id)`, así que aquí se compara con `auth.uid()`, no
por nombre. (La lectura de `deliveries` del chofer, 131:207-214, compara `assigned_driver` con
`profiles.full_name`; son dos mecanismos distintos y conviene saberlo: un chofer renombrado entre publicar y
leer seguiría viendo sus paradas, aunque dejara de ver sus órdenes hasta re-publicar.)

## 3. El cambio (SQL literal propuesto para la 134)

```sql
-- ¿Está publicado ese plan? Solo eso. `security definer` porque quien pregunta (un chofer) NO puede leer
-- `route_plans`, y no debe: la fila lleva el día entero. Devuelve un booleano y nada más.
create or replace function public.route_plan_is_published(p_plan uuid)
  returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.route_plans p where p.id = p_plan and p.status = 'published');
$$;
revoke execute on function public.route_plan_is_published(uuid) from public, anon;
grant  execute on function public.route_plan_is_published(uuid) to authenticated;

-- Una política MÁS, no un cambio a la que hay: las permisivas se suman con OR. La de la 133 sigue decidiendo
-- para admin/logística/gerente/office/almacén; esta solo añade filas para quien es chofer.
drop policy if exists "route_plan_stops select own (driver)" on public.route_plan_stops;
create policy "route_plan_stops select own (driver)" on public.route_plan_stops for select to authenticated
  using ((select public.has_deliveries_access())
     and (select public.current_user_role()) = 'driver'
     and driver_id = (select auth.uid())
     and public.route_plan_is_published(plan_id));
```

`route_plans` **no se toca.** Sin `begin/commit`; con autocomprobación (la política existe, es `SELECT`, la
función es `prosecdef = true` y devuelve `boolean`, `anon` no la ejecuta, y **`route_plans select` sigue sin
nombrar a `driver`**); con `-- @ledger-below` y su checksum.

Qué filtra la función hacia fuera: que un `plan_id` dado existe y está publicado. Un `authenticated` cualquiera
puede preguntarlo para un uuid que ya conozca. No devuelve fecha, ni autor, ni contenido. Se acepta.

## 4. Quién lee qué, después

| Rol | `route_plans` | `route_plan_stops` |
|---|---|---|
| admin, logistics, manager, accounting | todo (igual que hoy) | todo (igual) |
| warehouse | publicados (igual) | las de los publicados (igual) |
| **driver** | **nada (igual que hoy)** | **las suyas, de planes `published`** |
| sales, anon | nada | nada |

Un plan que pasa a `superseded` deja de verse para el chofer en el mismo instante: la función mira el estado
vivo. Un borrador nunca se ve.

## 5. Qué NO debe romperse

- Todo lo de la 133: quién crea, publica, ajusta; que un publicado es inmutable. Aquí no se toca ninguna
  política de escritura ni ningún disparador.
- `publish_route_plan` (SECURITY INVOKER) no lee paradas como chofer; no le afecta.
- `GET /api/route-plan` (D-322): para un chofer seguiría devolviendo `plan: null`, porque lee `route_plans`.
  **La pantalla del chofer necesita su propia lectura** —directa a `route_plan_stops` filtrando por fecha no se
  puede (la fecha está en el plan)—. Dos salidas, a decidir al implementar: (a) una columna `plan_date` copiada
  en las paradas, o (b) una función `security definer` `my_published_stops(p_date)` que devuelva solo las filas
  del que llama. **Propongo (b)**: no duplica datos y deja una sola puerta, pero entonces la política de arriba
  sobra para la pantalla y queda como defensa. Si se elige (b) sola, este plan se simplifica a esa función y
  **cero políticas nuevas** — que es menos superficie. Es la decisión que pido que mires.

## 6. Matriz de ensayo por rol, con `ROLLBACK`

Con un plan `published` de dos choferes (A y B) y un borrador posterior de la misma fecha.

| | Caso | Esperado |
|---|---|---|
| 1 | chofer A: `select` de paradas del publicado | **solo las de A** — MENOS que el total; contar total como postgres antes |
| 2 | chofer A: paradas del borrador | 0 |
| 3 | chofer A: `select` de `route_plans` | 0 (no cambió) |
| 4 | chofer A: tras `superseded` (publicar otro) | 0 del viejo; las suyas del nuevo |
| 5 | chofer A: insert / update / delete de paradas | BLOQUEADO (no cambió) |
| 6 | chofer sin acceso a Entregas | 0 |
| 7 | ventas | 0 |
| 8 | almacén, gerente, office, logística, admin | lo mismo que ANTES de la 134 (contar antes y después) |
| 9 | `anon`: ejecutar `route_plan_is_published` | permiso denegado |
| 10 | parada con `driver_id` null (perfil borrado) | no la ve ningún chofer |
| 11 | re-aplicar la 134 | sin error, mismas políticas (`pg_policies` de la tabla: 5, ninguna `ALL`) |

El caso 1 es el que importa y es el de «esperar menos que el total»: con permisivas que se suman, un error
aquí da MÁS filas, no un fallo.

## 7. Reversión

```sql
drop policy if exists "route_plan_stops select own (driver)" on public.route_plan_stops;
drop function if exists public.route_plan_is_published(uuid);
```

No borra datos. El chofer vuelve a no leer paradas; «Mi ruta» no se entera, porque no depende de esto.

## 8. Lo que este plan NO cubre, dicho

- **La pantalla.** Esto es solo el permiso. Dónde se pinta (¿«Mi ruta»?), y que ese sitio tenga los proveedores
  que el componente use (D-321), va en su incremento.
- **Si conviene enseñarle horas al chofer.** Son horas del plan, no promesas: nadie las ha contrastado con la
  realidad (`actual_arrival_at` aún no se llena). Puede generar «me dijeron 10:15». Decisión del dueño.
- **Nada de esto ha corrido.** En particular, que una función `security definer` llamada DENTRO de una política
  se evalúe por fila sin hundir el rendimiento: `route_plan_stops` tiene índice por `plan_id`; con decenas de
  paradas por plan no debería notarse, pero no está medido.
