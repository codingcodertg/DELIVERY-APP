# Plan — 144 · El tracker se muda a la base, y el dueño cierra una tarea de un clic

**Estado:** PLAN EN PAPEL. **Nada aplicado.** Espera aprobación.
**Fecha:** 2026-09-24 · **Rama:** `tracker-en-la-nube` desde `3a75d4ab` (origin/main).
**Molde:** `docs/PLAN-A-2a-profiles-rls.md` y `docs/PLAN-142-visibilidad-almacen-y-ventana.md`.
**Prerrequisito:** respaldo activo o `pg_dump` reciente antes de aplicar (CLAUDE.md).

El dueño, literal: *«en el html, primero, que se guarde en la nube, y segundo, si yo le doy a
comprobar que se cambie sin pedir diálogo»*. Preguntado: *«no no físico en el app pero sí en el mismo
de rtg»*, y que el botón marque **«Completado»**.

---

## 0. Qué medí, qué no pude medir, y dos cosas que hay que decidir

Todo lo de aquí sale de **leer el repo en `3a75d4ab`**: migraciones, `src/lib` y `tracker/`. No he
tocado producción, no he ensayado nada y no tengo `.env.local` en este worktree, a propósito.

**Medido:**

| qué | dónde | valor |
|---|---|---|
| tareas hoy | `tracker/tareas/*.json` | **371** |
| estados | `cli.mjs list --contar` | 352 desplegado · 10 ocupa revisión · **0 Completado** |
| verificación | ídem | 360 sin verificar · 2 verificado · 0 falló |
| última migración | `supabase/migrations/` | **143**, así que esta es la **144** |
| `is_admin()` | `099_profiles_row_rls.sql:26` | `current_user_role() = 'admin'`, `security definer` |
| el patrón de la casa para service-role | `009_routes.sql:26` | `if auth.uid() is null then return NEW; end if;` — **«sin sesión, pasa todo»** |

**NO medido, y hace falta antes de aplicar:**

- **Que `public.schema_migrations` tenga la 143 registrada** y no haya nada pendiente:
  `node scripts/db/migrate-status.mjs`. Lo corre quien aplique.
- **Si el proyecto de Supabase expone algún esquema además de `public`.** Es un ajuste del panel y
  decide el punto §1.
- **El tamaño real de la tabla.** 371 filas con el texto literal del dueño; a ojo, menos de 2 MB.

**Dos decisiones que no son mías:** el punto §2 (qué pasa con los JSON) y el §8 (si el HTML sube a
Storage). Van con recomendación.

---

## 1. Dónde vive: `public.tracker_tareas`, no un esquema `tracker`

**Recomiendo la tabla en `public`**, y no por comodidad:

- **La página HTML lee con `supabase-js`, o sea PostgREST.** PostgREST solo sirve los esquemas que el
  proyecto tiene en «Exposed schemas». Un esquema `tracker` obliga a cambiar ese ajuste en el panel,
  y eso es **configuración de todo el proyecto**, no de una tabla: si alguien lo toca mal, afecta a
  lo que la app entera puede leer. Cambiar el alcance de una app de entregas para colocar una tabla
  de notas es un mal reparto del riesgo.
- **Un esquema más es un nombre corto más que confundir.** Ya pasó aquí: `public.profiles` y
  `clockin.profiles` existen las dos, y un `count` sin esquema dio un número plausible y equivocado.
- Lo que un esquema aparte daría —que la app no la lea— **lo da la RLS**, que es donde de verdad se
  decide.

El nombre lleva prefijo, `tracker_tareas`, para que se lea de qué es sin abrir nada.

## 2. Una sola fuente de verdad: la base. Y los JSON se **congelan**, no se borran

En cuanto el dueño pulse «Completado» en la página, ese hecho vive en la base. Si los JSON siguieran
siendo escribibles, en una semana dirían cosas distintas. **La base manda.**

**Recomiendo NO borrar `tracker/tareas/`, y congelarlo**:

