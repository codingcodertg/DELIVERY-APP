-- ===========================================================================
-- 328 - Leads por ETAPAS: nadie toma ni guarda un lead; su etapa es la de su última nota
-- ===========================================================================
-- Decidido en la reunión del dueño y su jefe (2026-11-18). Hasta hoy una persona TOMABA el lead (tope de 10), lo
-- cerraba con un resultado y lo liberaba. Ahora:
--   · Nadie toma ni tiene un lead. Quien lo VE (la misma regla de siempre: módulo, tienda, cruce con Clientes) anota.
--   · La única acción es la NOTA DE AVANCE, con una etapa: made_contact, no_answer, appointment, quote, negotiation,
--     closed (venta), lost (no se logró nada), bad_lead (no es buen lead). «new» es no tener ninguna.
--   · La etapa de un lead es la de su última nota CON etapa. Vive en `leads.follow_up_action` (253): esa columna ya
--     existe, ya tiene su restricción, su historial (`lead_events.action`) y su disparador. Se reusa, no se crea otra.
--   · `closed` deja el lead como `won` (venta), a nombre de quien la anotó (`leads_dueno` exige dueño en `won`).
--     Cualquier otra etapa lo deja `free` y sin dueño. Una nota SIN etapa no cambia ni la etapa ni el estado.
--   · Quién hizo el último contacto: `last_by`, `last_by_name`, `last_at` (162). Ya existen y ya los escribía la base.
--     Se reusan. `follow_up_at` (162) es la fecha de la última nota; tampoco se crea otra.
--   · `times_seen` y `last_seen_at`: en cuántas cargas (imports) ha aparecido el lead. Son nuevas.
--   · Un presupuesto creado desde un lead (175) anota solo la etapa «quote» («Quote #n») en el lead, a nombre de quien
--     lo guardó. Lo hace el disparador de `estimator_quotes`, en la misma transacción que guarda el presupuesto.
--
-- QUE TRAE:
--   1. leads.times_seen (entero, default 1, >= 1) y leads.last_seen_at (null = no se sabe; las cargas viejas no lo
--      registraron). La carga (`leads_import_rows`, más abajo) suma una vez por carga que vuelve a traer el lead.
--   2. Las restricciones de la etapa (leads.follow_up_action) y del historial (lead_events.action) aceptan 'bad_lead'.
--   3. leads_puede_ver_fila(lead): la MISMA regla que la política «leads select» (225). Si cambia una, cambia la otra.
--   4. leads_registra_nota(lead, quien, nota, etapa): el núcleo de la nota. Lo usan lead_note y el disparador de cotizaciones.
--   5. lead_note(uuid, text, text): REDEFINIDA. Ya no exige tener el lead; exige poder VERLO. Misma firma, mismos grants.
--   6. estimator_quotes: disparador AFTER INSERT que anota «Quote #n» en el lead cuando la cotización sale de uno (lead_id).
--   7. Conversión de los datos, una sola vez y sin borrar nada:
--        · tomado → libre, con su etapa; quien lo tenía queda como último contacto.
--        · en revisión → libre (la cola de revisión desaparece).
--        · libre con last_outcome bad_lead → etapa bad_lead; con nothing → etapa lost.
--        · venta (won) → etapa closed. Un tomado con etapa closed también pasa a won, a nombre de quien lo tenía.
--        · archivado: no se toca.
--   8. Historial de cotizaciones ya guardadas desde un lead: se añade la nota «Quote #n» (kind progress, action quote)
--      con la fecha de la cotización, SIN cambiar la etapa del lead. Así «Ever quoted» cuenta también lo de antes.
--   9. leads_import_rows (162) REDEFINIDA: igual, con dos columnas más. Un lead que ya estaba y vuelve en una carga
--      nueva suma 1 a times_seen (una vez por carga, aunque la misma carga traiga el lead dos veces).
--
-- LO QUE NO TOCA:
--   · lead_take, lead_close, lead_admin_release, lead_admin_assign, lead_admin_archive, leads_set_cap y lead_settings:
--     quedan como estaban (la pantalla deja de llamar a las que sobran). Sus grants tampoco cambian.
--   · Ninguna política (RLS): quién VE qué lead es el mismo.
--   · Ningún dato se borra. El historial solo se añade (la 162 lo impone con un disparador).
--
-- Sin begin/commit propios: quien aplica envuelve el fichero en una transacción.
-- Vuelta atrás: ver el final del fichero.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Columnas nuevas.
-- ---------------------------------------------------------------------------
alter table public.leads add column if not exists times_seen integer not null default 1;
alter table public.leads drop constraint if exists leads_times_seen;
alter table public.leads add constraint leads_times_seen check (times_seen >= 1);
alter table public.leads add column if not exists last_seen_at timestamptz;

-- ---------------------------------------------------------------------------
-- 2. La etapa y el historial aceptan bad_lead (el resto de la lista es la de la 253).
-- ---------------------------------------------------------------------------
alter table public.leads drop constraint if exists leads_follow_up_action;
alter table public.leads add constraint leads_follow_up_action check (
  follow_up_action is null or follow_up_action in
    ('made_contact', 'no_answer', 'appointment', 'quote', 'negotiation', 'closed', 'lost', 'bad_lead')
);

alter table public.lead_events drop constraint if exists lead_events_action;
alter table public.lead_events add constraint lead_events_action check (
  action is null or (kind = 'progress' and action in
    ('made_contact', 'no_answer', 'appointment', 'quote', 'negotiation', 'closed', 'lost', 'bad_lead'))
);

-- ---------------------------------------------------------------------------
-- 3. ¿Puede quien llama VER este lead? La misma regla que «leads select» (225). Definer: lo llaman las funciones de
--    abajo, que escriben como dueño y no pueden depender de la RLS del llamador.
-- ---------------------------------------------------------------------------
create or replace function public.leads_puede_ver_fila(p_lead uuid)
  returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.has_leads_access() and exists (
    select 1 from public.leads l
     where l.id = p_lead
       and (case when l.source = 'privado' then (
              (select public.leads_sees_private())
              and (
                (select public.is_admin())
                or l.holder = (select auth.uid())
                or l.pool = any(coalesce((select public.leads_private_pools()), array[]::text[]))
                or public.leads_cruce_en_mi_tienda(l.customer_match_id)
              )
            )
            else (
              (select public.leads_scope_all())
              or l.holder = (select auth.uid())
              or l.pool = (select public.leads_my_store())
              or public.leads_cruce_en_mi_tienda(l.customer_match_id)
            ) end)
  );
$$;

-- ---------------------------------------------------------------------------
-- 4. El núcleo de la nota. Sin comprobar permisos (lo hace quien llama): la nota, la etapa, quién y cuándo.
--    p_action null = nota sin etapa: no cambia la etapa, ni el estado, ni el dueño.
--    p_action 'closed' = venta: won, a nombre de p_uid. Cualquier otra etapa: free, sin dueño.
-- ---------------------------------------------------------------------------
create or replace function public.leads_registra_nota(p_lead uuid, p_uid uuid, p_note text, p_action text)
  returns public.leads language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_name text := public.lead_person_name(p_uid);
  v_row  public.leads;
begin
  update public.leads l
     set follow_up_note   = p_note,
         follow_up_action = coalesce(p_action, l.follow_up_action),
         follow_up_at     = now(),
         status           = case when p_action is null then l.status when p_action = 'closed' then 'won' else 'free' end,
         holder           = case when p_action is null then l.holder when p_action = 'closed' then p_uid else null end,
         holder_name      = case when p_action is null then l.holder_name when p_action = 'closed' then v_name else null end,
         taken_at         = case when p_action is null or p_action = 'closed' then l.taken_at else null end,
         last_by          = p_uid,
         last_by_name     = v_name,
         last_at          = now(),
         touched_at       = now(),
         updated_at       = now()
   where l.id = p_lead and l.status <> 'archived'
  returning * into v_row;
  if not found then
    raise exception 'leads: no lead with that id' using errcode = 'P0002';
  end if;
  insert into public.lead_events (lead_id, kind, note, action, actor, actor_name, subject, subject_name)
    values (p_lead, 'progress', p_note, p_action, p_uid, v_name, p_uid, v_name);
  return v_row;
end $$;

-- ---------------------------------------------------------------------------
-- 5. LA NOTA DE AVANCE (REDEFINIDA). Cualquiera que VE el lead puede anotar. Sin etapa, la nota es obligatoria (como
--    siempre); con etapa, puede ir vacía. Misma firma que la 253: la app vieja y la nueva la llaman igual.
-- ---------------------------------------------------------------------------
create or replace function public.lead_note(p_lead uuid, p_note text, p_action text)
  returns public.leads language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_uid    uuid := auth.uid();
  v_action text := nullif(btrim(coalesce(p_action, '')), '');
  v_note   text;
begin
  if v_uid is null or not public.has_leads_access() then
    raise exception 'leads: you do not have the Leads module' using errcode = '42501';
  end if;
  if v_action is not null and v_action not in
     ('made_contact', 'no_answer', 'appointment', 'quote', 'negotiation', 'closed', 'lost', 'bad_lead') then
    raise exception 'leads: unknown action type' using errcode = '22023';
  end if;
  v_note := public.lead_clean_note(p_note, v_action is null);
  -- Uno que no ve (o que no existe) se responde igual: no se dice si existe.
  if not public.leads_puede_ver_fila(p_lead) then
    raise exception 'leads: no lead with that id' using errcode = 'P0002';
  end if;
  -- Una venta cerrada es de quien la cerro: solo esa persona o un admin le cambia la etapa. Los demas pueden dejar nota.
  -- Se bloquea la fila antes de mirar: dos personas cerrando a la vez no se pisan la venta.
  perform 1 from public.leads l where l.id = p_lead for update;
  if v_action is not null and not public.is_admin() and exists (
       select 1 from public.leads l where l.id = p_lead and l.status = 'won' and l.holder is distinct from v_uid) then
    raise exception 'leads: this sale was closed by someone else' using errcode = '42501';
  end if;
  return public.leads_registra_nota(p_lead, v_uid, v_note, v_action);
end $$;

-- ---------------------------------------------------------------------------
-- 6. La cotización desde un lead anota «Quote #n». Si no puede (sin módulo, no lo ve, o está archivado), la cotización
--    se guarda igual y no se anota nada: el presupuesto no depende del lead.
-- ---------------------------------------------------------------------------
create or replace function public.leads_nota_de_cotizacion()
  returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
begin
  if new.lead_id is null or v_uid is null then return new; end if;
  if not public.leads_puede_ver_fila(new.lead_id) then return new; end if;
  if not exists (select 1 from public.leads where id = new.lead_id and status <> 'archived') then return new; end if;
  -- Una venta ya cerrada no se reabre por cotizar otra vez: la nota queda en el historial y la etapa sigue en Cerrado.
  perform public.leads_registra_nota(new.lead_id, v_uid, 'Quote #' || new.estimate_num,
    case when (select status from public.leads where id = new.lead_id) = 'won' then null else 'quote' end);
  return new;
end $$;

drop trigger if exists estimator_quotes_nota_de_lead on public.estimator_quotes;
create trigger estimator_quotes_nota_de_lead after insert on public.estimator_quotes
  for each row when (new.lead_id is not null) execute function public.leads_nota_de_cotizacion();

-- ---------------------------------------------------------------------------
-- 7. Conversión de los datos. Un solo paso y en orden: primero se anota quién hizo el último contacto (de los tomados),
--    luego la etapa, luego los estados. Nada se borra.
-- ---------------------------------------------------------------------------
-- 7a. Tomados: quien lo tenía queda como último contacto.
update public.leads
   set last_by = holder,
       last_by_name = coalesce(holder_name, last_by_name),
       last_at = coalesce(touched_at, taken_at, last_at, now())
 where status = 'taken' and holder is not null;

-- 7b. La fecha de la etapa (follow_up_at) ANTES de la etapa: el disparador de 253 borra la etapa si no hay fecha.
--     La fecha que se pone es la del último movimiento del lead; no es la de una nota que no existe.
update public.leads
   set follow_up_at = coalesce(last_at, touched_at, taken_at, now())
 where status <> 'archived' and follow_up_at is null
   and (status = 'won' or follow_up_action is not null or last_outcome in ('bad_lead', 'nothing'));

-- 7c. La etapa: venta → closed; si no, la de su última nota; si no hay, lo que dejó el último cierre.
update public.leads
   set follow_up_action = case
         when status = 'won' then 'closed'
         when follow_up_action is not null then follow_up_action
         when last_outcome = 'bad_lead' then 'bad_lead'
         when last_outcome = 'nothing' then 'lost'
       end
 where status <> 'archived'
   and (status = 'won' or follow_up_action is not null or last_outcome in ('bad_lead', 'nothing'));

-- 7d. Un tomado con etapa closed es una venta: won, a nombre de quien lo tenía (leads_dueno exige dueño).
update public.leads set status = 'won'
 where status = 'taken' and follow_up_action = 'closed' and holder is not null;

-- 7e. Lo que queda tomado o en revisión vuelve libre y sin dueño (la etapa se queda como está).
update public.leads
   set status = 'free', holder = null, holder_name = null, taken_at = null
 where status in ('taken', 'review');

-- ---------------------------------------------------------------------------
-- 8. Cotizaciones que ya salieron de un lead: su nota «Quote #n» en el historial (sin cambiar la etapa del lead).
-- ---------------------------------------------------------------------------
insert into public.lead_events (lead_id, kind, note, action, actor, actor_name, subject, subject_name, at)
select q.lead_id, 'progress', 'Quote #' || q.estimate_num, 'quote', q.owner_id,
       public.lead_person_name(q.owner_id), q.owner_id, public.lead_person_name(q.owner_id), q.created_at
  from public.estimator_quotes q
  join public.leads l on l.id = q.lead_id
 where q.lead_id is not null
   and not exists (
     select 1 from public.lead_events e
      where e.lead_id = q.lead_id and e.action = 'quote' and e.note = 'Quote #' || q.estimate_num
   );

-- ---------------------------------------------------------------------------
-- 9. La carga de leads (REDEFINIDA: cuerpo de la 162 + times_seen / last_seen_at). El guion la llama igual.
-- ---------------------------------------------------------------------------
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
      filing_contact, funds_type, tdlr_link, last_seen_at
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
      public.lead_import_text(v_r, 'TDLR Link'),
      now()
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
      funds_type = excluded.funds_type, tdlr_link = excluded.tdlr_link, updated_at = now(),
      times_seen = case when l.last_seen_at is distinct from now() then l.times_seen + 1 else l.times_seen end, last_seen_at = now()
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

-- ---------------------------------------------------------------------------
-- 10. Permisos. Las funciones nuevas que no son para la pantalla no las ejecuta nadie con sesión. lead_note conserva
--     sus grants (create or replace no los toca; aquí se repiten para que se vea).
-- ---------------------------------------------------------------------------
revoke execute on function public.leads_puede_ver_fila(uuid)                      from public, anon, authenticated;
revoke execute on function public.leads_registra_nota(uuid, uuid, text, text)     from public, anon, authenticated;
revoke execute on function public.leads_nota_de_cotizacion()                      from public, anon, authenticated;
revoke execute on function public.lead_note(uuid, text, text)                     from public, anon;
grant  execute on function public.lead_note(uuid, text, text)                     to authenticated;

-- ---------------------------------------------------------------------------
-- 11. Comprobaciones: si algo no cuadra, la transacción se deshace entera.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from public.leads where status in ('taken', 'review')) then
    raise exception '328: quedan leads tomados o en revisión';
  end if;
  if exists (select 1 from public.leads where status = 'won' and (holder is null or follow_up_action is distinct from 'closed')) then
    raise exception '328: hay ventas sin dueño o sin etapa closed';
  end if;
  if exists (select 1 from public.leads where status = 'free' and holder is not null) then
    raise exception '328: hay leads libres con dueño';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'leads_follow_up_action' and pg_get_constraintdef(oid) like '%bad_lead%') then
    raise exception '328: la etapa no acepta bad_lead';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'estimator_quotes_nota_de_lead' and not tgisinternal) then
    raise exception '328: falta el disparador de cotizaciones';
  end if;
end $$;

notify pgrst, 'reload schema';

-- Vuelta atrás: volver a crear lead_note(uuid, text, text) y leads_import_rows(jsonb, uuid) con el cuerpo de la 253 y la
-- 162; drop trigger estimator_quotes_nota_de_lead; drop function leads_nota_de_cotizacion(), leads_registra_nota(...) y
-- leads_puede_ver_fila(uuid); restaurar las restricciones sin 'bad_lead'; drop column times_seen, last_seen_at.
-- Los datos convertidos (etapas, estados) no se devuelven solos: no hay copia de la forma anterior.

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('328_leads_etapas.sql', '406bbe88a803331d4c2b36356980a0142c80574c3d372bb4def83df493c65293') on conflict (name) do nothing;
