-- ===========================================================================
-- 180 - Clientes: la lista maestra de clientes (el Excel «REAL Master List Customers PRE DEC») en erp.customers
-- ===========================================================================
-- Plan en papel: docs/PLAN-clientes.md. ESCRITA Y NO APLICADA: aplicarla es del orquestador, despues del merge,
-- con respaldo hecho y migrate-status antes y despues.
--
-- El dueno (2026-10-16): «HGAMAOS EL CUSTOMER APP ASI COMO EL LEADS PERO CON EL SCHEMA DE EL ERP ASI CON ESE THEME»,
-- con el Excel de 1.349 clientes (hoja ALL) repartidos en cinco tiendas (MCA, PHR, BRO, EDG, WES).
--
-- POR QUE EN `erp` Y NO EN UN ESQUEMA `crm` NUEVO: PostgREST solo sirve los esquemas que estan en «Exposed schemas»
-- del panel de Supabase (hoy public, erp, clockin...). Un esquema nuevo obliga a un paso manual en el panel y a un
-- cliente de navegador mas (con su propia instancia de GoTrue, decision 185). `erp` ya esta expuesto, ya tiene
-- cliente, y un cliente es una entidad maestra del ERP igual que `erp.vendors`, `erp.stores` o `erp.salespeople`.
-- Las POLITICAS son las del ERP: una restrictiva por modulo que AND-ea con todo (066) y permisivas por accion.
--
-- QUE TRAE:
--   0. 'customers' en profiles_module_access_known (la ULTIMA definicion aplicada es la 162: se parte de su cuerpo
--      y se anade una palabra).
--   1. public.has_customers_access(): admin, o 'customers' en module_access. Misma forma que has_leads_access().
--   2. erp.customers_can_write(): quien puede escribir: admin o manager DEL HUB (profiles.role), con el modulo.
--      Por `profiles.role` y no por `erp_role`: el modulo se concede por casilla a gente que puede no tener nivel
--      de ERP, y el dueno pidio «como Leads», cuyo escalafon es el del hub. Cambiar quien escribe es tocar esta
--      funcion, no las politicas.
--   3. erp.customers: UNA fila por (tienda, cuenta). Clave natural = ACCOUNT + STORE del Excel, sin distinguir
--      mayusculas ni espacios de mas (indice unico sobre lower(btrim())).
--   4. RLS: lee quien tiene el modulo; inserta y actualiza quien puede escribir; borra solo el admin.
--   5. Disparador: updated_at y updated_by se ponen solos al actualizar (quien escribio y cuando).
--
-- DATOS PERSONALES: nombre de contacto, telefono y correo de cada cliente. Quien tiene el modulo los lee TODOS,
-- de todas las tiendas (es la lista de la empresa, no la de una tienda). El modulo se concede persona por persona.
--
-- LO QUE NO TOCA: ninguna tabla existente salvo la restriccion de profiles de la seccion 0. Ningun dato: la tabla
-- nace VACIA (los datos los mete scripts/importa-clientes.mjs, aparte, como postgres). No concede el modulo a nadie.
--
-- Sin begin/commit propios, a proposito: quien aplica envuelve el fichero en una transaccion.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 0. La restriccion que prohibe la palabra. LO UNICO QUE TOCA ALGO EXISTENTE.
-- ---------------------------------------------------------------------------
-- La 162 la dejo en: check (module_access is null or module_access <@
--   array['deliveries','recruiting','timetracker','erp','promos','estimator','surveys','leads']) not valid
-- (leido del fichero de la 162; NO medido en produccion desde esta rama, sin .env.local a proposito: el orquestador
-- lo comprueba con `\d public.profiles` antes de aplicar). Se conserva `not valid` por la razon de la 095: las filas
-- viejas no se re-examinan; las altas y los cambios si.
alter table public.profiles drop constraint if exists profiles_module_access_known;
alter table public.profiles add constraint profiles_module_access_known
  check (module_access is null or module_access <@ array['deliveries','recruiting','timetracker','erp','promos','estimator','surveys','leads','customers'])
  not valid;

