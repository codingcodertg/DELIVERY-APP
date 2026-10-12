-- ===========================================================================
-- 165 - La inspeccion pre-viaje del chofer (su decision: «Inspeccion pre-viaje» en DECISIONS.md)
-- ===========================================================================
-- El dueno, 2026-10-11: «AGREGA UN NUEVO VIEW QUE SE LLAMARA PRE TRIP INSPECTION CHECKLIST Y INVESTIGAME ALGO PARA
-- HACER UN FIRST DRAFT».
--
-- Plan en papel: docs/PLAN-165-inspeccion-pre-viaje.md (inventario, matriz por rol con ROLLBACK, reversion).
-- ESCRITA Y NO APLICADA: aplicarla es del orquestador, despues del merge, con respaldo hecho y migrate-status antes
-- y despues. Sin el numero de la decision dentro, a proposito: numerarla cambiaria el checksum (D-512).
-- La app funciona sin ella: la pantalla dice «aun no se puede guardar» y no avisa en «Mi ruta».
--
-- PLAN - que trae, y SOLO esto:
--   1. Una tabla nueva, public.vehicle_inspections: una fila por inspeccion. Quien, que dia, que vehiculo, el
--      odometro, las respuestas (jsonb, por id de punto), si es seguro salir, la certificacion del chofer y los
--      defectos que logistica marco corregidos. Indice unico: UNA por chofer, por dia y por vehiculo.
--   2. Un disparador que sella lo que no decide el telefono: quien (auth.uid()), su nombre (profiles), el dia (hoy
--      en America/Chicago), la hora (now()), y que nadie nace con defectos ya corregidos.
--   3. Dos politicas, una por comando. SELECT: el chofer las suyas; admin y logistica todas. INSERT: solo a nombre
--      propio. SIN UPDATE NI DELETE para nadie: un reporte firmado no se edita, y se guarda (49 CFR 396.11 pide tres
--      meses; aqui no se poda nada).
--   4. public.marca_defecto_corregido(...), security definer: admin o logistica marcan (o desmarcan) un defecto como
--      corregido. Sella quien y cuando. Es la UNICA escritura despues de insertar, y solo toca `repairs`.
--   5. public.vehiculos_para_inspeccion(), security definer: los vehiculos activos de clockin.vehicles (id, nombre,
--      placa, y si es el asignado a quien pregunta) para quien tiene el modulo de Entregas. Hace falta porque la RLS
--      de Clock-in (`vehicles_read`: company_id = clockin.auth_company_id()) no deja verlos a un chofer sin ficha de
--      fichaje. Devuelve solo esas cuatro columnas.
--   No toca ninguna otra tabla, politica ni funcion.
--
-- Decisiones, con su motivo:
--   - Las respuestas en jsonb y no en una tabla de puntos: la lista vive en el codigo (src/lib/inspeccion/puntos.ts),
--     es un primer borrador y va a cambiar; cada fila guarda `checklist_version`. Forma de cada respuesta:
--     {"estado": "ok"|"defecto"|"na", "nota": "...", "fotos": ["data:image/jpeg;base64,..."]}.
--   - Las fotos dentro del jsonb, como data URL comprimida, igual que `deliveries.photos` (PhotoUpload): sin cubo ni
--     politicas de storage nuevas. Tope: 2 fotos por defecto en la app y 4 MB por fila aqui.
--   - `vehicle_label` se guarda siempre, aunque haya `vehicle_id`: logistica puede no ver clockin.vehicles, el camion
--     puede cambiar de nombre, y un camion que no esta en la lista se escribe a mano (`vehicle_id` nulo).
--   - `driver_id` con on delete set null (no cascade): borrar a un usuario no borra sus reportes firmados.
--   - `safe` lo calcula la app (`esSeguroParaSalir`: todos los puntos criticos en OK) y se guarda tal cual: es el
--     veredicto que el chofer firmo. Recalcularlo aqui obligaria a copiar la lista de criticos en SQL.
--
-- Sin begin/commit propios, a proposito: quien aplica envuelve el fichero en una transaccion, y un commit de dentro
-- cerraria la de fuera (paso con la 124).
-- ===========================================================================

