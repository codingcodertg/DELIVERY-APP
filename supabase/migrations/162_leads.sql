-- ===========================================================================
-- 162 - Leads: el banco de leads de permisos (TDLR) repartido por tienda, el pool personal con tope,
--       el cierre con resultado y nota, el historial y lo que hace el admin
-- ===========================================================================
-- Plan en papel: docs/PLAN-162-leads.md. ESCRITA Y NO APLICADA: aplicarla es del orquestador,
-- despues del merge, con respaldo hecho y migrate-status antes y despues.
--
-- El dueno (2026-10-04) pidio llevar a una app el Excel de leads: un banco por tienda mas cercana,
-- un pool personal de hasta 10 leads por vendedor, y que el puesto solo se libere al cerrar el lead
-- con una nota y un resultado. Lo que vuelve al banco vuelve con la etiqueta y la nota de quien lo solto.
--
-- QUE TRAE:
--   0. 'leads' en profiles_module_access_known (la ULTIMA definicion aplicada es la 155: se parte de
--      su cuerpo y se anade una palabra).
--   1. has_leads_access(): admin, o 'leads' en module_access. Misma forma que has_surveys_access().
--   2. public.lead_settings: UNA fila, con el tope de leads abiertos por persona (10).
--   3. public.leads: un lead por TABS Project # (unico), con sus datos del Excel y su estado.
--   4. public.lead_events: el historial, SOLO se anade (un disparador rechaza update, delete y truncate).
--   5. RLS: quien tiene el modulo LEE las tres tablas. Nadie tiene INSERT, UPDATE ni DELETE por la
--      API: se escribe solo por las funciones de abajo.
--   6. Del vendedor: lead_take (tomar), lead_note (nota de avance, NO libera puesto), lead_close
--      (cerrar con resultado y nota, libera puesto).
--   7. Del admin: lead_admin_release, lead_admin_assign, lead_admin_archive, leads_set_cap, leads_import.
--   8. leads_import_rows: la carga del Excel (la usa leads_import y el guion scripts/leads).
--
-- DATOS PERSONALES: leads lleva nombre, telefono y direccion postal del dueno de cada obra, del
-- inquilino y del despacho de diseno. Son registros publicos de TDLR (TABS), pero quien tiene el
-- modulo los lee TODOS, de todas las tiendas. El modulo se concede persona por persona.
--
-- LO QUE NO TOCA: ninguna tabla existente salvo la restriccion de profiles de la seccion 0. Ningun
-- dato: la tabla de leads nace VACIA (los datos los mete el guion, aparte). No concede el modulo a nadie.
--
-- Sin begin/commit propios, a proposito: quien aplica envuelve el fichero en una transaccion.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 0. La restriccion que prohibe la palabra. LO UNICO QUE TOCA ALGO EXISTENTE.
-- ---------------------------------------------------------------------------
-- La 155 la dejo en: check (module_access is null or module_access <@
--   array['deliveries','recruiting','timetracker','erp','promos','estimator','surveys']) not valid
-- (medido en produccion el 2026-10-04, solo lectura: es exactamente esa). Se conserva `not valid`
-- por la razon de la 095: las filas viejas no se re-examinan; las altas y los cambios si.
alter table public.profiles drop constraint if exists profiles_module_access_known;
alter table public.profiles add constraint profiles_module_access_known
  check (module_access is null or module_access <@ array['deliveries','recruiting','timetracker','erp','promos','estimator','surveys','leads'])
  not valid;

-- ---------------------------------------------------------------------------
-- 1. Quien entra. Mismo idioma que has_surveys_access() (155).
-- ---------------------------------------------------------------------------
create or replace function public.has_leads_access()
  returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select role = 'admin' or 'leads' = any(coalesce(module_access, '{}'))
    from public.profiles where id = auth.uid()
  ), false);
$$;

