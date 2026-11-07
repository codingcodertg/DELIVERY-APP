-- 270: Merma: etapas Documentada -> Fotografiada -> Aprobada -> Desechada -> Ajustada, con la hoja de aprobacion firmada (Warehouse Ops) (2026-11-07).
--
-- Roberto (pedido 1aeba1e3, 2026-11-07): «Need a stage column: Documented -> Photographed -> Approved -> Dumped. Need to
-- be able to select rows that will be printed for approval. They will sign the sheet, manager will attach it to that
-- report and then the status will turn to Approved. Date approved will be registered and date Dumped as well. Dumped
-- means the manager approved and they threw it in trash.» Y despues: «Last step will be 'Adjusted' which would be when
-- manager uploads screenshot that they registered it in the system.»
--
-- Que hace:
--   1. Columnas en public.warehouse_reports (todas nulas en lo que no es merma):
--        stage            text   la etapa, SIEMPRE derivada por el trigger (lo que se escriba a mano se recalcula):
--                                documented (sin foto) / photographed (con foto) / approved / dumped / adjusted.
--        photographed_at  timestamptz  cuando entro la primera foto (al crear con foto: created_at).
--        approved_at / approved_by / approval_sheet   la hoja de aprobacion firmada (ruta en el cubo 'warehouse-ops').
--        dumped_at / dumped_by                        el gerente marco que ya se tiro.
--        adjusted_at / adjusted_by / adjustment_proof la captura del ajuste en el sistema de inventario.
--      Las fechas y actores SON la bitacora de cada transicion (no hay tabla aparte: una fila, una merma, un camino).
--      No se escribe en security_events: la 053 lo reserva para cambios de acceso, a proposito.
--   2. Un trigger BEFORE INSERT OR UPDATE, warehouse_reports_stage_guard (corre DESPUES del de fotos de la 268, por
--      orden alfabetico): pone photographed_at cuando las fotos pasan de 0 a alguna, y recalcula stage con la fecha mas
--      avanzada (adjusted > dumped > approved > fotos > nada). Lo que no es merma queda todo en null.
--   3. Relleno de las mermas existentes: con fotos -> photographed (photographed_at = created_at); sin fotos -> documented.
--   4. warehouse_ops_set_scrap_stage(p_report, p_stage, p_proof): LA transicion. Reglas (las mismas que
--      src/lib/almacen-ops/etapas.ts; la prueba lee este fichero):
--        - solo merma; de 'documented' no se sale aqui (se sale agregando la foto, warehouse_ops_add_photos);
--        - hacia adelante de una en una: photographed -> approved -> dumped -> adjusted;
--        - approved y adjusted exigen p_proof (ruta de la carpeta de quien llama, en el cubo);
--        - hacia atras un paso, solo el admin de la app (nivel admin, o store_admin en sus tiendas): deshacer. Borra la
--          fecha, el actor y el adjunto de la etapa que se deshace; nunca vuelve a 'documented' (eso lo dicen las fotos);
--        - quien llama debe poder VER el reporte (warehouse_ops_can_see) y gestionarlo (warehouse_ops_can_manage, 265).
--      Guarda fecha y actor de la etapa; edited_by / edited_at como las correcciones de la 263.
--   5. El cubo 'warehouse-ops' admite PDF (la hoja firmada puede venir escaneada) y la politica de lectura deja ver
--      la hoja y la captura a quien ve el reporte (antes solo las fotos de `photos`).
--
-- ORDEN: se puede aplicar ANTES o DESPUES de desplegar la pantalla nueva. Mejor ANTES.
--   - Pantalla nueva sin esta migracion: `select *` no trae `stage`; la pantalla lo nota (tieneEtapas) y NO ofrece
--     controles de etapa ni casillas para la hoja; el chip de etapa sale derivado (con foto / sin foto) y nada se rompe.
--     La hoja impresa funciona igual (lee columnas de la 247). Adjuntar / marcar falla con «funcion desconocida».
--   - Pantalla vieja + esta migracion: no pasa nada visible; las columnas se rellenan solas.
-- Depende de la 265 (warehouse_ops_can_manage, warehouse_ops_can_see, warehouse_ops_level) y de la 268 (photos guard).
--
-- Sin begin/commit propios. Para deshacer:
--   drop trigger if exists warehouse_reports_stage_guard on public.warehouse_reports;
--   drop function if exists public.warehouse_report_stage_guard();
--   drop function if exists public.warehouse_ops_set_scrap_stage(uuid, text, text);
--   drop index if exists public.warehouse_reports_stage;
--   alter table public.warehouse_reports drop column if exists stage, drop column if exists photographed_at,
--     drop column if exists approved_at, drop column if exists approved_by, drop column if exists approval_sheet,
--     drop column if exists dumped_at, drop column if exists dumped_by,
--     drop column if exists adjusted_at, drop column if exists adjusted_by, drop column if exists adjustment_proof;
--   volver a crear la politica "warehouse ops bucket read" como en la 247 y quitar application/pdf del cubo;
--   delete from public.schema_migrations where name = '270_merma_etapas_de_aprobacion.sql';