-- ---------------------------------------------------------------------------
-- 1. Quien entra. Mismo idioma que has_leads_access() (162) y has_erp_access() (062).
-- ---------------------------------------------------------------------------
create or replace function public.has_customers_access()
  returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select role = 'admin' or 'customers' = any(coalesce(module_access, '{}'))
    from public.profiles where id = auth.uid()
  ), false);
$$;

-- ---------------------------------------------------------------------------
-- 2. Quien escribe: admin o manager del hub, y ademas con el modulo (el admin lo tiene siempre).
-- ---------------------------------------------------------------------------
create or replace function erp.customers_can_write()
  returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select (role = 'admin' or (role = 'manager' and 'customers' = any(coalesce(module_access, '{}'))))
    from public.profiles where id = auth.uid()
  ), false);
$$;

-- ---------------------------------------------------------------------------
-- 3. La tabla. Las columnas del Excel que valen (docs/PLAN-clientes.md, seccion 3) mas las de la app.
-- ---------------------------------------------------------------------------
-- store:            el codigo de tienda del Excel (BRO, EDG, MCA, PHR, WES). La pantalla lo traduce al nombre.
-- account:          ACCOUNT del Excel, recortado. Con `store`, la clave natural.
-- unified_account:  UNIFIED ACCOUNT: el nombre con el que se agrupan las cuentas de un mismo cliente entre tiendas.
-- house_no:         HOUSE: el numero de fila del Excel maestro (unico alli). Para volver a encontrar la fila.
-- added_batch:      DATE ADDED: en el Excel es una tanda («1», «2», «3», «4») o una fecha (2026-09-24). Se guarda tal cual.
-- qb_status:        QB INACTIVE: 'ACTIVE' o 'NOT FOUND IN UPDATE' (si QuickBooks lo encontro en la ultima actualizacion).
-- activity_status:  ACTIVITY STATUS: Internal, One time, Inactive, Competencia, walk in, Supplier, Unknown (225 filas).
-- status_store/group:   STATUS TYPE: LOST, NONE SALE, ACTIVE DEC, ACTIVE INC, NEW; por tienda y por grupo.
-- history_store/group:  HISTORY TYPE: INSIGNIFICANT, SMALL, MID, LARGE; por tienda y por grupo.
-- rep_history / rep_qb / rep_store:  las iniciales (o nombre) del vendedor: historico del grupo, en QB del grupo,
--                   y el asignado en QB de la tienda.
-- contact_name / contact_title / address / phone / email:  el contacto. Vacios en casi todo el Excel; son los campos
--                   que la app va a ir llenando.
-- credit_limit:     QB Credit Limit.   euler_limit: el limite de Euler (la aseguradora de credito), si lo hay.
-- terms:            Terms, tal cual (Due on receipt, Net 30, 25 Days...).
-- account_no:       Account No.: en el Excel mezcla numeros de Euler con notas de credito («INTERNAL CREDIT», «NO
--                   CREDIT», «DICE $3000 CREDIT»). Se guarda tal cual y se enseña como «Cuenta / credito».
-- notes:            de la app, libre.
create table if not exists erp.customers (
  id               bigint generated always as identity primary key,
  store            text not null,
  account          text not null,
  unified_account  text,
  house_no         integer,
  added_batch      text,
  qb_status        text,
  activity_status  text,
  status_store     text,
  status_group     text,
  history_store    text,
  history_group    text,
  rep_history      text,
  rep_qb           text,
  rep_store        text,
  contact_name     text,
  contact_title    text,
  address          text,
  phone            text,
  email            text,
  credit_limit     numeric,
  euler_limit      numeric,
  terms            text,
  account_no       text,
  notes            text,
  source           text,
  imported_at      timestamptz,
  created_at       timestamptz not null default now(),
  created_by       uuid,
  updated_at       timestamptz not null default now(),
  updated_by       uuid,
  constraint customers_store_no_vacio check (length(btrim(store)) > 0),
  constraint customers_account_no_vacio check (length(btrim(account)) > 0),
  constraint customers_qb_status check (qb_status is null or qb_status in ('ACTIVE', 'NOT FOUND IN UPDATE')),
  constraint customers_status_store check (status_store is null or status_store in ('LOST', 'NONE SALE', 'ACTIVE DEC', 'ACTIVE INC', 'NEW')),
  constraint customers_status_group check (status_group is null or status_group in ('LOST', 'NONE SALE', 'ACTIVE DEC', 'ACTIVE INC', 'NEW')),
  constraint customers_history_store check (history_store is null or history_store in ('INSIGNIFICANT', 'SMALL', 'MID', 'LARGE')),
  constraint customers_history_group check (history_group is null or history_group in ('INSIGNIFICANT', 'SMALL', 'MID', 'LARGE')),
  constraint customers_credit_limit check (credit_limit is null or credit_limit >= 0),
  constraint customers_euler_limit check (euler_limit is null or euler_limit >= 0)
);