- Se queda en git como estaba el día de la mudanza, con un `LEEME.md` dentro que diga **«foto del
  2026-09-24; la verdad está en la base»**.
- **El CLI deja de escribir ahí**, y no por convenio: si hay base configurada, escribe en la base; si
  no la hay, **falla diciéndolo** (§4). Una sola ruta de escritura.
- Motivo de conservarlo: son **las palabras del dueño**, y en git se revisan en un diff y sobreviven
  a que alguien borre una fila por error. Borrarlo cambiaría «dos fuentes que se desincronizan» por
  «ninguna copia si la base se equivoca».

Alternativa si prefieres limpieza: borrar la carpeta entera. Lo digo para que sea decisión y no
olvido; yo no lo haría.

## 3. La tabla

```sql
create table if not exists public.tracker_tareas (
  id              text primary key,                    -- 'T-0001'
  fecha           date not null,                       -- cuando lo pidio EL
  resumen         text not null,
  texto_original  text not null default '',            -- sus palabras, literales
  lo_hizo_claude  text not null default 'No',          -- Si | Parcial | No
  estado          text not null,                       -- los cuatro suyos
  padre           text references public.tracker_tareas(id),
  evidencia       jsonb not null default '{}'::jsonb,  -- commits, prs, ficheros, decisiones, links
  verificacion    jsonb not null default
                  '{"estado":"sin verificar","prueba":"","fecha":null}'::jsonb,
  notas           jsonb not null default '[]'::jsonb,
  fuentes         jsonb not null default '[]'::jsonb,
  completado_por  uuid references auth.users(id),      -- lo pone el TRIGGER, no el cliente
  completado_en   timestamptz,                         -- idem
  creado          timestamptz not null default now(),
  modificado      timestamptz not null default now()
);
```

**Por qué `jsonb` y no tablas hijas** para evidencia, notas y fuentes: hoy son listas cortas que
siempre se leen enteras con su tarea y **nadie las consulta por separado**. Tres tablas más serían
tres joins y tres políticas RLS más para cero preguntas nuevas. Si algún día hace falta «todas las
tareas que citan el PR #204», se normaliza entonces.

**`estado` y `lo_hizo_claude` van con `check`**, con las palabras del dueño tal cual:

```sql
alter table public.tracker_tareas
  add constraint tracker_tareas_estado_chk check (estado in (
    'En revisión – desplegado', 'En revisión – no desplegado', 'Ocupa revisión', 'Completado')),
  add constraint tracker_tareas_hizo_chk check (lo_hizo_claude in ('Si', 'Parcial', 'No'));
```

(El guion de los dos primeros es el largo, U+2013. Es el que él escribió.)

Índices: `fecha desc` para la tabla, y `estado` para los contadores. Nada más: 371 filas no necesitan
más, y un índice de sobra es otra cosa que mantener.

## 4. Quién lee y quién escribe — el inventario antes de las políticas

| quién | hoy | con la 144 |
|---|---|---|
| **admin** (sesión suya en el navegador) | — | **lee y escribe**, incluido «Completado» |
| manager, accounting, sales, warehouse, driver, logistics | — | **nada**: ni leen ni escriben |
| `anon` (sin sesión) | — | **nada** |
| service-role (los scripts, el CLI, la importación) | — | **lee y escribe todo MENOS poner «Completado»** |
| la app RTG (Entregas, Promos, TT…) | — | **no la toca**: ninguna pantalla la consulta |

**Lo que NO debe romperse:** nada de la app. La tabla es nueva, no la lee ningún código existente, y
`profiles`, `deliveries` y las demás no se tocan. El riesgo real de esta migración no es romper: es
**dejar abierto** lo que debería estar cerrado.

## 5. Las políticas, literales

