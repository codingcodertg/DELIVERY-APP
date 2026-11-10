-- 283: Merma: la MISMA persona puede firmar los dos espacios, y con las dos firmas se aprueba SOLA (2026-11-10).
--
-- El dueno (10 nov): «que la misma persona pueda firmar a ambos lados —el gerente le pasa el aparato al de almacen y
-- firma ahi mismo— y una vez firmados los dos lados, que se apruebe automaticamente».
--
-- Cambia (ADITIVO, create or replace; no se tocan los .sql de la 280/281):
--   1. warehouse_ops_sign_scrap: quita la regla de «dos personas distintas»; tras firmar, si estan las DOS firmas y la
--      merma esta fotografiada, la APRUEBA sola.
--   2. warehouse_ops_set_scrap_stage: para 'approved' sigue EXIGIENDO las dos firmas, pero ya NO que sean distintas.
--   3. warehouse_ops_sign_scrap_group: quita «dos personas distintas»; tras firmar, si estan las dos, aprueba el grupo
--      y pasa todas sus mermas (fotografiadas) a aprobada.
--   4. warehouse_ops_approve_scrap_group: sigue exigiendo las dos firmas, pero ya NO que sean distintas.
--
-- Sigue intacto: la puerta de gestion (warehouse_ops_can_manage), que solo se firma una merma fotografiada, que el dibujo
-- no venga vacio, que no se pise la firma de OTRA persona en el mismo espacio, los grants, security definer y el trigger
-- de invalidacion (warehouse_ops_wipe_sigs_on_edit, 281). La 237/280/281/282 no se tocan.
--
-- Sin begin/commit propios. Para deshacer: volver a crear estas cuatro funciones como en la 280/281 (con las reglas de
--   «personas distintas» y sin el auto-aprobar), y `delete from public.schema_migrations where name='283_...';`.

-- 1. Firmar un slot por reporte: sin «personas distintas» + auto-aprobar con las dos
create or replace function public.warehouse_ops_sign_scrap(p_report uuid, p_slot text, p_png text)
  returns void
  language plpgsql volatile security definer set search_path = public as $$
declare
  yo uuid := auth.uid();
  r record;
  nombre text;
  mio uuid;
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
  -- 283: la misma persona puede firmar los dos espacios (ya no se exige que el otro slot sea de otra cuenta).
  select full_name into nombre from public.profiles where id = yo;
  insert into public.warehouse_report_signatures (report_id, slot, signer_id, signer_name, signature_png, signed_at)
    values (p_report, p_slot, yo, nombre, p_png, now())
  on conflict (report_id, slot) do update
    set signer_id = excluded.signer_id, signer_name = excluded.signer_name, signature_png = excluded.signature_png, signed_at = now();
  -- 283: con las DOS firmas y fotografiada, se aprueba sola (ya no hace falta el paso aparte de aprobar).
  if coalesce(r.stage, 'documented') = 'photographed'
     and exists (select 1 from public.warehouse_report_signatures where report_id = p_report and slot = 'gerente')
     and exists (select 1 from public.warehouse_report_signatures where report_id = p_report and slot = 'supervisor') then
    update public.warehouse_reports set approved_at = now(), approved_by = yo, approval_sheet = null, edited_by = yo, edited_at = now() where id = p_report;
  end if;
end $$;
revoke all on function public.warehouse_ops_sign_scrap(uuid, text, text) from public, anon;
grant execute on function public.warehouse_ops_sign_scrap(uuid, text, text) to authenticated;

