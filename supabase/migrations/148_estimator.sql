-- ===========================================================================
-- 148 - El Estimador (Quote Builder): cotizaciones guardadas, una por estimado, y la aprobacion
--       del vendedor que es dueno del estimado
-- ===========================================================================
-- Plan en papel: docs/PLAN-148-estimator.md. ESCRITA Y NO APLICADA: aplicarla es del orquestador,
-- despues del merge, con respaldo hecho y migrate-status antes y despues.
--
-- El dueno (2026-09-27) pidio "una estimator app asi como la de promo" a partir de su documento
-- "Estimate print outs app copy": un Quote Builder interno que produce una hoja PARA EL CLIENTE. La
-- pantalla (src/app/estimator) funciona SIN esta migracion - arma e imprime - pero no guarda. Lo que
-- esta migracion anade es lo que exige la politica del documento y no se puede hacer sin base:
--   "One quote only."  "Do not create competing quotes. Search the estimate number first. If another
--    sales representative owns the estimate, obtain their approval before proceeding."
--
-- QUE TRAE:
--   0. 'estimator' en profiles_module_access_known (la ULTIMA definicion es la 140, no la 095 ni la
--      088: se parte de su cuerpo y se anade una palabra).
--   1. has_estimator_access() y cuatro helpers definer.
--   2. public.estimator_quotes: una fila por estimado (indice unico sobre lower(btrim(estimate_num))).
--   3. public.estimator_approvals: la peticion de un vendedor al dueno del estimado.
--   4. Dos disparadores que ponen con auth.uid() lo que el navegador no debe decidir: el dueno, quien
--      preparo, la tienda y quien aprueba.
--   5. RLS una politica por comando, ninguna FOR ALL, ninguna de DELETE.
--   6. Dos funciones de lectura (buscar un estimado, las aprobaciones que me piden) que no devuelven
--      NINGUN dato del cliente.
--
-- LO QUE NO TOCA: ninguna tabla existente salvo la restriccion de profiles de la seccion 0. Ningun
-- dato: no hay UPDATE ni INSERT sobre filas que ya esten.
--
-- Sin begin/commit propios, a proposito: quien aplica envuelve el fichero en una transaccion, y un
-- commit de dentro cerraria la de fuera (paso con la 124).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 0. La restriccion que prohibe la palabra. LO UNICO QUE TOCA ALGO EXISTENTE.
-- ---------------------------------------------------------------------------
-- La 140 la dejo en: check (module_access is null or module_access <@
--   array['deliveries','recruiting','timetracker','erp','promos']) not valid
-- Sin anadir 'estimator', conceder el modulo desde Usuarios revienta contra ella y el modulo solo lo
-- veria el admin. Se conserva `not valid` por la razon de la 095: las filas viejas no se re-examinan;
-- las altas y los cambios si.
alter table public.profiles drop constraint if exists profiles_module_access_known;
alter table public.profiles add constraint profiles_module_access_known
  check (module_access is null or module_access <@ array['deliveries','recruiting','timetracker','erp','promos','estimator'])
  not valid;

-- ---------------------------------------------------------------------------
-- 1. Helpers. Mismo idioma que has_promos_access() (140).
-- ---------------------------------------------------------------------------
create or replace function public.has_estimator_access()
  returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select role = 'admin' or 'estimator' = any(coalesce(module_access, '{}'))
    from public.profiles where id = auth.uid()
  ), false);
$$;

-- La tienda de quien pregunta. profiles.store solo la cambia un admin (guard_profile_privileged_columns,
-- 099/104/131): sin ese guardia, un vendedor se pondria otra tienda y leeria sus cotizaciones.
create or replace function public.estimator_my_store()
  returns text language sql stable security definer set search_path = public as $$
  select nullif(trim(store), '') from public.profiles where id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- 2. Las cotizaciones. Una por estimado.
