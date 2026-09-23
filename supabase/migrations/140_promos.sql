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
-- LO QUE NO HACE: ninguna pantalla, ningun registro del modulo en el codigo (MODULES /
-- MODULE_ACCESS de constants.ts), ningun cambio de version.
--
-- LO QUE SI TOCA DE LO QUE YA HABIA, Y ES UNA SOLA COSA: la restriccion
-- `profiles_module_access_known` de `public.profiles`, que hoy PROHIBE la palabra 'promos' y por
-- tanto haria el modulo imposible de conceder (seccion 0). La primera version de esta migracion
-- decia "no modifica nada existente" y era FALSO: nadie habia mirado esa restriccion. Se deja
-- escrito en vez de corregirlo callando, porque de ahi sale la advertencia de la reversion: dar
-- marcha atras a la restriccion FALLA si alguien ya tiene 'promos' concedido, asi que la
-- reversion lleva un paso previo para quitarselo. El respaldo protege sobre todo del drop, pero
-- ya no es verdad que no proteja de nada del alta.
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
-- 0. La restriccion que prohibia el modulo. LO UNICO DE AQUI QUE TOCA ALGO EXISTENTE.
-- ---------------------------------------------------------------------------
-- `profiles_module_access_known` (095:54-57) dice hoy:
--   check (module_access is null or module_access <@ array['deliveries','recruiting','timetracker','erp'])
--   not valid
-- O sea que dar 'promos' a un perfil REVIENTA contra la restriccion. Sin tocarla,
-- has_promos_access() solo seria cierta para un admin - por la rama del rol - y ni un gerente de
-- oficina, ni oficina, ni un vendedor podria entrar jamas. El modulo entero seria decorativo.
--
-- OJO AL PARTIR DE DONDE (la misma trampa que avisa la 131 con guard_profile_privileged_columns):
-- la ULTIMA migracion que define esta restriccion es la 095, NO la 088. Copiar el cuerpo de la 088
-- devolveria 'clockin' a la lista que la 095 quito a proposito, sin tocar la 095 y sin que nada
-- fallara.
--
-- Se conserva `not valid` por la razon que da la propia 095: validarla obligaria a arreglar antes
-- cualquier fila que todavia lleve una palabra vieja, o sea a tomar por esa persona una decision
-- que la 095 dejo a una persona. `not valid` no afloja nada de aqui en adelante: las altas y los
-- cambios SI se comprueban; lo unico que no se re-examina son las filas que ya estaban.
alter table public.profiles drop constraint if exists profiles_module_access_known;
alter table public.profiles add constraint profiles_module_access_known
  check (module_access is null or module_access <@ array['deliveries','recruiting','timetracker','erp','promos'])
  not valid;

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

-- NO HAY promo_visible_groups(). La hubo mientras se creyo que un vendedor veia solo su tienda.
-- El dueno contesto las dos preguntas abiertas: los vendedores ven TODAS las tiendas y filtran, y
-- ven TODOS los productos con su estado (aprobado, rechazado y pendiente). Con eso, la funcion
-- devolvia "todos los grupos" para todo el que tuviera acceso y "ninguno" para el que no: o sea,
-- has_promos_access() con tres lineas de mas. Se quita en vez de dejarla, porque una funcion que
-- se llama "los grupos que ves" y nunca filtra nada invita al siguiente a creer que filtra.
--
-- promo_group_of_user() SI se queda: sigue decidiendo DONDE ESCRIBE un gerente, que es lo unico
-- que no cambio.

-- El grant explicito, en vez de confiar en los privilegios por defecto del proyecto: revocar de
-- public quita la concesion implicita, y que authenticated conserve la suya depende de un
-- ALTER DEFAULT PRIVILEGES que no se puede comprobar desde una rama. Se pone y se acaba la duda.
revoke execute on function public.has_promos_access()      from public, anon;
revoke execute on function public.promo_group_of_user()    from public, anon;
revoke execute on function public.promo_is_decider()       from public, anon;
revoke execute on function public.promo_can_see_private()  from public, anon;
grant execute on function public.has_promos_access()       to authenticated;
grant execute on function public.promo_group_of_user()     to authenticated;
grant execute on function public.promo_is_decider()        to authenticated;
grant execute on function public.promo_can_see_private()   to authenticated;

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
  -- "Esta ronda ya no se decide", y lo pidio el dueno. Con closed_at puesto, el disparador de
  -- decisiones rechaza toda escritura - TAMBIEN la del admin, que si necesita corregir algo tiene
  -- que reabrir. Solo lo mueve promo_set_round_closed() (mas abajo), que es admin.
  closed_at    timestamptz,
  closed_by    uuid references public.profiles(id) on delete set null,
  -- La ultima reapertura. Es el unico rastro que deja reabrir, y solo guarda la ULTIMA: en fase 1
  -- no hay bitacora de reaperturas, y si el dueno la quiere es una tabla aparte. Dicho para que
  -- nadie lea "queda rastro" y entienda mas de lo que hay.
  reopened_at  timestamptz,
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

