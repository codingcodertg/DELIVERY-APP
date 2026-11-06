-- 253: la nota de avance de un lead lleva un TIPO DE ACCION (ayuda e207d9ef, Roberto).
--
-- «Progress note to include an action type as well as the note: Made Contact, Didn't Answer, Had Appointment,
-- Made Quote, Under Negotiation, Closed, Lost». Con tipo, el texto de la nota pasa a ser opcional.
--
--   1. leads.follow_up_action: el tipo de la ULTIMA nota de avance (para pintarla y filtrar la lista por ella).
--   2. lead_events.action: el tipo de cada nota en el historial. Solo en kind = 'progress'.
--      Las notas viejas quedan sin tipo (null): se siguen viendo igual.
--   3. lead_note(uuid, text, text): la nueva. Sin tipo, la nota sigue siendo obligatoria (como antes);
--      con tipo, la nota puede ir vacia. lead_note(uuid, text) queda y llama a la nueva sin tipo, para la app vieja.
--   4. lead_take y los cierres/liberaciones ya ponen follow_up_note/at a null; follow_up_action se limpia con un
--      disparador cuando follow_up_at queda en null, para no reescribir esas funciones.
--
-- Vuelta atras: drop function public.lead_note(uuid, text, text); restaurar lead_note(uuid, text) de la 162;
-- drop trigger leads_limpia_accion; alter table ... drop column follow_up_action / action.
-- Sin begin/commit propios: quien aplica envuelve el fichero en una transaccion.

alter table public.leads add column if not exists follow_up_action text;
alter table public.leads drop constraint if exists leads_follow_up_action;
alter table public.leads add constraint leads_follow_up_action check (
  follow_up_action is null or follow_up_action in
    ('made_contact', 'no_answer', 'appointment', 'quote', 'negotiation', 'closed', 'lost')
);

alter table public.lead_events add column if not exists action text;
alter table public.lead_events drop constraint if exists lead_events_action;
alter table public.lead_events add constraint lead_events_action check (
  action is null or (kind = 'progress' and action in
    ('made_contact', 'no_answer', 'appointment', 'quote', 'negotiation', 'closed', 'lost'))
);

create index if not exists leads_follow_up_action_idx on public.leads (follow_up_action) where follow_up_action is not null;

-- Si follow_up_at queda en null (tomar, cerrar, liberar, asignar, archivar), el tipo se va con el.
create or replace function public.leads_limpia_accion()
  returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.follow_up_at is null then new.follow_up_action := null; end if;
  return new;
end $$;
drop trigger if exists leads_limpia_accion on public.leads;
create trigger leads_limpia_accion before insert or update on public.leads
  for each row execute function public.leads_limpia_accion();

create or replace function public.lead_note(p_lead uuid, p_note text, p_action text)
  returns public.leads language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_uid    uuid := auth.uid();
  v_note   text;
  v_action text := nullif(btrim(coalesce(p_action, '')), '');
  v_name   text;
  v_row    public.leads;
begin
  if v_uid is null or not public.has_leads_access() then
    raise exception 'leads: you do not have the Leads module' using errcode = '42501';
  end if;
  if v_action is not null and v_action not in
     ('made_contact', 'no_answer', 'appointment', 'quote', 'negotiation', 'closed', 'lost') then
    raise exception 'leads: unknown action type' using errcode = '22023';
  end if;
  -- Sin tipo, la nota es obligatoria (como siempre); con tipo, puede ir vacia.
  v_note := public.lead_clean_note(p_note, v_action is null);
  update public.leads
     set follow_up_note = v_note, follow_up_action = v_action, follow_up_at = now(), touched_at = now(), updated_at = now()
   where id = p_lead and status = 'taken' and holder = v_uid
  returning * into v_row;
  if not found then
    raise exception 'leads: this lead is not open in your pool' using errcode = 'LD004';
  end if;
  v_name := public.lead_person_name(v_uid);
  insert into public.lead_events (lead_id, kind, note, action, actor, actor_name, subject, subject_name)
    values (p_lead, 'progress', v_note, v_action, v_uid, v_name, v_uid, v_name);
  return v_row;
end $$;

-- La de dos argumentos (la app que aun no se actualizo): la misma, sin tipo.
create or replace function public.lead_note(p_lead uuid, p_note text)
  returns public.leads language sql volatile security definer set search_path = public, pg_temp as $$
  select public.lead_note(p_lead, p_note, null::text);
$$;

revoke execute on function public.leads_limpia_accion()         from public, anon, authenticated;
revoke execute on function public.lead_note(uuid, text, text)   from public, anon;
revoke execute on function public.lead_note(uuid, text)         from public, anon;
grant execute on function public.lead_note(uuid, text, text)    to authenticated;
grant execute on function public.lead_note(uuid, text)          to authenticated;

notify pgrst, 'reload schema';

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('253_leads_tipo_de_accion.sql', '4fc758074ead74299b7c9508a081a1c4cc8ba59e352b3aec29d8316209f70a71') on conflict (name) do nothing;