-- ---------------------------------------------------------------------------
-- 2. El tope. Una sola fila (la clave es `true` y no puede ser otra cosa).
-- ---------------------------------------------------------------------------
create table if not exists public.lead_settings (
  id          boolean primary key default true,
  max_open    integer not null default 10,
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  constraint lead_settings_una_fila check (id),
  constraint lead_settings_tope check (max_open between 1 and 100)
);
insert into public.lead_settings (id) values (true) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Los leads.
-- ---------------------------------------------------------------------------
-- status:  free     en el banco, cualquiera con el modulo lo puede tomar
--          taken    en el pool de `holder`; OCUPA uno de sus puestos
--          won      venta lograda: se queda con `holder` para siempre, fuera del banco, NO ocupa puesto
--          review   «ocupa revision»: en la cola del admin, sin dueno, nadie lo puede tomar
--          archived fuera del banco por decision del admin
-- holder sin clave foranea a proposito: borrar a una persona no debe fallar ni dejar el lead en un
-- estado imposible; el lead sigue a su nombre (holder_name) hasta que el admin lo libere.
-- last_*: la etiqueta con la que el lead volvio al banco (resultado, nota, quien y cuando). Se queda
-- puesta cuando otro lo toma, para que el siguiente la lea, hasta el cierre siguiente.
create table if not exists public.leads (
  id                    uuid primary key default gen_random_uuid(),
  tabs_project          text not null,
  pool                  text not null,
  distance_miles        numeric,
  category              text,
  project_type          text,
  reason                text,
  county                text,
  registered_date       date,
  project_name          text,
  facility_name         text,
  type_of_work          text,
  scope_of_work         text,
  square_footage        numeric,
  estimated_cost        numeric,
  est_start_date        date,
  est_completion_date   date,
  permit_status         text,
  site_address          text,
  site_city             text,
  site_zip              text,
  owner_name            text,
  owner_phone           text,
  owner_contact         text,
  owner_mailing_address text,
  owner_city_state_zip  text,
  tenant_name           text,
  tenant_phone          text,
  design_firm_name      text,
  design_firm_phone     text,
  design_firm_city      text,
  filing_contact        text,
  funds_type            text,
  tdlr_link             text,
  status                text not null default 'free',
  holder                uuid,
  holder_name           text,
  taken_at              timestamptz,
  touched_at            timestamptz,
  follow_up_note        text,
  follow_up_at          timestamptz,
  last_outcome          text,
  last_note             text,
  last_by               uuid,
  last_by_name          text,
  last_at               timestamptz,
  imported_at           timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint leads_tabs_unico unique (tabs_project),
  constraint leads_tabs_no_vacio check (length(btrim(tabs_project)) > 0),
  constraint leads_pool_no_vacio check (length(btrim(pool)) > 0),
  constraint leads_status check (status in ('free', 'taken', 'won', 'review', 'archived')),
  -- Tiene dueno si y solo si esta tomado o vendido.
  constraint leads_dueno check ((status in ('taken', 'won')) = (holder is not null)),
  constraint leads_last_outcome check (
    last_outcome is null or last_outcome in ('sale', 'bad_lead', 'nothing', 'review', 'reassign', 'admin')
  )
);

create index if not exists leads_pool_status_idx on public.leads (pool, status);
create index if not exists leads_holder_idx on public.leads (holder) where holder is not null;

-- ---------------------------------------------------------------------------
-- 4. El historial. Solo se anade.
-- ---------------------------------------------------------------------------
-- kind:    imported  entro por una carga
--          taken     alguien lo tomo                    (subject = quien)
--          progress  nota de avance, sigue abierto      (subject = quien)
--          closed    cerrado con resultado `outcome`    (subject = quien)
--          released  el admin lo devolvio al banco      (subject = quien lo tenia)
--          assigned  el admin se lo dio a alguien       (subject = a quien)
--          archived  el admin lo archivo                (subject = quien lo tenia)
-- actor/subject sin clave foranea y con el nombre copiado: una fila de historial no se puede
-- modificar, asi que no puede depender de que la persona siga existiendo.
create table if not exists public.lead_events (
  id            bigint generated always as identity primary key,
  lead_id       uuid not null references public.leads (id),
  at            timestamptz not null default now(),
  kind          text not null,
  outcome       text,
  note          text,
  actor         uuid,
  actor_name    text,
  subject       uuid,
  subject_name  text,
  constraint lead_events_kind check (kind in ('imported', 'taken', 'progress', 'closed', 'released', 'assigned', 'archived')),
  constraint lead_events_outcome check (
    (kind = 'closed' and outcome in ('sale', 'bad_lead', 'nothing', 'review', 'reassign'))
    or (kind <> 'closed' and outcome is null)
  )
);

create index if not exists lead_events_lead_idx on public.lead_events (lead_id, at);

create or replace function public.lead_events_solo_anadir()
  returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'leads: the history is append-only (% is not allowed)', tg_op using errcode = '42501';
end $$;

drop trigger if exists lead_events_no_cambia on public.lead_events;
create trigger lead_events_no_cambia before update or delete on public.lead_events
  for each row execute function public.lead_events_solo_anadir();
drop trigger if exists lead_events_no_trunca on public.lead_events;
create trigger lead_events_no_trunca before truncate on public.lead_events
  for each statement execute function public.lead_events_solo_anadir();

