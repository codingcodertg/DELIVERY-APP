-- 144 - El tracker se muda a la base, y «Completado» solo lo pone el dueno desde su sesion
-- ===========================================================================
-- Plan en papel: docs/PLAN-144-tracker-en-la-nube.md (aprobado el 2026-09-24).
--
-- El dueno: "en el html, primero, que se guarde en la nube, y segundo, si yo le doy a comprobar que
-- se cambie sin pedir dialogo". Preguntado: "no no fisico en el app pero si en el mismo de rtg", y
-- que el boton marque «Completado».
--
-- EN `public` Y NO EN UN ESQUEMA `tracker`: la pagina lee por PostgREST, que solo sirve los esquemas
-- expuestos; un esquema nuevo obliga a cambiar un ajuste que afecta a TODO el proyecto. Lo que un
-- esquema aparte daria —que la app no la lea— lo da la RLS. Ninguna pantalla del hub consulta esta
-- tabla.
--
-- Sin begin/commit propios, a proposito (lo envuelve quien aplica).
-- ===========================================================================

create table if not exists public.tracker_tareas (
  id              text primary key,
  fecha           date not null,
  resumen         text not null,
  texto_original  text not null default '',
  lo_hizo_claude  text not null default 'No',
  estado          text not null,
  padre           text references public.tracker_tareas(id),
  -- jsonb y no tablas hijas: hoy son listas cortas que siempre se leen enteras con su tarea y nadie
  -- las consulta por separado. Tres tablas mas serian tres joins y tres politicas para cero
  -- preguntas nuevas. Si algun dia hace falta «todas las que citan el PR #204», se normaliza.
  evidencia       jsonb not null default '{}'::jsonb,
  verificacion    jsonb not null default '{"estado":"sin verificar","prueba":"","fecha":null}'::jsonb,
  notas           jsonb not null default '[]'::jsonb,
  fuentes         jsonb not null default '[]'::jsonb,
  -- Los pone el TRIGGER desde auth.uid(), nunca el cliente: un campo de auditoria que el cliente
  -- puede escribir no es auditoria.
  completado_por  uuid references auth.users(id),
  completado_en   timestamptz,
  creado          timestamptz not null default now(),
  modificado      timestamptz not null default now()
);

-- Los cuatro estados son las palabras del dueno, con su guion largo (U+2013). El check esta para que
-- un quinto estado inventado no entre por una via lateral.
alter table public.tracker_tareas drop constraint if exists tracker_tareas_estado_chk;
alter table public.tracker_tareas add constraint tracker_tareas_estado_chk
  check (estado in ('En revisión – desplegado', 'En revisión – no desplegado', 'Ocupa revisión', 'Completado'));

alter table public.tracker_tareas drop constraint if exists tracker_tareas_hizo_chk;
alter table public.tracker_tareas add constraint tracker_tareas_hizo_chk
  check (lo_hizo_claude in ('Si', 'Parcial', 'No'));

alter table public.tracker_tareas drop constraint if exists tracker_tareas_verif_chk;
alter table public.tracker_tareas add constraint tracker_tareas_verif_chk
  check (verificacion->>'estado' in ('sin verificar', 'verificado', 'fallo'));

create index if not exists tracker_tareas_fecha_idx  on public.tracker_tareas (fecha desc);
create index if not exists tracker_tareas_estado_idx on public.tracker_tareas (estado);

-- ---------------------------------------------------------------------------
-- RLS: solo el admin, con su sesion. Nadie mas lee ni escribe.
-- ---------------------------------------------------------------------------
alter table public.tracker_tareas enable row level security;
alter table public.tracker_tareas force  row level security;

revoke all on public.tracker_tareas from public, anon;
grant select, insert, update, delete on public.tracker_tareas to authenticated;

-- Cuatro politicas, una por comando, y ninguna FOR ALL. Aqui ya se pago: una permisiva FOR ALL
-- tambien concede SELECT, y las permisivas se suman con OR, asi que una sola politica ancha deja
-- sin efecto a las demas.
drop policy if exists "tracker select admin" on public.tracker_tareas;
drop policy if exists "tracker insert admin" on public.tracker_tareas;
drop policy if exists "tracker update admin" on public.tracker_tareas;
drop policy if exists "tracker delete admin" on public.tracker_tareas;

