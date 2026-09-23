-- ===========================================================================
-- 140 - RTG PROMOS, fase 1: las cuatro tablas, los seis helpers y el costo cerrado
-- ===========================================================================
-- Plan: docs/PLAN-140-promos.md. Leelo antes de tocar nada de aqui: esta migracion es la
-- mitad de ese documento, y la otra mitad (por que NO se usa una vista definer, por que el
-- grupo de tiendas es un dato y no codigo, y la matriz de pruebas por rol) no cabe en un .sql.
--
-- QUE HACE: monta el modulo de promociones en la base. Un Excel subido es una RONDA; sus
-- productos, sus sugerencias por grupo de tiendas y las decisiones (aprobar/rechazar/nota) son
-- las otras tres tablas. Las rondas viejas no se pisan: son historia.
--
-- LO QUE NO HACE: ninguna pantalla, ningun registro del modulo en MODULES/module_access, ningun
-- cambio de version. Y NO MODIFICA NI UNA SOLA COSA EXISTENTE - ni una politica, ni un guard, ni
-- una columna, ni el esquema de settings. Solo crea. Por eso su reversion es un drop y por eso
-- el respaldo protege del drop, no del alta (plan, seccion 9).
--
-- LA PARTE DELICADA, EN UNA LINEA: un vendedor no puede recibir el costo. Eso no lo decide la
-- pantalla ni una politica de fila: lo decide el PRIVILEGIO DE COLUMNA. Un vendedor que pida
-- promo_products?select=cost recibe "permission denied for column cost", no un null amable. Es el
-- hallazgo A-2d del ERP (docs/PLAN-A-2d-erp-role-cost.md) aplicado a una tabla que nace limpia.
--
-- POR QUE NO UNA VISTA DEFINER: se salta la RLS de fila de la tabla, o sea que el filtro de fila
-- habria que duplicarlo dentro de la vista y mantener dos copias. Y va contra la 068, que existe
-- justo porque las vistas del ERP nacieron sin security_invoker. promo_catalog nace con el.
--
-- Sin begin/commit: una migracion no lleva su propia transaccion.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Los helpers. Mismo idioma que has_deliveries_access() (083) e is_admin() (099).
-- ---------------------------------------------------------------------------

-- La puerta del modulo. Calcada de has_deliveries_access(): admin, o el modulo concedido.
-- module_access es text[] sin restriccion de valores, asi que 'promos' no necesita DDL.
create or replace function public.has_promos_access()
  returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select role = 'admin' or 'promos' = any(coalesce(module_access, '{}'))
    from public.profiles where id = auth.uid()
  ), false);
$$;

-- El grupo de quien pregunta. Su tienda (profiles.store, que es el NOMBRE de una tienda de
-- settings.stores) buscada en settings.stores, de donde sale su promo_group.
--
-- DE QUE DEPENDE QUE ESTO SEA SEGURIDAD Y NO DECORACION: profiles.store ya esta guardada -
-- solo un admin la cambia (guard_profile_privileged_columns, 099/104/131). Sin ese guardia, un
-- vendedor se pondria otra tienda en su propia fila y leeria las aprobaciones de otro grupo.
-- Es el mismo argumento que hace la 131 con visible_stores.
--
-- Null si no tiene tienda, si la tienda ya no existe, o si no tiene grupo. NULL ES EL VALOR
-- SEGURO: sin grupo no se ve nada y no se decide nada. El dia que se aplique esto, ninguna
-- tienda tiene promo_group todavia, asi que solo el admin decide hasta que el los reparta.
create or replace function public.promo_group_of_user()
  returns text language sql stable security definer set search_path = public as $$
  select nullif(trim(s->>'promo_group'), '')
    from public.settings cfg
    cross join lateral jsonb_array_elements(coalesce(cfg.stores, '[]'::jsonb)) as s
   where cfg.id = 1
     and lower(trim(s->>'name')) = lower(trim((select store from public.profiles where id = auth.uid())))
   limit 1;