-- ---------------------------------------------------------------------------
-- 5. Privilegios y RLS. Una tabla nueva nace con todo concedido a anon y authenticated (los default
--    privileges de postgres en public): se revoca y se concede lo justo. authenticated: SOLO select,
--    y la politica lo deja en quien tiene el modulo.
-- ---------------------------------------------------------------------------
revoke all on public.leads         from public, anon, authenticated;
revoke all on public.lead_events   from public, anon, authenticated;
revoke all on public.lead_settings from public, anon, authenticated;
grant select on public.leads         to authenticated;
grant select on public.lead_events   to authenticated;
grant select on public.lead_settings to authenticated;

alter table public.leads         enable row level security;
alter table public.lead_events   enable row level security;
alter table public.lead_settings enable row level security;

drop policy if exists "leads select" on public.leads;
create policy "leads select" on public.leads for select to authenticated
  using ((select public.has_leads_access()));
drop policy if exists "lead_events select" on public.lead_events;
create policy "lead_events select" on public.lead_events for select to authenticated
  using ((select public.has_leads_access()));
drop policy if exists "lead_settings select" on public.lead_settings;
create policy "lead_settings select" on public.lead_settings for select to authenticated
  using ((select public.has_leads_access()));

-- ---------------------------------------------------------------------------
-- 6. Lo que hace el vendedor. Definer: escriben como el dueno de la tabla, que salta la RLS.
--    Los errores de regla llevan un codigo propio para que la pantalla los traduzca:
--      LD001 pool lleno · LD002 el lead no esta libre · LD003 falta la nota · LD004 no es tuyo
-- ---------------------------------------------------------------------------
create or replace function public.lead_person_name(p_id uuid)
  returns text language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select nullif(btrim(full_name), '') from public.profiles where id = p_id), 'Unknown');
$$;

-- La nota: recortada, obligatoria, y con un tope para que nadie pegue un libro.
create or replace function public.lead_clean_note(p_note text, p_required boolean)
  returns text language plpgsql immutable set search_path = public, pg_temp as $$
declare
  v text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if v is null and p_required then
    raise exception 'leads: a note is required' using errcode = 'LD003';
  end if;
  if length(v) > 2000 then
    raise exception 'leads: the note is longer than 2000 characters' using errcode = '22023';
  end if;
  return v;
end $$;

-- TOMAR. Atomica: el candado por persona pone en fila sus propios intentos (dos pestanas a la vez no
-- pasan las dos con 9 abiertos), y el UPDATE condicionado a status = 'free' hace que de dos personas
-- sobre el mismo lead solo gane una (la segunda espera el candado de la fila y ya no la encuentra libre).
create or replace function public.lead_take(p_lead uuid)
  returns public.leads language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_uid   uuid := auth.uid();
  v_cap   integer;
  v_open  integer;
  v_name  text;
  v_row   public.leads;
  v_prev  public.leads;
begin
  if v_uid is null or not public.has_leads_access() then
    raise exception 'leads: you do not have the Leads module' using errcode = '42501';
  end if;
  if p_lead is null then
    raise exception 'leads: lead id is required' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('leads:take:' || v_uid::text, 0));
  select max_open into v_cap from public.lead_settings where id;
  v_cap := coalesce(v_cap, 10);
  select count(*) into v_open from public.leads where holder = v_uid and status = 'taken';
  if v_open >= v_cap then
    raise exception 'leads: your pool is full (% of %). Close a lead with its result to take another.', v_open, v_cap
      using errcode = 'LD001';
  end if;
  v_name := public.lead_person_name(v_uid);
  update public.leads
     set status = 'taken', holder = v_uid, holder_name = v_name, taken_at = now(), touched_at = now(),
         follow_up_note = null, follow_up_at = null, updated_at = now()
   where id = p_lead and status = 'free'
  returning * into v_row;
  if not found then
    select * into v_prev from public.leads where id = p_lead;
    if not found then
      raise exception 'leads: no lead with that id' using errcode = 'P0002';
    end if;
    raise exception 'leads: this lead is not free (%, %)', v_prev.status, coalesce(v_prev.holder_name, 'nobody')
      using errcode = 'LD002';
  end if;
  insert into public.lead_events (lead_id, kind, actor, actor_name, subject, subject_name)
    values (p_lead, 'taken', v_uid, v_name, v_uid, v_name);
  return v_row;
end $$;

-- NOTA DE AVANCE («visitado, en seguimiento»). El lead sigue abierto y sigue ocupando su puesto.
create or replace function public.lead_note(p_lead uuid, p_note text)
  returns public.leads language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_uid   uuid := auth.uid();
  v_note  text;
  v_name  text;
  v_row   public.leads;