-- DOS indices, y solo dos. Los dos que faltan aqui estaban en la primera version y se han quitado
-- a sabiendas: `promo_products (round_id)` es el PREFIJO de su propia clave primaria
-- `(round_id, code)`, o sea un indice que duplica otro; y `promo_decisions (round_id, code, status)`
-- lo justificaba el `exists` de la politica de productos, que ya no existe - y ademas tenia la
-- forma equivocada para "las aprobadas de esta ronda", que seria `(round_id, status)`. Un indice
-- que no motiva ninguna consulta es peso al escribir y una pista falsa para quien lea.
--
-- Los dos que quedan SI ganan algo, porque `(round_id, group_code)` no es prefijo de ninguna clave:
create index if not exists promo_suggestions_round_idx on public.promo_suggestions (round_id, group_code);
create index if not exists promo_decisions_round_idx   on public.promo_decisions (round_id, group_code);

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

-- Rondas: las ve quien tiene el modulo. Sin insert/update/delete: la subida va por service-role
-- (que se salta RLS, pero no los disparadores) y cerrarlas o reabrirlas, por
-- promo_set_round_closed(), que es la unica escritura que un cliente puede hacer aqui.
create policy "promo_rounds select" on public.promo_rounds for select to authenticated
  using ((select public.has_promos_access()));

-- Productos: TODAS las filas para todo el que tenga el modulo. Lo pidio el dueno - un vendedor ve
-- todos los productos con su estado (aprobado, rechazado y pendiente) y filtra el que quiere.
--
-- LEASE ESTO ANTES DE TOCAR NADA DE AQUI: hasta esta version, un vendedor tampoco veia la FILA de
-- un producto que no estuviera aprobado para su tienda, asi que el costo estaba tapado dos veces.
-- Ahora ve todas las filas, y **lo unico que separa a un vendedor del costo es el privilegio de
-- columna** del bloque de arriba. Ya no es una segunda linea de defensa: es la unica. Quien
-- devuelva aqui un `grant select` de tabla, o meta una de las cinco columnas en promo_catalog,
-- abre el costo a toda la fuerza de ventas y ninguna pantalla se quejara. La autocomprobacion del
-- final lo mira, y por eso esta ahi.
create policy "promo_products select" on public.promo_products for select to authenticated
  using ((select public.has_promos_access()));

create policy "promo_suggestions select" on public.promo_suggestions for select to authenticated
  using ((select public.has_promos_access()));

-- Decisiones: las LEE todo el que tiene el modulo, porque el vendedor necesita ver el estado de
-- cada producto en cada tienda para filtrar. Las ESCRIBE solo quien decide, y solo en su grupo:
-- eso es lo unico que no cambio con las respuestas del dueno.
create policy "promo_decisions select" on public.promo_decisions for select to authenticated
  using ((select public.has_promos_access()));

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

-- LA RONDA CERRADA NO SE COMPRUEBA AQUI, Y ES A PROPOSITO. Va en el disparador, por dos razones
-- medibles:
--   1. Una politica de UPDATE que no deja pasar la fila no da error: afecta a CERO filas y
--      PostgREST responde limpio. El cliente creeria que guardo. Una excepcion del disparador si
--      llega a la persona, y con un mensaje que dice por que.
--   2. El disparador vale tambien para la llave de servicio, que se salta RLS. "Congelada" tiene
--      que querer decir congelada por todos los caminos, no solo por el del navegador.

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
  -- Una ronda cerrada esta congelada para TODOS, admin incluido. Corregir algo de una ronda
  -- cerrada obliga a reabrirla, que es un acto explicito y deja su marca en reopened_at, en vez
  -- de un cambio que nadie sabria que ocurrio.
  if exists (select 1 from public.promo_rounds r where r.id = NEW.round_id and r.closed_at is not null) then
    raise exception 'This promo round is closed; reopen it before changing decisions';
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
-- 6b. Cerrar y reabrir una ronda. Es lo UNICO que un cliente escribe sobre promo_rounds, y no va
--     por un grant: `authenticated` no tiene UPDATE sobre esa tabla, ni lo va a tener.
-- ---------------------------------------------------------------------------
-- Por que una funcion definer y no una ruta de API con la llave de servicio: cerrar es un
-- booleano, y montar una ruta de servicio para un booleano abre otro camino que se salta TODO en
-- el resto de la tabla. Asi la comprobacion vive en la base y vale para cualquier llamante.
create or replace function public.promo_set_round_closed(p_round uuid, p_closed boolean)
  returns public.promo_rounds language plpgsql security definer set search_path = public as $$
declare
  fila public.promo_rounds;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can close or reopen a promo round';
  end if;
  update public.promo_rounds
     set closed_at   = case when p_closed then now() else null end,
         closed_by   = case when p_closed then auth.uid() else null end,
         -- Solo cuenta como reapertura si ESTABA cerrada: llamar con false a una ronda abierta no
         -- inventa una reapertura que no ocurrio. (En un UPDATE, closed_at a la derecha es el
         -- valor VIEJO, que es justo lo que hace falta aqui.)
         reopened_at = case when not p_closed and closed_at is not null then now() else reopened_at end
   where id = p_round
  returning * into fila;
  if fila.id is null then
    raise exception 'No such promo round';
  end if;
  return fila;