$$;

-- Quien DECIDE: el admin en cualquier grupo; gerente de oficina (manager) y oficina (accounting)
-- en el suyo. Los dos roles los nombro el dueno. 'sales' no esta, y por eso un vendedor no aprueba.
create or replace function public.promo_is_decider()
  returns boolean language sql stable security definer set search_path = public as $$
  select public.has_promos_access() and (
    public.is_admin()
    or (public.current_user_role() in ('manager', 'accounting')
        and public.promo_group_of_user() is not null)
  );
$$;

-- Quien ve las CINCO columnas privadas (notes, demand, months_of_stock, cost, diff; son las
-- columnas E,G,H,O,Q que el dueno escribio en la hoja Sheet6 del Excel).
--
-- Hoy devuelve el mismo conjunto que promo_is_decider(), y aun asi se escribe aparte a proposito:
-- "puede aprobar" y "puede ver el costo" son DOS hechos, y el dia que uno cambie no debe arrastrar
-- al otro. Es exactamente la leccion de A-2d, donde "ve costo" viajaba pegado a "es gerente de
-- Entregas" solo porque nadie los habia separado.
create or replace function public.promo_can_see_private()
  returns boolean language sql stable security definer set search_path = public as $$
  select public.has_promos_access()
     and (public.is_admin() or public.current_user_role() in ('manager', 'accounting'));
$$;

-- LOS GRUPOS QUE ALGUIEN VE. Aqui, y solo aqui, vive la pregunta abierta del plan (seccion 0):
-- el dueno escribio "REPS: FILTER BY STORE", que se lee como "ven varias y filtran", y la decision
-- que se trae es "solo la suya". Como esta escrito ahora: el suyo y ninguno mas.
-- Si el dueno contesta lo otro, cambia el ELSE de esta funcion y NI UNA TABLA NI UNA POLITICA.
create or replace function public.promo_visible_groups()
  returns text[] language sql stable security definer set search_path = public as $$
  select case
    when not public.has_promos_access() then '{}'::text[]
    when public.is_admin() then array(
      select distinct nullif(trim(s->>'promo_group'), '')
        from public.settings cfg
        cross join lateral jsonb_array_elements(coalesce(cfg.stores, '[]'::jsonb)) as s
       where cfg.id = 1 and nullif(trim(s->>'promo_group'), '') is not null)
    when public.promo_group_of_user() is null then '{}'::text[]
    else array[public.promo_group_of_user()]
  end;
$$;

-- El grant explicito, en vez de confiar en los privilegios por defecto del proyecto: revocar de
-- public quita la concesion implicita, y que authenticated conserve la suya depende de un
-- ALTER DEFAULT PRIVILEGES que no se puede comprobar desde una rama. Se pone y se acaba la duda.
revoke execute on function public.has_promos_access()      from public, anon;
revoke execute on function public.promo_group_of_user()    from public, anon;
revoke execute on function public.promo_is_decider()       from public, anon;
revoke execute on function public.promo_can_see_private()  from public, anon;
revoke execute on function public.promo_visible_groups()   from public, anon;
grant execute on function public.has_promos_access()       to authenticated;
grant execute on function public.promo_group_of_user()     to authenticated;
grant execute on function public.promo_is_decider()        to authenticated;
grant execute on function public.promo_can_see_private()   to authenticated;
grant execute on function public.promo_visible_groups()    to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Las cuatro tablas
-- ---------------------------------------------------------------------------

-- Una ronda = un Excel subido. Las viejas se quedan; nada las pisa.
create table if not exists public.promo_rounds (
  id           uuid primary key default gen_random_uuid(),
  label        text not null,                 -- lo que el admin escribe: "9.25.26 Promo"
  source_name  text,                          -- el nombre del fichero, para poder rastrearlo
  uploaded_by  uuid references public.profiles(id) on delete set null,
  uploaded_at  timestamptz not null default now(),
  -- Preparado para "esta ronda ya no se decide". NINGUNA POLITICA LO MIRA TODAVIA: es la
  -- pregunta abierta 2 del plan. Ponerlo en marcha es un "and closed_at is null" en las dos
  -- politicas de escritura de decisiones, no una migracion de datos.
  closed_at    timestamptz,
  constraint promo_rounds_label_no_vacia check (length(trim(label)) between 1 and 120)
);