begin
  if v_uid is null or not public.has_leads_access() then
    raise exception 'leads: you do not have the Leads module' using errcode = '42501';
  end if;
  v_note := public.lead_clean_note(p_note, true);
  update public.leads
     set follow_up_note = v_note, follow_up_at = now(), touched_at = now(), updated_at = now()
   where id = p_lead and status = 'taken' and holder = v_uid
  returning * into v_row;
  if not found then
    raise exception 'leads: this lead is not open in your pool' using errcode = 'LD004';
  end if;
  v_name := public.lead_person_name(v_uid);
  insert into public.lead_events (lead_id, kind, note, actor, actor_name, subject, subject_name)
    values (p_lead, 'progress', v_note, v_uid, v_name, v_uid, v_name);
  return v_row;
end $$;

-- CERRAR con resultado y nota. Es lo UNICO que libera el puesto del vendedor.
--   sale     -> won: se queda suyo, fuera del banco
--   review   -> review: a la cola del admin, sin dueno
--   bad_lead, nothing, reassign -> free: vuelve al banco con la etiqueta y la nota
create or replace function public.lead_close(p_lead uuid, p_outcome text, p_note text)
  returns public.leads language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_uid   uuid := auth.uid();
  v_note  text;
  v_name  text;
  v_row   public.leads;
begin
  if v_uid is null or not public.has_leads_access() then
    raise exception 'leads: you do not have the Leads module' using errcode = '42501';
  end if;
  if p_outcome is null or p_outcome not in ('sale', 'bad_lead', 'nothing', 'review', 'reassign') then
    raise exception 'leads: unknown outcome "%"', p_outcome using errcode = '22023';
  end if;
  v_note := public.lead_clean_note(p_note, true);
  v_name := public.lead_person_name(v_uid);
  update public.leads
     set status = case p_outcome when 'sale' then 'won' when 'review' then 'review' else 'free' end,
         holder = case when p_outcome = 'sale' then holder else null end,
         holder_name = case when p_outcome = 'sale' then holder_name else null end,
         taken_at = case when p_outcome = 'sale' then taken_at else null end,
         follow_up_note = case when p_outcome = 'sale' then follow_up_note else null end,
         follow_up_at = case when p_outcome = 'sale' then follow_up_at else null end,
         last_outcome = p_outcome, last_note = v_note, last_by = v_uid, last_by_name = v_name, last_at = now(),
         touched_at = now(), updated_at = now()
   where id = p_lead and status = 'taken' and holder = v_uid
  returning * into v_row;
  if not found then
    raise exception 'leads: this lead is not open in your pool' using errcode = 'LD004';
  end if;
  insert into public.lead_events (lead_id, kind, outcome, note, actor, actor_name, subject, subject_name)
    values (p_lead, 'closed', p_outcome, v_note, v_uid, v_name, v_uid, v_name);
  return v_row;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Lo que hace el admin.
-- ---------------------------------------------------------------------------
-- LIBERAR: devolver al banco desde cualquier estado (tomado, vendido, en revision, archivado).
-- Con nota, la nota pasa a ser la etiqueta; sin nota, se conserva la que traia.
create or replace function public.lead_admin_release(p_lead uuid, p_note text)
  returns public.leads language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_uid   uuid := auth.uid();
  v_note  text;
  v_name  text;
  v_prev  public.leads;
  v_row   public.leads;
begin
  if v_uid is null or not public.is_admin() then
    raise exception 'leads: only an admin can release a lead' using errcode = '42501';
  end if;
  v_note := public.lead_clean_note(p_note, false);
  select * into v_prev from public.leads where id = p_lead for update;
  if not found then
    raise exception 'leads: no lead with that id' using errcode = 'P0002';
  end if;
  if v_prev.status = 'free' then
    raise exception 'leads: this lead is already free' using errcode = 'LD002';
  end if;
  v_name := public.lead_person_name(v_uid);
  update public.leads
     set status = 'free', holder = null, holder_name = null, taken_at = null,
         follow_up_note = null, follow_up_at = null,
         last_outcome = case when v_note is null then last_outcome else 'admin' end,
         last_note    = coalesce(v_note, last_note),
         last_by      = case when v_note is null then last_by else v_uid end,
         last_by_name = case when v_note is null then last_by_name else v_name end,
         last_at      = case when v_note is null then last_at else now() end,
         touched_at = now(), updated_at = now()
   where id = p_lead
  returning * into v_row;
  insert into public.lead_events (lead_id, kind, note, actor, actor_name, subject, subject_name)
    values (p_lead, 'released', v_note, v_uid, v_name, v_prev.holder, v_prev.holder_name);
  return v_row;
end $$;

-- REASIGNAR: darselo a una persona con el modulo, este donde este. NO mira el tope a proposito (es
-- una decision del admin); la persona, si queda por encima, no podra tomar otro hasta bajar de el.
create or replace function public.lead_admin_assign(p_lead uuid, p_user uuid, p_note text)
  returns public.leads language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_uid     uuid := auth.uid();
  v_note    text;
  v_name    text;
  v_target  text;
  v_row     public.leads;