-- ---------------------------------------------------------------------------
create table if not exists public.estimator_quotes (
  id              uuid primary key default gen_random_uuid(),
  estimate_num    text not null,
  -- El vendedor original: quien la creo. Solo un admin lo cambia (disparador). Nullable solo para
  -- que borrar a una persona no quede bloqueado por sus cotizaciones: sin dueno, solo el admin edita.
  owner_id        uuid references public.profiles(id) on delete set null,
  -- "Prepared by": quien la guardo por ultima vez. Lo pone el disparador.
  prepared_by     uuid references public.profiles(id) on delete set null,
  -- La tienda del dueno al crearla: decide quien mas la ve (los de su tienda).
  store           text,
  sales_ext       text,
  -- INTERNO. Nombre completo, empresa, telefono, direccion: nada de esto se imprime.
  customer        jsonb not null default '{}'::jsonb,
  -- INTERNO. Modo, direccion de entrega y cargo: el cargo no entra en el total.
  delivery        jsonb not null default '{}'::jsonb,
  lines           jsonb not null default '[]'::jsonb,
  display_level   text not null default 'standard',
  valid_through   date,
  project_summary text,
  policy_ack_at   timestamptz,
  printed_at      timestamptz,
  print_count     integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint estimator_quotes_num_no_vacio check (length(btrim(estimate_num)) between 1 and 40),
  constraint estimator_quotes_level check (display_level in ('basic', 'standard', 'detailed')),
  constraint estimator_quotes_lines_array check (jsonb_typeof(lines) = 'array'),
  constraint estimator_quotes_customer_obj check (jsonb_typeof(customer) = 'object'),
  constraint estimator_quotes_delivery_obj check (jsonb_typeof(delivery) = 'object'),
  constraint estimator_quotes_print_count check (print_count >= 0)
);

-- "One quote only" / "no competing quotes", dicho por la base: dos vendedores no pueden tener cada
-- uno su cotizacion del mismo estimado. Sin mayusculas ni espacios que los separen.
create unique index if not exists estimator_quotes_one_per_estimate
  on public.estimator_quotes (lower(btrim(estimate_num)));
create index if not exists estimator_quotes_owner_idx on public.estimator_quotes (owner_id);
create index if not exists estimator_quotes_store_idx on public.estimator_quotes (store);

-- ---------------------------------------------------------------------------
-- 3. Las aprobaciones: el vendedor B pide al dueno A trabajar sobre su estimado.
-- ---------------------------------------------------------------------------
create table if not exists public.estimator_approvals (
  id            uuid primary key default gen_random_uuid(),
  quote_id      uuid not null references public.estimator_quotes(id) on delete cascade,
  requested_by  uuid not null references public.profiles(id) on delete cascade,
  status        text not null default 'pending',
  requested_at  timestamptz not null default now(),
  decided_by    uuid references public.profiles(id) on delete set null,
  decided_at    timestamptz,
  constraint estimator_approvals_status check (status in ('pending', 'approved', 'denied')),
  constraint estimator_approvals_una_por_persona unique (quote_id, requested_by)
);

-- (Aqui y no con los otros helpers: una funcion `language sql` se valida al crearla, y estas leen las
-- dos tablas de arriba.)
-- Definer para que las politicas de una tabla no lean la otra a traves de SU RLS: quotes mira
-- approvals y approvals mira quotes, y con politicas que se consultan entre si Postgres puede dar
-- "infinite recursion detected in policy".
create or replace function public.estimator_is_quote_owner(p_quote uuid)
  returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.estimator_quotes where id = p_quote and owner_id = auth.uid());
$$;

create or replace function public.estimator_has_approval(p_quote uuid)
  returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.estimator_approvals
                  where quote_id = p_quote and requested_by = auth.uid() and status = 'approved');
$$;

-- ---------------------------------------------------------------------------
-- 4. Los disparadores: lo que no decide el navegador.
-- ---------------------------------------------------------------------------
-- Con auth.uid() nulo (service-role, postgres) no se reescribe nada salvo updated_at: es quien
-- repara a mano, y el disparador no debe pelearse con el.
create or replace function public.estimator_quotes_guard()
  returns trigger language plpgsql security definer set search_path = public as $$
declare
  yo uuid := auth.uid();
begin
  if yo is null then
    new.updated_at := now();
    return new;
  end if;
  if tg_op = 'INSERT' then
    -- El dueno es quien la crea. Un admin puede crearla a nombre de otro vendedor.
    if not public.is_admin() or new.owner_id is null then
      new.owner_id := yo;
    end if;
    new.prepared_by := yo;
    new.store := (select nullif(trim(store), '') from public.profiles where id = new.owner_id);
    new.print_count := 0;
    new.created_at := now();
  else
    if not public.is_admin() then
      if new.owner_id is distinct from old.owner_id then
        raise exception 'Only an admin can change who owns an estimate' using errcode = '42501';
      end if;
      if lower(btrim(new.estimate_num)) is distinct from lower(btrim(old.estimate_num)) then
        raise exception 'The estimate number of a saved quote cannot change' using errcode = '42501';
      end if;
    end if;
    new.store := case when new.owner_id is distinct from old.owner_id
                      then (select nullif(trim(store), '') from public.profiles where id = new.owner_id)
                      else old.store end;
    new.prepared_by := yo;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists estimator_quotes_guard on public.estimator_quotes;