-- Los productos de esa ronda. LA TABLA DELICADA: aqui vive el costo.
create table if not exists public.promo_products (
  round_id        uuid not null references public.promo_rounds(id) on delete cascade,
  -- El codigo del Excel TAL CUAL viene, recortado solo por los lados. Medido en el libro real:
  -- 'FMPGC' y 'FMPGC 3.5GAL' son dos productos distintos, asi que normalizar los espacios
  -- interiores los fundiria en uno.
  code            text not null,
  supplier        text,
  size            text,
  description     text,
  -- --- las cinco privadas (E,G,H,O,Q de la hoja Sheet6) ---
  notes           text,
  demand          numeric,
  months_of_stock numeric,
  cost            numeric,
  diff            numeric,
  -- --- las publicas ---
  qoh             numeric,
  -- Las seis existencias por tienda van en UN jsonb y no en seis columnas: los codigos de
  -- columna son del libro, no del esquema. Una columna por tienda obligaria a una migracion
  -- cada vez que abra o cierre una tienda.
  qoh_by_store    jsonb not null default '{}'::jsonb,
  price           numeric,
  -- De que hoja salio: la general o la de los que no estan en ella.
  source_sheet    text not null,
  row_no          integer,
  primary key (round_id, code),
  constraint promo_products_code_no_vacio check (length(trim(code)) between 1 and 80),
  -- Un producto de la hoja "other" puede no traer costo NI precio (medido: ocho de nueve sin
  -- precio, cinco con el costo como cadena vacia). Por eso las dos son nullable: guardar un
  -- cero seria inventar un dato.
  constraint promo_products_qoh_by_store_es_objeto check (jsonb_typeof(qoh_by_store) = 'object')
);

-- Que productos sugeria la hoja de cada grupo. Es informacion del Excel que si no se guarda se
-- pierde: el dueno decidio que cada tienda ve TODOS los productos, no solo los de su hoja, asi
-- que esta tabla no filtra nada - solo recuerda que sugeria el libro.
create table if not exists public.promo_suggestions (
  round_id   uuid not null references public.promo_rounds(id) on delete cascade,
  code       text not null,
  group_code text not null,
  primary key (round_id, code, group_code),
  constraint promo_suggestions_grupo_no_vacio check (length(trim(group_code)) between 1 and 40)
);

-- Una decision por (ronda, producto, grupo de tiendas). Lo unico que el navegador escribe.
create table if not exists public.promo_decisions (
  round_id    uuid not null references public.promo_rounds(id) on delete cascade,
  code        text not null,
  group_code  text not null,
  status      text not null default 'pending',
  note        text,
  decided_by  uuid references public.profiles(id) on delete set null,
  decided_at  timestamptz not null default now(),
  primary key (round_id, code, group_code),
  constraint promo_decisions_status check (status in ('pending', 'approved', 'rejected')),
  constraint promo_decisions_grupo_no_vacio check (length(trim(group_code)) between 1 and 40),
  -- La nota es libre pero no es un cajon: el ejemplo del dueno es "DISCONTINUED ITEM".
  constraint promo_decisions_nota_tamano check (note is null or length(note) <= 500)
);

create index if not exists promo_products_round_idx    on public.promo_products (round_id);
create index if not exists promo_suggestions_round_idx on public.promo_suggestions (round_id, group_code);
create index if not exists promo_decisions_round_idx   on public.promo_decisions (round_id, group_code);
-- El exists de la politica de productos busca por (round_id, code, status): que no sea un
-- recorrido de tabla por cada fila del catalogo.
create index if not exists promo_decisions_aprobadas_idx
  on public.promo_decisions (round_id, code, status);

