-- 249: Clientes — «En asociación con»: la asociación entre clientes (2026-11-05).
--
-- El dueño: «un cliente puede haber trabajado con otro (uno es builder y el otro contractor). Desde ahora se puede crear
-- una asociación entre clientes. Por ahora no afecta absolutamente nada; es simbólico: dirá "en asociación con" otro
-- cliente. Se edita el cliente y se añade la asociación, elegida de la misma base de clientes».
--
-- Qué hace:
--  1. `erp.customer_associations`: un par de EMPRESAS (company_id, 189), no de filas: Clientes tiene una fila por tienda
--     y la asociación es entre empresas, así que la ven todas sus tiendas. Simétrica: una sola fila por par, sin orden
--     (índice único sobre least/greatest), y nunca una empresa consigo misma. No hay FK posible (company_id no es único
--     en erp.customers): el disparador exige que las dos empresas existan.
--  2. RLS: lee quien tiene Clientes (has_customers_access) y ve alguna fila de cualquiera de las dos empresas (la
--     subconsulta corre con la RLS de erp.customers de quien mira). Crea y quita SOLO quien edita directo:
--     erp.es_admin_de_clientes() (241). La edición del vendedor y del gerente es una solicitud (221) que cambia columnas
--     de UNA fila; la asociación no es una columna, así que por ahora no la piden.
--  3. `erp.asociados_de_la_empresa(p_company)`: las empresas asociadas a una con su nombre, sus tiendas y su tipo CRM,
--     para pintar las pastillas aunque quien mira no vea esas filas (como la búsqueda de la 215: solo nombre y tienda).
--     Solo lee; exige el módulo y que quien mira vea alguna fila de p_company.
--  4. El historial (221/245): clases nuevas 'associate' y 'dissociate'; al crear o quitar un par se escribe en CADA fila
--     de las dos empresas, con el nombre de la otra.
--  5. Al juntar (erp.junta_clientes) una empresa puede quedarse sin filas: sus pares pasan a la empresa que queda (los
--     que serían consigo misma o repetidos se borran, sin historial).
--
-- Nada más mira esta tabla: ni filtros, ni órdenes, ni permisos, ni informes. Es simbólica.
-- El campo de texto libre «Associated with» (`erp.customers.associated_with`) NO se toca.
--
-- Sin begin/commit propios: el ensayo con ROLLBACK envuelve el fichero.
-- Para deshacer: drop trigger customers_zz_asociaciones on erp.customers; drop table erp.customer_associations; drop
-- function erp.asociados_de_la_empresa(uuid), erp.customer_associations_antes(), erp.customer_associations_historial(),
-- erp.customers_asociaciones_al_juntar(); devolver customer_history_kind a la 245 (borrando antes las filas
-- 'associate'/'dissociate'); borrar la fila del registro.

do $pre$
begin
  if to_regprocedure('erp.es_admin_de_clientes()') is null then raise exception '249: falta erp.es_admin_de_clientes(); aplica primero la 241'; end if;
  if not exists (select 1 from pg_constraint where conname = 'customer_history_kind' and pg_get_constraintdef(oid) like '%''rep''%') then
    raise exception '249: customer_history_kind no tiene ''rep''; aplica primero la 245';
  end if;
end $pre$;

-- ---------------------------------------------------------------------------
-- 1. La tabla
-- ---------------------------------------------------------------------------
create table if not exists erp.customer_associations (
  id          bigint generated always as identity primary key,
  company_a   uuid not null,
  company_b   uuid not null,
  created_by  uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  constraint customer_associations_no_consigo check (company_a <> company_b)
);
create unique index if not exists customer_associations_par
  on erp.customer_associations (least(company_a, company_b), greatest(company_a, company_b));
create index if not exists customer_associations_por_b on erp.customer_associations (company_b);

create or replace function erp.customer_associations_antes()
  returns trigger language plpgsql security definer set search_path = pg_catalog, erp, pg_temp as $$
declare
  a uuid := least(NEW.company_a, NEW.company_b);
  b uuid := greatest(NEW.company_a, NEW.company_b);