begin
  if v_uid is null or not public.is_admin() then
    raise exception 'leads: only an admin can assign a lead' using errcode = '42501';
  end if;
  v_note := public.lead_clean_note(p_note, false);
  if not exists (select 1 from public.profiles
                  where id = p_user and (role = 'admin' or 'leads' = any(coalesce(module_access, '{}')))) then
    raise exception 'leads: that person does not have the Leads module' using errcode = '22023';
  end if;
  v_target := public.lead_person_name(p_user);
  v_name := public.lead_person_name(v_uid);
  update public.leads
     set status = 'taken', holder = p_user, holder_name = v_target, taken_at = now(), touched_at = now(),
         follow_up_note = null, follow_up_at = null, updated_at = now()
   where id = p_lead
  returning * into v_row;
  if not found then
    raise exception 'leads: no lead with that id' using errcode = 'P0002';
  end if;
  insert into public.lead_events (lead_id, kind, note, actor, actor_name, subject, subject_name)
    values (p_lead, 'assigned', v_note, v_uid, v_name, p_user, v_target);
  return v_row;
end $$;

-- ARCHIVAR: fuera del banco. No se borra nada; «liberar» lo devuelve.
create or replace function public.lead_admin_archive(p_lead uuid, p_note text)
  returns public.leads language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_uid   uuid := auth.uid();
  v_note  text;
  v_name  text;
  v_prev  public.leads;
  v_row   public.leads;
begin
  if v_uid is null or not public.is_admin() then
    raise exception 'leads: only an admin can archive a lead' using errcode = '42501';
  end if;
  v_note := public.lead_clean_note(p_note, false);
  select * into v_prev from public.leads where id = p_lead for update;
  if not found then
    raise exception 'leads: no lead with that id' using errcode = 'P0002';
  end if;
  v_name := public.lead_person_name(v_uid);
  update public.leads
     set status = 'archived', holder = null, holder_name = null, taken_at = null,
         follow_up_note = null, follow_up_at = null, touched_at = now(), updated_at = now()
   where id = p_lead
  returning * into v_row;
  insert into public.lead_events (lead_id, kind, note, actor, actor_name, subject, subject_name)
    values (p_lead, 'archived', v_note, v_uid, v_name, v_prev.holder, v_prev.holder_name);
  return v_row;
end $$;

-- EL TOPE. Bajarlo no le quita nada a nadie: quien quede por encima no toma otro hasta bajar.
create or replace function public.leads_set_cap(p_max integer)
  returns integer language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'leads: only an admin can change the limit' using errcode = '42501';
  end if;
  if p_max is null or p_max not between 1 and 100 then
    raise exception 'leads: the limit must be between 1 and 100' using errcode = '22023';
  end if;
  update public.lead_settings set max_open = p_max, updated_at = now(), updated_by = auth.uid() where id;
  return p_max;
end $$;

-- ---------------------------------------------------------------------------
-- 8. La carga del Excel.
-- ---------------------------------------------------------------------------
-- Cada elemento de p_rows es UNA fila de la hoja, con las cabeceras del Excel como claves, tal cual
-- (el guion no traduce nada: el mapa de columnas vive aqui y solo aqui). Las tres cabeceras con
-- acento van escritas con escapes para que este fichero siga siendo ASCII.
create or replace function public.lead_import_text(p_row jsonb, p_key text)
  returns text language sql immutable set search_path = public, pg_temp as $$
  select nullif(btrim(p_row ->> p_key), '');
$$;

create or replace function public.lead_import_num(p_row jsonb, p_key text)
  returns numeric language sql immutable set search_path = public, pg_temp as $$
  select case when x ~ '^-?[0-9]+(\.[0-9]+)?$' then x::numeric end
    from (select regexp_replace(coalesce(p_row ->> p_key, ''), '[$,[:space:]]', '', 'g') as x) s;
$$;

-- Una fecha llega como numero de serie de Excel (46281 = 2026-09-16) o como texto AAAA-MM-DD.
create or replace function public.lead_import_date(p_row jsonb, p_key text)
  returns date language sql immutable set search_path = public, pg_temp as $$
  select case
           when x ~ '^[0-9]{5}(\.[0-9]+)?$' then date '1899-12-30' + trunc(x::numeric)::integer
           when x ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' then to_date(substr(x, 1, 10), 'YYYY-MM-DD')
         end
    from (select btrim(coalesce(p_row ->> p_key, '')) as x) s;
$$;