-- ---------------------------------------------------------------------------
-- 3. Privilegios. En esta base una tabla nueva nace con todo concedido a anon y authenticated
--    (medido al ensayar la 126, y por eso la 136 lo revoca explicitamente). Aqui igual.
-- ---------------------------------------------------------------------------
revoke all on public.promo_rounds      from anon, authenticated;
revoke all on public.promo_products    from anon, authenticated;
revoke all on public.promo_suggestions from anon, authenticated;
revoke all on public.promo_decisions   from anon, authenticated;

grant select on public.promo_rounds      to authenticated;
grant select on public.promo_suggestions to authenticated;
grant select, insert, update on public.promo_decisions to authenticated;
-- sin delete en ningun sitio: una decision se cambia, no se borra. Es historial.

-- Y EL GRANT QUE ES EL CORAZON DE ESTO: por COLUMNA. notes, demand, months_of_stock, cost y diff
-- no se conceden a nadie - tampoco al admin, que tambien las lee por la funcion de mas abajo,
-- para que haya UN solo camino y no dos que puedan divergir.
grant select (round_id, code, supplier, size, description, qoh, qoh_by_store, price,
              source_sheet, row_no)
  on public.promo_products to authenticated;

-- ---------------------------------------------------------------------------
-- 4. RLS. Una politica por comando; NINGUNA de tipo ALL - una FOR ALL tambien concede SELECT, y
--    entonces la politica de lectura deja de ser la que manda (la leccion de la 136).
-- ---------------------------------------------------------------------------
alter table public.promo_rounds      enable row level security;
alter table public.promo_products    enable row level security;
alter table public.promo_suggestions enable row level security;
alter table public.promo_decisions   enable row level security;

drop policy if exists "promo_rounds select"      on public.promo_rounds;
drop policy if exists "promo_products select"    on public.promo_products;
drop policy if exists "promo_suggestions select" on public.promo_suggestions;
drop policy if exists "promo_decisions select"   on public.promo_decisions;
drop policy if exists "promo_decisions insert"   on public.promo_decisions;
drop policy if exists "promo_decisions update"   on public.promo_decisions;

-- Rondas: las ve quien tiene el modulo. Sin insert/update/delete: la subida va por service-role,
-- que se salta RLS (pero no los disparadores).
create policy "promo_rounds select" on public.promo_rounds for select to authenticated
  using ((select public.has_promos_access()));

-- Productos: el que decide ve la ronda entera (la tiene que decidir); el vendedor ve solo lo ya
-- aprobado para los grupos que le tocan. El exists mira promo_decisions, cuya propia politica se
-- resuelve con funciones security definer - no vuelve a promo_products, asi que no hay ciclo.
create policy "promo_products select" on public.promo_products for select to authenticated
  using (
    (select public.has_promos_access())
    and (
      (select public.promo_is_decider())
      or exists (
        select 1 from public.promo_decisions d
         where d.round_id   = promo_products.round_id
           and d.code       = promo_products.code
           and d.status     = 'approved'
           and d.group_code = any ((select public.promo_visible_groups()))
      )
    )
  );

create policy "promo_suggestions select" on public.promo_suggestions for select to authenticated
  using ((select public.has_promos_access()));

create policy "promo_decisions select" on public.promo_decisions for select to authenticated
  using (group_code = any ((select public.promo_visible_groups())));

create policy "promo_decisions insert" on public.promo_decisions for insert to authenticated
  with check (
    (select public.promo_is_decider())
    and ((select public.is_admin()) or group_code = (select public.promo_group_of_user()))
  );

create policy "promo_decisions update" on public.promo_decisions for update to authenticated
  using (
    (select public.promo_is_decider())
    and ((select public.is_admin()) or group_code = (select public.promo_group_of_user()))
  )
  with check (
    (select public.promo_is_decider())
    and ((select public.is_admin()) or group_code = (select public.promo_group_of_user()))
  );