-- 2. La transicion: 'approved' exige las dos firmas (ya NO distintas); 'adjusted' sigue con su captura; deshacer igual.
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
    if r.stage = 'approved' then delete from public.warehouse_report_signatures where report_id = p_report; end if;
    return;
  end if;

  -- Hacia adelante: de una en una, con foto, y la regla de cada etapa.
  if r.stage = 'documented' or cardinality(coalesce(r.photos, '{}')) = 0 then
    raise exception 'warehouse_ops: primero la foto de las piezas' using errcode = '22023';
  end if;
  if a - de <> 1 then raise exception 'warehouse_ops: las etapas van de una en una' using errcode = '22023'; end if;

  if p_stage = 'approved' then
    -- 283: NO se aprueba sin las DOS firmas (gerente y supervisor); ya NO hace falta que sean de personas distintas.
    if not exists (select 1 from public.warehouse_report_signatures where report_id = p_report and slot = 'gerente')
       or not exists (select 1 from public.warehouse_report_signatures where report_id = p_report and slot = 'supervisor') then
      raise exception 'warehouse_ops: faltan las dos firmas (gerente y supervisor)' using errcode = '22023';
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

-- 3. Firmar un espacio del grupo: sin «personas distintas» + auto-aprobar con las dos
create or replace function public.warehouse_ops_sign_scrap_group(p_group uuid, p_slot text, p_png text)
  returns void
  language plpgsql volatile security definer set search_path = public as $$
declare
  yo uuid := auth.uid();
  g record;
  nombre text;
  mio uuid;
  admin boolean;
begin
  if p_slot is null or p_slot not in ('gerente', 'supervisor') then
    raise exception 'warehouse_ops: firma desconocida' using errcode = '22023';
  end if;
  if p_png is null or btrim(p_png) = '' or left(p_png, 11) <> 'data:image/' then
    raise exception 'warehouse_ops: la firma viene vacia' using errcode = '22023';
  end if;
  select * into g from public.warehouse_scrap_groups where id = p_group;
  if g.id is null then raise exception 'warehouse_ops: grupo desconocido'; end if;
  if g.approved_at is not null then raise exception 'warehouse_ops: el grupo ya esta aprobado' using errcode = '22023'; end if;
  if yo is null or not public.warehouse_ops_can_see('scrap', g.store, null) then
    raise exception 'warehouse_ops: sin acceso' using errcode = '42501';
  end if;
  if not public.warehouse_ops_can_manage(g.store) then
    raise exception 'warehouse_ops: solo gerencia firma' using errcode = '42501';
  end if;
  admin := coalesce(public.warehouse_ops_level_of(yo), '') in ('admin', 'store_admin');
  select signer_id into mio from public.warehouse_scrap_group_signatures where group_id = p_group and slot = p_slot;
  if mio is not null and mio <> yo and not admin then
    raise exception 'warehouse_ops: ese espacio ya lo firmo otra persona' using errcode = '42501';
  end if;
  -- 283: la misma persona puede firmar los dos espacios del grupo.
  select full_name into nombre from public.profiles where id = yo;
  insert into public.warehouse_scrap_group_signatures (group_id, slot, signer_id, signer_name, signature_png, signed_at)
    values (p_group, p_slot, yo, nombre, p_png, now())
  on conflict (group_id, slot) do update
    set signer_id = excluded.signer_id, signer_name = excluded.signer_name, signature_png = excluded.signature_png, signed_at = now();
  -- 283: con las DOS firmas, el grupo se aprueba solo y todas sus mermas (fotografiadas) pasan a aprobada.
  if exists (select 1 from public.warehouse_scrap_group_signatures where group_id = p_group and slot = 'gerente')
     and exists (select 1 from public.warehouse_scrap_group_signatures where group_id = p_group and slot = 'supervisor') then
    update public.warehouse_scrap_groups set approved_at = now(), approved_by = yo where id = p_group and approved_at is null;
    update public.warehouse_reports
       set approved_at = now(), approved_by = yo, approval_sheet = null, edited_by = yo, edited_at = now()
     where scrap_group_id = p_group and kind = 'scrap' and coalesce(stage, 'documented') = 'photographed';
  end if;
end $$;
revoke all on function public.warehouse_ops_sign_scrap_group(uuid, text, text) from public, anon;
grant execute on function public.warehouse_ops_sign_scrap_group(uuid, text, text) to authenticated;