begin
  if tg_op = 'UPDATE' then
    raise exception 'An association is not edited: remove it and add another' using errcode = '42501';
  end if;
  if not exists (select 1 from erp.customers c where c.company_id = a)
     or not exists (select 1 from erp.customers c where c.company_id = b) then
    raise exception 'Customer not found' using errcode = 'P0002';
  end if;
  NEW.company_a := a;
  NEW.company_b := b;
  NEW.created_by := auth.uid();
  NEW.created_at := now();
  return NEW;
end $$;
drop trigger if exists customer_associations_antes on erp.customer_associations;
create trigger customer_associations_antes before insert or update on erp.customer_associations
  for each row execute function erp.customer_associations_antes();

-- ---------------------------------------------------------------------------
-- 2. Quién lee y quién escribe
-- ---------------------------------------------------------------------------
revoke all on erp.customer_associations from public, anon, authenticated;
grant select, insert, delete on erp.customer_associations to authenticated;
alter table erp.customer_associations enable row level security;

drop policy if exists "customer associations gate" on erp.customer_associations;
create policy "customer associations gate" on erp.customer_associations as restrictive for all to authenticated
  using ((select public.has_customers_access())) with check ((select public.has_customers_access()));
drop policy if exists "customer associations read visible" on erp.customer_associations;
create policy "customer associations read visible" on erp.customer_associations as permissive for select to authenticated
  using (exists (select 1 from erp.customers c where c.company_id in (customer_associations.company_a, customer_associations.company_b)));
drop policy if exists "customer associations insert (admin)" on erp.customer_associations;
create policy "customer associations insert (admin)" on erp.customer_associations as permissive for insert to authenticated
  with check ((select erp.es_admin_de_clientes()));
drop policy if exists "customer associations delete (admin)" on erp.customer_associations;
create policy "customer associations delete (admin)" on erp.customer_associations as permissive for delete to authenticated
  using ((select erp.es_admin_de_clientes()));

-- ---------------------------------------------------------------------------
-- 3. Las asociadas de una empresa, con nombre
-- ---------------------------------------------------------------------------
create or replace function erp.asociados_de_la_empresa(p_company uuid)
  returns table (id bigint, company_id uuid, account text, stores text[], crm_type text, all_archived boolean,
                 created_by uuid, created_at timestamptz)
  language sql stable security definer set search_path = pg_catalog, public, erp, pg_temp as $$
  with puede as (
    select public.has_customers_access()
       and exists (select 1 from erp.customers c
                    where c.company_id = p_company
                      and erp.customers_ve_la_fila(c.rep_id, c.created_by, c.store)) as si
  ), pares as (
    select x.id, case when x.company_a = p_company then x.company_b else x.company_a end as otra, x.created_by, x.created_at
      from erp.customer_associations x, puede
     where puede.si and p_company in (x.company_a, x.company_b)
  )
  select p.id, p.otra,
         (array_agg(c.account order by (c.archived_at is not null), c.id))[1],
         array_agg(distinct c.store) filter (where c.store is not null and c.archived_at is null),
         (array_agg(coalesce(nullif(btrim(c.crm_type_group), ''), nullif(btrim(c.crm_type_store), '')) order by (c.archived_at is not null), c.id)
            filter (where coalesce(nullif(btrim(c.crm_type_group), ''), nullif(btrim(c.crm_type_store), '')) is not null))[1],
         bool_and(c.archived_at is not null),
         p.created_by, p.created_at
    from pares p join erp.customers c on c.company_id = p.otra
   group by p.id, p.otra, p.created_by, p.created_at
   order by 3, p.id;