create table if not exists public.vehicle_inspections (
  id                uuid primary key default gen_random_uuid(),
  driver_id         uuid references public.profiles(id) on delete set null,
  driver_name       text not null default '',
  inspection_date   date not null default ((now() at time zone 'America/Chicago')::date),
  vehicle_id        uuid references clockin.vehicles(id) on delete set null,
  vehicle_label     text not null,
  odometer          numeric(9,1),
  answers           jsonb not null default '{}'::jsonb,
  safe              boolean not null,
  notes             text,
  certified         boolean not null,
  checklist_version text not null default '',
  repairs           jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  constraint vehicle_inspections_label_not_blank check (btrim(vehicle_label) <> '' and char_length(vehicle_label) <= 200),
  constraint vehicle_inspections_certified check (certified),
  constraint vehicle_inspections_odometer_range check (odometer is null or (odometer >= 0 and odometer < 10000000)),
  constraint vehicle_inspections_answers_object check (jsonb_typeof(answers) = 'object'),
  constraint vehicle_inspections_repairs_object check (jsonb_typeof(repairs) = 'object'),
  constraint vehicle_inspections_answers_size check (octet_length(answers::text) <= 4000000),
  constraint vehicle_inspections_notes_len check (notes is null or char_length(notes) <= 2000)
);

comment on table public.vehicle_inspections is
  'Inspeccion pre-viaje del chofer (165): una por chofer, dia y vehiculo. answers = {punto: {estado, nota, fotos}}; repairs = {punto: {at, by, by_name, note}}. Sin UPDATE ni DELETE: corregir un defecto es marca_defecto_corregido().';

-- Una por chofer, por dia y por vehiculo. El vehiculo es su id; si se escribio a mano, el texto sin mayusculas ni
-- espacios de mas. La MISMA clave que `claveDeVehiculo` (src/lib/inspeccion/reglas.ts); una prueba compara las dos.
create unique index if not exists vehicle_inspections_una_por_dia
  on public.vehicle_inspections (driver_id, inspection_date,
    (coalesce(vehicle_id::text, 'texto:' || lower(regexp_replace(btrim(vehicle_label), '\s+', ' ', 'g')))));

-- La lista de logistica lee un dia entero.
create index if not exists vehicle_inspections_por_dia on public.vehicle_inspections (inspection_date, created_at);

-- Lo que no decide el telefono lo pone la base. Sin sesion (psql, llave de servicio) se deja como venga, salvo el
-- dia, la hora y `repairs`, que se sellan siempre.
create or replace function public.vehicle_inspections_stamp()
  returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  NEW.created_at := now();
  NEW.inspection_date := (now() at time zone 'America/Chicago')::date;
  NEW.repairs := '{}'::jsonb;
  if auth.uid() is not null then
    NEW.driver_id := auth.uid();
    NEW.driver_name := coalesce((select nullif(btrim(p.full_name), '') from public.profiles p where p.id = auth.uid()), NEW.driver_name, '');
  end if;
  return NEW;
end $$;

revoke execute on function public.vehicle_inspections_stamp() from public, anon, authenticated;

drop trigger if exists vehicle_inspections_stamp on public.vehicle_inspections;
create trigger vehicle_inspections_stamp
  before insert on public.vehicle_inspections
  for each row execute function public.vehicle_inspections_stamp();

-- ---------------------------------------------------------------------------
-- Quien lee y quien escribe
-- ---------------------------------------------------------------------------
-- Una politica POR COMANDO y ninguna FOR ALL: una ALL tambien lee, y las permisivas se suman con OR.
-- La lista ('admin', 'logistics') es `ROLES_QUE_REVISAN` (src/lib/inspeccion/reglas.ts); una prueba compara las dos.
alter table public.vehicle_inspections enable row level security;

-- El revoke va primero: en Supabase los privilegios por defecto dan TODO a anon y authenticated sobre cada tabla
-- nueva, y un grant a secas no quita nada (medido al ensayar la 126).
revoke all on public.vehicle_inspections from anon, authenticated;
grant select, insert on public.vehicle_inspections to authenticated;

drop policy if exists "vehicle_inspections select" on public.vehicle_inspections;
drop policy if exists "vehicle_inspections insert" on public.vehicle_inspections;