```sql
alter table public.tracker_tareas enable row level security;
alter table public.tracker_tareas force row level security;   -- que ni el dueño de la tabla se salte

revoke all on public.tracker_tareas from public, anon;
grant select, insert, update, delete on public.tracker_tareas to authenticated;

create policy "tracker select admin" on public.tracker_tareas
  for select to authenticated using (public.is_admin());

create policy "tracker insert admin" on public.tracker_tareas
  for insert to authenticated with check (public.is_admin());

create policy "tracker update admin" on public.tracker_tareas
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "tracker delete admin" on public.tracker_tareas
  for delete to authenticated using (public.is_admin());
```

**Cuatro políticas, una por comando, y ninguna `FOR ALL`.** Aquí ya se pagó: una permisiva `FOR ALL`
también concede SELECT, y las permisivas se suman con OR, así que una sola política ancha vuelve
inútiles a las demás.

`force row level security` es lo que impide que el propietario de la tabla la lea saltándose todo.
**service-role sigue pasando** porque `supabase_admin` tiene `bypassrls`; eso es a propósito y es lo
que deja funcionar a los scripts.

## 6. «Completado» solo lo pone el admin — y aquí hay un choque con el patrón de la casa

**El choque, dicho antes que la solución.** Los `guard_*` de este repo empiezan con
`if auth.uid() is null then return NEW; end if;` (`009_routes.sql:26`): *sin sesión, pasa todo*. Es
razonable para ellos —service-role es el editor SQL y los scripts del orquestador—, pero aquí **es
justo lo contrario de lo que se pide**: quien no puede cerrar una tarea es, sobre todo, un script.
Si copio el patrón, cualquier sesión de Claude cierra tareas con la llave de servicio y la regla no
existe.

Así que este trigger **se aparta del patrón a propósito**:

```sql
create or replace function public.tracker_guard_completado()
  returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Quien cierra una tarea es el DUENO, no quien la hizo. Sin sesion (service-role, scripts,
  -- editor SQL) NO se puede poner «Completado»: es la unica regla del tracker que no se puede
  -- saltar con la llave de servicio, y por eso este trigger NO lleva el
  -- `if auth.uid() is null then return NEW` de los guard_* (009_routes.sql:26).
  if NEW.estado = 'Completado'
     and (TG_OP = 'INSERT' or OLD.estado is distinct from 'Completado') then
    if auth.uid() is null then
      raise exception 'tracker: «Completado» lo pone el dueño desde su sesión, no un script';
    end if;
    if not public.is_admin() then
      raise exception 'tracker: «Completado» solo lo pone un admin';
    end if;
    NEW.completado_por := auth.uid();      -- del servidor, NO de lo que mande el cliente
    NEW.completado_en  := now();
  end if;

  -- Deshacer: al salir de «Completado» se borra el rastro, para que no quede un sello mintiendo.
  if TG_OP = 'UPDATE' and OLD.estado = 'Completado' and NEW.estado is distinct from 'Completado' then
    NEW.completado_por := null;
    NEW.completado_en  := null;
  end if;

  NEW.modificado := now();
  return NEW;
end $$;

create trigger tracker_tareas_guard
  before insert or update on public.tracker_tareas
  for each row execute function public.tracker_guard_completado();
```

**`completado_por` y `completado_en` los pone el trigger**, nunca el cliente: un campo de auditoría
que el cliente puede escribir no es auditoría.

**Esto no estorba a la importación**, y está medido: de las 371 tareas, **0 están en «Completado»**,
así que el script de carga nunca toca esa rama. Si algún día hubiera que restaurar una cerrada, es
un acto deliberado del admin, que es exactamente lo que se quiere.

## 7. Matriz de pruebas, con `ROLLBACK` — la corre el orquestador

Todas dentro de `begin; … rollback;`. Se ensaya con `set local role authenticated` y
`request.jwt.claims` del usuario que toque. **Cada caso dice qué se espera ANTES de correrlo.**

