-- ===========================================================================
-- 156 - Estimados de la competencia SUELTOS (sin cotizacion) y una lista que ven todos los vendedores del modulo
-- ===========================================================================
-- Plan en papel: docs/PLAN-156-competencia-suelta.md. ESCRITA Y NO APLICADA: aplicarla es del orquestador,
-- despues del merge, con respaldo hecho y migrate-status antes y despues.
--
-- El dueno (2026-09-29): "THE COMEPTITORS ESTIMATE YOU CAN UPLOAD IT WITHOUT NEEDE TO CREATE AN ESTIMATE / AND I
-- WANT IT TO SHOW ALL ESTIAMTES IN A TAB AND ALL SALES REP COULD SEE IT".
--
-- QUE CAMBIA (sobre la 153):
--   1. estimator_competitor_files.quote_id pasa a OPCIONAL. Un archivo suelto lleva en su lugar el nombre del cliente
--      (obligatorio si no hay cotizacion), la tienda y, opcional, un # de estimado escrito a mano.
--   2. Columnas nuevas: customer_name, store, estimate_num. En los pegados a una cotizacion, el disparador copia el
--      estimate_num y la tienda de la cotizacion (el vendedor que no ve esa cotizacion ve igual de cual es).
--   3. Ruta de los sueltos: 'general/<uid de quien sube>/...'. Techo: 50 por persona (tabla y cubo).
--   4. VER se abre: toda persona con el modulo (has_estimator_access(): admin o la casilla 'estimator') ve TODAS las
--      filas y puede firmar TODOS los objetos del cubo, de todas las tiendas. Antes: quien veia la cotizacion.
--   5. QUITAR sigue igual (quien lo subio o el admin), sin exigir ya ver la cotizacion.
--   6. SUBIR a una cotizacion sigue igual (dueno, aprobado, admin: estimator_can_attach).
--
-- LO QUE NO TOCA: estimator_quotes ni estimator_approvals ni sus politicas; el cubo (limite y tipos); ningun dato.
-- Las filas que ya hay (0 el 2026-09-29) siguen validas: tienen quote_id.
--
-- Sin begin/commit propios, a proposito: quien aplica envuelve el fichero en una transaccion, y un commit de dentro
-- cerraria la de fuera (paso con la 124).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Columnas y restricciones.
-- ---------------------------------------------------------------------------
alter table public.estimator_competitor_files alter column quote_id drop not null;
alter table public.estimator_competitor_files add column if not exists customer_name text;
alter table public.estimator_competitor_files add column if not exists store text;
alter table public.estimator_competitor_files add column if not exists estimate_num text;

alter table public.estimator_competitor_files drop constraint if exists estimator_competitor_files_cliente;
alter table public.estimator_competitor_files drop constraint if exists estimator_competitor_files_tienda;
alter table public.estimator_competitor_files drop constraint if exists estimator_competitor_files_estimado;
alter table public.estimator_competitor_files drop constraint if exists estimator_competitor_files_suelto;
alter table public.estimator_competitor_files
  add constraint estimator_competitor_files_cliente check (customer_name is null or length(customer_name) <= 120),
  add constraint estimator_competitor_files_tienda check (store is null or length(store) <= 80),
  add constraint estimator_competitor_files_estimado check (estimate_num is null or length(estimate_num) <= 60),
  -- Un suelto sin cotizacion tiene que decir de quien es: si no, la lista tendria filas que nadie reconoce.
  add constraint estimator_competitor_files_suelto check (quote_id is not null or length(btrim(coalesce(customer_name, ''))) > 0);

-- La lista de la pestana va de lo mas nuevo a lo mas viejo.
create index if not exists estimator_competitor_files_uploaded_idx on public.estimator_competitor_files (uploaded_at desc);

-- ---------------------------------------------------------------------------
-- 2. Cuantos objetos sueltos tiene ya una persona en el cubo. Definer por lo mismo que la de la 153: cuenta en
--    storage.objects, cuya RLS no es la de quien pregunta; devuelve solo un numero.
-- ---------------------------------------------------------------------------
create or replace function public.estimator_competitor_loose_count(p_user text)
  returns integer language sql stable security definer set search_path = public, storage as $$
  select count(*)::int from storage.objects
   where bucket_id = 'estimator-competitor-files'
     and (storage.foldername(name))[1] = 'general'
     and (storage.foldername(name))[2] = p_user;
$$;