-- ---------------------------------------------------------------------------
-- 5. Las cinco privadas, por una funcion definer; y la vista por la que lee la pantalla.
-- ---------------------------------------------------------------------------

-- Las cinco juntas y en UNA llamada por fila, no cinco. Con 60 productos por ronda el coste es
-- irrelevante; si una ronda llegara a miles habria que volver a mirarlo, y queda dicho aqui para
-- que nadie crea que se midio a esa escala.
create or replace function public.promo_private(p_round uuid, p_code text)
  returns jsonb language sql stable security definer set search_path = public as $$
  select case when public.promo_can_see_private() then
    jsonb_build_object('notes', p.notes, 'demand', p.demand,
                       'months_of_stock', p.months_of_stock, 'cost', p.cost, 'diff', p.diff)
  else null end
  from public.promo_products p
  where p.round_id = p_round and p.code = p_code;
$$;

revoke execute on function public.promo_private(uuid, text) from public, anon;
grant  execute on function public.promo_private(uuid, text) to authenticated;

-- security_invoker = ON, como manda la 068: la RLS de fila de la tabla se aplica IGUAL a traves
-- de la vista. Y la vista NO NOMBRA ni una de las cinco columnas revocadas - por eso un vendedor
-- puede leerla sin chocar con el privilegio de columna.
create or replace view public.promo_catalog
with (security_invoker = on) as
  select p.round_id, p.code, p.supplier, p.size, p.description,
         p.qoh, p.qoh_by_store, p.price, p.source_sheet, p.row_no,
         public.promo_private(p.round_id, p.code) as private
    from public.promo_products p;

revoke all  on public.promo_catalog from anon, authenticated;
grant select on public.promo_catalog to authenticated;

-- ---------------------------------------------------------------------------
-- 6. El guardia de las decisiones. Mismo patron que user_prefs_guard (136): la fila conserva su
--    identidad y el sello lo pone la base, no el navegador. Vale tambien para la llave de
--    servicio, que se salta RLS pero no los disparadores.
-- ---------------------------------------------------------------------------
create or replace function public.promo_decisions_guard()
  returns trigger language plpgsql set search_path = public as $$
begin
  if TG_OP = 'UPDATE' and (NEW.round_id   is distinct from OLD.round_id
                        or NEW.code       is distinct from OLD.code
                        or NEW.group_code is distinct from OLD.group_code) then
    raise exception 'A decision keeps its round, its product and its group';
  end if;
  NEW.decided_by := auth.uid();
  NEW.decided_at := now();
  return NEW;
end $$;

drop trigger if exists promo_decisions_guard on public.promo_decisions;
create trigger promo_decisions_guard
  before insert or update on public.promo_decisions
  for each row execute function public.promo_decisions_guard();

revoke execute on function public.promo_decisions_guard() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Autocomprobacion. Mira definiciones y privilegios, no cuenta filas: sobrevive a re-aplicar.
-- ---------------------------------------------------------------------------
do $comprueba$
declare
  n integer;
  col text;