-- La clave natural: una cuenta por tienda, sin que «Paseo Residencial» y «PASEO RESIDENCIAL » cuenten como dos.
create unique index if not exists customers_store_account_unico
  on erp.customers (upper(btrim(store)), lower(btrim(account)));
create index if not exists customers_unified_idx on erp.customers (lower(btrim(unified_account)));
create index if not exists customers_store_status_idx on erp.customers (store, status_store);

-- ---------------------------------------------------------------------------
-- 4. Privilegios y RLS. Una tabla nueva en `erp` nace con lo que digan los default privileges del esquema: se
--    revoca y se concede lo justo. authenticated: select, insert, update, delete; y las politicas deciden.
-- ---------------------------------------------------------------------------
revoke all on erp.customers from public, anon, authenticated;
grant select, insert, update, delete on erp.customers to authenticated;

alter table erp.customers enable row level security;

-- La puerta del modulo, RESTRICTIVA (AND con todo lo demas, presente o futuro), como el «erp module gate» de la 066.
-- Mira el modulo `customers`, no el `erp`: tener el ERP no da la lista de clientes, ni al reves.
drop policy if exists "customers module gate" on erp.customers;
create policy "customers module gate" on erp.customers as restrictive for all to authenticated
  using ((select public.has_customers_access())) with check ((select public.has_customers_access()));

drop policy if exists "customers read" on erp.customers;
create policy "customers read" on erp.customers as permissive for select to authenticated
  using (true);
drop policy if exists "customers insert (writers)" on erp.customers;
create policy "customers insert (writers)" on erp.customers as permissive for insert to authenticated
  with check ((select erp.customers_can_write()));
drop policy if exists "customers update (writers)" on erp.customers;
create policy "customers update (writers)" on erp.customers as permissive for update to authenticated
  using ((select erp.customers_can_write())) with check ((select erp.customers_can_write()));
drop policy if exists "customers delete (admin)" on erp.customers;
create policy "customers delete (admin)" on erp.customers as permissive for delete to authenticated
  using ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- 5. Quien y cuando. created_by al insertar, updated_* al actualizar; la fila no puede mentir sobre esto.
-- ---------------------------------------------------------------------------
create or replace function erp.customers_touch()
  returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.created_by := coalesce(auth.uid(), new.created_by);
  end if;
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end $$;

drop trigger if exists customers_touch on erp.customers;
create trigger customers_touch before insert or update on erp.customers
  for each row execute function erp.customers_touch();

-- Reversion (en este orden):
--   drop trigger if exists customers_touch on erp.customers;
--   drop function if exists erp.customers_touch();
--   drop table if exists erp.customers;
--   drop function if exists erp.customers_can_write();
--   drop function if exists public.has_customers_access();
--   alter table public.profiles drop constraint if exists profiles_module_access_known;
--   alter table public.profiles add constraint profiles_module_access_known
--     check (module_access is null or module_access <@ array['deliveries','recruiting','timetracker','erp','promos','estimator','surveys','leads'])
--     not valid;
--   update public.profiles set module_access = array_remove(module_access, 'customers') where 'customers' = any(module_access);
--   delete from public.schema_migrations where name = '180_clientes.sql';
-- OJO: la restriccion se vuelve a poner DESPUES de quitar la palabra de los perfiles, o un perfil con 'customers'
-- la viola (es `not valid`, asi que no fallaria al crearla, pero su siguiente cambio si).

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('180_clientes.sql', 'b716baf7b730bd98e41c01f4171ccdb6d5ae40032f64ed4f0a98f7c8e7b40b4a') on conflict (name) do nothing;