create trigger estimator_quotes_guard before insert or update on public.estimator_quotes
  for each row execute function public.estimator_quotes_guard();

-- Pedir: siempre 'pending', a mi nombre, y no a mi mismo. Decidir: solo el dueno del estimado o un
-- admin, y queda quien y cuando. El que pidio solo puede volver a pedir (denied -> pending).
create or replace function public.estimator_approvals_guard()
  returns trigger language plpgsql security definer set search_path = public as $$
declare
  yo uuid := auth.uid();
  decide boolean;
begin
  if yo is null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.requested_by := yo;
    new.status := 'pending';
    new.requested_at := now();
    new.decided_by := null;
    new.decided_at := null;
    if public.estimator_is_quote_owner(new.quote_id) then
      raise exception 'You already own this estimate' using errcode = '22023';
    end if;
    return new;
  end if;
  if new.quote_id is distinct from old.quote_id or new.requested_by is distinct from old.requested_by then
    raise exception 'An approval request cannot be moved' using errcode = '42501';
  end if;
  decide := public.is_admin() or public.estimator_is_quote_owner(old.quote_id);
  if decide then
    if new.status is distinct from old.status then
      new.decided_by := yo;
      new.decided_at := now();
    end if;
  else
    -- Solo quien pidio llega aqui (la politica de UPDATE no deja a nadie mas), y solo a volver a pedir.
    if new.status <> 'pending' then
      raise exception 'Only the estimate owner can approve or deny' using errcode = '42501';
    end if;
    new.requested_at := now();
    new.decided_by := null;
    new.decided_at := null;
  end if;
  return new;
end $$;

drop trigger if exists estimator_approvals_guard on public.estimator_approvals;
create trigger estimator_approvals_guard before insert or update on public.estimator_approvals
  for each row execute function public.estimator_approvals_guard();

-- ---------------------------------------------------------------------------
-- 5. Privilegios y RLS. Una tabla nueva nace con todo concedido a anon y authenticated (medido al
--    ensayar la 126): se revoca y se concede lo justo. Sin DELETE: una cotizacion es historial.
-- ---------------------------------------------------------------------------
revoke all on public.estimator_quotes    from anon, authenticated;
revoke all on public.estimator_approvals from anon, authenticated;
grant select, insert, update on public.estimator_quotes    to authenticated;
grant select, insert, update on public.estimator_approvals to authenticated;

alter table public.estimator_quotes    enable row level security;
alter table public.estimator_approvals enable row level security;

drop policy if exists "estimator_quotes select"    on public.estimator_quotes;
drop policy if exists "estimator_quotes insert"    on public.estimator_quotes;
drop policy if exists "estimator_quotes update"    on public.estimator_quotes;
drop policy if exists "estimator_approvals select" on public.estimator_approvals;
drop policy if exists "estimator_approvals insert" on public.estimator_approvals;
drop policy if exists "estimator_approvals update" on public.estimator_approvals;

-- Ver: las mias, las de mi tienda, las que me aprobaron, y el admin todas.
create policy "estimator_quotes select" on public.estimator_quotes for select to authenticated
  using (
    (select public.has_estimator_access())
    and (
      (select public.is_admin())
      or owner_id = (select auth.uid())
      or (store is not null and store = (select public.estimator_my_store()))
      or public.estimator_has_approval(id)
    )
  );

-- Crear: cualquiera con el modulo; el disparador pone el dueno ANTES de que se mire esto.
create policy "estimator_quotes insert" on public.estimator_quotes for insert to authenticated
  with check (
    (select public.has_estimator_access())
    and ((select public.is_admin()) or owner_id = (select auth.uid()))
  );

-- Editar: el dueno, el admin, o quien tenga la aprobacion del dueno. Ver la de un companero de
-- tienda NO da para editarla: para eso esta la aprobacion.
create policy "estimator_quotes update" on public.estimator_quotes for update to authenticated
  using (
    (select public.has_estimator_access())
    and ((select public.is_admin()) or owner_id = (select auth.uid()) or public.estimator_has_approval(id))
  )
  with check (
    (select public.has_estimator_access())
    and ((select public.is_admin()) or owner_id = (select auth.uid()) or public.estimator_has_approval(id))
  );

