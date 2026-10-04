-- ===========================================================================
-- 161 - Los PRODUCTOS del estimado de la competencia (leidos del PDF o la foto, corregidos a mano) y el registro de
--       quien pidio cada lectura automatica
-- ===========================================================================
-- Plan en papel: docs/PLAN-161-competencia-productos.md. ESCRITA Y NO APLICADA: aplicarla es del orquestador,
-- despues del merge, con respaldo hecho y migrate-status antes y despues.
--
-- DEPENDE DE LA 156 (y por ella de la 153 y la 148). La 156 esta escrita y sin aplicar (2026-10-04): hay que
-- aplicarla ANTES. Si no esta, esta migracion se para en su primera linea util con un mensaje que lo dice.
--
-- El dueno (2026-10-04): "in the quote builder addd the compettiton pdf or pcicture upload / compettiros company
-- name and also products from the  and the ocr to recognize the images,".
--
-- QUE TRAE:
--   1. public.estimator_competitor_extracts: UNA fila por archivo de la competencia (file_id es la clave), con la
--      empresa, la fecha y el numero del documento, subtotal / impuesto / total, y los productos en un jsonb
--      (descripcion, marca, sku, cantidad, unidad, precio unitario, total de linea y, si el vendedor la emparejo a
--      mano, el id de la linea propia). Hasta 200 productos.
--      VER: toda persona con el modulo (has_estimator_access()), igual que los archivos desde la 156.
--      GUARDAR / CORREGIR: quien subio el archivo o el admin. Sin DELETE: la fila se va con su archivo (cascade).
--   2. public.estimator_competitor_reads: el registro de cada lectura automatica (quien, que archivo, cuando, con
--      que modelo, cuantas paginas y tokens, y como acabo). Lo escribe SOLO el servidor con la llave de servicio
--      (ruta /api/estimator/leer-competencia); de el sale el tope diario. Lo lee el admin, y cada uno lo suyo.
--
-- LO QUE NO TOCA: estimator_competitor_files, su disparador, sus politicas ni el cubo; estimator_quotes. Ningun dato.
--
-- Sin begin/commit propios, a proposito: quien aplica envuelve el fichero en una transaccion, y un commit de dentro
-- cerraria la de fuera (paso con la 124).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 0. La 156 tiene que estar. Sin ella no existen los archivos sueltos ni la lectura abierta al modulo, y las
--    politicas de abajo dirian otra cosa de la que dice el plan.
-- ---------------------------------------------------------------------------
do $requiere$
begin
  if to_regclass('public.estimator_competitor_files') is null then
    raise exception '161: falta la migracion 153 (no existe public.estimator_competitor_files). Aplica 153 y 156 antes que la 161.';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public'
                   and table_name = 'estimator_competitor_files' and column_name = 'customer_name') then
    raise exception '161: falta la migracion 156 (estimator_competitor_files no tiene customer_name). Aplica la 156 antes que la 161.';
  end if;
end $requiere$;

-- ---------------------------------------------------------------------------
-- 1. Los productos y la cabecera de cada estimado de la competencia.
-- ---------------------------------------------------------------------------
create table if not exists public.estimator_competitor_extracts (
  file_id        uuid primary key references public.estimator_competitor_files(id) on delete cascade,
  competitor     text,
  doc_date       date,
  doc_number     text,
  subtotal       numeric(12,2),
  tax            numeric(12,2),
  total          numeric(12,2),
  -- [{id, description, brand, sku, quantity, unit, unit_price, line_total, matched_line_id}]. Lo que no se leyo, null.
  items          jsonb not null default '[]'::jsonb,
  -- 'ocr': salio de la lectura automatica (aunque luego se corrigiera). 'manual': se tecleo entera.
  source         text not null default 'manual',
  saved_by       uuid references public.profiles(id) on delete set null,
  saved_by_name  text,
  saved_at       timestamptz not null default now(),
  constraint estimator_competitor_extracts_empresa check (competitor is null or length(competitor) <= 120),
  constraint estimator_competitor_extracts_numero check (doc_number is null or length(doc_number) <= 60),
  constraint estimator_competitor_extracts_importes check (
    (subtotal is null or subtotal >= 0) and (tax is null or tax >= 0) and (total is null or total >= 0)),
  constraint estimator_competitor_extracts_items check (
    jsonb_typeof(items) = 'array' and jsonb_array_length(items) <= 200 and length(items::text) <= 200000),
  constraint estimator_competitor_extracts_origen check (source in ('ocr', 'manual'))
);