create policy "tracker select admin" on public.tracker_tareas
  for select to authenticated using (public.is_admin());
create policy "tracker insert admin" on public.tracker_tareas
  for insert to authenticated with check (public.is_admin());
create policy "tracker update admin" on public.tracker_tareas
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "tracker delete admin" on public.tracker_tareas
  for delete to authenticated using (public.is_admin());

-- Y `service_role` explicito, en vez de fiarlo a `bypassrls`.
--
-- El plan decia que service-role pasa porque tiene bypassrls. **Eso no lo he medido**, y si fuera
-- falso los scripts se quedarian sin poder escribir: las politicas de arriba son `to authenticated`,
-- asi que para otro rol NO hay ninguna politica aplicable y la tabla queda cerrada del todo.
-- Con esto, el import funciona se cumpla o no la suposicion. Si bypassrls existe, estas politicas
-- no se consultan nunca y no estorban.
--
-- Lo que NO le abre esto a service-role es poner «Completado»: de eso se encarga el trigger, que
-- corre siempre, incluso para quien salta la RLS.
do $srv$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant select, insert, update, delete on public.tracker_tareas to service_role';
    execute 'drop policy if exists "tracker todo service_role" on public.tracker_tareas';
    execute 'create policy "tracker todo service_role" on public.tracker_tareas '
         || 'for all to service_role using (true) with check (true)';
  end if;
end $srv$;

-- ---------------------------------------------------------------------------
-- El trigger: «Completado» lo pone el dueno, y NADIE mas
-- ---------------------------------------------------------------------------
create or replace function public.tracker_guard_completado()
  returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- OJO, esto se aparta del patron de la casa A PROPOSITO. Los guard_* de este repo empiezan con
  -- `if auth.uid() is null then return NEW` (009_routes.sql:26) — «sin sesion, pasa todo» — y aqui
  -- eso seria justo al reves de lo pedido: quien no debe poder cerrar una tarea es, sobre todo, un
  -- script. Con el patron copiado, cualquier sesion con la llave de servicio cerraria tareas y la
  -- regla no existiria.
  if NEW.estado = 'Completado'
     and (TG_OP = 'INSERT' or OLD.estado is distinct from 'Completado') then
    if auth.uid() is null then
      raise exception 'tracker: «Completado» solo se pone desde la sesion del dueno en la pagina. '
                      'Un script con la llave de servicio no puede cerrar una tarea, y eso es la regla, no un fallo.';
    end if;
    if not public.is_admin() then
      raise exception 'tracker: «Completado» solo lo pone un admin; esta sesion no lo es';
    end if;
    NEW.completado_por := auth.uid();
    NEW.completado_en  := now();
  end if;

  -- El sello se decide SIEMPRE aqui, no solo al entrar y al salir de «Completado».
  --
  -- La primera version solo lo sellaba al entrar y lo limpiaba al salir, y dejaba un hueco: en una
  -- tarea que NUNCA ha estado completada, el cliente podia mandar `completado_por` y `completado_en`
  -- a mano y quedaban escritos. Una tarea sin cerrar con el sello de alguien puesto es una mentira
  -- que nadie mira, porque el estado se lee y el sello no.
  --
  -- Las tres ramas: fuera de «Completado» el sello no existe; si sigue completada, se conserva el de
  -- OLD —o sea que tampoco se puede reescribir quien la cerro—; y al ENTRAR, el bloque de arriba ya
  -- lo puso desde auth.uid() y aqui no se toca (esa rama no entra por ninguna de las dos).
  if NEW.estado is distinct from 'Completado' then
    NEW.completado_por := null;
    NEW.completado_en  := null;
  elsif TG_OP = 'UPDATE' and OLD.estado = 'Completado' then
    NEW.completado_por := OLD.completado_por;
    NEW.completado_en  := OLD.completado_en;
  end if;

  NEW.modificado := now();
  return NEW;