-- ---------------------------------------------------------------------------
-- 3. El disparador, con las dos rutas.
-- ---------------------------------------------------------------------------
create or replace function public.estimator_competitor_files_guard()
  returns trigger language plpgsql security definer set search_path = public, storage as $$
declare
  yo  uuid := auth.uid();
  obj record;
  n   int;
  q   record;
begin
  if yo is not null then
    new.uploaded_by := yo;
  end if;
  if new.path is null or position('..' in new.path) > 0 then
    raise exception 'The file path must be inside its folder' using errcode = '22023';
  end if;
  if new.quote_id is not null then
    if new.path not like new.quote_id::text || '/%' then
      raise exception 'The file path must be inside its quote folder' using errcode = '22023';
    end if;
  else
    -- Suelto: en la carpeta de quien lo sube. Sin sesion (postgres, service role) basta con 'general/<uid>/'.
    if new.uploaded_by is null or new.path not like 'general/' || new.uploaded_by::text || '/%' then
      raise exception 'A loose file must be inside general/<your id>/' using errcode = '22023';
    end if;
  end if;
  -- El objeto tiene que existir: una fila sin archivo seria una lista que miente.
  select o.metadata into obj from storage.objects o
   where o.bucket_id = 'estimator-competitor-files' and o.name = new.path;
  if not found then
    raise exception 'The file was not uploaded' using errcode = '22023';
  end if;
  new.size_bytes := coalesce(nullif(obj.metadata->>'size', '')::bigint, new.size_bytes);
  new.mime_type  := coalesce(nullif(obj.metadata->>'mimetype', ''), new.mime_type);
  new.customer_name := nullif(btrim(coalesce(new.customer_name, '')), '');
  new.store := nullif(btrim(coalesce(new.store, '')), '');
  new.estimate_num := nullif(btrim(coalesce(new.estimate_num, '')), '');
  if new.quote_id is not null then
    select count(*) into n from public.estimator_competitor_files where quote_id = new.quote_id;
    if n >= 5 then
      raise exception 'Up to 5 competitor files per quote' using errcode = '23514';
    end if;
    -- De que estimado es y su tienda, copiados: quien no ve la cotizacion (RLS de la 148) ve igual de cual es.
    select estimate_num, store into q from public.estimator_quotes where id = new.quote_id;
    new.estimate_num := q.estimate_num;
    new.store := coalesce(new.store, q.store);
  else
    select count(*) into n from public.estimator_competitor_files where quote_id is null and uploaded_by = new.uploaded_by;
    if n >= 50 then
      raise exception 'Up to 50 loose competitor files per person' using errcode = '23514';
    end if;
  end if;
  -- Sin tienda escrita, la del perfil de quien sube.
  new.store := coalesce(new.store, (select nullif(btrim(store), '') from public.profiles where id = new.uploaded_by));
  new.uploaded_by_name := (select nullif(trim(full_name), '') from public.profiles where id = new.uploaded_by);
  new.uploaded_at := now();
  return new;
end $$;
-- El disparador de la 153 ya apunta a esta funcion por nombre: create or replace basta.

-- ---------------------------------------------------------------------------
-- 4. RLS de la tabla.
-- ---------------------------------------------------------------------------
drop policy if exists "estimator_competitor_files select" on public.estimator_competitor_files;
drop policy if exists "estimator_competitor_files insert" on public.estimator_competitor_files;
drop policy if exists "estimator_competitor_files delete" on public.estimator_competitor_files;

-- Ver: todo el que tenga el modulo, de todas las tiendas (lo pidio el dueno: "ALL SALES REP COULD SEE IT").
create policy "estimator_competitor_files select" on public.estimator_competitor_files for select to authenticated
  using ((select public.has_estimator_access()));

-- Subir: a una cotizacion, quien la puede editar (153); suelto, cualquiera con el modulo, en su carpeta. Siempre a
-- su nombre (el disparador ya lo puso antes de mirar esto).
create policy "estimator_competitor_files insert" on public.estimator_competitor_files for insert to authenticated
  with check (
    uploaded_by = (select auth.uid())
    and (
      (quote_id is not null and public.estimator_can_attach(quote_id::text))
      or (quote_id is null and (select public.has_estimator_access())
          and path like 'general/' || (select auth.uid())::text || '/%')
    )
  );

-- Quitar: quien lo subio o el admin, con el modulo.
create policy "estimator_competitor_files delete" on public.estimator_competitor_files for delete to authenticated
  using (
    (select public.has_estimator_access())
    and ((select public.is_admin()) or uploaded_by = (select auth.uid()))
  );