-- Quien guarda y cuando no los decide el navegador.
create or replace function public.estimator_competitor_extracts_guard()
  returns trigger language plpgsql security definer set search_path = public as $$
declare
  yo uuid := auth.uid();
begin
  if tg_op = 'UPDATE' then
    new.file_id := old.file_id;
  end if;
  if yo is not null then
    new.saved_by := yo;
  end if;
  new.competitor := nullif(btrim(coalesce(new.competitor, '')), '');
  new.doc_number := nullif(btrim(coalesce(new.doc_number, '')), '');
  new.saved_by_name := (select nullif(trim(full_name), '') from public.profiles where id = new.saved_by);
  new.saved_at := now();
  return new;
end $$;

drop trigger if exists estimator_competitor_extracts_guard on public.estimator_competitor_extracts;
create trigger estimator_competitor_extracts_guard before insert or update on public.estimator_competitor_extracts
  for each row execute function public.estimator_competitor_extracts_guard();

revoke all on public.estimator_competitor_extracts from anon, authenticated;
grant select, insert, update on public.estimator_competitor_extracts to authenticated;

alter table public.estimator_competitor_extracts enable row level security;

drop policy if exists "estimator_competitor_extracts select" on public.estimator_competitor_extracts;
drop policy if exists "estimator_competitor_extracts insert" on public.estimator_competitor_extracts;
drop policy if exists "estimator_competitor_extracts update" on public.estimator_competitor_extracts;

-- Ver: todo el que tenga el modulo, como los archivos (156).
create policy "estimator_competitor_extracts select" on public.estimator_competitor_extracts for select to authenticated
  using ((select public.has_estimator_access()));

-- Guardar: con el modulo, y solo sobre un archivo que subio uno mismo (o siendo admin). La subconsulta pasa por la
-- RLS de estimator_competitor_files, que con la 156 deja ver todos los archivos a quien tiene el modulo.
create policy "estimator_competitor_extracts insert" on public.estimator_competitor_extracts for insert to authenticated
  with check (
    (select public.has_estimator_access())
    and ((select public.is_admin())
         or exists (select 1 from public.estimator_competitor_files f where f.id = file_id and f.uploaded_by = (select auth.uid())))
  );

create policy "estimator_competitor_extracts update" on public.estimator_competitor_extracts for update to authenticated
  using (
    (select public.has_estimator_access())
    and ((select public.is_admin())
         or exists (select 1 from public.estimator_competitor_files f where f.id = file_id and f.uploaded_by = (select auth.uid())))
  )
  with check (
    (select public.has_estimator_access())
    and ((select public.is_admin())
         or exists (select 1 from public.estimator_competitor_files f where f.id = file_id and f.uploaded_by = (select auth.uid())))
  );

revoke execute on function public.estimator_competitor_extracts_guard() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. El registro de lecturas automaticas. Solo lo escribe el servidor (service role salta RLS): no hay ninguna
--    politica de escritura ni permiso de escritura para authenticated. Si alguien pudiera borrar sus filas, se
--    saltaria el tope diario, que es lo que evita gastar de mas en la API.
-- ---------------------------------------------------------------------------
create table if not exists public.estimator_competitor_reads (
  id             uuid primary key default gen_random_uuid(),
  file_id        uuid references public.estimator_competitor_files(id) on delete set null,
  -- Copiado: el archivo se puede quitar despues, y el registro tiene que seguir diciendo que se leyo.
  file_name      text,
  read_by        uuid references public.profiles(id) on delete set null,
  read_by_name   text,
  read_at        timestamptz not null default now(),
  model          text,
  pages          integer,
  bytes          bigint,
  input_tokens   integer,
  output_tokens  integer,
  status         text not null default 'started',
  error          text,
  constraint estimator_competitor_reads_estado check (status in ('started', 'ok', 'error')),
  constraint estimator_competitor_reads_error check (error is null or length(error) <= 300)
);