create policy "vehicle_inspections select" on public.vehicle_inspections for select to authenticated
  using ((select public.has_deliveries_access())
     and (driver_id = (select auth.uid())
          or (select public.current_user_role()) in ('admin', 'logistics')));

-- El disparador pone driver_id = auth.uid() ANTES de esta comprobacion (los BEFORE ROW corren primero); la
-- comprobacion queda como segunda puerta.
create policy "vehicle_inspections insert" on public.vehicle_inspections for insert to authenticated
  with check ((select public.has_deliveries_access())
     and driver_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Marcar un defecto como corregido (admin y logistica)
-- ---------------------------------------------------------------------------
create or replace function public.marca_defecto_corregido(p_inspeccion uuid, p_punto text, p_corregido boolean default true, p_nota text default null)
  returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  quien uuid := auth.uid();
  respuesta jsonb;
  resultado jsonb;
begin
  if not coalesce((select public.has_deliveries_access()), false)
     or coalesce((select public.current_user_role()), '') not in ('admin', 'logistics') then
    raise exception 'marca_defecto_corregido: only admin or logistics' using errcode = '42501';
  end if;
  select vi.answers -> p_punto into respuesta from public.vehicle_inspections vi where vi.id = p_inspeccion for update;
  if not found then
    raise exception 'marca_defecto_corregido: inspection not found' using errcode = 'P0002';
  end if;
  if coalesce(respuesta ->> 'estado', '') <> 'defecto' then
    raise exception 'marca_defecto_corregido: % is not a defect in this inspection', p_punto using errcode = '22023';
  end if;
  if coalesce(p_corregido, true) then
    update public.vehicle_inspections vi
       set repairs = vi.repairs || jsonb_build_object(p_punto, jsonb_build_object(
             'at', now(),
             'by', quien,
             'by_name', (select p.full_name from public.profiles p where p.id = quien),
             'note', nullif(left(btrim(coalesce(p_nota, '')), 500), '')))
     where vi.id = p_inspeccion
     returning vi.repairs into resultado;
  else
    update public.vehicle_inspections vi
       set repairs = vi.repairs - p_punto
     where vi.id = p_inspeccion
     returning vi.repairs into resultado;
  end if;
  return resultado;
end $$;

revoke execute on function public.marca_defecto_corregido(uuid, text, boolean, text) from public, anon;
grant execute on function public.marca_defecto_corregido(uuid, text, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Los vehiculos para elegir
-- ---------------------------------------------------------------------------
-- La compania es la de la ficha de fichaje de quien pregunta; sin ficha, la unica que hay (la misma regla de
-- clockin.auth_company_id() de la 079, aqui para cualquiera con el modulo y no solo para el admin). Con varias
-- companias y sin ficha, ninguna: elegir mal la compania es peor que escribir el camion a mano.
create or replace function public.vehiculos_para_inspeccion()
  returns table (id uuid, name text, plate text, assigned boolean)
  language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  mi_compania uuid;
  mi_vehiculo uuid;
begin
  if not coalesce((select public.has_deliveries_access()), false) then
    raise exception 'vehiculos_para_inspeccion: requires the deliveries module' using errcode = '42501';
  end if;
  select es.company_id, es.vehicle_id into mi_compania, mi_vehiculo
    from clockin.employee_settings es where es.id = auth.uid();
  if mi_compania is null and (select count(*) from clockin.companies) = 1 then
    select c.id into mi_compania from clockin.companies c;
  end if;
  return query
    select v.id, v.name, v.plate, coalesce(v.id = mi_vehiculo, false)
      from clockin.vehicles v
     where v.active and v.company_id = mi_compania
     order by coalesce(v.id = mi_vehiculo, false) desc, v.name;
end $$;

revoke execute on function public.vehiculos_para_inspeccion() from public, anon;
grant execute on function public.vehiculos_para_inspeccion() to authenticated;

-- ===========================================================================
-- Autocomprobacion
-- ===========================================================================
do $comprueba$
declare
  n int;
begin
  if not (select relrowsecurity from pg_class where oid = 'public.vehicle_inspections'::regclass) then
    raise exception '165: vehicle_inspections quedo sin RLS';
  end if;
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'vehicle_inspections';
  if n <> 2 then raise exception '165: vehicle_inspections tiene % politicas, se esperaban 2', n; end if;
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'vehicle_inspections' and cmd in ('ALL', 'UPDATE', 'DELETE');
  if n <> 0 then raise exception '165: hay % politicas FOR ALL, UPDATE o DELETE', n; end if;
  select count(distinct cmd) into n from pg_policies where schemaname = 'public' and tablename = 'vehicle_inspections' and cmd in ('SELECT', 'INSERT');
  if n <> 2 then raise exception '165: las politicas no cubren select e insert (cubren %)', n; end if;

  if has_table_privilege('anon', 'public.vehicle_inspections', 'SELECT')
     or has_table_privilege('anon', 'public.vehicle_inspections', 'INSERT')
     or has_table_privilege('authenticated', 'public.vehicle_inspections', 'UPDATE')
     or has_table_privilege('authenticated', 'public.vehicle_inspections', 'DELETE')
     or has_table_privilege('authenticated', 'public.vehicle_inspections', 'TRUNCATE')
     or has_table_privilege('authenticated', 'public.vehicle_inspections', 'REFERENCES')
     or has_table_privilege('authenticated', 'public.vehicle_inspections', 'TRIGGER') then
    raise exception '165: permisos de mas sobre vehicle_inspections';
  end if;
  if not has_table_privilege('authenticated', 'public.vehicle_inspections', 'SELECT')
     or not has_table_privilege('authenticated', 'public.vehicle_inspections', 'INSERT') then
    raise exception '165: a authenticated le faltan permisos sobre vehicle_inspections';
  end if;

  if not exists (select 1 from pg_trigger where tgrelid = 'public.vehicle_inspections'::regclass
                  and tgname = 'vehicle_inspections_stamp' and not tgisinternal) then
    raise exception '165: falta el disparador vehicle_inspections_stamp';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'vehicle_inspections'
                  and indexname = 'vehicle_inspections_una_por_dia' and indexdef ilike 'create unique index%') then
    raise exception '165: falta el indice unico de una por dia';
  end if;

  if not (select prosecdef from pg_proc where oid = 'public.marca_defecto_corregido(uuid, text, boolean, text)'::regprocedure)
     or not (select prosecdef from pg_proc where oid = 'public.vehiculos_para_inspeccion()'::regprocedure) then
    raise exception '165: las funciones no son security definer';
  end if;
  if has_function_privilege('anon', 'public.marca_defecto_corregido(uuid, text, boolean, text)', 'execute')
     or has_function_privilege('anon', 'public.vehiculos_para_inspeccion()', 'execute')
     or has_function_privilege('authenticated', 'public.vehicle_inspections_stamp()', 'execute') then
    raise exception '165: alguien de mas puede ejecutar las funciones';
  end if;
  if not has_function_privilege('authenticated', 'public.marca_defecto_corregido(uuid, text, boolean, text)', 'execute')
     or not has_function_privilege('authenticated', 'public.vehiculos_para_inspeccion()', 'execute') then
    raise exception '165: authenticated no puede ejecutar las funciones';
  end if;
end $comprueba$;

-- ===========================================================================
-- REVERSION (a mano, en una transaccion propia)
-- ===========================================================================
--   begin;
--   drop function if exists public.marca_defecto_corregido(uuid, text, boolean, text);
--   drop function if exists public.vehiculos_para_inspeccion();
--   drop table if exists public.vehicle_inspections;          -- se lleva politicas, indices y disparador
--   drop function if exists public.vehicle_inspections_stamp();
--   delete from public.schema_migrations where name = '165_inspeccion_pre_viaje.sql';
--   commit;
-- SE PIERDEN LAS INSPECCIONES GUARDADAS (y 49 CFR 396.11 pide guardarlas tres meses): antes de revertir, un
-- `\copy (select * from public.vehicle_inspections) to 'inspecciones.csv' csv header`. La app no se rompe: sin la
-- tabla, la pantalla vuelve a decir «aun no se puede guardar» y «Mi ruta» deja de avisar.
-- ===========================================================================
-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('165_inspeccion_pre_viaje.sql', '8df01aff5d359316a07e052f3220e682c2c87f10a6536ffd6acd9d8acacfad48') on conflict (name) do nothing;