-- 1. Las columnas
alter table public.warehouse_reports
  add column if not exists stage text,
  add column if not exists photographed_at timestamptz,
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid references auth.users(id) on delete set null,
  add column if not exists approval_sheet text,
  add column if not exists dumped_at timestamptz,
  add column if not exists dumped_by uuid references auth.users(id) on delete set null,
  add column if not exists adjusted_at timestamptz,
  add column if not exists adjusted_by uuid references auth.users(id) on delete set null,
  add column if not exists adjustment_proof text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'warehouse_reports_stage_check') then
    alter table public.warehouse_reports add constraint warehouse_reports_stage_check
      check (stage is null or stage in ('documented', 'photographed', 'approved', 'dumped', 'adjusted'));
  end if;
end $$;

-- 2. El trigger: la etapa siempre sale de las fechas
create or replace function public.warehouse_report_stage_guard()
  returns trigger language plpgsql set search_path = public as $$
declare n int;
begin
  if NEW.kind <> 'scrap' then
    NEW.stage := null; NEW.photographed_at := null;
    NEW.approved_at := null; NEW.approved_by := null; NEW.approval_sheet := null;
    NEW.dumped_at := null; NEW.dumped_by := null;
    NEW.adjusted_at := null; NEW.adjusted_by := null; NEW.adjustment_proof := null;
    return NEW;
  end if;
  n := cardinality(coalesce(NEW.photos, '{}'));
  if n = 0 then
    NEW.photographed_at := null;
  elsif NEW.photographed_at is null then
    -- La primera foto: al crear con foto, la fecha del reporte; al agregarla despues, ahora.
    NEW.photographed_at := case when TG_OP = 'INSERT' then coalesce(NEW.created_at, now()) else now() end;
  end if;
  NEW.stage := case
    when NEW.adjusted_at is not null then 'adjusted'
    when NEW.dumped_at is not null then 'dumped'
    when NEW.approved_at is not null then 'approved'
    when n > 0 then 'photographed'
    else 'documented' end;
  return NEW;
end $$;

drop trigger if exists warehouse_reports_stage_guard on public.warehouse_reports;
create trigger warehouse_reports_stage_guard before insert or update on public.warehouse_reports
  for each row execute function public.warehouse_report_stage_guard();
revoke all on function public.warehouse_report_stage_guard() from public, anon, authenticated;

-- 3. Relleno de lo que ya existe (el trigger calcula stage y photographed_at)
update public.warehouse_reports
   set photographed_at = case when cardinality(coalesce(photos, '{}')) > 0 then coalesce(photographed_at, created_at) end
 where kind = 'scrap' and stage is null;

-- 4. La transicion
create or replace function public.warehouse_ops_set_scrap_stage(p_report uuid, p_stage text, p_proof text default null)
  returns void
  language plpgsql volatile security definer set search_path = public as $$
