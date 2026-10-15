# Plan 173 · «📅 Reprogramar» para todos menos el chofer: la función `reprogramar_orden`

Plan en papel exigido por `CLAUDE.md` («Antes de tocar RLS, triggers o permisos en producción»): esta migración añade
**un bloque a `guard_delivery_stage`** y **una función nueva con su grant**. No toca políticas ni el esquema de tablas.
Molde: `docs/PLAN-169-fotos-del-chofer.md`. **Nada de esto se ha aplicado en ninguna base**: lo aplica el orquestador
después de fusionar, con `migrate-status` antes y después, y con un respaldo o `pg_dump` reciente.

**Lo que pidió el dueño (2026-10-14), literal:** *«reprogamar buttom in ther order view put it the top right hand side
insead»* y *«all sales people well everybody has the iption to reprogramar»*.

**Lo que se midió en producción (2026-10-14, el orquestador):** un vendedor que cambia `delivery_date` en su orden
`approved`/`ready` recibe *«You cannot edit an order in the approved stage»*.

## 0 · Por qué no basta una función SECURITY DEFINER

El encargo pedía una función `SECURITY DEFINER`. No basta: el guard es un disparador `BEFORE UPDATE` que decide con
`auth.uid()` y `current_user_role()`, y esos salen del JWT de la **petición**, no del dueño de la función. Lo dejó escrito
la 157 sobre `juntar_cargas` (definer): *«El UPDATE de `p_a` sigue pasando por el guard (`auth.uid()` es el de quien
llama)»*. Una función definer que hace el `UPDATE` le daría al vendedor el mismo rechazo.

Alternativas descartadas:

- **Vaciar `request.jwt.claims` dentro de la función** para que el guard salga por `auth.uid() is null`: también apaga el
  resto de disparadores que miran `auth.uid()` (la 172 firma su evento con él) y deja a la transacción sin identidad. Es
  un atajo que no se ve desde fuera.
- **Una cláusula en el guard «ventas, su orden, solo la fecha»** sin función: dejaría a ventas mover la fecha por la API sin
  nota, y la nota es la mitad del pedido de D-500.

Lo elegido: la función marca **esa** orden en una variable local a la transacción (`set_config('rtg.reprogramar_orden',
id, true)`) justo antes de su `UPDATE`, y el guard deja pasar esa escritura **solo si lo único que cambia es
`delivery_date`** (el patrón `probe` de 125/138/169). La función es **SECURITY INVOKER**: lee y escribe con la RLS de
quien llama (visibilidad por tienda, 131), y el guard la ve con su rol de verdad.

¿Puede un cliente poner la variable él solo? Por PostgREST no: no ejecuta SQL suelto, y `set_config` no está expuesta. Y
aunque pudiera, solo movería la fecha (el `probe` lo exige), que es lo que la función ya le deja con nota.

## 1 · Lecturas y escrituras (inventario)

| Quién / dónde | Qué escribe hoy | Qué contesta la base hoy (169) | Con la 173 |
|---|---|---|---|
| Logística, gerente, oficina — «📅» del Gestor (D-500) | `update deliveries set delivery_date` + evento nota | pasa (borrador a lista) | por la función; mismo resultado |
| Almacén — «📅» de su Cola/Recepción/Ruta (D-534) | lo mismo | pasa (aprobada a lista) | por la función; mismo resultado |
| Admin — «📅» en cualquier sitio | lo mismo | pasa (sale antes del guard) | por la función; mismo resultado |
| **Ventas, SU orden, «📅» en la ficha (nuevo)** | — | borrador/pendiente: pasa; **aprobada en adelante: rechazo** | pasa en borrador … lista, con nota |
| Ventas, orden ajena | — | (pendiente: pasa por API sin mirar dueño, D-480) | la función la rechaza: `REPROGRAMAR_NO_PERMITIDO` |
| Chofer | — | — | la función lo rechaza |
| Ventas, «Editar fecha» (D-480, pendiente/rechazada) | `updateDelivery({delivery_date})` | pasa | **sin cambios** (no pasa por la función) |
| La ficha, «Guardar cambios» (oficina, logística…) | la orden entera | lo de siempre | **sin cambios** |
| Disparador de la 172 (si está aplicada) | saca a la orden de la ruta al cambiar la fecha | — | la función cambia SOLO `delivery_date`, así que la 172 actúa igual que con el camino de antes |

