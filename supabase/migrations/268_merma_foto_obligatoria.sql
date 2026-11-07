-- 268: Merma: la foto es obligatoria, se puede guardar «sin foto» (papel) y cada foto lleva su huella (Warehouse Ops) (2026-11-06).
--
-- Reunion del dueno con Roberto (2026-11-06): Francis subio las mismas fotos en varias mermas y las tomaba DESPUES de
-- capturar los datos. Lo decidido: la foto va primero y es obligatoria; si lo apuntaron en papel, se guarda como
-- borrador «sin foto» y queda incompleto hasta que le agreguen la foto (el gerente lo ve como «foto pendiente» a las
-- 24 h); y cada foto lleva su SHA-256 para avisar cuando una ya se uso en otro reporte (solo aviso, no bloquea).
--
-- Que hace:
--   1. public.warehouse_reports.photo_pending (boolean, default false): merma guardada sin foto, a la espera de ella.
--      public.warehouse_reports.photo_hashes (text[]): el SHA-256 hexadecimal de cada foto, ALINEADO con `photos`
--      (misma posicion; null donde no se conoce). Las fotos de antes de esta migracion quedan sin huella: SQL no puede
--      leer los bytes de storage (storage.objects solo guarda metadatos). La pantalla la calcula al abrir la tarjeta y
--      la guarda con warehouse_ops_set_photo_hashes.
--   2. Un trigger BEFORE INSERT OR UPDATE, warehouse_report_photos_guard:
--        - la pantalla manda dentro de `answers` answers.photo_pending (true) y answers.photo_hashes (lista alineada
--          con p_photos); el trigger los valida, los pasa a sus columnas y los quita de `answers`. Mismo camino que la
--          266 (broken_on): warehouse_ops_file_report no cambia de firma ni de cuerpo, la pantalla desplegada sigue
--          entrando, y la regla queda en la tabla, donde ninguna reescritura futura de la funcion la puede perder.
--        - LA REGLA: una merma sin fotos solo entra si photo_pending = true. Con fotos, photo_pending vuelve a false.
--          En UPDATE solo se revisa si cambiaron `photos` o `photo_pending`: las mermas viejas sin foto (de antes de
--          esto) siguen pudiendose corregir (producto, origen, CRMA) sin que se les exija una foto a destiempo.
--        - Lo que no es merma nunca queda photo_pending.
--   3. warehouse_ops_add_photos(p_report, p_photos, p_hashes): agrega fotos a una MERMA que esta «sin foto» (photo_pending
--      o sin fotos todavia); exige al menos una, que sean de la carpeta de quien llama, y quita photo_pending. Quien
--      llama debe poder ver el reporte (warehouse_ops_can_see) y ser su autor o quien corrige la merma de esa tienda
--      (warehouse_ops_can_manage, 265). Maximo 6 fotos en total (el limite de la 247).
--   4. warehouse_ops_set_photo_hashes(p_report, p_hashes): rellena las huellas que faltan (fotos de antes de la 268).
--      Solo rellena huecos, nunca cambia una huella ya guardada; p_hashes debe venir alineado con photos (misma
--      cantidad). Quien puede ver el reporte (warehouse_ops_can_see).
--   5. Un indice GIN sobre photo_hashes: la pantalla pregunta «¿que reportes llevan esta huella?» con `@>`.
--
-- ORDEN: se puede aplicar ANTES o DESPUES de desplegar la pantalla nueva.
--   - Pantalla vieja + esta migracion: una merma sin foto que antes entraba ahora la rechaza la base
--     («la merma necesita al menos una foto»); la pantalla vieja ensena ese mensaje en rojo. Es lo que el dueno pidio.
--   - Pantalla nueva sin esta migracion: la foto sigue siendo obligatoria EN LA PANTALLA (no deja enviar sin ella) y
--     el icono de camara sale igual (`photos` ya existe). «Guardar sin foto» entra como merma normal con
--     answers.photo_pending = true y las huellas dentro de answers.photo_hashes; el paso 2b los recoge al aplicar
--     esto. Mientras tanto no hay insignia de «falta la foto» ni aviso de repetidas (la pantalla lo tolera: la
--     consulta por huella devuelve vacio). Y «agregar la foto» a una guardada sin foto falla hasta aplicarla.
--   Mejor aplicarla ANTES del deploy; nada se rompe si va despues.
-- Depende de la 265 (warehouse_ops_can_manage, warehouse_ops_can_see) y de la 247 (photos, cubo).
--
-- Sin begin/commit propios. Para deshacer:
--   drop trigger if exists warehouse_reports_photos_guard on public.warehouse_reports;
--   drop function if exists public.warehouse_report_photos_guard();
--   drop function if exists public.warehouse_ops_add_photos(uuid, text[], text[]);
--   drop function if exists public.warehouse_ops_set_photo_hashes(uuid, text[]);
--   drop index if exists public.warehouse_reports_photo_hashes;
--   drop index if exists public.warehouse_reports_photo_pending;
--   alter table public.warehouse_reports drop column if exists photo_hashes;
--   alter table public.warehouse_reports drop column if exists photo_pending;
--   delete from public.schema_migrations where name = '268_merma_foto_obligatoria.sql';