declare
  yo uuid := auth.uid();
  r record;
  orden text[] := array['documented', 'photographed', 'approved', 'dumped', 'adjusted'];
  de int; a int;
  admin boolean;
begin
  if p_stage is null or not (p_stage = any(orden)) then
    raise exception 'warehouse_ops: etapa desconocida' using errcode = '22023';
  end if;
  select * into r from public.warehouse_reports where id = p_report;
  if r.id is null then raise exception 'warehouse_ops: reporte desconocido'; end if;
  if r.kind <> 'scrap' then
    raise exception 'warehouse_ops: solo la merma tiene etapas' using errcode = '22023';
  end if;
  -- Quien llama: ve el reporte (RLS de la 265) y gestiona la merma de esa tienda (gerente / supervisor full, store_admin, admin).
  if yo is null or not public.warehouse_ops_can_see(r.kind, r.store, r.author_id) then
    raise exception 'warehouse_ops: sin acceso' using errcode = '42501';
  end if;
  if not public.warehouse_ops_can_manage(r.store) then
    raise exception 'warehouse_ops: solo el gerente de la tienda cambia la etapa' using errcode = '42501';
  end if;
  admin := coalesce(public.warehouse_ops_level_of(yo), '') in ('admin', 'store_admin');
  de := array_position(orden, coalesce(r.stage, 'documented'));
  a := array_position(orden, p_stage);
  if a = de then raise exception 'warehouse_ops: ya esta en esa etapa' using errcode = '22023'; end if;

  if a < de then
    -- Deshacer: solo el admin de la app, un paso, y nunca hasta 'documented' (eso lo dicen las fotos).
    if not admin or de - a <> 1 or p_stage = 'documented' then
      raise exception 'warehouse_ops: solo el admin deshace, y un paso a la vez' using errcode = '42501';
    end if;
    update public.warehouse_reports set
      adjusted_at = case when r.stage = 'adjusted' then null else adjusted_at end,
      adjusted_by = case when r.stage = 'adjusted' then null else adjusted_by end,
      adjustment_proof = case when r.stage = 'adjusted' then null else adjustment_proof end,
      dumped_at = case when r.stage = 'dumped' then null else dumped_at end,
      dumped_by = case when r.stage = 'dumped' then null else dumped_by end,
      approved_at = case when r.stage = 'approved' then null else approved_at end,
      approved_by = case when r.stage = 'approved' then null else approved_by end,
      approval_sheet = case when r.stage = 'approved' then null else approval_sheet end,
      edited_by = yo, edited_at = now()
    where id = p_report;
    return;
  end if;

  -- Hacia adelante: de una en una, con foto, y con su adjunto cuando toca.
  if r.stage = 'documented' or cardinality(coalesce(r.photos, '{}')) = 0 then
    raise exception 'warehouse_ops: primero la foto de las piezas' using errcode = '22023';
  end if;
  if a - de <> 1 then raise exception 'warehouse_ops: las etapas van de una en una' using errcode = '22023'; end if;
  if p_stage in ('approved', 'adjusted') then
    if p_proof is null or btrim(p_proof) = '' then
      raise exception 'warehouse_ops: falta el adjunto (la hoja firmada o la captura)' using errcode = '22023';
    end if;
    -- El adjunto es de la carpeta de quien llama (la misma regla que las fotos y el cubo).
    if split_part(p_proof, '/', 1) <> yo::text then raise exception 'warehouse_ops: adjunto no valido'; end if;
  end if;
  if p_stage = 'approved' then
    update public.warehouse_reports set approved_at = now(), approved_by = yo, approval_sheet = p_proof, edited_by = yo, edited_at = now() where id = p_report;
  elsif p_stage = 'dumped' then
    update public.warehouse_reports set dumped_at = now(), dumped_by = yo, edited_by = yo, edited_at = now() where id = p_report;
  elsif p_stage = 'adjusted' then
    update public.warehouse_reports set adjusted_at = now(), adjusted_by = yo, adjustment_proof = p_proof, edited_by = yo, edited_at = now() where id = p_report;
  end if;