create policy "estimator_approvals select" on public.estimator_approvals for select to authenticated
  using (
    (select public.has_estimator_access())
    and (requested_by = (select auth.uid()) or (select public.is_admin()) or public.estimator_is_quote_owner(quote_id))
  );

create policy "estimator_approvals insert" on public.estimator_approvals for insert to authenticated
  with check (
    (select public.has_estimator_access())
    and requested_by = (select auth.uid())
  );

create policy "estimator_approvals update" on public.estimator_approvals for update to authenticated
  using (
    (select public.has_estimator_access())
    and (requested_by = (select auth.uid()) or (select public.is_admin()) or public.estimator_is_quote_owner(quote_id))
  )
  with check (
    (select public.has_estimator_access())
    and (requested_by = (select auth.uid()) or (select public.is_admin()) or public.estimator_is_quote_owner(quote_id))
  );

-- ---------------------------------------------------------------------------
-- 6. Las dos lecturas que cruzan tiendas. NINGUNA devuelve datos del cliente.
-- ---------------------------------------------------------------------------
-- Buscar un estimado: "Search the estimate number first". Un vendedor de otra tienda no ve la fila
-- (RLS), pero tiene que poder saber QUE existe y DE QUIEN es, o crearia justo la cotizacion que
-- compite. Devuelve el dueno, su tienda y el estado de MI peticion; nada del cliente ni de las lineas.
create or replace function public.estimator_find_estimate(p_num text)
  returns table (quote_id uuid, estimate_num text, owner_id uuid, owner_name text, owner_store text,
                 my_approval_id uuid, my_approval text)
  language sql stable security definer set search_path = public as $$
  select q.id, q.estimate_num, q.owner_id, p.full_name, q.store, a.id, a.status
    from public.estimator_quotes q
    left join public.profiles p on p.id = q.owner_id
    left join public.estimator_approvals a on a.quote_id = q.id and a.requested_by = auth.uid()
   where public.has_estimator_access()
     and lower(btrim(q.estimate_num)) = lower(btrim(p_num))
   limit 1;
$$;

-- Las peticiones pendientes que me toca decidir (las de mis estimados; el admin, todas), con el
-- nombre de quien pide. Definer porque leer el nombre de otro perfil depende de la RLS de profiles.
create or replace function public.estimator_pending_approvals()
  returns table (approval_id uuid, quote_id uuid, estimate_num text, requester_name text, requested_at timestamptz)
  language sql stable security definer set search_path = public as $$
  select a.id, q.id, q.estimate_num, p.full_name, a.requested_at
    from public.estimator_approvals a
    join public.estimator_quotes q on q.id = a.quote_id
    left join public.profiles p on p.id = a.requested_by
   where public.has_estimator_access()
     and a.status = 'pending'
     and (public.is_admin() or q.owner_id = auth.uid())
   order by a.requested_at;
$$;

revoke execute on function public.has_estimator_access()             from public, anon;
revoke execute on function public.estimator_my_store()                from public, anon;
revoke execute on function public.estimator_is_quote_owner(uuid)      from public, anon;
revoke execute on function public.estimator_has_approval(uuid)        from public, anon;
revoke execute on function public.estimator_find_estimate(text)       from public, anon;
revoke execute on function public.estimator_pending_approvals()       from public, anon;
grant execute on function public.has_estimator_access()               to authenticated;
grant execute on function public.estimator_my_store()                 to authenticated;
grant execute on function public.estimator_is_quote_owner(uuid)       to authenticated;
grant execute on function public.estimator_has_approval(uuid)         to authenticated;
grant execute on function public.estimator_find_estimate(text)        to authenticated;
grant execute on function public.estimator_pending_approvals()        to authenticated;

-- ===========================================================================
-- Se comprueba a si misma
-- ===========================================================================
do $comprueba$
declare
  n   int;
  col text;