| # | quién | qué intenta | espera |
|---|---|---|---|
| 1 | admin | `select count(*)` | **371** |
| 2 | admin | `update … set estado='Completado'` en una | **1 fila**, y `completado_por = su uid` |
| 3 | admin | deshacer: `set estado='Ocupa revisión'` | 1 fila, y `completado_por` **null** |
| 4 | manager | `select count(*)` | **0** (RLS, no error) |
| 5 | accounting | `select count(*)` | **0** |
| 6 | sales | `select count(*)` | **0** |
| 7 | sales | `update … set estado='Completado'` | **0 filas** (no error: RLS filtra) |
| 8 | anon | `select count(*)` | **0** |
| 9 | **sin sesión (service-role)** | `update … set estado='Completado'` | **excepción** del trigger |
| 10 | sin sesión | `update … set estado='Ocupa revisión'` | **1 fila**: lo demás sí se puede |
| 11 | admin | `insert` con `completado_por` inventado y estado Completado | `completado_por` = **su uid**, no el inventado |
| 12 | admin | `insert` con `estado='terminado'` | **excepción** del `check` |

El caso 7 espera **menos** de lo obvio a propósito: una política mal escrita devuelve «1 fila» ahí, y
un caso que espera «error» no lo distinguiría de un rechazo por otro motivo.

## 8. La página HTML — fuera de la app

- **Un fichero suelto**, no una ruta del hub. Lo abre con doble clic o por una URL.
- Entra con **su usuario del RTG**: `supabase-js` desde `cdn.jsdelivr.net`, con la **URL y la anon
  key**, que son públicas por diseño. **Ninguna llave de service-role en el HTML**, y una prueba lo
  vigila: si el fichero generado contiene `service_role` o un JWT con ese rol, falla.
- Lee `tracker_tareas` con su sesión. Lo que vea lo decide la RLS, no el JavaScript.
- **Botón «Completado» por tarea, de un clic y sin diálogo**, como pidió. Pinta el cambio al
  instante (optimista) y lo revierte si la base dice que no. **Se deshace con otro clic.**
- Esto **rompe la regla de «sin nada de fuera»** que tiene hoy el informe estático: `supabase-js`
  viene de un CDN. Lo digo en vez de esconderlo. Se puede evitar bajando la librería al repo; dime
  si lo prefieres y lo cambio, con el coste de tener que actualizarla a mano.
- **Quedan DOS páginas**, y a propósito: el informe suelto de hoy (sin red, sin sesión, para guardar
  y mandar) y esta (en vivo, con su sesión). Las dos salen del mismo renderizador.

**Sobre Storage (tu pregunta):** sí conviene, y así quedaría — bucket **`tracker`**, público de solo
lectura, un objeto `informe.html`, subido por un script con service-role. Ventaja real: una URL fija
que abre desde el celular sin instalar nada. Aviso: un bucket público es **público de verdad**; el
HTML no puede llevar ningún dato dentro, solo el código que los pide con la sesión. Como los datos ya
viven en la base y la página los busca al abrirse, eso se cumple — pero es la clase de cosa que se
rompe el día que alguien «mete los datos para que cargue más rápido». Recomiendo hacerlo **en un
segundo paso**, después de que la tabla y la página funcionen.

## 9. Qué NO hace este plan

- **No aplica nada.** Escribo el `.sql` y el script; los ensayos y la aplicación son del orquestador.
- **No toca ninguna tabla existente**, ni `profiles`, ni políticas de la app.
- **No mete el tracker en la app RTG.** Ninguna pantalla del hub lo lee.
- **No borra los JSON** (§2), salvo que se decida.
- **No sube nada a Storage** (§8) en este paso.

## 10. Reversión

```sql
drop trigger if exists tracker_tareas_guard on public.tracker_tareas;
drop function if exists public.tracker_guard_completado();
drop table if exists public.tracker_tareas;          -- se lleva políticas e índices
delete from public.schema_migrations where name = '144_tracker_tareas.sql';
```

La tabla es **nueva**: revertir la borra y no deja residuo en nada de la app. El único dato que se
perdería son los «Completado» que el dueño hubiera puesto entre aplicar y revertir — por eso los JSON
congelados de §2 valen también como red.
