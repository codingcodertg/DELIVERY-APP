-- 220: Leads — el «STXP Pool» (antes «Pool privado», 218) se abre por permiso y se reparte por tienda, con la tienda
-- más cercana cuando la propia se agota (D-770, 2026-10-30).
--
-- El dueño (2026-10-30): «create the permission for the employees to see the private pool»; «si la tienda se acaba todas
-- las leads de su tienda en la private pool, automáticamente podrán ver las leads de la tienda más cercana, y así
-- sucesivamente si ya tocaron todas las leads de la tienda de ellos»; «private pool to STXP Pool».
--
-- Qué hace:
--   1. `leads_sees_private()`: ¿ve el STXP Pool? El admin siempre; los demás, con 'leads_private_pool' en
--      `profiles.permissions` (la casilla «Ver el STXP Pool» de Usuarios › Leads).
--   2. `leads_private_order(tienda)`: la tienda y, detrás, las demás de la más cercana a la más lejana (orden fijo por
--      geografía del valle: Mission · McAllen · Pharr · Edinburg · Weslaco · Brownsville).
--   3. `leads_private_pools()`: los pools del STXP Pool que alcanza quien llama: su tienda y, mientras la anterior no tenga
--      ningún lead privado LIBRE, la siguiente más cercana (la primera que aún tiene libres cierra la lista). El admin, null
--      (= todos).
--   4. Las políticas de lectura de `leads` y `lead_events`: lo 'privado' lo lee quien ve el STXP Pool, y de él solo lo que
--      alcanza (sus pools, o lo que tiene a su nombre). Lo demás, como la 163/218.
--   5. `lead_take`: tomar un lead privado exige lo mismo (alcanzarlo por el STXP Pool); los del estado siguen con la 163.
--
-- Sin transacción propia (la pone quien aplica). Reversible: las políticas y `lead_take` vuelven a las de la 218/163 y se
-- borran las tres funciones.

-- 1. ¿Ve el STXP Pool?
create or replace function public.leads_sees_private()
  returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((
    select role = 'admin' or 'leads_private_pool' = any(coalesce(permissions, '{}'))
    from public.profiles where id = auth.uid()
  ), false);
$$;

-- 2. La tienda y sus vecinas, de la más cercana a la más lejana.
create or replace function public.leads_private_order(p_store text)
  returns text[] language sql immutable as $$
  select case p_store
    when 'RDZ Mission'     then array['RDZ Mission', 'RDZ McAllen', 'RDZ Pharr', 'RDZ Edinburg', 'RDZ Weslaco', 'RDZ Brownsville']
    when 'RDZ McAllen'     then array['RDZ McAllen', 'RDZ Pharr', 'RDZ Mission', 'RDZ Edinburg', 'RDZ Weslaco', 'RDZ Brownsville']
    when 'RDZ Pharr'       then array['RDZ Pharr', 'RDZ McAllen', 'RDZ Edinburg', 'RDZ Mission', 'RDZ Weslaco', 'RDZ Brownsville']
    when 'RDZ Edinburg'    then array['RDZ Edinburg', 'RDZ McAllen', 'RDZ Pharr', 'RDZ Mission', 'RDZ Weslaco', 'RDZ Brownsville']
    when 'RDZ Weslaco'     then array['RDZ Weslaco', 'RDZ Pharr', 'RDZ McAllen', 'RDZ Edinburg', 'RDZ Mission', 'RDZ Brownsville']
    when 'RDZ Brownsville' then array['RDZ Brownsville', 'RDZ Weslaco', 'RDZ Pharr', 'RDZ McAllen', 'RDZ Edinburg', 'RDZ Mission']
    else case when p_store is null or btrim(p_store) = '' then array[]::text[] else array[p_store] end
  end;
$$;

-- 3. Los pools del STXP Pool que alcanza quien llama. null = todos (admin).
create or replace function public.leads_private_pools()
  returns text[] language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_store text;
  v_out   text[] := '{}';
  p       text;
