-- 280: Merma: aprobacion con DOS firmas dibujadas en la app (gerente + supervisor), en vez de la hoja firmada adjunta (2026-11-10).
--
-- El dueno (10 nov): el gerente crea el reporte y lo firma; el supervisor de almacen lo ve y lo firma. Un reporte NO se
-- puede aprobar sin las DOS firmas, y tienen que ser de DOS personas distintas. Mientras falte una, queda "pendiente de
-- firma" y sale en la vista "En revision". Las firmas (PNG dibujado) salen luego en el PDF / la hoja.
--
-- Reemplaza el paso de "adjuntar la hoja de aprobacion firmada" de la 270 para la etapa 'approved'. 'adjusted' sigue
-- igual (sube la captura del sistema). La migracion 237 NO se toca.
--
-- Que hace:
--   1. Tabla public.warehouse_report_signatures: una fila por (reporte, slot). slot in ('gerente','supervisor').
--      signer_id/-name/-png (el PNG dibujado, data URL), signed_at. unique(report_id, slot).
--   2. RLS: lee quien puede VER el reporte (warehouse_ops_can_see, 265). NO hay politica de escritura: se escribe solo
--      por las RPC de abajo (security definer), igual que warehouse_reports.
--   3. warehouse_ops_sign_scrap(p_report, p_slot, p_png): firma un slot. Reglas: solo merma 'photographed' (con foto y
--      sin aprobar); quien llama VE y GESTIONA (warehouse_ops_can_manage); firma como el mismo (signer_id = auth.uid());
--      no puede firmar un slot que ya firmo otra persona (salvo re-firmar el suyo); y las dos firmas deben ser de dos
--      personas distintas (el otro slot no puede ser suyo). Upsert del slot.
--   4. warehouse_ops_unsign_scrap(p_report, p_slot): quita una firma (quien la puso, o el admin de la app), solo mientras
--      la merma siga 'photographed' (sin aprobar).
--   5. warehouse_ops_set_scrap_stage: para 'approved' ya NO pide p_proof; exige las DOS firmas distintas. 'adjusted'
--      sigue pidiendo su captura (p_proof). Lo demas igual que la 270.
--
-- ORDEN: aplicar ANTES o DESPUES de desplegar la pantalla nueva.
--   - Pantalla nueva sin esta migracion: la tabla/RPC no existen; la pantalla lo nota (faltaLaMigracion) y no ofrece
--     firmar; la lista sigue; aprobar falla con "funcion desconocida". No se rompe.
--   - Pantalla vieja + esta migracion: 'approved' deja de aceptar la hoja adjunta y pedira las firmas; por eso mejor
--     desplegar la pantalla a la par.
-- Depende de la 265 (warehouse_ops_can_see, warehouse_ops_can_manage, warehouse_ops_level_of) y de la 270 (etapas).
--
-- Sin begin/commit propios. Para deshacer:
--   -- (volver a la 270: 'approved' pide p_proof y no firmas)
--   drop function if exists public.warehouse_ops_sign_scrap(uuid, text, text);
--   drop function if exists public.warehouse_ops_unsign_scrap(uuid, text);
--   drop table if exists public.warehouse_report_signatures;
--   -- y volver a crear warehouse_ops_set_scrap_stage como en la 270.
--   delete from public.schema_migrations where name = '280_merma_firmas_de_aprobacion.sql';

-- 1. La tabla de firmas
create table if not exists public.warehouse_report_signatures (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.warehouse_reports(id) on delete cascade,
  slot text not null check (slot in ('gerente', 'supervisor')),
  signer_id uuid references public.profiles(id) on delete set null,
  signer_name text,
  signature_png text not null,
  signed_at timestamptz not null default now(),
  unique (report_id, slot)
);
create index if not exists warehouse_report_signatures_report on public.warehouse_report_signatures (report_id);

-- 2. RLS: lee quien ve el reporte; nadie escribe directo (solo las RPC definer)
alter table public.warehouse_report_signatures enable row level security;
drop policy if exists "warehouse report signatures read" on public.warehouse_report_signatures;
create policy "warehouse report signatures read" on public.warehouse_report_signatures for select to authenticated
  using (exists (
    select 1 from public.warehouse_reports r
     where r.id = report_id and public.warehouse_ops_can_see(r.kind, r.store, r.author_id)
  ));
revoke all on public.warehouse_report_signatures from anon;

-- 3. Firmar un slot
create or replace function public.warehouse_ops_sign_scrap(p_report uuid, p_slot text, p_png text)
  returns void
  language plpgsql volatile security definer set search_path = public as $$
declare
  yo uuid := auth.uid();
  r record;
  nombre text;
  mio uuid;
  otro uuid;
  admin boolean;
