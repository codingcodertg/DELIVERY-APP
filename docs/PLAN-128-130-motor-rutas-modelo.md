# PLAN 128–130 — El modelo del motor de rutas: chofer, tipo de cliente y ajustes

> Plan en papel **antes** de tocar esquema y RLS, como pide `CLAUDE.md`. Las tres migraciones están escritas y
> **no aplicadas**: las ensaya y las aplica el orquestador, con respaldo. Fecha: 2026-09-18.
> Diseño: `docs/route-algorithm-design.md` (aprobado, §11). Esto es su incremento 1.
> **Nada de esto cambia todavía el Gestor de Rutas.**

## 1. Qué añade cada una

| # | Fichero | Qué | ¿Toca RLS? |
|---|---|---|---|
| 128 | `128_driver_settings.sql` | tabla nueva `driver_settings`: base, capacidad, turno, vuelve a la base y «rutea», por `profile_id` | sí: RLS de una tabla **nueva** |
| 129 | `129_customer_type.sql` | columna `deliveries.customer_type` (`builder` \| `counter_sale` \| null) | no |
| 130 | `130_route_settings.sql` | columnas `settings.route_weights`, `route_hard_windows`, `route_late_cap_min`, con sus valores por defecto | no |

Las tres son **aditivas** e independientes entre sí: se pueden aplicar en cualquier orden y una a una.

## 2. Lo medido

- **Guard vigente: la 127** (`grep "function public.guard_delivery_stage" supabase/migrations`: la última es
  `127_borrador_enviado_nace_aprobado.sql:22`). La 129 no lo redefine.
- **`assigned_driver` es `text` = nombre** (`schema.sql:100`) y la RLS de lectura del chofer compara con
  `profiles.full_name`. La política vigente es la de la **131** (`131_visibilidad_por_tienda.sql:207-214`), que
  entró en `main` mientras se escribía esto y redefine `auth read deliveries`; sigue comparando por nombre. **La 128 no toca nada de eso**, y su
  autocomprobación falla si `assigned_driver` dejara de ser `text`.
- **Capacidad de hoy:** `settings.driver_capacity` (nombre → pallets, `010:11`), luego
  `settings.default_truck_capacity`, luego 12 (`routes/page.tsx:539`). El código nuevo pone la fila de
  `driver_settings` **delante** de esa cadena y deja el resto igual (`route-settings.ts`, `choferParaElMotor`).
- **`settings`:** fila única (`id = 1`), la lee cualquiera con sesión y la escribe solo el admin (`100:31-37`).
- **Funciones que usan las políticas de la 128:** `has_deliveries_access()` (`083:24`) y `current_user_role()`
  (`roles.sql:15`), las dos `security definer`.
- **Privilegios por defecto:** medido por el orquestador al ensayar la 126 — en esta base, una tabla nueva
  nace con todo concedido a `anon` y `authenticated`. Por eso la 128 hace `revoke all` **antes** del `grant`.

## 3. La ventana entre fusionar y aplicar — lo más importante de este plan

En este proyecto las migraciones se aplican **después** de fusionar. Entre una cosa y la otra, el código
nuevo corre contra la base vieja. Qué pasa con cada pieza, y por qué no rompe nada:

| Pieza | Sin su migración | Cómo |
|---|---|---|
| Formulario de la orden | **guarda igual**, sin el tipo de cliente | `parcheDeTipoDeCliente` no manda `customer_type` si ninguna orden cargada trae esa clave (`select("*")`: si la columna existe, la clave viene). Sin esta red no fallaría ese campo: **fallaría el guardado de todas las órdenes a cliente** |
| Tarjeta «Motor de rutas» — pesos, ventanas, tope | enseña los valores por defecto, **deshabilitados**, y dice que falta la actualización | `laBaseTieneAjustesDeRuta(settings)` |
| Tarjeta — choferes | dice que no está disponible | la lectura de `driver_settings` da error y se muestra el aviso, no una pantalla rota |
| Editor de cuentas (marca Builder) | funciona | vive en el JSON de `settings.accounts`; no necesita migración |