-- 1. Las columnas
alter table public.warehouse_reports add column if not exists photo_pending boolean not null default false;
alter table public.warehouse_reports add column if not exists photo_hashes text[];

-- 2b. Lo que una pantalla nueva haya guardado dentro de answers antes de aplicar esto.
do $previas$
declare f record; h text[]; n int;
begin
  for f in select id, photos, answers from public.warehouse_reports where answers ? 'photo_hashes' or answers ? 'photo_pending' loop
    begin
      if jsonb_typeof(f.answers->'photo_hashes') = 'array' then
        select coalesce(array_agg(case when x ~ '^[0-9a-f]{64}$' then x end order by o), '{}') into h
          from jsonb_array_elements_text(f.answers->'photo_hashes') with ordinality as t(x, o);
        n := cardinality(coalesce(f.photos, '{}'));
        -- Alineado con photos: se recorta o se rellena con null.
        h := (select coalesce(array_agg(h[i]), '{}') from generate_series(1, n) i);
        if n > 0 then update public.warehouse_reports set photo_hashes = h where id = f.id and photo_hashes is null; end if;
      end if;
      -- Un «sin foto» guardado antes de la columna: se respeta solo si de verdad no tiene fotos.
      if f.answers->>'photo_pending' = 'true' and cardinality(coalesce(f.photos, '{}')) = 0 then
        update public.warehouse_reports set photo_pending = true where id = f.id;
      end if;
    exception when others then null;
    end;
  end loop;
end $previas$;
update public.warehouse_reports set answers = answers - 'photo_hashes' - 'photo_pending'
 where answers ? 'photo_hashes' or answers ? 'photo_pending';

-- 2. El trigger
create or replace function public.warehouse_report_photos_guard()
  returns trigger language plpgsql set search_path = public as $$
declare
  n int;
  h text[];
  cambio boolean;
begin
  -- Lo que la pantalla manda dentro de answers pasa a sus columnas (solo al crear; al corregir, answers no trae nada).
  if NEW.answers ? 'photo_pending' then
    if TG_OP = 'INSERT' and NEW.answers->>'photo_pending' = 'true' then NEW.photo_pending := true; end if;
    NEW.answers := NEW.answers - 'photo_pending';
  end if;
  if NEW.answers ? 'photo_hashes' then
    if TG_OP = 'INSERT' and jsonb_typeof(NEW.answers->'photo_hashes') = 'array' then
      select coalesce(array_agg(case when x ~ '^[0-9a-f]{64}$' then x end order by o), '{}') into h
        from jsonb_array_elements_text(NEW.answers->'photo_hashes') with ordinality as t(x, o);
      NEW.photo_hashes := h;
    end if;
    NEW.answers := NEW.answers - 'photo_hashes';
  end if;

  NEW.photos := coalesce(NEW.photos, '{}');
  n := cardinality(NEW.photos);
  -- Las huellas, alineadas con las fotos: ni mas ni menos (null donde no se conoce). Sin fotos, sin huellas.
  if n = 0 then
    NEW.photo_hashes := null;
  else
    h := coalesce(NEW.photo_hashes, '{}');
    NEW.photo_hashes := (select coalesce(array_agg(case when h[i] ~ '^[0-9a-f]{64}$' then h[i] end), '{}') from generate_series(1, n) i);
  end if;

  if NEW.kind <> 'scrap' then
    NEW.photo_pending := false;
    return NEW;
  end if;
  -- Con fotos ya no esta pendiente.
  if n > 0 then NEW.photo_pending := false; end if;

  -- LA REGLA: la merma sin fotos solo entra como «sin foto» (papel). Al corregir una merma vieja sin tocar las fotos
  -- no se exige nada: la regla es de ahora en adelante.
  cambio := TG_OP = 'INSERT' or NEW.photos is distinct from OLD.photos or NEW.photo_pending is distinct from OLD.photo_pending;
  if cambio and n = 0 and not NEW.photo_pending then
    raise exception 'warehouse_ops: la merma necesita al menos una foto de las piezas' using errcode = '23514';
  end if;
  return NEW;
