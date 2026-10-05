-- ===========================================================================
-- 163 - Leads por tienda: cada quien ve y toma solo los leads del banco de SU tienda (y los que tiene
--       a su nombre); el admin, todos; y un permiso por persona, solo para el rol manager, que deja
--       ver los de las otras tiendas
-- ===========================================================================
-- ESCRITA Y NO APLICADA: aplicarla es del orquestador, despues del merge, con la aprobacion del
-- dueno (es un cambio de RLS), respaldo hecho y migrate-status antes y despues.
--
-- El dueno (2026-10-04): «solo el manager puede ver leads de otras tiendas configurable en user
-- permisions, pero sales solo puede ver su tienda».
--
-- COMO ESTABA (162): quien tiene el modulo 'leads' lee TODAS las filas de leads y de lead_events, de
-- todas las tiendas, y puede tomar cualquier lead libre.
--
-- COMO QUEDA:
--   * admin: todo, siempre. No depende de ningun permiso.
--   * manager CON el permiso 'leads_all_stores' en profiles.permissions: todo.
--   * cualquier otro con el modulo (sales, accounting, logistics, y el manager SIN el permiso): solo
--     los leads cuyo pool = su profiles.store, mas los que tiene a su nombre (holder = el), sean del
--     pool que sean (p. ej. uno que le asigno un admin). Sin tienda y sin permiso: solo los suyos.
--   * el permiso NO surte efecto en ningun otro rol: un vendedor con la palabra en su lista (escrita
--     a mano, o que le quedo de cuando era manager) sigue viendo solo su tienda.
--   * el pool 'No store' (leads sin tienda cercana) no es de ninguna tienda: solo lo alcanza quien
--     ve todas.
--
-- QUE TRAE:
--   1. leads_scope_all(), leads_my_store(): las dos preguntas de la regla, una vez por consulta.
--   2. leads_my_scope(): lo mismo en un jsonb {"all","store"}, para que la pantalla le PREGUNTE a la
--      base que alcanza quien mira en vez de recalcularlo. Mientras esta funcion no exista, la
--      pantalla se comporta como con la 162 (el codigo llega antes que la migracion).
--   3. Las politicas "leads select" y "lead_events select", reescritas con la regla. La de
--      lead_settings (el tope) NO se toca.
--   4. lead_take: el cuerpo de la 162 mas UNA comprobacion (el lead es de un banco que alcanzas), con
--      codigo propio LD005. lead_note y lead_close NO se tocan: ya exigen holder = quien llama. Las
--      del admin tampoco: is_admin() y el admin lo alcanza todo.
--   5. UN CAMBIO DE DATOS: a cada perfil con role = 'manager' se le anade 'leads_all_stores' a
--      permissions. Hoy todos los managers lo ven todo y el dueno dice que el manager si puede: el
--      interruptor nace ENCENDIDO para los que hay, y el admin lo apaga persona por persona en
--      Usuarios. Un manager dado de alta DESPUES de esta migracion nace sin el: se le marca a mano.
--      (Medido en produccion el 2026-10-04, solo lectura: 6 managers, los 6 con el modulo.)
--
-- LO QUE NO TOCA: ninguna tabla ni columna (profiles.permissions existe desde la 052 y no tiene
-- restriccion de valores), ningun lead, ningun evento, ningun grant de tabla. guard_profile_privileged_columns
-- ya deja escribir permissions solo a un admin.
--
-- Sin begin/commit propios, a proposito: quien aplica envuelve el fichero en una transaccion.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Las dos preguntas. Definer: leen el perfil de quien llama sin depender de la RLS de profiles.
-- ---------------------------------------------------------------------------
-- ¿Alcanza los leads de todas las tiendas? admin siempre; manager solo con el permiso.
create or replace function public.leads_scope_all()
  returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((
    select role = 'admin'
        or (role = 'manager' and 'leads_all_stores' = any(coalesce(permissions, '{}')))
    from public.profiles where id = auth.uid()
  ), false);
$$;

-- Su tienda. Una tienda en blanco no es una tienda (null no iguala a ningun pool).
create or replace function public.leads_my_store()
  returns text language sql stable security definer set search_path = public, pg_temp as $$
  select nullif(btrim(store), '') from public.profiles where id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- 2. Lo que la pantalla pregunta. Sin el modulo: nada.
-- ---------------------------------------------------------------------------
create or replace function public.leads_my_scope()
  returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select case when public.has_leads_access()
    then jsonb_build_object('all', public.leads_scope_all(), 'store', public.leads_my_store())
    else jsonb_build_object('all', false, 'store', null)
  end;
$$;