begin
  if (select public.is_admin()) then return null; end if;
  v_store := public.leads_my_store();
  foreach p in array public.leads_private_order(v_store) loop
    v_out := v_out || p;
    -- La primera tienda que aún tiene libres cierra la lista: las de detrás no se ven hasta que esta se agote.
    if exists (select 1 from public.leads where source = 'privado' and pool = p and status = 'free') then
      exit;
    end if;
  end loop;
  return v_out;
end $$;

-- 4. Lectura.
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
        )
      )
      else (
        (select public.leads_scope_all())
        or holder = (select auth.uid())
        or pool = (select public.leads_my_store())
      ) end
    )
  );

drop policy if exists "lead_events select" on public.lead_events;
create policy "lead_events select" on public.lead_events for select to authenticated
  using (
    (select public.has_leads_access())
    and exists (
      select 1 from public.leads l
       where l.id = lead_events.lead_id
         and (
           case when l.source = 'privado' then (
             (select public.leads_sees_private())
             and (
               (select public.is_admin())
               or l.holder = (select auth.uid())
               or l.pool = any(coalesce((select public.leads_private_pools()), array[]::text[]))
             )
           )
           else (
             (select public.leads_scope_all())
             or l.holder = (select auth.uid())
             or l.pool = (select public.leads_my_store())
           ) end
         )
    )
  );

-- 5. Tomar. Igual que la 163, con la regla del STXP Pool para lo privado.
create or replace function public.lead_take(p_lead uuid)
  returns public.leads language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_uid    uuid := auth.uid();
  v_cap    integer;
  v_open   integer;
  v_name   text;
  v_pool   text;
  v_source text;
  v_row    public.leads;
  v_prev   public.leads;
begin
  if v_uid is null or not public.has_leads_access() then
    raise exception 'leads: you do not have the Leads module' using errcode = '42501';
  end if;
  if p_lead is null then
    raise exception 'leads: lead id is required' using errcode = '22023';
  end if;
  select pool, source into v_pool, v_source from public.leads where id = p_lead;
  if not found then
    raise exception 'leads: no lead with that id' using errcode = 'P0002';
  end if;
  if v_source = 'privado' then
    -- 220: del STXP Pool se toma lo que se alcanza: su tienda y, agotada, la más cercana (leads_private_pools).
    if not public.leads_sees_private() then
      raise exception 'leads: you cannot see the STXP Pool' using errcode = 'LD005';
    end if;
    if not public.is_admin() and not (v_pool = any(coalesce(public.leads_private_pools(), array[]::text[]))) then
      raise exception 'leads: this lead belongs to another store' using errcode = 'LD005';
    end if;
  elsif not public.leads_scope_all() and v_pool is distinct from public.leads_my_store() then
    -- 163: solo se toma del banco que se alcanza.
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

-- Autocomprobación.
do $chk$
declare
  def text;
begin
  select pg_get_expr(polqual, polrelid) into def from pg_policy where polname = 'leads select' and polrelid = 'public.leads'::regclass;
  if def is null or position('leads_sees_private' in def) = 0 or position('leads_private_pools' in def) = 0 then
    raise exception '220: la politica de leads no mira el STXP Pool: %', def;
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'leads') <> 1 then
    raise exception '220: leads debe seguir con UNA politica (select)';
  end if;
  if position('leads_private_pools' in pg_get_functiondef('public.lead_take(uuid)'::regprocedure)) = 0 then
    raise exception '220: lead_take no mira el STXP Pool';
  end if;
  if (public.leads_private_order('RDZ McAllen'))[2] <> 'RDZ Pharr' or array_length(public.leads_private_order('RDZ Brownsville'), 1) <> 6 then
    raise exception '220: el orden de tiendas cercanas no es el esperado';
  end if;
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum)
  values ('220_leads_stxp_pool.sql', '89c8e15bc98f5c076e45e683ed8ba88c2a0ba60b6e22620b2d09353695c4b0b8') on conflict (name) do nothing;