begin
  if p_slot is null or p_slot not in ('gerente', 'supervisor') then
    raise exception 'warehouse_ops: firma desconocida' using errcode = '22023';
  end if;
  if p_png is null or btrim(p_png) = '' or left(p_png, 11) <> 'data:image/' then
    raise exception 'warehouse_ops: la firma viene vacia' using errcode = '22023';
  end if;
  select * into r from public.warehouse_reports where id = p_report;
  if r.id is null then raise exception 'warehouse_ops: reporte desconocido'; end if;
  if r.kind <> 'scrap' then raise exception 'warehouse_ops: solo la merma se firma' using errcode = '22023'; end if;
  if yo is null or not public.warehouse_ops_can_see(r.kind, r.store, r.author_id) then
    raise exception 'warehouse_ops: sin acceso' using errcode = '42501';
  end if;
  if not public.warehouse_ops_can_manage(r.store) then
    raise exception 'warehouse_ops: solo gerencia firma' using errcode = '42501';
  end if;
  if coalesce(r.stage, 'documented') <> 'photographed' then
    raise exception 'warehouse_ops: solo se firma una merma fotografiada y sin aprobar' using errcode = '22023';
  end if;
  admin := coalesce(public.warehouse_ops_level_of(yo), '') in ('admin', 'store_admin');
  -- No pisar la firma de otra persona en ESTE slot (salvo el admin, o re-firmar la tuya).
  select signer_id into mio from public.warehouse_report_signatures where report_id = p_report and slot = p_slot;
  if mio is not null and mio <> yo and not admin then
    raise exception 'warehouse_ops: ese espacio ya lo firmo otra persona' using errcode = '42501';
  end if;
  -- Las dos firmas deben ser de personas distintas: el OTRO slot no puede ser tuyo.
  select signer_id into otro from public.warehouse_report_signatures where report_id = p_report and slot <> p_slot;
  if otro is not null and otro = yo then
    raise exception 'warehouse_ops: las dos firmas deben ser de personas distintas' using errcode = '22023';
  end if;
  select full_name into nombre from public.profiles where id = yo;
  insert into public.warehouse_report_signatures (report_id, slot, signer_id, signer_name, signature_png, signed_at)
    values (p_report, p_slot, yo, nombre, p_png, now())
  on conflict (report_id, slot) do update
    set signer_id = excluded.signer_id, signer_name = excluded.signer_name, signature_png = excluded.signature_png, signed_at = now();
end $$;
revoke all on function public.warehouse_ops_sign_scrap(uuid, text, text) from public, anon;
grant execute on function public.warehouse_ops_sign_scrap(uuid, text, text) to authenticated;

-- 4. Quitar una firma (solo mientras no este aprobada)
create or replace function public.warehouse_ops_unsign_scrap(p_report uuid, p_slot text)
  returns void
  language plpgsql volatile security definer set search_path = public as $$
declare
  yo uuid := auth.uid();
  r record;
  quien uuid;
  admin boolean;
begin
  if p_slot is null or p_slot not in ('gerente', 'supervisor') then
    raise exception 'warehouse_ops: firma desconocida' using errcode = '22023';
  end if;
  select * into r from public.warehouse_reports where id = p_report;
  if r.id is null then raise exception 'warehouse_ops: reporte desconocido'; end if;
  if yo is null or not public.warehouse_ops_can_see(r.kind, r.store, r.author_id) then
    raise exception 'warehouse_ops: sin acceso' using errcode = '42501';
  end if;
  if not public.warehouse_ops_can_manage(r.store) then
    raise exception 'warehouse_ops: solo gerencia firma' using errcode = '42501';
  end if;
  if coalesce(r.stage, 'documented') <> 'photographed' then
    raise exception 'warehouse_ops: ya esta aprobada; un admin tiene que deshacer la etapa primero' using errcode = '22023';
  end if;
  select signer_id into quien from public.warehouse_report_signatures where report_id = p_report and slot = p_slot;
  if quien is null then return; end if;
  admin := coalesce(public.warehouse_ops_level_of(yo), '') in ('admin', 'store_admin');
  if quien <> yo and not admin then
    raise exception 'warehouse_ops: solo quien firmo (o un admin) quita la firma' using errcode = '42501';
  end if;
  delete from public.warehouse_report_signatures where report_id = p_report and slot = p_slot;
end $$;
revoke all on function public.warehouse_ops_unsign_scrap(uuid, text) from public, anon;
grant execute on function public.warehouse_ops_unsign_scrap(uuid, text) to authenticated;

-- 5. La transicion: 'approved' exige las dos firmas (no p_proof); 'adjusted' sigue con su captura.
create or replace function public.warehouse_ops_set_scrap_stage(p_report uuid, p_stage text, p_proof text default null)
  returns void
  language plpgsql volatile security definer set search_path = public as $$