Lecturas de la función: `public.deliveries` (una fila, por id, con la RLS de quien llama) y `current_user_role()`.
Escrituras: `public.deliveries.delivery_date` (una fila) y dos filas en `public.order_events` firmadas por quien llama
(la política `order_events insert self` exige `created_by = auth.uid()`, y así es).

## 2 · Lo que cambia (literal)

### 2.1 · El bloque del guard

En el tramo «misma etapa», después del bloque 169 del chofer y antes de `if r in ('manager','accounting') then return
NEW; end if;`:

```sql
if current_setting('rtg.reprogramar_orden', true) = OLD.id::text then
  probe := NEW;
  probe.delivery_date := OLD.delivery_date;
  probe.updated_at    := OLD.updated_at;
  if probe is not distinct from OLD then return NEW; end if;
end if;
```

Todo lo demás, letra por letra la 169 (lo compara `src/lib/juntar-y-reprogramar.test.ts`).

### 2.2 · La función

```sql
create or replace function public.reprogramar_orden(p_id uuid, p_fecha date, p_nota text, p_lang text default 'es')
  returns void language plpgsql security invoker set search_path = public as $function$
declare
  yo     uuid := auth.uid();
  r      text := public.current_user_role();
  limpia text := btrim(regexp_replace(coalesce(p_nota, ''), '\s+', ' ', 'g'));
  hoy    date := (now() at time zone 'America/Chicago')::date;
  o record; filas integer; de text;
begin
  if yo is null then raise exception 'REPROGRAMAR_SIN_SESION: sign in first' using errcode = '42501'; end if;
  select d.id, d.stage, d.delivery_date, d.created_by, d.assigned_sales_rep into o from public.deliveries d where d.id = p_id;
  if not found then raise exception 'REPROGRAMAR_NO_EXISTE: order not found' using errcode = 'P0002'; end if;
  if not (
       (r = 'admin' and o.stage in ('draft','pending','approved','fulfilling','ready','picked_up','rejected'))
    or (r in ('logistics','manager','accounting') and o.stage in ('draft','pending','approved','fulfilling','ready'))
    or (r = 'warehouse' and o.stage in ('approved','fulfilling','ready'))
    or (r = 'sales' and o.stage in ('draft','pending','approved','fulfilling','ready')
        and (o.created_by = yo or o.assigned_sales_rep = yo))
  ) then raise exception 'REPROGRAMAR_NO_PERMITIDO: ...' using errcode = '42501'; end if;
  if p_fecha is null or p_fecha < hoy then raise exception 'REPROGRAMAR_FECHA_PASADA: ...'; end if;
  if o.delivery_date is not distinct from p_fecha then raise exception 'REPROGRAMAR_MISMA_FECHA: ...'; end if;
  if char_length(limpia) < 3 then raise exception 'REPROGRAMAR_SIN_NOTA: ...'; end if;
  perform set_config('rtg.reprogramar_orden', p_id::text, true);
  update public.deliveries set delivery_date = p_fecha where id = p_id;
  get diagnostics filas = row_count;
  perform set_config('rtg.reprogramar_orden', '', true);
  if filas <> 1 then raise exception 'REPROGRAMAR_NO_GUARDADA: ...'; end if;
  -- evento «edited» (Changed: Delivery Date: antes → después) y evento «note» (Reprogramada de … a …: nota)
end $function$;
revoke execute on function public.reprogramar_orden(uuid, date, text, text) from public, anon;
grant execute on function public.reprogramar_orden(uuid, date, text, text) to authenticated;
```

El texto completo, en `supabase/migrations/173_reprogramar_orden.sql`. `p_lang` es un cuarto parámetro con valor por
defecto (el encargo nombraba tres): la nota del historial se escribe en el idioma de quien la escribe, como hacía la
pantalla (`notaDeReprogramacion`).

**Sales «suya»** = `created_by = yo or assigned_sales_rep = yo`: la misma dueñez que `esMia` (D-537/D-544, que decide si
la abre) y que las ramas 125/138 del guard. El encargo decía `orderOwner` (vendedor asignado, si no quien la creó); es
más estrecho, y daría el botón a quien no puede guardar (o al revés). Se eligió la que ya usan la pantalla y la base.

## 3 · Qué no debe romperse

1. Logística, gerente, oficina, almacén y admin reprograman igual que hoy, en las mismas etapas (la función copia
   `puedeReprogramar`; una prueba compara las dos).