revoke execute on function public.leads_scope_all() from public, anon;
revoke execute on function public.leads_my_store()  from public, anon;
revoke execute on function public.leads_my_scope()  from public, anon;
-- authenticated las ejecuta: las dos primeras corren dentro de la politica, con los privilegios de quien consulta.
grant execute on function public.leads_scope_all() to authenticated;
grant execute on function public.leads_my_store()  to authenticated;
grant execute on function public.leads_my_scope()  to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Las politicas. Siguen siendo UNA por tabla y de SELECT.
-- ---------------------------------------------------------------------------
drop policy if exists "leads select" on public.leads;
create policy "leads select" on public.leads for select to authenticated
  using (
    (select public.has_leads_access())
    and (
      (select public.leads_scope_all())
      or holder = (select auth.uid())
      or pool = (select public.leads_my_store())
    )
  );

-- El historial de un lead lo lee quien puede leer ese lead. Ni mas ni menos.
drop policy if exists "lead_events select" on public.lead_events;
create policy "lead_events select" on public.lead_events for select to authenticated
  using (
    (select public.has_leads_access())
    and (
      (select public.leads_scope_all())
      or exists (
        select 1 from public.leads l
         where l.id = lead_events.lead_id
           and (l.holder = (select auth.uid()) or l.pool = (select public.leads_my_store()))
      )
    )
  );

-- ---------------------------------------------------------------------------
-- 4. TOMAR, con la tienda. Cuerpo de la 162 (su definicion vigente) mas el bloque marcado.
--    Codigo nuevo: LD005 el lead es del banco de otra tienda.
-- ---------------------------------------------------------------------------
create or replace function public.lead_take(p_lead uuid)
  returns public.leads language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_uid   uuid := auth.uid();
  v_cap   integer;
  v_open  integer;
  v_name  text;
  v_pool  text;
  v_row   public.leads;
  v_prev  public.leads;
begin
  if v_uid is null or not public.has_leads_access() then
    raise exception 'leads: you do not have the Leads module' using errcode = '42501';
  end if;
  if p_lead is null then
    raise exception 'leads: lead id is required' using errcode = '22023';
  end if;
  -- 163: solo se toma del banco que se alcanza. Va ANTES del tope y del candado: es un «no puedes»,
  -- no un «ahora no». El pool de un lead solo lo cambia una carga del Excel, no hay carrera que mirar.
  select pool into v_pool from public.leads where id = p_lead;
  if not found then
    raise exception 'leads: no lead with that id' using errcode = 'P0002';
  end if;
  if not public.leads_scope_all() and v_pool is distinct from public.leads_my_store() then
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

-- create or replace conserva los privilegios; se repiten por si alguien la borro y la recrea.
revoke execute on function public.lead_take(uuid) from public, anon;
grant execute on function public.lead_take(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. El interruptor nace ENCENDIDO para los managers que hay. Corre como postgres (sin auth.uid()):
--    guard_profile_privileged_columns lo deja pasar. Volver a ejecutarlo no duplica la palabra.
-- ---------------------------------------------------------------------------
update public.profiles
   set permissions = array_append(coalesce(permissions, '{}'), 'leads_all_stores')
 where role = 'manager'
   and not ('leads_all_stores' = any(coalesce(permissions, '{}')));

-- ===========================================================================
-- Se comprueba a si misma
-- ===========================================================================
do $comprueba$
declare
  n    integer;
  tab  text;
  fn   text;
begin
  -- Sigue habiendo UNA politica por tabla, de SELECT; las dos de leads miran el modulo Y la tienda.
  foreach tab in array array['leads', 'lead_events', 'lead_settings'] loop
    select count(*) into n from pg_policies where schemaname = 'public' and tablename = tab;
    if n <> 1 then raise exception '163: % debe tener 1 politica, tiene %', tab, n; end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = tab
                     and cmd = 'SELECT' and qual ~ 'has_leads_access') then
      raise exception '163: la politica de % no es SELECT con has_leads_access', tab;
    end if;
  end loop;
  foreach tab in array array['leads', 'lead_events'] loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = tab
                     and qual ~ 'leads_scope_all' and qual ~ 'leads_my_store' and qual ~ 'holder') then
      raise exception '163: la politica de % no mira la tienda', tab;
    end if;
  end loop;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'lead_settings'
               and qual ~ 'leads_scope_all') then
    raise exception '163: la politica del tope no debia cambiar';
  end if;

  -- anon no ejecuta ninguna; authenticated si.
  foreach fn in array array['public.leads_scope_all()', 'public.leads_my_store()', 'public.leads_my_scope()', 'public.lead_take(uuid)'] loop
    if has_function_privilege('anon', fn, 'execute') then
      raise exception '163: anon puede ejecutar %', fn;
    end if;
    if not has_function_privilege('authenticated', fn, 'execute') then
      raise exception '163: authenticated no puede ejecutar %', fn;
    end if;
  end loop;

  -- lead_take lleva la comprobacion nueva.
  if position('LD005' in pg_get_functiondef('public.lead_take(uuid)'::regprocedure)) = 0 then
    raise exception '163: lead_take no comprueba la tienda';
  end if;

  -- Todos los managers quedaron con el permiso, y nadie mas lo recibio de esta migracion.
  select count(*) into n from public.profiles
   where role = 'manager' and not ('leads_all_stores' = any(coalesce(permissions, '{}')));
  if n <> 0 then raise exception '163: % managers sin el permiso', n; end if;
  select count(*) into n from public.profiles
   where role <> 'manager' and 'leads_all_stores' = any(coalesce(permissions, '{}'));
  if n <> 0 then raise notice '163: % perfiles que no son manager tienen la palabra (no les surte efecto)', n; end if;