-- 4. Aprobar el grupo (camino manual / de respaldo): exige las dos firmas (ya NO distintas); aprueba todas sus mermas
create or replace function public.warehouse_ops_approve_scrap_group(p_group uuid)
  returns void
  language plpgsql volatile security definer set search_path = public as $$
declare
  yo uuid := auth.uid();
  g record;
begin
  select * into g from public.warehouse_scrap_groups where id = p_group;
  if g.id is null then raise exception 'warehouse_ops: grupo desconocido'; end if;
  if yo is null or not public.warehouse_ops_can_manage(g.store) then
    raise exception 'warehouse_ops: solo quien gestiona esa tienda aprueba' using errcode = '42501';
  end if;
  if g.approved_at is not null then raise exception 'warehouse_ops: el grupo ya esta aprobado' using errcode = '22023'; end if;
  -- 283: NO se aprueba sin las DOS firmas (gerente y supervisor); ya NO hace falta que sean de personas distintas.
  if not exists (select 1 from public.warehouse_scrap_group_signatures where group_id = p_group and slot = 'gerente')
     or not exists (select 1 from public.warehouse_scrap_group_signatures where group_id = p_group and slot = 'supervisor') then
    raise exception 'warehouse_ops: faltan las dos firmas (gerente y supervisor)' using errcode = '22023';
  end if;
  update public.warehouse_scrap_groups set approved_at = now(), approved_by = yo where id = p_group;
  update public.warehouse_reports
     set approved_at = now(), approved_by = yo, approval_sheet = null, edited_by = yo, edited_at = now()
   where scrap_group_id = p_group and kind = 'scrap' and coalesce(stage, 'documented') = 'photographed';
end $$;
revoke all on function public.warehouse_ops_approve_scrap_group(uuid) from public, anon;
grant execute on function public.warehouse_ops_approve_scrap_group(uuid) to authenticated;

-- ===========================================================================
-- Autocomprobacion
-- ===========================================================================
do $chk$
declare f text;
begin
  -- Las cuatro funciones ya no exigen «personas distintas», pero SIGUEN exigiendo las dos firmas.
  f := pg_get_functiondef('public.warehouse_ops_set_scrap_stage(uuid, text, text)'::regprocedure);
  if position('count(distinct signer_id)' in f) <> 0 or position('personas distintas' in f) <> 0 then
    raise exception '283: set_scrap_stage todavia exige firmantes distintos';
  end if;
  if position('faltan las dos firmas' in f) = 0 then
    raise exception '283: set_scrap_stage ya no exige las dos firmas';
  end if;
  f := pg_get_functiondef('public.warehouse_ops_approve_scrap_group(uuid)'::regprocedure);
  if position('count(distinct signer_id)' in f) <> 0 or position('personas distintas' in f) <> 0 then
    raise exception '283: approve_scrap_group todavia exige firmantes distintos';
  end if;
  f := pg_get_functiondef('public.warehouse_ops_sign_scrap(uuid, text, text)'::regprocedure);
  if position('approved_at = now()' in f) = 0 then
    raise exception '283: sign_scrap no auto-aprueba con las dos firmas';
  end if;
  f := pg_get_functiondef('public.warehouse_ops_sign_scrap_group(uuid, text, text)'::regprocedure);
  if position('warehouse_scrap_groups set approved_at' in f) = 0 then
    raise exception '283: sign_scrap_group no auto-aprueba con las dos firmas';
  end if;
  -- Ni anon las ejecuta.
  foreach f in array array['public.warehouse_ops_sign_scrap(uuid, text, text)', 'public.warehouse_ops_set_scrap_stage(uuid, text, text)',
    'public.warehouse_ops_sign_scrap_group(uuid, text, text)', 'public.warehouse_ops_approve_scrap_group(uuid)'] loop
    if has_function_privilege('anon', f, 'execute') then raise exception '283: anon ejecuta %', f; end if;
  end loop;
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('283_merma_firma_misma_persona_y_autoaprobar.sql', '56e158c989091d8eccbb1cfb002f17674a9eafc28f7f68b55e89f2bacb7dd063') on conflict (name) do nothing;