Un límite conocido de la primera fila: con **cero órdenes cargadas** no se puede saber si la columna existe y
el campo no se manda. Es el lado seguro —se pierde una marca, no una orden— y en producción no ocurre.

**Aun así, el orden recomendado es: aplicar las tres nada más fusionar.** La red está para que un retraso no
sea un incidente, no para vivir en ella.

## 4. 128 — inventario y políticas literales

Columnas: `profile_id uuid` PK → `profiles(id)` on delete cascade · `base_store text` (nombre de una tienda de
`settings.stores`) · `capacity_pallets numeric` · `shift_start time` default `08:00` · `shift_end time` default
`17:30` · `returns_to_base boolean` default true · `routable boolean` default true · `updated_at` · `updated_by`.
Restricciones: capacidad nula o > 0; `shift_end > shift_start`; base nula o no en blanco.
Disparador `driver_settings_stamp`: `updated_at` y `updated_by` los pone la base (con sesión).

```sql
revoke all on public.driver_settings from anon, authenticated;
grant select, insert, update, delete on public.driver_settings to authenticated;

create policy "driver_settings select" ... for select to authenticated
  using ((select public.has_deliveries_access())
     and (select public.current_user_role()) in ('admin','logistics','manager','accounting','warehouse'));
create policy "driver_settings insert" ... for insert  with check (… in ('admin','logistics'));
create policy "driver_settings update" ... for update  using (… in ('admin','logistics')) with check (… idem);
create policy "driver_settings delete" ... for delete  using (… in ('admin','logistics'));
```

Una por comando, **ninguna `FOR ALL`**. Leen quienes planifican o ven el plan; escriben admin y logística
(decisión 13 de §11). La pantalla de hoy solo se la enseña al admin (Ajustes es solo suyo); la base ya deja
escribir a logística para cuando publique rutas. El chofer **no lee**: nada de su pantalla lo usa.

**No siembra datos** (ver §7).

## 5. 129 y 130

- **129:** `add column if not exists customer_type text` + `check (… is null or … in ('builder','counter_sale'))`.
  No rellena nada hacia atrás. No toca guard ni políticas: el campo se edita con el formulario, así que vale
  para él lo que para cualquier otro campo de la orden.
  **Lo que hay que mirar al ensayar:** `guard_delivery_stage` compara filas enteras con una variable
  `public.deliveries%rowtype` (GPS tardío de la 048; factura de ventas de la 125). Una columna nueva cambia ese
  tipo. Postgres recompila la función, pero se comprueba: el ensayo repite esos dos casos con la columna puesta.
- **130:** tres columnas `not null` con valor por defecto — `{"builder":2,"manejo":1,"millas":0.5,"tarde":0.75,
  "balance":0.1}`, `{0830-1000,0830-1200}`, `60` — y dos `check` (los pesos son un objeto; el tope ≥ 0). Una
  prueba compara esos valores con los de `src/lib/route-settings.ts`. La autocomprobación mira los valores por
  defecto **de las columnas**, no los de la fila, para que volver a aplicarla con los pesos ya afinados pase.

## 6. Qué NO debe romperse

- Que un chofer siga viendo sus órdenes (RLS por nombre): caso E1 de la 128.
- Los dos caminos del guard que comparan la fila entera: casos B1–B5 de la 129.
- Guardar una orden, antes y después de cada migración (§3).
- La capacidad que usa hoy el Gestor de Rutas: `settings.driver_capacity` **no se toca ni se borra**.
- `settings`: que el admin siga guardando cualquier otro ajuste (la 130 solo añade columnas).

## 7. Sembrar los choferes — lo corre el orquestador en producción, DESPUÉS de aplicar la 128

Ningún nombre de persona entra en el repo. Esto es genérico: toma de cada chofer lo que **ya** consta —su
capacidad por nombre en Ajustes y la tienda de su perfil— y no inventa nada. Es idempotente.