end $$;

drop trigger if exists tracker_tareas_guard on public.tracker_tareas;
create trigger tracker_tareas_guard
  before insert or update on public.tracker_tareas
  for each row execute function public.tracker_guard_completado();

-- ---------------------------------------------------------------------------
-- Se comprueba a si misma
-- ---------------------------------------------------------------------------
do $chk$
declare
  n_pol  int;
  def    text := pg_get_functiondef('public.tracker_guard_completado()'::regprocedure);
  -- El cuerpo SIN las lineas de comentario. Se quitan solo las que empiezan por `--` (con espacios
  -- delante), y no cualquier `--` suelto, para no tocar un `--` que viviera dentro de una cadena.
  -- La `n` de las banderas es lo que hace que `^` y `$` valgan por linea; sin ella, `.` se come los
  -- saltos y el primer comentario se llevaria por delante el resto de la funcion.
  codigo text := regexp_replace(def, '^[ \t]*--.*$', '', 'gn');
begin
  if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'tracker_tareas') then
    raise exception '144: no existe public.tracker_tareas';
  end if;
  if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'tracker_tareas'
                 and rowsecurity) then
    raise exception '144: tracker_tareas sin RLS activada';
  end if;
  -- Las cuatro de authenticated, una por comando, y ninguna FOR ALL para ese rol.
  select count(*) into n_pol from pg_policies
   where schemaname = 'public' and tablename = 'tracker_tareas' and 'authenticated' = any(roles);
  if n_pol <> 4 then
    raise exception '144: se esperaban 4 politicas para authenticated y hay %', n_pol;
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tracker_tareas'
             and 'authenticated' = any(roles) and cmd = 'ALL') then
    raise exception '144: hay una politica FOR ALL para authenticated, y eso concede tambien SELECT';
  end if;
  -- Y las cuatro miran is_admin(): una politica que no decide nada es peor que ninguna, porque se
  -- cuenta como proteccion.
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tracker_tareas'
             and 'authenticated' = any(roles)
             and coalesce(qual, '') || coalesce(with_check, '') not like '%is_admin%') then
    raise exception '144: alguna politica de authenticated no mira is_admin()';
  end if;
  -- El trigger NO puede llevar el «sin sesion, pasa todo» de los guard_*.
  --
  -- **Se mira el CODIGO, no los comentarios**, y esto costo un ensayo entero: `pg_get_functiondef`
  -- devuelve el cuerpo con sus comentarios dentro, y el comentario que explica esta misma regla cita
  -- la frase prohibida. La comprobacion se disparaba sola y la migracion abortaba antes de aplicar
  -- nada. Quitando las lineas `--` se puede seguir explicando la regla sin que la explicacion la
  -- rompa, que es lo que se quiere: el dia que alguien vuelva a citar el patron para contar por que
  -- no se usa, esto seguira funcionando.
  if position('auth.uid() is null then return NEW' in codigo) > 0 then
    raise exception '144: el trigger dejaria pasar a service-role, que es justo lo que no debe';
  end if;
  if position('auth.uid() is null' in codigo) = 0 then
    raise exception '144: el trigger no comprueba que haya sesion';
  end if;
  -- Y el sello se decide siempre, no solo al entrar y salir de «Completado».
  if position('NEW.estado is distinct from ''Completado'' then' in codigo) = 0 then
    raise exception '144: el trigger no limpia el sello cuando el estado final no es Completado';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'tracker_tareas_guard' and not tgisinternal) then
    raise exception '144: falta el trigger tracker_tareas_guard';
  end if;
end $chk$;

-- Reversion (a mano):
--   drop trigger if exists tracker_tareas_guard on public.tracker_tareas;
--   drop function if exists public.tracker_guard_completado();
--   drop table if exists public.tracker_tareas;          -- se lleva politicas e indices
--   delete from public.schema_migrations where name = '144_tracker_tareas.sql';

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('144_tracker_tareas.sql', 'b1b984d41490c02c74502af441ab0a29bb988c3fe3680482ba081f993ababbdb') on conflict (name) do nothing;
