-- 225: Leads — un lead cruzado con un cliente de MI tienda lo veo y lo puedo tomar, aunque su pool sea otra tienda
-- (D-NEXT, 2026-11-01).
--
-- El dueño, con captura del STXP Pool como Melecio (Pharr) y un lead de Pharr cruzado con CANTU CONSTRUCTION (MCA): «in
-- this case you see a Pharr client matched with a McAllen client, so in this situation you can also show the McAllen
-- sales people this cliente, and do this throughout the stores».
--
-- Que habia: la fila se ve por su pool (163: el banco de tu tienda; 220: tus pools del STXP Pool) y por quien la tiene.
-- El cruce con Clientes (218, `customer_match_id`) no contaba para nada en quien la ve.
--
-- Que hace: `leads_cruce_en_mi_tienda(p_customer)`: ¿el cliente cruzado es de la tienda de quien pregunta? (el codigo de
-- la fila de erp.customers contra el nombre de tienda del perfil, por erp.customers_codigo_de_tienda, como la 217). Se
-- suma con OR a las dos ramas de "leads select" (GOV Pool y STXP Pool; en el STXP sigue haciendo falta la casilla) y
-- abre la excepcion LD005 de lead_take: ese lead tambien se toma. "lead_events select" pasa a mirar solo si se ve el
-- lead (la RLS de leads decide), en vez de repetir las condiciones.
--
-- Sin begin/commit propios. Para deshacer: volver a crear "leads select" y "lead_events select" como en la 220 y
-- lead_take como en la 220; drop function public.leads_cruce_en_mi_tienda(bigint); borrar la fila del registro.

create or replace function public.leads_cruce_en_mi_tienda(p_customer bigint)
  returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select p_customer is not null and exists (
    select 1 from erp.customers c
     where c.id = p_customer
       and upper(btrim(coalesce(c.store, ''))) <> ''
       and upper(btrim(coalesce(c.store, ''))) = erp.customers_codigo_de_tienda(public.leads_my_store())
  );
$$;
revoke execute on function public.leads_cruce_en_mi_tienda(bigint) from public, anon;
grant  execute on function public.leads_cruce_en_mi_tienda(bigint) to authenticated;

drop policy if exists "leads select" on public.leads;
create policy "leads select" on public.leads for select to authenticated
  using (
    (select public.has_leads_access())
    and (
      case when source = 'privado' then (
        (select public.leads_sees_private())
        and (
          (select public.is_admin())
          or holder = (select auth.uid())
          or pool = any(coalesce((select public.leads_private_pools()), array[]::text[]))
          or public.leads_cruce_en_mi_tienda(customer_match_id)
        )
      )
      else (
        (select public.leads_scope_all())
        or holder = (select auth.uid())
        or pool = (select public.leads_my_store())
        or public.leads_cruce_en_mi_tienda(customer_match_id)
      ) end
    )
  );

drop policy if exists "lead_events select" on public.lead_events;
create policy "lead_events select" on public.lead_events for select to authenticated
  using (
    (select public.has_leads_access())
    and exists (select 1 from public.leads l where l.id = lead_events.lead_id)
  );

create or replace function public.lead_take(p_lead uuid)
  returns public.leads language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid    uuid := auth.uid();
  v_cap    integer;
  v_open   integer;
  v_name   text;
  v_pool   text;
  v_source text;
  v_match  bigint;
  v_row    public.leads;
  v_prev   public.leads;
begin
  if v_uid is null or not public.has_leads_access() then
    raise exception 'leads: you do not have the Leads module' using errcode = '42501';
  end if;
  if p_lead is null then
    raise exception 'leads: lead id is required' using errcode = '22023';
  end if;
  select pool, source, customer_match_id into v_pool, v_source, v_match from public.leads where id = p_lead;
  if not found then
    raise exception 'leads: no lead with that id' using errcode = 'P0002';
  end if;
  if v_source = 'privado' then
    -- 220: del STXP Pool se toma lo que se alcanza: su tienda y, agotada, la más cercana (leads_private_pools).
    -- 225: y lo cruzado con un cliente de mi tienda.
    if not public.leads_sees_private() then
      raise exception 'leads: you cannot see the STXP Pool' using errcode = 'LD005';
    end if;
    if not public.is_admin()
       and not (v_pool = any(coalesce(public.leads_private_pools(), array[]::text[])))
       and not public.leads_cruce_en_mi_tienda(v_match) then
      raise exception 'leads: this lead belongs to another store' using errcode = 'LD005';
    end if;
  elsif not public.leads_scope_all() and v_pool is distinct from public.leads_my_store()
        and not public.leads_cruce_en_mi_tienda(v_match) then
    -- 163: solo se toma del banco que se alcanza; 225: o lo cruzado con un cliente de mi tienda.
    raise exception 'leads: this lead belongs to another store' using errcode = 'LD005';
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

-- ===========================================================================
-- Autocomprobacion (mira el catalogo)
-- ===========================================================================
do $chk$
declare def text;
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'leads_cruce_en_mi_tienda') then
    raise exception '225: falta leads_cruce_en_mi_tienda';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'leads' and policyname = 'leads select'
                   and qual ~ 'leads_cruce_en_mi_tienda' and qual ~ 'leads_private_pools' and qual ~ 'leads_my_store') then
    raise exception '225: "leads select" no mira el cruce (o perdio las reglas de la 163/220)';
  end if;
  def := pg_get_functiondef('public.lead_take(uuid)'::regprocedure);
  if position('leads_cruce_en_mi_tienda' in def) = 0 or position('LD005' in def) = 0 then
    raise exception '225: lead_take no abre la excepcion del cruce (o perdio LD005)';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'lead_events' and policyname = 'lead_events select') then
    raise exception '225: falta "lead_events select"';
  end if;
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum)
  values ('225_leads_cruzados_de_mi_tienda.sql', '0cca2d74306e970f34a61db62d632f2d42101df078a3ecf5387c33de76f42d34') on conflict (name) do nothing;