$$;
revoke all on function erp.asociados_de_la_empresa(uuid) from public, anon;
grant execute on function erp.asociados_de_la_empresa(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. El historial, en las dos empresas
-- ---------------------------------------------------------------------------
alter table erp.customer_history drop constraint if exists customer_history_kind;
alter table erp.customer_history add constraint customer_history_kind
  check (kind in ('create', 'edit', 'archive', 'restore', 'approved', 'rejected', 'merge', 'review', 'corrected', 'rep',
                  'associate', 'dissociate'));

create or replace function erp.customer_associations_historial()
  returns trigger language plpgsql security definer set search_path = pg_catalog, public, erp, pg_temp as $$
declare
  r erp.customer_associations;
  v_kind text;
  nombre_a text;
  nombre_b text;
begin
  -- Lo que hace el juntar (5) no es una decisión de nadie: no se apunta.
  if coalesce(current_setting('rtg.asociacion_al_juntar', true), '') = '1' then return null; end if;
  if tg_op = 'INSERT' then r := NEW; v_kind := 'associate'; else r := OLD; v_kind := 'dissociate'; end if;
  select c.account into nombre_a from erp.customers c where c.company_id = r.company_a order by (c.archived_at is not null), c.id limit 1;
  select c.account into nombre_b from erp.customers c where c.company_id = r.company_b order by (c.archived_at is not null), c.id limit 1;
  insert into erp.customer_history (customer_id, by, kind, after)
    select c.id, auth.uid(), v_kind, jsonb_build_object('associated_customer', nombre_b, 'associated_company', r.company_b)
      from erp.customers c where c.company_id = r.company_a;
  insert into erp.customer_history (customer_id, by, kind, after)
    select c.id, auth.uid(), v_kind, jsonb_build_object('associated_customer', nombre_a, 'associated_company', r.company_a)
      from erp.customers c where c.company_id = r.company_b;
  return null;
end $$;
drop trigger if exists customer_associations_historial on erp.customer_associations;
create trigger customer_associations_historial after insert or delete on erp.customer_associations
  for each row execute function erp.customer_associations_historial();

-- ---------------------------------------------------------------------------
-- 5. Al juntar empresas
-- ---------------------------------------------------------------------------
create or replace function erp.customers_asociaciones_al_juntar()
  returns trigger language plpgsql security definer set search_path = pg_catalog, erp, pg_temp as $$
begin
  if exists (select 1 from erp.customers c where c.company_id = OLD.company_id) then return null; end if;
  perform set_config('rtg.asociacion_al_juntar', '1', true);
  -- Las que serían consigo misma, o que ya existen con la empresa que queda.
  delete from erp.customer_associations x
   where (x.company_a = OLD.company_id and x.company_b = NEW.company_id)
      or (x.company_b = OLD.company_id and x.company_a = NEW.company_id)
      or (OLD.company_id in (x.company_a, x.company_b) and exists (
            select 1 from erp.customer_associations y
             where y.id <> x.id
               and least(y.company_a, y.company_b) = least(NEW.company_id, case when x.company_a = OLD.company_id then x.company_b else x.company_a end)
               and greatest(y.company_a, y.company_b) = greatest(NEW.company_id, case when x.company_a = OLD.company_id then x.company_b else x.company_a end)));
  -- El resto pasa a la empresa que queda (borrar y crear: la fila no se edita).
  with movidas as (
    delete from erp.customer_associations x where OLD.company_id in (x.company_a, x.company_b)
    returning case when x.company_a = OLD.company_id then x.company_b else x.company_a end as otra, x.created_by, x.created_at
  )
  insert into erp.customer_associations (company_a, company_b, created_by, created_at)
    select NEW.company_id, m.otra, m.created_by, m.created_at from movidas m;
  perform set_config('rtg.asociacion_al_juntar', '', true);
  return null;
end $$;
drop trigger if exists customers_zz_asociaciones on erp.customers;
create trigger customers_zz_asociaciones after update of company_id on erp.customers
  for each row when (OLD.company_id is distinct from NEW.company_id)
  execute function erp.customers_asociaciones_al_juntar();

do $chk$
begin
  if to_regclass('erp.customer_associations') is null then raise exception '249: falta erp.customer_associations'; end if;
  if (select count(*) from pg_policies where schemaname = 'erp' and tablename = 'customer_associations') <> 4 then
    raise exception '249: las politicas de customer_associations no son 4';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'customer_history_kind' and pg_get_constraintdef(oid) like '%''dissociate''%') then
    raise exception '249: customer_history_kind no admite ''dissociate''';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'erp.customer_associations'::regclass and tgname = 'customer_associations_historial') then
    raise exception '249: falta el disparador del historial';
  end if;
end $chk$;
-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('249_clientes_asociaciones.sql', '16d32cd93fa201acd1da82dda641699010edab73ba1c87f57d4f79b3e8b2d5d6') on conflict (name) do nothing;