begin
  -- La restriccion acepta 'estimator' y no perdio ninguna de las cinco de la 140, ni recupero 'clockin'.
  foreach col in array array['deliveries', 'recruiting', 'timetracker', 'erp', 'promos', 'estimator'] loop
    if not exists (select 1 from pg_constraint where conrelid = 'public.profiles'::regclass
                     and conname = 'profiles_module_access_known'
                     and pg_get_constraintdef(oid) like '%''' || col || '''%') then
      raise exception '148: profiles_module_access_known no acepta %', col;
    end if;
  end loop;
  if exists (select 1 from pg_constraint where conrelid = 'public.profiles'::regclass
               and conname = 'profiles_module_access_known'
               and pg_get_constraintdef(oid) like '%clockin%') then
    raise exception '148: profiles_module_access_known volvio a aceptar clockin';
  end if;

  -- Una cotizacion por estimado.
  if not exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'estimator_quotes'
                   and indexname = 'estimator_quotes_one_per_estimate' and indexdef like 'CREATE UNIQUE INDEX%') then
    raise exception '148: falta el indice unico por estimado';
  end if;

  -- Nadie borra, y anon no toca nada.
  foreach col in array array['estimator_quotes', 'estimator_approvals'] loop
    if has_table_privilege('authenticated', 'public.' || col, 'delete') then
      raise exception '148: authenticated no debe poder borrar en %', col;
    end if;
    if has_table_privilege('anon', 'public.' || col, 'select') then
      raise exception '148: anon no debe leer %', col;
    end if;
    if not (select relrowsecurity from pg_class where oid = ('public.' || col)::regclass) then
      raise exception '148: % sin RLS', col;
    end if;
  end loop;

  -- Tres politicas por tabla, ninguna ALL ni DELETE, y todas mirando el modulo.
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'estimator_quotes';
  if n <> 3 then raise exception '148: estimator_quotes debe tener 3 politicas, tiene %', n; end if;
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'estimator_approvals';
  if n <> 3 then raise exception '148: estimator_approvals debe tener 3 politicas, tiene %', n; end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename like 'estimator\_%'
              and cmd in ('ALL', 'DELETE')) then
    raise exception '148: una politica del estimador es ALL o DELETE';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename like 'estimator\_%'
              and coalesce(qual, '') || coalesce(with_check, '') !~ 'has_estimator_access') then
    raise exception '148: una politica del estimador no mira has_estimator_access';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename like 'estimator\_%'
              and cmd = 'UPDATE' and with_check is null) then
    raise exception '148: una politica de UPDATE del estimador no tiene with check';
  end if;

  -- Los dos disparadores, colgados.
  if not exists (select 1 from pg_trigger where tgrelid = 'public.estimator_quotes'::regclass
                   and tgname = 'estimator_quotes_guard' and not tgisinternal) then
    raise exception '148: falta el disparador estimator_quotes_guard';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.estimator_approvals'::regclass
                   and tgname = 'estimator_approvals_guard' and not tgisinternal) then
    raise exception '148: falta el disparador estimator_approvals_guard';
  end if;
end $comprueba$;

-- ===========================================================================
-- Ensayo por rol, con ROLLBACK: en el plan (docs/PLAN-148-estimator.md, seccion 6). Aqui no va
-- ejecutable a proposito: cualquier sentencia de este fichero corre al aplicarlo.
-- ===========================================================================

-- ===========================================================================
-- Reversion (para pegar A MANO, en una transaccion propia; por eso lleva begin/commit y el fichero no)
-- ---------------------------------------------------------------------------
-- AVISO: dar marcha atras a la restriccion FALLA en la siguiente escritura del perfil de quien ya
-- tenga 'estimator' concedido; por eso el paso 1 se lo quita ANTES. Y el drop BORRA las cotizaciones
-- guardadas: de eso protege el pg_dump.
--
--   begin;
--   update public.profiles set module_access = array_remove(module_access, 'estimator')
--    where 'estimator' = any (coalesce(module_access, '{}'));
--   drop table    if exists public.estimator_approvals;
--   drop table    if exists public.estimator_quotes;
--   drop function if exists public.estimator_pending_approvals();
--   drop function if exists public.estimator_find_estimate(text);
--   drop function if exists public.estimator_approvals_guard();
--   drop function if exists public.estimator_quotes_guard();
--   drop function if exists public.estimator_has_approval(uuid);
--   drop function if exists public.estimator_is_quote_owner(uuid);
--   drop function if exists public.estimator_my_store();
--   drop function if exists public.has_estimator_access();
--   -- La restriccion EXACTAMENTE como la dejo la 140.
--   alter table public.profiles drop constraint if exists profiles_module_access_known;
--   alter table public.profiles add constraint profiles_module_access_known
--     check (module_access is null or module_access <@ array['deliveries','recruiting','timetracker','erp','promos'])
--     not valid;
--   delete from public.schema_migrations where name = '148_estimator.sql';
--   commit;
-- La app no se rompe: sin la tabla, la pantalla arma e imprime y dice que no guarda.
-- ===========================================================================

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('148_estimator.sql', '5bdee6183c98747183e2d7a5e1081c25794611788068850b0a396b135c2e84ed') on conflict (name) do nothing;