end $comprueba$;

-- ===========================================================================
-- Ensayo por rol, con ROLLBACK: scripts/leads/ensayo-163.mjs (lo corre el orquestador antes de
-- aplicar; no deja nada). Aqui no va ejecutable a proposito: cualquier sentencia de este fichero
-- corre al aplicarlo.
-- ===========================================================================

-- ===========================================================================
-- Reversion (para pegar A MANO, en una transaccion propia; por eso lleva begin/commit y el fichero no)
-- ---------------------------------------------------------------------------
-- Deja las politicas y lead_take EXACTAMENTE como las dejo la 162. No borra ningun lead ni evento.
-- La palabra en profiles.permissions puede quedarse (sin las funciones no significa nada), pero se
-- quita para no dejar basura; OJO: eso borra tambien lo que un admin haya apagado o encendido a mano.
--
--   begin;
--   drop policy if exists "leads select" on public.leads;
--   create policy "leads select" on public.leads for select to authenticated
--     using ((select public.has_leads_access()));
--   drop policy if exists "lead_events select" on public.lead_events;
--   create policy "lead_events select" on public.lead_events for select to authenticated
--     using ((select public.has_leads_access()));
--   create or replace function public.lead_take(p_lead uuid)
--     returns public.leads language plpgsql volatile security definer set search_path = public, pg_temp as $fn$
--   declare
--     v_uid   uuid := auth.uid();
--     v_cap   integer;
--     v_open  integer;
--     v_name  text;
--     v_row   public.leads;
--     v_prev  public.leads;
--   begin
--     if v_uid is null or not public.has_leads_access() then
--       raise exception 'leads: you do not have the Leads module' using errcode = '42501';
--     end if;
--     if p_lead is null then
--       raise exception 'leads: lead id is required' using errcode = '22023';
--     end if;
--     perform pg_advisory_xact_lock(hashtextextended('leads:take:' || v_uid::text, 0));
--     select max_open into v_cap from public.lead_settings where id;
--     v_cap := coalesce(v_cap, 10);
--     select count(*) into v_open from public.leads where holder = v_uid and status = 'taken';
--     if v_open >= v_cap then
--       raise exception 'leads: your pool is full (% of %). Close a lead with its result to take another.', v_open, v_cap
--         using errcode = 'LD001';
--     end if;
--     v_name := public.lead_person_name(v_uid);
--     update public.leads
--        set status = 'taken', holder = v_uid, holder_name = v_name, taken_at = now(), touched_at = now(),
--            follow_up_note = null, follow_up_at = null, updated_at = now()
--      where id = p_lead and status = 'free'
--     returning * into v_row;
--     if not found then
--       select * into v_prev from public.leads where id = p_lead;
--       if not found then
--         raise exception 'leads: no lead with that id' using errcode = 'P0002';
--       end if;
--       raise exception 'leads: this lead is not free (%, %)', v_prev.status, coalesce(v_prev.holder_name, 'nobody')
--         using errcode = 'LD002';
--     end if;
--     insert into public.lead_events (lead_id, kind, actor, actor_name, subject, subject_name)
--       values (p_lead, 'taken', v_uid, v_name, v_uid, v_name);
--     return v_row;
--   end $fn$;
--   drop function if exists public.leads_my_scope();
--   drop function if exists public.leads_my_store();
--   drop function if exists public.leads_scope_all();
--   update public.profiles set permissions = array_remove(permissions, 'leads_all_stores')
--    where 'leads_all_stores' = any (coalesce(permissions, '{}'));
--   delete from public.schema_migrations where name = '163_leads_por_tienda.sql';
--   commit;
-- La app no se rompe: sin leads_my_scope() la pantalla vuelve a comportarse como con la 162.
-- ===========================================================================

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('163_leads_por_tienda.sql', 'f07267f2e7debe6bd334b949721743d9ff3b9ef9f5b76d64342a8a5d7cc51aa8') on conflict (name) do nothing;
