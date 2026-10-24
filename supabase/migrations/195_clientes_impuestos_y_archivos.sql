-- ===========================================================================
-- 195 . Clientes: impuestos por tienda, sitio web y archivos adjuntos (D-672)
-- ===========================================================================
-- PEDIDO. Roberto Rodriguez Jr (admin), 2026-10-24, en Clientes: «Need to be able to attach files like No Sales Tax Form.
-- Need to know their tax terms too and it can vary by store bc each store needs the form signed if they want to apply»;
-- «Since we are adding tax terms it'll replace the spot for Type»; y «need to add Website under contact».
--
-- QUE HACE:
--  1. `erp.customers.tax_terms`: 'taxable' (paga impuesto) o 'exempt' (exento); null = no se sabe. Es de la FILA, y una
--     fila es una tienda (D-633): cada tienda lleva el suyo, porque cada tienda necesita su formulario firmado.
--  2. `erp.customers.website`: el sitio web de la cuenta (texto; la app lo enlaza).
--  3. `erp.customer_files`: los archivos de una fila (una tienda), con su clase: 'no_sales_tax' (el formulario de exencion)
--     u 'other'. El fichero vive en el cubo privado `customer-files` (25 MB), en `<id de la fila>/<nombre unico>`; se abre
--     con un enlace firmado. Leen quienes entran a Clientes; suben y quitan quienes editan Clientes
--     (`erp.customers_can_write()`, el admin o el gerente con el modulo), con la MISMA regla en la tabla y en el cubo.
--
-- Sin begin/commit: quien aplica envuelve el fichero.
--
-- Reversion: `drop table erp.customer_files;`, borrar el cubo `customer-files` (y sus ficheros), `alter table erp.customers
-- drop column tax_terms, drop column website;` y borrar la fila del registro.

alter table erp.customers add column if not exists tax_terms text;
alter table erp.customers add column if not exists website text;
alter table erp.customers drop constraint if exists customers_tax_terms_valido;
alter table erp.customers add constraint customers_tax_terms_valido check (tax_terms is null or tax_terms in ('taxable', 'exempt'));

create table if not exists erp.customer_files (
  id bigint generated always as identity primary key,
  customer_id bigint not null references erp.customers(id) on delete cascade,
  kind text not null default 'other' check (kind in ('no_sales_tax', 'other')),
  name text not null check (length(btrim(name)) > 0),
  path text not null unique,
  size_bytes bigint,
  content_type text,
  uploaded_by uuid default auth.uid(),
  uploaded_at timestamptz not null default now()
);
create index if not exists customer_files_por_cliente on erp.customer_files (customer_id);

revoke all on erp.customer_files from public, anon, authenticated;
grant select, insert, delete on erp.customer_files to authenticated;
alter table erp.customer_files enable row level security;

drop policy if exists "customer files gate" on erp.customer_files;
create policy "customer files gate" on erp.customer_files as restrictive for all to authenticated
  using ((select public.has_customers_access())) with check ((select public.has_customers_access()));
drop policy if exists "customer files read" on erp.customer_files;
create policy "customer files read" on erp.customer_files as permissive for select to authenticated
  using (true);
drop policy if exists "customer files insert (writers)" on erp.customer_files;
create policy "customer files insert (writers)" on erp.customer_files as permissive for insert to authenticated
  with check ((select erp.customers_can_write()));
drop policy if exists "customer files delete (writers)" on erp.customer_files;
create policy "customer files delete (writers)" on erp.customer_files as permissive for delete to authenticated
  using ((select erp.customers_can_write()));

insert into storage.buckets (id, name, public, file_size_limit)
values ('customer-files', 'customer-files', false, 26214400)
on conflict (id) do update set public = false, file_size_limit = 26214400;

drop policy if exists "customer files bucket read"   on storage.objects;
drop policy if exists "customer files bucket insert" on storage.objects;
drop policy if exists "customer files bucket delete" on storage.objects;

create policy "customer files bucket read" on storage.objects for select to authenticated
  using (bucket_id = 'customer-files' and (select public.has_customers_access()));
create policy "customer files bucket insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'customer-files' and (select public.has_customers_access()) and (select erp.customers_can_write()));
create policy "customer files bucket delete" on storage.objects for delete to authenticated
  using (bucket_id = 'customer-files' and (select public.has_customers_access()) and (select erp.customers_can_write()));

-- ===========================================================================
-- Autocomprobacion (mira el catalogo)
-- ===========================================================================
do $chk$
begin
  if not exists (select 1 from pg_attribute where attrelid = 'erp.customers'::regclass and attname = 'tax_terms' and not attisdropped)
     or not exists (select 1 from pg_attribute where attrelid = 'erp.customers'::regclass and attname = 'website' and not attisdropped) then
    raise exception '195: faltan tax_terms o website';
  end if;
  if not exists (select 1 from pg_class where oid = 'erp.customer_files'::regclass and relrowsecurity) then
    raise exception '195: customer_files sin RLS';
  end if;
  if (select count(*) from pg_policies where schemaname = 'erp' and tablename = 'customer_files') <> 4 then
    raise exception '195: se esperaban 4 politicas en customer_files';
  end if;
  if (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'customer files bucket %') <> 3 then
    raise exception '195: se esperaban 3 politicas en el cubo';
  end if;
  if not exists (select 1 from storage.buckets where id = 'customer-files' and not public) then
    raise exception '195: el cubo no existe o es publico';
  end if;
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('195_clientes_impuestos_y_archivos.sql', '84057a124e9471aef11d1f9c21d0fc4195ffa06146e64001112801e4b5c33b01') on conflict (name) do nothing;