2. Ninguna otra escritura de ventas se abre: sin la marca, el guard contesta como la 169. Con la marca, solo pasa
   `delivery_date` (cualquier otra columna en la misma escritura → rechazo).
3. La marca no sobrevive a la función: se borra después del `UPDATE` (y es local a la transacción).
4. El evento «edited» guarda el valor anterior (la lección del 2026-09-23: 162 fechas sin su valor viejo).
5. La 172 (pendiente) no se toca: corre después del guard y ve un cambio de fecha y nada más.
6. Sin la función (antes de aplicar la 173), la app guarda por el camino de antes (`caminoTrasReprogramar` → `respaldo`).

## 4 · Ensayo por rol, con ROLLBACK

Para pegar a mano en una sesión `psql` contra un respaldo o contra producción **dentro de una transacción que termina en
ROLLBACK**. `<id-*>` son órdenes reales elegidas antes; `<uuid-*>` usuarios reales de cada rol.

```sql
begin;
\i supabase/migrations/173_reprogramar_orden.sql   -- sin begin/commit propios: queda dentro de esta transacción
set local role authenticated;

-- R1 ventas, SU orden 'approved' → pasa
set local request.jwt.claims = '{"sub":"<uuid-ventas>","role":"authenticated"}';
select public.reprogramar_orden('<id-suya-approved>', current_date + 1, 'cliente cerró', 'es');
select delivery_date from public.deliveries where id = '<id-suya-approved>';                      -- mañana
select kind, note from public.order_events where delivery_id = '<id-suya-approved>' order by created_at desc limit 2;
-- R2 ventas, orden de OTRO vendedor → REPROGRAMAR_NO_PERMITIDO (savepoint para seguir)
savepoint s; select public.reprogramar_orden('<id-ajena-approved>', current_date + 1, 'prueba', 'es'); rollback to s;
-- R3 ventas, SU orden 'picked_up' / 'delivered' / 'canceled' → REPROGRAMAR_NO_PERMITIDO
-- R4 ventas, UPDATE directo sin la función en SU 'approved' → "You cannot edit an order in the approved stage" (como hoy)
savepoint s; update public.deliveries set delivery_date = current_date + 2 where id = '<id-suya-approved>'; rollback to s;
-- R5 ventas, con la marca puesta a mano y OTRA columna → rechazo del guard
savepoint s; select set_config('rtg.reprogramar_orden', '<id-suya-approved>', true);
  update public.deliveries set delivery_date = current_date + 3, contact = 'x' where id = '<id-suya-approved>'; rollback to s;
-- R6 chofer, cualquier orden → REPROGRAMAR_NO_PERMITIDO
set local request.jwt.claims = '{"sub":"<uuid-chofer>","role":"authenticated"}';
savepoint s; select public.reprogramar_orden('<id-ready>', current_date + 1, 'prueba', 'es'); rollback to s;
-- R7 almacén: 'pending' → NO_PERMITIDO; 'ready' → pasa
set local request.jwt.claims = '{"sub":"<uuid-almacen>","role":"authenticated"}';
savepoint s; select public.reprogramar_orden('<id-pending>', current_date + 1, 'prueba', 'es'); rollback to s;
select public.reprogramar_orden('<id-ready>', current_date + 1, 'camión lleno', 'es');
-- R8 logística / gerente / oficina: 'draft'…'ready' pasa; 'picked_up' → NO_PERMITIDO
-- R9 admin: 'picked_up' pasa; 'delivered' → NO_PERMITIDO
-- R10 cualquiera: ayer → FECHA_PASADA; la misma fecha → MISMA_FECHA; nota ' x ' → SIN_NOTA
-- R11 con la 172 aplicada: R1 sobre una orden con chofer → assigned_driver null y su evento «Removed from …»
rollback;
```

## 5 · Reversión

```sql
-- 1) El guard de la 169: volver a aplicar SOLO su bloque `create or replace function public.guard_delivery_stage() …
--    end $function$;` (supabase/migrations/169_fotos_del_chofer.sql).
-- 2) La función:
drop function if exists public.reprogramar_orden(uuid, date, text, text);
-- 3) El registro:
delete from public.schema_migrations where name = '173_reprogramar_orden.sql';
```

Las fechas ya cambiadas se quedan: el valor anterior de cada una está en su evento «edited». La app sigue funcionando sin
la función (vuelve al camino de antes), así que revertir no exige desplegar nada.