begin
  -- RLS encendida en las cuatro.
  foreach col in array array['promo_rounds', 'promo_products', 'promo_suggestions', 'promo_decisions'] loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || col)::regclass) then
      raise exception '140: % sin RLS', col;
    end if;
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = col and cmd = 'ALL') then
      raise exception '140: % no debe tener ninguna politica ALL', col;
    end if;
    if has_table_privilege('anon', 'public.' || col, 'select') then
      raise exception '140: anon no debe leer %', col;
    end if;
    if has_table_privilege('authenticated', 'public.' || col, 'delete') then
      raise exception '140: nadie borra en % - es historial', col;
    end if;
  end loop;

  -- LO QUE DE VERDAD PRUEBA ESTA MIGRACION: las cinco privadas no se conceden, y las publicas si.
  foreach col in array array['notes', 'demand', 'months_of_stock', 'cost', 'diff'] loop
    if has_column_privilege('authenticated', 'public.promo_products', col, 'select') then
      raise exception '140: authenticated NO debe poder leer la columna % de promo_products', col;
    end if;
  end loop;
  foreach col in array array['code', 'description', 'qoh', 'qoh_by_store', 'price'] loop
    if not has_column_privilege('authenticated', 'public.promo_products', col, 'select') then
      raise exception '140: authenticated debe poder leer la columna % de promo_products', col;
    end if;
  end loop;
  -- Y que no se cuele por la tabla entera: un grant de tabla daria las cinco de vuelta.
  if has_table_privilege('authenticated', 'public.promo_products', 'select') then
    raise exception '140: promo_products no debe tener SELECT de tabla - es por columna';
  end if;
  if has_table_privilege('authenticated', 'public.promo_products', 'insert')
     or has_table_privilege('authenticated', 'public.promo_products', 'update') then
    raise exception '140: el catalogo no se escribe desde el cliente';
  end if;

  -- La vista tiene que ser invoker (la leccion de la 068). Definer se saltaria la RLS de fila.
  if not exists (select 1 from pg_class
                  where oid = 'public.promo_catalog'::regclass
                    and 'security_invoker=on' = any (coalesce(reloptions, '{}'))) then
    raise exception '140: promo_catalog tiene que ser security_invoker = on';
  end if;

  -- Ninguna politica puede abrirse por su cuenta: todas pasan por un helper del modulo.
  if exists (select 1 from pg_policies
              where schemaname = 'public' and tablename like 'promo\_%'
                and coalesce(qual, '') || coalesce(with_check, '') !~ 'has_promos_access|promo_is_decider|promo_visible_groups') then
    raise exception '140: una politica de promos no mira ningun helper del modulo';
  end if;

  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'promo_decisions';
  if n <> 3 then raise exception '140: promo_decisions debe tener 3 politicas, tiene %', n; end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'promo_decisions'
              and cmd = 'UPDATE' and with_check is null) then
    raise exception '140: la politica de UPDATE de decisiones necesita with check';
  end if;

  if not exists (select 1 from pg_trigger where tgrelid = 'public.promo_decisions'::regclass
                   and tgname = 'promo_decisions_guard' and not tgisinternal) then
    raise exception '140: falta el disparador promo_decisions_guard';
  end if;
end $comprueba$;

-- ---------------------------------------------------------------------------
-- Reversion (para pegar A MANO en una sesion; por eso lleva begin/commit y un fichero de
-- migracion no). Deja la base exactamente como estaba: aqui todo es nuevo.
-- OJO: el drop de promo_decisions BORRA DECISIONES YA TOMADAS. De eso protege el pg_dump, no
-- del alta. Releerlo antes de ejecutar esto.
--
--   begin;
--   drop view     if exists public.promo_catalog;
--   drop table    if exists public.promo_decisions;
--   drop table    if exists public.promo_suggestions;
--   drop table    if exists public.promo_products;
--   drop table    if exists public.promo_rounds;
--   drop function if exists public.promo_decisions_guard();
--   drop function if exists public.promo_private(uuid, text);
--   drop function if exists public.promo_visible_groups();
--   drop function if exists public.promo_can_see_private();
--   drop function if exists public.promo_is_decider();
--   drop function if exists public.promo_group_of_user();
--   drop function if exists public.has_promos_access();
--   delete from public.schema_migrations where name = '140_promos.sql';
--   commit;
--   -- promo_group dentro de settings.stores puede quedarse: es un campo que nadie mas lee.
-- ---------------------------------------------------------------------------

-- @ledger-below
insert into public.schema_migrations (name, checksum)
  values ('140_promos.sql', '4b72d6ed2af342a092cd44dd05bc91f515100fd6dbe697b7a53a0542b1b5f320') on conflict (name) do nothing;