-- Dedupe por TABS Project #. Un lead que ya esta se ACTUALIZA solo en sus datos del Excel: su estado,
-- su dueno, su etiqueta y su historial NO se tocan. Una fila sin TABS se salta y se cuenta.
create or replace function public.leads_import_rows(p_rows jsonb, p_actor uuid)
  returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_r         jsonb;
  v_tabs      text;
  v_pool      text;
  v_id        uuid;
  v_new       boolean;
  v_inserted  integer := 0;
  v_updated   integer := 0;
  v_skipped   integer := 0;
  v_name      text := case when p_actor is null then 'import script' else public.lead_person_name(p_actor) end;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'leads: the rows must be a JSON array' using errcode = '22023';
  end if;
  for v_r in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_r) <> 'object' then
      raise exception 'leads: every row must be a JSON object' using errcode = '22023';
    end if;
    v_tabs := upper(public.lead_import_text(v_r, 'TABS Project #'));
    if v_tabs is null then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    v_pool := public.lead_import_text(v_r, U&'Tienda RTG m\00E1s cercana');
    if v_pool is null or v_pool in ('-', U&'\2014', U&'\2013') then
      v_pool := 'No store';
    end if;
    insert into public.leads as l (
      tabs_project, pool, distance_miles, category, project_type, reason, county, registered_date,
      project_name, facility_name, type_of_work, scope_of_work, square_footage, estimated_cost,
      est_start_date, est_completion_date, permit_status, site_address, site_city, site_zip,
      owner_name, owner_phone, owner_contact, owner_mailing_address, owner_city_state_zip,
      tenant_name, tenant_phone, design_firm_name, design_firm_phone, design_firm_city,
      filing_contact, funds_type, tdlr_link
    ) values (
      v_tabs, v_pool,
      public.lead_import_num(v_r, 'Distancia aprox. (millas)'),
      public.lead_import_text(v_r, U&'Categor\00EDa'),
      public.lead_import_text(v_r, 'Tipo de proyecto'),
      public.lead_import_text(v_r, 'Motivo / nota'),
      public.lead_import_text(v_r, 'County'),
      public.lead_import_date(v_r, 'Registered Date'),
      public.lead_import_text(v_r, 'Project Name'),
      public.lead_import_text(v_r, 'Facility Name'),
      public.lead_import_text(v_r, 'Type of Work'),
      public.lead_import_text(v_r, 'Scope of Work'),
      public.lead_import_num(v_r, 'Square Footage'),
      public.lead_import_num(v_r, 'Estimated Cost'),
      public.lead_import_date(v_r, 'Est. Start Date'),
      public.lead_import_date(v_r, 'Est. Completion Date'),
      public.lead_import_text(v_r, 'Status'),
      public.lead_import_text(v_r, 'Site Address'),
      public.lead_import_text(v_r, 'Site City'),
      public.lead_import_text(v_r, 'Site ZIP'),
      public.lead_import_text(v_r, 'Owner Name'),
      public.lead_import_text(v_r, 'Owner Phone'),
      public.lead_import_text(v_r, 'Owner Contact Name'),
      public.lead_import_text(v_r, 'Owner Mailing Address'),
      public.lead_import_text(v_r, 'Owner City/State/ZIP'),
      public.lead_import_text(v_r, 'Tenant Name'),
      public.lead_import_text(v_r, 'Tenant Phone'),
      public.lead_import_text(v_r, 'Design Firm Name'),
      public.lead_import_text(v_r, 'Design Firm Phone'),
      public.lead_import_text(v_r, 'Design Firm City'),
      public.lead_import_text(v_r, 'Filing Contact Name'),
      public.lead_import_text(v_r, 'Type of Funds'),
      public.lead_import_text(v_r, 'TDLR Link')
    )
    on conflict (tabs_project) do update set
      pool = excluded.pool, distance_miles = excluded.distance_miles, category = excluded.category,
      project_type = excluded.project_type, reason = excluded.reason, county = excluded.county,
      registered_date = excluded.registered_date, project_name = excluded.project_name,
      facility_name = excluded.facility_name, type_of_work = excluded.type_of_work,
      scope_of_work = excluded.scope_of_work, square_footage = excluded.square_footage,
      estimated_cost = excluded.estimated_cost, est_start_date = excluded.est_start_date,
      est_completion_date = excluded.est_completion_date, permit_status = excluded.permit_status,
      site_address = excluded.site_address, site_city = excluded.site_city, site_zip = excluded.site_zip,
      owner_name = excluded.owner_name, owner_phone = excluded.owner_phone, owner_contact = excluded.owner_contact,
      owner_mailing_address = excluded.owner_mailing_address, owner_city_state_zip = excluded.owner_city_state_zip,
      tenant_name = excluded.tenant_name, tenant_phone = excluded.tenant_phone,
      design_firm_name = excluded.design_firm_name, design_firm_phone = excluded.design_firm_phone,
      design_firm_city = excluded.design_firm_city, filing_contact = excluded.filing_contact,
      funds_type = excluded.funds_type, tdlr_link = excluded.tdlr_link, updated_at = now()
    returning l.id, (l.xmax = 0) into v_id, v_new;
    if v_new then
      v_inserted := v_inserted + 1;
      insert into public.lead_events (lead_id, kind, actor, actor_name) values (v_id, 'imported', p_actor, v_name);
    else
      v_updated := v_updated + 1;
    end if;
  end loop;
  return jsonb_build_object(
    'inserted', v_inserted, 'updated', v_updated, 'skipped', v_skipped,
    'total', (select count(*) from public.leads),
    'by_pool', (select coalesce(jsonb_object_agg(pool, n), '{}'::jsonb)
                  from (select pool, count(*) as n from public.leads group by pool) p)
  );