end $$;
revoke all on function public.warehouse_ops_set_scrap_stage(uuid, text, text) from public, anon;
grant execute on function public.warehouse_ops_set_scrap_stage(uuid, text, text) to authenticated;

-- 5. El cubo: PDF para la hoja escaneada, y la lectura de la hoja y la captura
update storage.buckets set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] where id = 'warehouse-ops';
drop policy if exists "warehouse ops bucket read" on storage.objects;
create policy "warehouse ops bucket read" on storage.objects for select to authenticated
  using (bucket_id = 'warehouse-ops' and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or exists (select 1 from public.warehouse_reports r where name = any(r.photos) or name = r.approval_sheet or name = r.adjustment_proof)
  ));

-- 6. Indice: la lista filtra por etapa
create index if not exists warehouse_reports_stage on public.warehouse_reports (stage) where kind = 'scrap';

-- ===========================================================================
-- Autocomprobacion
-- ===========================================================================
do $chk$
declare f text; c text;
begin
  foreach c in array array['stage', 'photographed_at', 'approved_at', 'approved_by', 'approval_sheet', 'dumped_at', 'dumped_by', 'adjusted_at', 'adjusted_by', 'adjustment_proof'] loop
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'warehouse_reports' and column_name = c) then
      raise exception '270: falta warehouse_reports.%', c;
    end if;
  end loop;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.warehouse_reports'::regclass and tgname = 'warehouse_reports_stage_guard' and not tgisinternal) then
    raise exception '270: falta el guardia de etapas en warehouse_reports';
  end if;
  if exists (select 1 from public.warehouse_reports where kind = 'scrap' and stage is null) then
    raise exception '270: quedo merma sin etapa';
  end if;
  if exists (select 1 from public.warehouse_reports where kind <> 'scrap' and stage is not null) then
    raise exception '270: algo que no es merma tiene etapa';
  end if;
  if exists (select 1 from public.warehouse_reports where kind = 'scrap' and stage = 'photographed' and cardinality(coalesce(photos, '{}')) = 0)
     or exists (select 1 from public.warehouse_reports where kind = 'scrap' and stage = 'documented' and cardinality(coalesce(photos, '{}')) > 0) then
    raise exception '270: la etapa no cuadra con las fotos';
  end if;
  foreach f in array array['public.warehouse_ops_set_scrap_stage(uuid, text, text)', 'public.warehouse_report_stage_guard()'] loop
    if has_function_privilege('anon', f, 'execute') then raise exception '270: anon ejecuta %', f; end if;
  end loop;
  f := pg_get_functiondef('public.warehouse_ops_set_scrap_stage(uuid, text, text)'::regprocedure);
  if position('warehouse_ops_can_manage(r.store)' in f) = 0 or position('warehouse_ops_can_see(r.kind, r.store, r.author_id)' in f) = 0
     or position('r.kind <> ''scrap''' in f) = 0 or position('a - de <> 1' in f) = 0 or position('falta el adjunto' in f) = 0 then
    raise exception '270: warehouse_ops_set_scrap_stage no usa las puertas (ver, gestionar, solo merma, de una en una, adjunto)';
  end if;
  if not exists (select 1 from storage.buckets where id = 'warehouse-ops' and 'application/pdf' = any(allowed_mime_types) and not public) then
    raise exception '270: el cubo warehouse-ops no admite PDF o dejo de ser privado';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'warehouse ops bucket read' and qual like '%approval_sheet%') then
    raise exception '270: la lectura del cubo no deja ver la hoja firmada';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'warehouse_reports' and cmd <> 'SELECT') then
    raise exception '270: warehouse_reports no debe tener politicas de escritura';
  end if;
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('270_merma_etapas_de_aprobacion.sql', '2866fbc62ca7bb847b92aa6d55fe66b93fcf04d2b707c6356f36e661a24b71bc') on conflict (name) do nothing;