-- ---------------------------------------------------------------------------
-- 5. Politicas del cubo.
-- ---------------------------------------------------------------------------
drop policy if exists "estimator competitor files read"   on storage.objects;
drop policy if exists "estimator competitor files insert" on storage.objects;

-- Leer (firmar un enlace): todo el que tenga el modulo.
create policy "estimator competitor files read" on storage.objects for select to authenticated
  using (
    bucket_id = 'estimator-competitor-files'
    and (select public.has_estimator_access())
  );

-- Subir: a la carpeta de una cotizacion que puede editar, con menos de 5 (153); o a SU carpeta general/<uid>/, con
-- menos de 50. estimator_can_attach('general') es falso (no hay cotizacion con ese id), asi que las dos ramas no se
-- mezclan.
create policy "estimator competitor files insert" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'estimator-competitor-files'
    and (
      (public.estimator_can_attach((storage.foldername(name))[1])
        and public.estimator_competitor_object_count((storage.foldername(name))[1]) < 5)
      or ((storage.foldername(name))[1] = 'general'
        and (storage.foldername(name))[2] = (select auth.uid())::text
        and (select public.has_estimator_access())
        and public.estimator_competitor_loose_count((select auth.uid())::text) < 50)
    )
  );
-- "estimator competitor files delete" (quien lo subio por owner_id, o el admin) no cambia: vale igual para los sueltos.

revoke execute on function public.estimator_competitor_loose_count(text) from public, anon;
grant execute on function public.estimator_competitor_loose_count(text)  to authenticated;

-- ===========================================================================
-- Se comprueba a si misma
-- ===========================================================================
do $comprueba$
declare
  n int;
begin
  if (select is_nullable from information_schema.columns where table_schema = 'public'
        and table_name = 'estimator_competitor_files' and column_name = 'quote_id') <> 'YES' then
    raise exception '156: quote_id sigue siendo obligatorio';
  end if;
  select count(*) into n from information_schema.columns where table_schema = 'public'
     and table_name = 'estimator_competitor_files' and column_name in ('customer_name', 'store', 'estimate_num');
  if n <> 3 then raise exception '156: faltan columnas nuevas (hay %)', n; end if;

  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'estimator_competitor_files';
  if n <> 3 then raise exception '156: estimator_competitor_files debe tener 3 politicas, tiene %', n; end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'estimator_competitor_files'
              and cmd in ('ALL', 'UPDATE')) then
    raise exception '156: una politica de estimator_competitor_files es ALL o UPDATE';
  end if;
  -- Ver ya no depende de la cotizacion.
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'estimator_competitor_files'
              and cmd = 'SELECT' and qual like '%estimator_quotes%') then
    raise exception '156: la politica de SELECT aun mira estimator_quotes';
  end if;
  if has_table_privilege('anon', 'public.estimator_competitor_files', 'select') then
    raise exception '156: anon no debe leer estimator_competitor_files';
  end if;
  if has_table_privilege('authenticated', 'public.estimator_competitor_files', 'update') then
    raise exception '156: authenticated no debe poder actualizar estimator_competitor_files';
  end if;

  select count(*) into n from pg_policies
   where schemaname = 'storage' and tablename = 'objects' and policyname like 'estimator competitor files %';
  if n <> 3 then raise exception '156: el cubo debe tener 3 politicas, tiene %', n; end if;
  if not exists (select 1 from storage.buckets where id = 'estimator-competitor-files' and public = false) then
    raise exception '156: el cubo no esta o es publico';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.estimator_competitor_files'::regclass
                   and tgname = 'estimator_competitor_files_guard' and not tgisinternal) then
    raise exception '156: falta el disparador estimator_competitor_files_guard';
  end if;
end $comprueba$;

-- ===========================================================================
-- Ensayo por rol, con ROLLBACK: en el plan (docs/PLAN-156-competencia-suelta.md, seccion 6).
-- ===========================================================================

-- ===========================================================================
-- Reversion a la 153 (para pegar A MANO, en una transaccion propia): en el plan, seccion 8. ANTES hay que quitar los
-- sueltos (quote_id null) con la API de Storage y sus filas, o el "set not null" falla.
-- ===========================================================================

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('156_competencia_suelta.sql', '710860de51a574602a5c714def6916eadc4b0e1b309b8ee8babbadddd414c938') on conflict (name) do nothing;