end $$;

revoke execute on function public.promo_set_round_closed(uuid, boolean) from public, anon;
grant  execute on function public.promo_set_round_closed(uuid, boolean) to authenticated;

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
                and coalesce(qual, '') || coalesce(with_check, '') !~ 'has_promos_access|promo_is_decider') then
    raise exception '140: una politica de promos no mira ningun helper del modulo';
  end if;

  -- La restriccion tiene que aceptar 'promos' y NO haber perdido las otras cuatro por el camino:
  -- el riesgo real de reescribirla era partir del cuerpo de la 088 en vez del de la 095.
  if not exists (select 1 from pg_constraint where conrelid = 'public.profiles'::regclass
                   and conname = 'profiles_module_access_known'
                   and pg_get_constraintdef(oid) like '%promos%') then
    raise exception '140: profiles_module_access_known sigue sin aceptar promos - el modulo seria decorativo';
  end if;
  foreach col in array array['deliveries', 'recruiting', 'timetracker', 'erp'] loop
    if not exists (select 1 from pg_constraint where conrelid = 'public.profiles'::regclass
                     and conname = 'profiles_module_access_known'
                     and pg_get_constraintdef(oid) like '%' || col || '%') then
      raise exception '140: al reescribir profiles_module_access_known se perdio %', col;
    end if;
  end loop;
  if exists (select 1 from pg_constraint where conrelid = 'public.profiles'::regclass
               and conname = 'profiles_module_access_known'
               and pg_get_constraintdef(oid) like '%clockin%') then
    raise exception '140: profiles_module_access_known volvio a aceptar clockin - se partio de la 088, no de la 095';
  end if;

  -- Cerrar una ronda tiene que tener puerta, y una sola.
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'promo_set_round_closed') then
    raise exception '140: falta promo_set_round_closed - nadie podria cerrar una ronda';
  end if;
  if has_table_privilege('authenticated', 'public.promo_rounds', 'update')
     or has_table_privilege('authenticated', 'public.promo_rounds', 'insert') then
    raise exception '140: promo_rounds no se escribe desde el cliente - solo por la funcion o service-role';
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
-- migracion no).
--
-- DOS AVISOS, y el primero es el que muerde:
--   1. Devolver `profiles_module_access_known` a su forma vieja FALLA si alguien ya tiene 'promos'
--      concedido - y aunque sea `not valid`, un `add constraint` comprueba... nada de lo viejo,
--      pero la SIGUIENTE escritura de ese perfil si revienta, y esa es peor: aparece dias despues
--      y en otra pantalla. Por eso el paso 1 quita la palabra ANTES. Quitarsela a alguien es
--      quitarle el acceso al modulo: eso es lo que significa revertir esto.
--   2. El drop de promo_decisions BORRA DECISIONES YA TOMADAS. De eso protege el pg_dump.
--      Releerlo antes de ejecutar esto.
--
--   begin;
--   -- 1. Primero la palabra, o el paso 4 deja perfiles que la restriccion vieja no admite.
--   update public.profiles
--      set module_access = array_remove(module_access, 'promos')
--    where 'promos' = any (coalesce(module_access, '{}'));
--   -- 2. La vista y las tablas.
--   drop view     if exists public.promo_catalog;
--   drop table    if exists public.promo_decisions;
--   drop table    if exists public.promo_suggestions;
--   drop table    if exists public.promo_products;
--   drop table    if exists public.promo_rounds;
--   -- 3. Las funciones.
--   drop function if exists public.promo_set_round_closed(uuid, boolean);
--   drop function if exists public.promo_decisions_guard();
--   drop function if exists public.promo_private(uuid, text);
--   drop function if exists public.promo_can_see_private();
--   drop function if exists public.promo_is_decider();
--   drop function if exists public.promo_group_of_user();
--   drop function if exists public.has_promos_access();
--   -- 4. La restriccion, EXACTAMENTE como la dejo la 095 (no la 088: esa lleva 'clockin').
--   alter table public.profiles drop constraint if exists profiles_module_access_known;
--   alter table public.profiles add constraint profiles_module_access_known
--     check (module_access is null or module_access <@ array['deliveries','recruiting','timetracker','erp'])
--     not valid;
--   delete from public.schema_migrations where name = '140_promos.sql';
--   commit;
--   -- promo_group dentro de settings.stores puede quedarse: es un campo que nadie mas lee.
-- ---------------------------------------------------------------------------

-- @ledger-below
insert into public.schema_migrations (name, checksum)
  values ('140_promos.sql', '129e57e4dece937127541bd696c63e879149603607ad166110e6fb85a517004c') on conflict (name) do nothing;