```sql
-- 1) Una fila por chofer, con lo que ya se sabe. La base, SOLO si la tienda de su perfil es una tienda de
--    Ajustes; si no, se queda sin base y el motor no le da trabajo hasta que alguien se la ponga.
insert into public.driver_settings (profile_id, base_store, capacity_pallets)
select p.id,
       (select s->>'name' from public.settings st, jsonb_array_elements(st.stores) s
         where st.id = 1 and lower(btrim(s->>'name')) = lower(btrim(p.store)) limit 1),
       nullif((select (st.driver_capacity->>p.full_name) from public.settings st where st.id = 1), '')::numeric
  from public.profiles p
 where p.role = 'driver'
on conflict (profile_id) do nothing;

-- 2) Las bases decididas el 2026-09-18 (§11, decisión 1), por id. Los <uuid-…> los pone quien lo corre.
update public.driver_settings set base_store = :'tienda' where profile_id = :'uuid_chofer';

-- 3) El chofer sin órdenes en 90 días queda fuera del motor (§11, decisión 3).
update public.driver_settings set routable = false where profile_id = :'uuid_chofer_que_no_rutea';

-- Comprobar: quién rutea, desde dónde y con cuánto. Una base que no case con una tienda sale a null.
select p.full_name, d.base_store, d.capacity_pallets, d.shift_start, d.shift_end, d.routable
  from public.driver_settings d join public.profiles p on p.id = d.profile_id order by 1;
```

La capacidad de quien no tiene una puesta queda en `null` **a propósito**: así sigue valiendo la de flota (12) y
el día que el dueño cambie la de flota en Ajustes, cambia para todos los que no tienen una propia.

## 8. Matriz de ensayo por rol, con `ROLLBACK`

Completa y comentada al final de cada `.sql`. Resumen de lo esperado:

| | Caso | Resultado |
|---|---|---|
| 128 A | admin: inserta, y `updated_by` = él; capacidad 0, turno al revés, base en blanco | PERMITIDO; los tres últimos BLOQUEADOS por `check` |
| 128 B | logística: lee y actualiza | PERMITIDO |
| 128 C | gerente / office / almacén: leen; update, insert, delete | leen; SIN FILAS / BLOQUEADO / SIN FILAS |
| 128 D | ventas y el propio chofer: leer; el chofer, su fila | 0 filas; SIN FILAS |
| 128 E | el chofer sigue viendo sus órdenes por nombre | igual que antes de aplicar |
| 129 A | `builder`, `counter_sale`, `null`; `'vip'` | PERMITIDO ×3; BLOQUEADO (`check`) |
| 129 B | ventas pone la factura que falta (125) — sola; con `customer_type` a la vez | PERMITIDO; BLOQUEADO |
| 129 B | chofer, GPS tardío (048) — solo; con `customer_type` a la vez | PERMITIDO; BLOQUEADO |
| 129 C | ventas crea un borrador con `customer_type = 'builder'` | PERMITIDO |
| 130 A | admin cambia un peso; pesos como lista; tope negativo; lista de duras vacía | PERMITIDO; BLOQUEADO; BLOQUEADO; PERMITIDO |
| 130 B | logística: lee; cambia el tope | lo ve; SIN FILAS |

## 9. Reversión

Al final de cada `.sql`. 128: `drop table` + función. 129: `drop constraint` + `drop column`. 130: dos
`drop constraint` + tres `drop column`. Cada una avisa de qué datos se pierden y cómo guardarlos antes. **La app
aguanta la reversión sin tocar código**: es la misma red de §3, en sentido contrario.

## 10. Lo no verificado

- **Nada de esto se ha corrido.** Una rama no toca producción.
- **130, autocomprobación:** evalúa con `execute` el texto que devuelve `pg_get_expr` para el valor por
  defecto de `route_weights`, y compara `column_default` de las otras dos con un `like` y un `= '60'`. El
  formato exacto de esos textos en esta versión de Postgres no lo he visto: si la autocomprobación revienta al
  aplicar siendo correctos los valores, es ahí donde mirar.
- **129:** que el guard siga comparando bien con la columna nueva (casos B).
- Que el `upsert` de la tarjeta pase por PostgREST con las cuatro políticas.
- Nadie ha visto las pantallas en un navegador: en el worktree no hay `.env.local`.