end $$;

-- La puerta del admin a la carga (por si un dia se importa desde la pantalla).
create or replace function public.leads_import(p_rows jsonb)
  returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'leads: only an admin can import leads' using errcode = '42501';
  end if;
  return public.leads_import_rows(p_rows, auth.uid());
end $$;

-- Quien ejecuta que. Los default privileges dan EXECUTE a anon, authenticated y service_role en cada
-- funcion nueva: se quita todo y se concede lo justo.
revoke execute on function public.has_leads_access()                       from public, anon;
revoke execute on function public.lead_person_name(uuid)                   from public, anon, authenticated;
revoke execute on function public.lead_clean_note(text, boolean)           from public, anon, authenticated;
revoke execute on function public.lead_events_solo_anadir()                from public, anon, authenticated;
revoke execute on function public.lead_import_text(jsonb, text)            from public, anon, authenticated;
revoke execute on function public.lead_import_num(jsonb, text)             from public, anon, authenticated;
revoke execute on function public.lead_import_date(jsonb, text)            from public, anon, authenticated;
revoke execute on function public.leads_import_rows(jsonb, uuid)           from public, anon, authenticated;
revoke execute on function public.lead_take(uuid)                          from public, anon;
revoke execute on function public.lead_note(uuid, text)                    from public, anon;
revoke execute on function public.lead_close(uuid, text, text)             from public, anon;
revoke execute on function public.lead_admin_release(uuid, text)           from public, anon;
revoke execute on function public.lead_admin_assign(uuid, uuid, text)      from public, anon;
revoke execute on function public.lead_admin_archive(uuid, text)           from public, anon;
revoke execute on function public.leads_set_cap(integer)                   from public, anon;
revoke execute on function public.leads_import(jsonb)                      from public, anon;

grant execute on function public.has_leads_access()                        to authenticated;
grant execute on function public.lead_take(uuid)                           to authenticated;
grant execute on function public.lead_note(uuid, text)                     to authenticated;
grant execute on function public.lead_close(uuid, text, text)              to authenticated;
grant execute on function public.lead_admin_release(uuid, text)            to authenticated;
grant execute on function public.lead_admin_assign(uuid, uuid, text)       to authenticated;
grant execute on function public.lead_admin_archive(uuid, text)            to authenticated;
grant execute on function public.leads_set_cap(integer)                    to authenticated;
grant execute on function public.leads_import(jsonb)                       to authenticated;
grant execute on function public.leads_import_rows(jsonb, uuid)            to service_role;

-- ===========================================================================
-- Se comprueba a si misma
-- ===========================================================================
do $comprueba$
declare
  n    integer;
  col  text;
  tab  text;
  fn   text;
