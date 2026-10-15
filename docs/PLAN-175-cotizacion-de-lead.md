# Plan 175 · `estimator_quotes.lead_id`: la cotización recuerda de qué lead salió

**Fecha:** 2026-10-15 · **Decisión:** D-558 (Leads → Quote Builder, la primera conexión del mapa de apps) ·
**Migración:** `supabase/migrations/175_cotizacion_de_lead.sql` · **Estado:** ESCRITA, NO APLICADA. La aplica el
orquestador después del merge, con respaldo y `migrate-status` antes y después.

## Por qué

El dueño, 2026-10-15, a «¿construyo la primera conexión, Leads → Quote Builder?»: «si a todo». El código rellena la
cotización con los datos del lead **sin** esta migración. Lo que la migración añade es que el **enlace quede guardado**:
que la cotización diga «De lead: …» y que la tarjeta del lead cuente sus cotizaciones.

## Qué cambia en la base

| Objeto | Cambio |
|---|---|
| `public.estimator_quotes` | `lead_id uuid null references public.leads(id) on delete set null` |
| índice nuevo | `estimator_quotes_lead_idx on estimator_quotes (lead_id) where lead_id is not null` |

Nada más. Ninguna fila cambia (todas quedan con `lead_id` null).

## Qué lee y qué escribe la columna (inventario)

| Quién | Qué | Con qué permiso |
|---|---|---|
| `almacenDeLaBase().guardar(null, draft, leadId)` (`src/lib/estimator/almacen.ts`) | **INSERT** de una cotización nueva con `lead_id` | política «estimator_quotes insert» (148), sin cambios |
| `almacenDeLaBase().guardar(id, draft)` | UPDATE de una guardada: **nunca** manda `lead_id` | política «estimator_quotes update» (148), sin cambios |
| `almacenDeLaBase().cargar(id)` | SELECT de `lead_id` al abrir una cotización | política «estimator_quotes select» (148), sin cambios |
| `enlaceDeLaBase().cotizacionesConLead()` (`src/lib/leads/enlace.ts`) | SELECT `id, estimate_num, lead_id, updated_at where lead_id is not null` desde Leads | «estimator_quotes select» (148): solo las que quien mira ya ve |
| `enlaceDeLaBase().leerLead(id)` | SELECT de un lead desde el Quote Builder | «leads select» (163): solo los que quien mira ya alcanza |

Todo con la sesión de quien mira. Ninguna llave de servicio.

## Políticas, grants y disparadores: intactos

- **Políticas.** Las tres de `estimator_quotes` (148) y la de `leads` (163) no se tocan. La columna nueva se lee y se
  escribe en las mismas filas que ya se leían y escribían.
- **Grants.** La 148 concede `select, insert, update` **sobre la tabla** a `authenticated`; un privilegio de tabla
  cubre las columnas nuevas. No se concede nada, no se amplía nada.
- **Clave foránea y RLS.** Postgres comprueba la clave foránea saltándose la RLS de `leads` (es una comprobación de
  integridad del dueño de la tabla). Consecuencia que se acepta: quien tiene el Quote Builder podría enlazar su
  cotización a un lead que no ve **si conoce su uuid**; no lee nada del lead por eso, y en la cotización saldría «De un
  lead que no puedes ver». La pantalla solo enlaza el lead que leyó con su sesión y que `puedeCotizarLead` le deja.
- **`estimator_quotes_guard` (148) no se reescribe.** Ver «Lo que se descartó».
- **`on delete set null`.** Hoy nadie borra leads por la API (la 162 no da DELETE; `lead_events` además los ata). Si un
  día se borra uno a mano, sus cotizaciones se quedan, sin lead. Ese `set null` dispara `estimator_quotes_guard` como
  un UPDATE; con `auth.uid()` nulo (postgres / service-role) solo toca `updated_at`.

## Qué no debe romperse (y cómo se protege)

1. **El código llega antes que la migración.** Sin la columna:
   - abrir una cotización: el SELECT con `lead_id` falla con 42703 y se repite sin la columna (`faltaLaColumnaDelLead`);
   - crear desde un lead: el INSERT falla con PGRST204 **antes de escribir nada** y se repite sin `lead_id`; la pantalla
     dice «Guardada, pero sin el enlace al lead (migración 175)»;
   - Leads: contar cotizaciones devuelve cero, no un error.
   Un PGRST204/42703 de **otra** columna no se confunde con esto: se dice como error. Pruebas en
   `src/lib/leads/cotizar.test.ts` con un cliente de mentira.
2. **Editar una cotización no toca su lead**: `guardar(id, …)` usa `filaDeBorrador`, sin la clave.
3. **Nadie ve más.** Las lecturas cruzadas pasan por la RLS de cada tabla.

## Matriz de pruebas por rol (con `ROLLBACK`, para el orquestador al aplicar)

```sql
begin;
\i supabase/migrations/175_cotizacion_de_lead.sql
-- 1. La columna, nullable, con su FK y on delete set null
select column_name, is_nullable, data_type from information_schema.columns
 where table_schema = 'public' and table_name = 'estimator_quotes' and column_name = 'lead_id';
select confdeltype from pg_constraint where conrelid = 'public.estimator_quotes'::regclass and contype = 'f'
   and conkey = array[(select attnum from pg_attribute where attrelid = 'public.estimator_quotes'::regclass and attname = 'lead_id')];
-- esperado: 'n' (set null)
-- 2. Las políticas siguen siendo las tres de la 148, idénticas
select policyname, cmd, qual, with_check from pg_policies where tablename = 'estimator_quotes' order by policyname;
-- 3. Un vendedor con el Quote Builder crea con lead_id (simular con set local role authenticated + request.jwt.claims)
-- 4. El mismo vendedor NO ve la cotización de otra tienda aunque tenga lead_id (la select de la 148 manda)
-- 5. Ningún dato cambió
select count(*) from public.estimator_quotes where lead_id is not null;  -- esperado: 0
rollback;
```

## Reversión

```sql
drop index if exists public.estimator_quotes_lead_idx;
alter table public.estimator_quotes drop column if exists lead_id;
delete from public.schema_migrations where name = '175_cotizacion_de_lead.sql';
```

El código sigue funcionando después de revertir: es el camino «sin la 175».

## Lo que se descartó

- **Que el disparador ponga o congele `lead_id`.** Habría que reescribir `estimator_quotes_guard` (copiar el cuerpo de
  la 148 y añadir una cláusula), que es un cambio de guardia con su propio plan. El valor no llega a justificarlo hoy:
  el navegador solo manda `lead_id` al crear, y la edición no lo manda. Si se quiere que la base lo haga cumplir
  («`lead_id` no cambia una vez puesto, salvo el admin»), es una migración aparte.
- **Comprobar en la base que quien crea ve el lead.** Mismo motivo; y la RLS de leads ya decide lo que se lee.
- **Pasar los datos del lead por la URL.** Llevarían nombre y teléfono del dueño a historiales y registros; la URL solo
  lleva el id, y el Quote Builder lee el lead con la sesión de quien abre.