end $$;

drop trigger if exists warehouse_reports_photos_guard on public.warehouse_reports;
create trigger warehouse_reports_photos_guard before insert or update on public.warehouse_reports
  for each row execute function public.warehouse_report_photos_guard();
revoke all on function public.warehouse_report_photos_guard() from public, anon, authenticated;

-- 3. Agregar las fotos a una merma guardada sin ellas
create or replace function public.warehouse_ops_add_photos(p_report uuid, p_photos text[], p_hashes text[])
  returns void
  language plpgsql volatile security definer set search_path = public as $$
declare
  yo uuid := auth.uid();
  r record;
  fotos text[] := coalesce(p_photos, '{}');
  huellas text[] := coalesce(p_hashes, '{}');
  viejas text[];
  n int := cardinality(coalesce(p_photos, '{}'));
begin
  select * into r from public.warehouse_reports where id = p_report;
  if r.id is null then raise exception 'warehouse_ops: reporte desconocido'; end if;
  -- Solo a una merma, y solo si esta a la espera de la foto (o aun no tiene ninguna): no es un editor de fotos general.
  if r.kind <> 'scrap' then
    raise exception 'warehouse_ops: solo a una merma se le agrega la foto despues' using errcode = '22023';
  end if;
  if not (r.photo_pending or cardinality(coalesce(r.photos, '{}')) = 0) then
    raise exception 'warehouse_ops: este reporte ya tiene su foto' using errcode = '22023';
  end if;
  -- Quien llama tiene que poder VER el reporte (RLS de la 265) y ademas ser su autor o quien corrige la merma de esa tienda.
  if yo is null or not public.warehouse_ops_can_see(r.kind, r.store, r.author_id) then
    raise exception 'warehouse_ops: sin acceso' using errcode = '42501';
  end if;
  if not (r.author_id = yo or public.warehouse_ops_can_manage(r.store)) then
    raise exception 'warehouse_ops: solo quien lo lleno o el gerente de la tienda agrega fotos' using errcode = '42501';
  end if;
  if n = 0 then raise exception 'warehouse_ops: falta la foto'; end if;
  if cardinality(coalesce(r.photos, '{}')) + n > 6 then raise exception 'warehouse_ops: demasiadas fotos'; end if;
  -- Las fotos son de la carpeta de quien las sube (la misma regla que warehouse_ops_file_report y el cubo).
  if exists (select 1 from unnest(fotos) f where split_part(f, '/', 1) <> yo::text) then
    raise exception 'warehouse_ops: foto no valida';
  end if;
  huellas := (select coalesce(array_agg(case when huellas[i] ~ '^[0-9a-f]{64}$' then huellas[i] end), '{}') from generate_series(1, n) i);
  -- Las huellas de las fotos que ya tenia, alineadas (null donde no se conoce), y detras las nuevas.
  viejas := (select coalesce(array_agg(case when (coalesce(r.photo_hashes, '{}'))[i] ~ '^[0-9a-f]{64}$' then (coalesce(r.photo_hashes, '{}'))[i] end), '{}')
               from generate_series(1, cardinality(coalesce(r.photos, '{}'))) i);
  update public.warehouse_reports
     set photos = coalesce(photos, '{}') || fotos,
         photo_hashes = viejas || huellas,
         photo_pending = false,
         edited_by = yo, edited_at = now()
   where id = p_report;
end $$;
revoke all on function public.warehouse_ops_add_photos(uuid, text[], text[]) from public, anon;
grant execute on function public.warehouse_ops_add_photos(uuid, text[], text[]) to authenticated;

-- 4. Rellenar las huellas de las fotos de antes (la pantalla las calcula al abrir la tarjeta)
create or replace function public.warehouse_ops_set_photo_hashes(p_report uuid, p_hashes text[])
  returns void
  language plpgsql volatile security definer set search_path = public as $$
declare
  yo uuid := auth.uid();
  r record;
  n int;
  nuevas text[];