begin
  -- La restriccion acepta 'leads' y no perdio ninguna de las siete de la 155, ni recupero 'clockin'.
  foreach col in array array['deliveries', 'recruiting', 'timetracker', 'erp', 'promos', 'estimator', 'surveys', 'leads'] loop
    if not exists (select 1 from pg_constraint where conrelid = 'public.profiles'::regclass
                     and conname = 'profiles_module_access_known'
                     and pg_get_constraintdef(oid) like '%''' || col || '''%') then
      raise exception '162: profiles_module_access_known no acepta %', col;
    end if;
  end loop;
  if exists (select 1 from pg_constraint where conrelid = 'public.profiles'::regclass
               and conname = 'profiles_module_access_known'
               and pg_get_constraintdef(oid) like '%clockin%') then
    raise exception '162: profiles_module_access_known volvio a aceptar clockin';
  end if;

  -- Las tres tablas: RLS puesta, UNA politica y de SELECT mirando el modulo; anon nada;
  -- authenticated solo leer.
  foreach tab in array array['leads', 'lead_events', 'lead_settings'] loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || tab)::regclass) then
      raise exception '162: % sin RLS', tab;
    end if;
    select count(*) into n from pg_policies where schemaname = 'public' and tablename = tab;
    if n <> 1 then raise exception '162: % debe tener 1 politica, tiene %', tab, n; end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = tab
                     and cmd = 'SELECT' and qual ~ 'has_leads_access') then
      raise exception '162: la politica de % no es SELECT con has_leads_access', tab;
    end if;
    foreach col in array array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger'] loop
      if has_table_privilege('anon', 'public.' || tab, col) then
        raise exception '162: anon tiene % en %', col, tab;
      end if;
      if col <> 'select' and has_table_privilege('authenticated', 'public.' || tab, col) then
        raise exception '162: authenticated tiene % en %', col, tab;
      end if;
    end loop;
  end loop;

  -- anon no ejecuta ninguna; authenticated no ejecuta la carga interna.
  foreach fn in array array[
    'public.lead_take(uuid)', 'public.lead_note(uuid, text)', 'public.lead_close(uuid, text, text)',
    'public.lead_admin_release(uuid, text)', 'public.lead_admin_assign(uuid, uuid, text)',
    'public.lead_admin_archive(uuid, text)', 'public.leads_set_cap(integer)', 'public.leads_import(jsonb)',
    'public.leads_import_rows(jsonb, uuid)'
  ] loop
    if has_function_privilege('anon', fn, 'execute') then
      raise exception '162: anon puede ejecutar %', fn;
    end if;
  end loop;
  if has_function_privilege('authenticated', 'public.leads_import_rows(jsonb, uuid)', 'execute') then
    raise exception '162: authenticated puede ejecutar leads_import_rows';
  end if;

  -- El tope: una fila, y vale 10 si nadie lo ha cambiado.
  select count(*) into n from public.lead_settings;
  if n <> 1 then raise exception '162: lead_settings debe tener 1 fila, tiene %', n; end if;

  -- El modulo no se concede a nadie aqui.
  select count(*) into n from public.profiles where 'leads' = any(coalesce(module_access, '{}'));
  if n <> 0 then raise notice '162: % perfiles ya tenian el modulo leads (re-ejecucion)', n; end if;
end $comprueba$;

-- ===========================================================================
-- Ensayo por rol, con ROLLBACK: en el plan (docs/PLAN-162-leads.md, seccion 6). Aqui no va
-- ejecutable a proposito: cualquier sentencia de este fichero corre al aplicarlo.
-- ===========================================================================

-- ===========================================================================
-- Reversion (para pegar A MANO, en una transaccion propia; por eso lleva begin/commit y el fichero no)
-- ---------------------------------------------------------------------------
-- AVISO: los drop BORRAN los leads, su estado y su historial: de eso protege el pg_dump. Quitar la
-- palabra de los perfiles va ANTES que la restriccion, o la siguiente escritura del perfil de quien
-- la tenga falla.
--
--   begin;
--   update public.profiles set module_access = array_remove(module_access, 'leads')
--    where 'leads' = any (coalesce(module_access, '{}'));
--   drop function if exists public.leads_import(jsonb);
--   drop function if exists public.leads_import_rows(jsonb, uuid);
--   drop function if exists public.lead_import_date(jsonb, text);
--   drop function if exists public.lead_import_num(jsonb, text);
--   drop function if exists public.lead_import_text(jsonb, text);
--   drop function if exists public.leads_set_cap(integer);
--   drop function if exists public.lead_admin_archive(uuid, text);
--   drop function if exists public.lead_admin_assign(uuid, uuid, text);
--   drop function if exists public.lead_admin_release(uuid, text);
--   drop function if exists public.lead_close(uuid, text, text);
--   drop function if exists public.lead_note(uuid, text);
--   drop function if exists public.lead_take(uuid);
--   drop table    if exists public.lead_events;
--   drop table    if exists public.leads;
--   drop table    if exists public.lead_settings;
--   drop function if exists public.lead_events_solo_anadir();
--   drop function if exists public.lead_clean_note(text, boolean);
--   drop function if exists public.lead_person_name(uuid);
--   drop function if exists public.has_leads_access();
--   -- La restriccion EXACTAMENTE como la dejo la 155.
--   alter table public.profiles drop constraint if exists profiles_module_access_known;
--   alter table public.profiles add constraint profiles_module_access_known
--     check (module_access is null or module_access <@ array['deliveries','recruiting','timetracker','erp','promos','estimator','surveys'])
--     not valid;
--   delete from public.schema_migrations where name = '162_leads.sql';
--   commit;
-- La app no se rompe: sin las tablas, la pantalla dice que la 162 no esta aplicada.
-- ===========================================================================

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('162_leads.sql', '31b3ce06fa4a6f20942ef29e95b57c81aad02551b864308d466ebba30f3e8221') on conflict (name) do nothing;