create index if not exists estimator_competitor_reads_at_idx on public.estimator_competitor_reads (read_at desc);

revoke all on public.estimator_competitor_reads from anon, authenticated;
grant select on public.estimator_competitor_reads to authenticated;

alter table public.estimator_competitor_reads enable row level security;

drop policy if exists "estimator_competitor_reads select" on public.estimator_competitor_reads;
create policy "estimator_competitor_reads select" on public.estimator_competitor_reads for select to authenticated
  using ((select public.is_admin()) or ((select public.has_estimator_access()) and read_by = (select auth.uid())));

-- ===========================================================================
-- Se comprueba a si misma
-- ===========================================================================
do $comprueba$
declare
  n int;
begin
  select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relname in ('estimator_competitor_extracts', 'estimator_competitor_reads') and c.relrowsecurity;
  if n <> 2 then raise exception '161: las dos tablas deben existir con RLS activa (hay %)', n; end if;

  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'estimator_competitor_extracts';
  if n <> 3 then raise exception '161: estimator_competitor_extracts debe tener 3 politicas, tiene %', n; end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'estimator_competitor_extracts'
              and cmd in ('ALL', 'DELETE')) then
    raise exception '161: una politica de estimator_competitor_extracts es ALL o DELETE';
  end if;
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'estimator_competitor_reads';
  if n <> 1 then raise exception '161: estimator_competitor_reads debe tener 1 politica (SELECT), tiene %', n; end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'estimator_competitor_reads' and cmd <> 'SELECT') then
    raise exception '161: estimator_competitor_reads solo puede tener politica de SELECT';
  end if;

  if has_table_privilege('anon', 'public.estimator_competitor_extracts', 'select')
     or has_table_privilege('anon', 'public.estimator_competitor_reads', 'select') then
    raise exception '161: anon no debe leer las tablas de la 161';
  end if;
  if has_table_privilege('authenticated', 'public.estimator_competitor_extracts', 'delete') then
    raise exception '161: authenticated no debe poder borrar de estimator_competitor_extracts';
  end if;
  if has_table_privilege('authenticated', 'public.estimator_competitor_reads', 'insert')
     or has_table_privilege('authenticated', 'public.estimator_competitor_reads', 'update')
     or has_table_privilege('authenticated', 'public.estimator_competitor_reads', 'delete') then
    raise exception '161: authenticated no debe poder escribir en estimator_competitor_reads (se saltaria el tope diario)';
  end if;
  if not has_table_privilege('service_role', 'public.estimator_competitor_reads', 'insert')
     or not has_table_privilege('service_role', 'public.estimator_competitor_reads', 'update') then
    raise exception '161: service_role debe poder escribir en estimator_competitor_reads (lo usa la ruta del servidor)';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.estimator_competitor_extracts'::regclass
                   and tgname = 'estimator_competitor_extracts_guard' and not tgisinternal) then
    raise exception '161: falta el disparador estimator_competitor_extracts_guard';
  end if;
end $comprueba$;

-- ===========================================================================
-- Ensayo por rol, con ROLLBACK: en el plan (docs/PLAN-161-competencia-productos.md, seccion 6).
-- Reversion (para pegar A MANO, en una transaccion propia): en el plan, seccion 8.
-- ===========================================================================

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('161_competencia_productos.sql', '7e44fa642ae08df0ef7d2962c34d277fe5a7fe37bbca96a3ca6946e70863204e') on conflict (name) do nothing;