begin
  select * into r from public.warehouse_reports where id = p_report;
  if r.id is null then raise exception 'warehouse_ops: reporte desconocido'; end if;
  if yo is null or not public.warehouse_ops_can_see(r.kind, r.store, r.author_id) then
    raise exception 'warehouse_ops: sin acceso' using errcode = '42501';
  end if;
  n := cardinality(coalesce(r.photos, '{}'));
  if n = 0 then return; end if;
  -- Las huellas vienen alineadas con las fotos: ni mas ni menos.
  if cardinality(coalesce(p_hashes, '{}')) <> n then
    raise exception 'warehouse_ops: las huellas no cuadran con las fotos (% fotos)', n using errcode = '22023';
  end if;
  -- Solo rellena huecos: una huella guardada no se cambia.
  nuevas := (select coalesce(array_agg(case
                when (coalesce(r.photo_hashes, '{}'))[i] ~ '^[0-9a-f]{64}$' then (coalesce(r.photo_hashes, '{}'))[i]
                when (coalesce(p_hashes, '{}'))[i] ~ '^[0-9a-f]{64}$' then (coalesce(p_hashes, '{}'))[i]
              end), '{}') from generate_series(1, n) i);
  if nuevas is distinct from r.photo_hashes then
    update public.warehouse_reports set photo_hashes = nuevas where id = p_report;
  end if;
end $$;
revoke all on function public.warehouse_ops_set_photo_hashes(uuid, text[]) from public, anon;
grant execute on function public.warehouse_ops_set_photo_hashes(uuid, text[]) to authenticated;

-- 5. Indices
create index if not exists warehouse_reports_photo_hashes on public.warehouse_reports using gin (photo_hashes);
create index if not exists warehouse_reports_photo_pending on public.warehouse_reports (created_at) where photo_pending;

-- ===========================================================================
-- Autocomprobacion
-- ===========================================================================
do $chk$
declare f text;
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'warehouse_reports' and column_name = 'photo_pending') then
    raise exception '268: falta warehouse_reports.photo_pending';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'warehouse_reports' and column_name = 'photo_hashes') then
    raise exception '268: falta warehouse_reports.photo_hashes';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.warehouse_reports'::regclass and tgname = 'warehouse_reports_photos_guard' and not tgisinternal) then
    raise exception '268: falta el guardia de fotos en warehouse_reports';
  end if;
  if exists (select 1 from public.warehouse_reports where answers ? 'photo_hashes' or answers ? 'photo_pending') then
    raise exception '268: quedaron huellas o photo_pending dentro de answers';
  end if;
  if exists (select 1 from public.warehouse_reports where kind <> 'scrap' and photo_pending) then
    raise exception '268: algo que no es merma quedo como sin foto';
  end if;
  if exists (select 1 from public.warehouse_reports where photo_hashes is not null and cardinality(photo_hashes) <> cardinality(photos)) then
    raise exception '268: huellas desalineadas con las fotos';
  end if;
  foreach f in array array[
    'public.warehouse_ops_add_photos(uuid, text[], text[])',
    'public.warehouse_ops_set_photo_hashes(uuid, text[])',
    'public.warehouse_report_photos_guard()'
  ] loop
    if has_function_privilege('anon', f, 'execute') then raise exception '268: anon ejecuta %', f; end if;
  end loop;
  f := pg_get_functiondef('public.warehouse_ops_add_photos(uuid, text[], text[])'::regprocedure);
  if position('warehouse_ops_can_manage(r.store)' in f) = 0 or position('warehouse_ops_can_see(r.kind, r.store, r.author_id)' in f) = 0
     or position('r.kind <> ''scrap''' in f) = 0 or position('r.photo_pending or cardinality' in f) = 0 then
    raise exception '268: warehouse_ops_add_photos no usa las puertas (ver, autor/gerente, solo merma sin foto)';
  end if;
  f := pg_get_functiondef('public.warehouse_ops_set_photo_hashes(uuid, text[])'::regprocedure);
  if position('warehouse_ops_can_see(r.kind, r.store, r.author_id)' in f) = 0 or position('las huellas no cuadran' in f) = 0 then
    raise exception '268: warehouse_ops_set_photo_hashes no usa la puerta de ver o no alinea las huellas';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'warehouse_reports' and cmd <> 'SELECT') then
    raise exception '268: warehouse_reports no debe tener politicas de escritura';
  end if;
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('268_merma_foto_obligatoria.sql', '4d39293c2438bd4b54b28c4ebdc685b5fad12dc46c36e60d34d3ecab74d4841c') on conflict (name) do nothing;