declare
  yo uuid := auth.uid();
  r record;
  orden text[] := array['documented', 'photographed', 'approved', 'dumped', 'adjusted'];
  de int; a int;
  admin boolean;
  firmantes int;
begin
  if p_stage is null or not (p_stage = any(orden)) then
    raise exception 'warehouse_ops: etapa desconocida' using errcode = '22023';
  end if;
  select * into r from public.warehouse_reports where id = p_report;
  if r.id is null then raise exception 'warehouse_ops: reporte desconocido'; end if;
  if r.kind <> 'scrap' then
    raise exception 'warehouse_ops: solo la merma tiene etapas' using errcode = '22023';
  end if;
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
    -- Deshacer: solo el admin de la app, un paso, y nunca hasta 'documented'.
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

  -- Hacia adelante: de una en una, con foto, y la regla de cada etapa.
  if r.stage = 'documented' or cardinality(coalesce(r.photos, '{}')) = 0 then
    raise exception 'warehouse_ops: primero la foto de las piezas' using errcode = '22023';
  end if;
  if a - de <> 1 then raise exception 'warehouse_ops: las etapas van de una en una' using errcode = '22023'; end if;

  if p_stage = 'approved' then
    -- NO se aprueba sin las DOS firmas, y de dos personas distintas.
    select count(distinct signer_id) into firmantes
      from public.warehouse_report_signatures
     where report_id = p_report and slot in ('gerente', 'supervisor');
    if not exists (select 1 from public.warehouse_report_signatures where report_id = p_report and slot = 'gerente')
       or not exists (select 1 from public.warehouse_report_signatures where report_id = p_report and slot = 'supervisor')
       or firmantes < 2 then
      raise exception 'warehouse_ops: faltan las dos firmas (gerente y supervisor), de personas distintas' using errcode = '22023';
    end if;
    update public.warehouse_reports set approved_at = now(), approved_by = yo, approval_sheet = null, edited_by = yo, edited_at = now() where id = p_report;
  elsif p_stage = 'dumped' then
    update public.warehouse_reports set dumped_at = now(), dumped_by = yo, edited_by = yo, edited_at = now() where id = p_report;
  elsif p_stage = 'adjusted' then
    if p_proof is null or btrim(p_proof) = '' then
      raise exception 'warehouse_ops: falta el adjunto (la captura del sistema)' using errcode = '22023';
    end if;
    if split_part(p_proof, '/', 1) <> yo::text then raise exception 'warehouse_ops: adjunto no valido'; end if;
    update public.warehouse_reports set adjusted_at = now(), adjusted_by = yo, adjustment_proof = p_proof, edited_by = yo, edited_at = now() where id = p_report;
  end if;
end $$;
revoke all on function public.warehouse_ops_set_scrap_stage(uuid, text, text) from public, anon;
grant execute on function public.warehouse_ops_set_scrap_stage(uuid, text, text) to authenticated;

-- ===========================================================================
-- Autocomprobacion
-- ===========================================================================
do $chk$
declare f text;
begin
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'warehouse_report_signatures') then
    raise exception '280: falta la tabla warehouse_report_signatures';
  end if;
  if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'warehouse_report_signatures' and rowsecurity) then
    raise exception '280: la tabla de firmas no tiene RLS';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'warehouse_report_signatures' and cmd <> 'SELECT') then
    raise exception '280: la tabla de firmas no debe tener politicas de escritura (solo las RPC)';
  end if;
  foreach f in array array['public.warehouse_ops_sign_scrap(uuid, text, text)', 'public.warehouse_ops_unsign_scrap(uuid, text)', 'public.warehouse_ops_set_scrap_stage(uuid, text, text)'] loop
    if has_function_privilege('anon', f, 'execute') then raise exception '280: anon ejecuta %', f; end if;
  end loop;
  f := pg_get_functiondef('public.warehouse_ops_set_scrap_stage(uuid, text, text)'::regprocedure);
  if position('faltan las dos firmas' in f) = 0 or position('count(distinct signer_id)' in f) = 0 then
    raise exception '280: set_scrap_stage no exige las dos firmas para aprobar';
  end if;
  if position('p_proof' in f) = 0 or position('la captura del sistema' in f) = 0 then
    raise exception '280: set_scrap_stage ya no pide la captura para ajustada';
  end if;
  f := pg_get_functiondef('public.warehouse_ops_sign_scrap(uuid, text, text)'::regprocedure);
  if position('personas distintas' in f) = 0 or position('warehouse_ops_can_manage(r.store)' in f) = 0 then
    raise exception '280: sign_scrap no exige firmantes distintos o no revisa la puerta de gestion';
  end if;
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('280_merma_firmas_de_aprobacion.sql', '6af49dde95e15c5116c974ee171169ee74da9343be39a8aa4c5708e2c4079b01') on conflict (name) do nothing;
