-- 293: Merma: el gerente firma SOLO «gerente» y el supervisor de almacen SOLO «supervisor» (2026-11-11).
--
-- El dueno (11 nov) revierte la parte de la 283 que dejaba a la misma persona llenar los dos espacios: un gerente no
-- puede firmar como supervisor ni al reves, y nadie llena los dos. El admin del hub (profiles.role = 'admin') puede
-- firmar cualquiera de los dos como respaldo (el dueno puede vetarlo).
--
-- Cambia (ADITIVO, create or replace; no se tocan los .sql anteriores):
--   1. Nueva warehouse_ops_can_sign_slot(slot): admin del hub -> los dos; role = 'manager' -> 'gerente';
--      permiso 'warehouse_ops_supervisor' -> 'supervisor'.
--   2. warehouse_ops_sign_scrap_group y warehouse_ops_sign_scrap (firma por reporte, 280): ademas de lo de siempre,
--      exigen can_sign_slot(slot) y, salvo el admin del hub, que la MISMA persona no tenga ya el otro espacio; toman
--      un candado de fila (for update) para que dos firmas a la vez no se crucen.
--   3. Aprobar (auto-aprobar al firmar, approve_scrap_group, set_scrap_stage->approved) exige dos firmantes distintos
--      salvo que sea el admin del hub (warehouse_ops_dos_firmas_validas).
--   4. Datos (solo grupos/mermas AUN sin aprobar): se borran las firmas de quien ya no puede firmar ese espacio y las
--      dobles de una misma persona (no admin). Aprobar tambien revisa el papel de cada firmante al momento.
--
-- Sigue intacto: warehouse_ops_can_manage, el auto-aprobar con las dos firmas (283), no pisar la firma de otra persona,
-- grants y security definer. 237/238/239 no se tocan.
-- Para deshacer: volver a crear las dos funciones como en la 283, `drop function public.warehouse_ops_can_sign_slot(text);`
--   y `delete from public.schema_migrations where name='293_firma_por_papel.sql';`.

create or replace function public.warehouse_ops_can_sign_slot(p_slot text)
  returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((
    select p.role = 'admin'
        or (p_slot = 'gerente' and p.role = 'manager')
        or (p_slot = 'supervisor' and 'warehouse_ops_supervisor' = any(coalesce(p.permissions, '{}')))
    from public.profiles p where p.id = auth.uid()
  ), false);
$$;
revoke all on function public.warehouse_ops_can_sign_slot(text) from public, anon;
grant execute on function public.warehouse_ops_can_sign_slot(text) to authenticated;

-- ¿Esta persona puede firmar este espacio, segun su papel AHORA? (la misma regla que can_sign_slot, para cualquier id)
create or replace function public.warehouse_ops_firmante_valido(p_user uuid, p_slot text)
  returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((
    select p.role = 'admin'
        or (p_slot = 'gerente' and p.role = 'manager')
        or (p_slot = 'supervisor' and 'warehouse_ops_supervisor' = any(coalesce(p.permissions, '{}')))
    from public.profiles p where p.id = p_user
  ), false);
$$;
revoke all on function public.warehouse_ops_firmante_valido(uuid, text) from public, anon, authenticated;

-- ¿Las dos firmas valen para aprobar? Estan las dos Y son de personas distintas, salvo que la misma sea admin del hub.
-- (Revision de seguridad: aun con el candado, la aprobacion vuelve a exigirlo, por si dos llamadas se cruzan.)
create or replace function public.warehouse_ops_dos_firmas_validas(p_group uuid, p_report uuid)
  returns boolean
  language sql stable security definer set search_path = public as $$
  with f as (
    select slot, signer_id from public.warehouse_scrap_group_signatures where p_group is not null and group_id = p_group
    union all
    select slot, signer_id from public.warehouse_report_signatures where p_report is not null and report_id = p_report
  ), ger as (select signer_id from f where slot = 'gerente'), sup as (select signer_id from f where slot = 'supervisor')
  select exists (select 1 from ger) and exists (select 1 from sup)
     -- Cada firma, de alguien que HOY puede firmar ese espacio (una firma vieja de la regla anterior no cuenta).
     and public.warehouse_ops_firmante_valido((select signer_id from ger limit 1), 'gerente')
     and public.warehouse_ops_firmante_valido((select signer_id from sup limit 1), 'supervisor')
     and (
       (select signer_id from ger limit 1) is distinct from (select signer_id from sup limit 1)
       or exists (select 1 from public.profiles p where p.id = (select signer_id from ger limit 1) and p.role = 'admin')
     );
$$;
revoke all on function public.warehouse_ops_dos_firmas_validas(uuid, uuid) from public, anon, authenticated;

-- 1. Firma de un GRUPO
create or replace function public.warehouse_ops_sign_scrap_group(p_group uuid, p_slot text, p_png text)
  returns void
  language plpgsql volatile security definer set search_path = public as $$
declare
  yo uuid := auth.uid();
  g record;
  nombre text;
  mio uuid;
  admin boolean;
  otro text;
begin
  if p_slot is null or p_slot not in ('gerente', 'supervisor') then
    raise exception 'warehouse_ops: firma desconocida' using errcode = '22023';
  end if;
  if p_png is null or btrim(p_png) = '' or left(p_png, 11) <> 'data:image/' then
    raise exception 'warehouse_ops: la firma viene vacia' using errcode = '22023';
  end if;
  -- Candado: dos firmas a la vez sobre el mismo grupo se forman en fila (revision de seguridad).
  select * into g from public.warehouse_scrap_groups where id = p_group for update;
  if g.id is null then raise exception 'warehouse_ops: grupo desconocido'; end if;
  if g.approved_at is not null then raise exception 'warehouse_ops: el grupo ya esta aprobado' using errcode = '22023'; end if;
  if yo is null or not public.warehouse_ops_can_see('scrap', g.store, null) then
    raise exception 'warehouse_ops: sin acceso' using errcode = '42501';
  end if;
  if not public.warehouse_ops_can_manage(g.store) then
    raise exception 'warehouse_ops: solo gerencia firma' using errcode = '42501';
  end if;
  if not public.warehouse_ops_can_sign_slot(p_slot) then
    raise exception 'warehouse_ops: ese espacio no te toca (gerente firma gerente, supervisor firma supervisor)' using errcode = '42501';
  end if;
  admin := coalesce(public.warehouse_ops_level_of(yo), '') in ('admin', 'store_admin');
  select signer_id into mio from public.warehouse_scrap_group_signatures where group_id = p_group and slot = p_slot;
  if mio is not null and mio <> yo and not admin then
    raise exception 'warehouse_ops: ese espacio ya lo firmo otra persona' using errcode = '42501';
  end if;
  otro := case when p_slot = 'gerente' then 'supervisor' else 'gerente' end;
  if not exists (select 1 from public.profiles where id = yo and role = 'admin')
     and exists (select 1 from public.warehouse_scrap_group_signatures where group_id = p_group and slot = otro and signer_id = yo) then
    raise exception 'warehouse_ops: ya firmaste el otro espacio; lo firma otra persona' using errcode = '42501';
  end if;
  select full_name into nombre from public.profiles where id = yo;
  insert into public.warehouse_scrap_group_signatures (group_id, slot, signer_id, signer_name, signature_png, signed_at)
    values (p_group, p_slot, yo, nombre, p_png, now())
  on conflict (group_id, slot) do update
    set signer_id = excluded.signer_id, signer_name = excluded.signer_name, signature_png = excluded.signature_png, signed_at = now();
  -- 283: con las DOS firmas (de personas distintas, 293), el grupo se aprueba solo y todas sus mermas (fotografiadas) pasan a aprobada.
  if public.warehouse_ops_dos_firmas_validas(p_group, null) then
    update public.warehouse_scrap_groups set approved_at = now(), approved_by = yo where id = p_group and approved_at is null;
    update public.warehouse_reports
       set approved_at = now(), approved_by = yo, approval_sheet = null, edited_by = yo, edited_at = now()
     where scrap_group_id = p_group and kind = 'scrap' and coalesce(stage, 'documented') = 'photographed';
  end if;
end $$;
revoke all on function public.warehouse_ops_sign_scrap_group(uuid, text, text) from public, anon;
grant execute on function public.warehouse_ops_sign_scrap_group(uuid, text, text) to authenticated;

-- 2. Firma de UN reporte (280; la app ya no la ofrece, pero la regla es la misma)
create or replace function public.warehouse_ops_sign_scrap(p_report uuid, p_slot text, p_png text)
  returns void
  language plpgsql volatile security definer set search_path = public as $$
declare
  yo uuid := auth.uid();
  r record;
  nombre text;
  mio uuid;
  admin boolean;
  otro text;
begin
  if p_slot is null or p_slot not in ('gerente', 'supervisor') then
    raise exception 'warehouse_ops: firma desconocida' using errcode = '22023';
  end if;
  if p_png is null or btrim(p_png) = '' or left(p_png, 11) <> 'data:image/' then
    raise exception 'warehouse_ops: la firma viene vacia' using errcode = '22023';
  end if;
  -- Candado: dos firmas a la vez sobre la misma merma se forman en fila (revision de seguridad).
  select * into r from public.warehouse_reports where id = p_report for update;
  if r.id is null then raise exception 'warehouse_ops: reporte desconocido'; end if;
  if r.kind <> 'scrap' then raise exception 'warehouse_ops: solo la merma se firma' using errcode = '22023'; end if;
  if yo is null or not public.warehouse_ops_can_see(r.kind, r.store, r.author_id) then
    raise exception 'warehouse_ops: sin acceso' using errcode = '42501';
  end if;
  if not public.warehouse_ops_can_manage(r.store) then
    raise exception 'warehouse_ops: solo gerencia firma' using errcode = '42501';
  end if;
  if not public.warehouse_ops_can_sign_slot(p_slot) then
    raise exception 'warehouse_ops: ese espacio no te toca (gerente firma gerente, supervisor firma supervisor)' using errcode = '42501';
  end if;
  if coalesce(r.stage, 'documented') <> 'photographed' then
    raise exception 'warehouse_ops: solo se firma una merma fotografiada y sin aprobar' using errcode = '22023';
  end if;
  admin := coalesce(public.warehouse_ops_level_of(yo), '') in ('admin', 'store_admin');
  select signer_id into mio from public.warehouse_report_signatures where report_id = p_report and slot = p_slot;
  if mio is not null and mio <> yo and not admin then
    raise exception 'warehouse_ops: ese espacio ya lo firmo otra persona' using errcode = '42501';
  end if;
  otro := case when p_slot = 'gerente' then 'supervisor' else 'gerente' end;
  if not exists (select 1 from public.profiles where id = yo and role = 'admin')
     and exists (select 1 from public.warehouse_report_signatures where report_id = p_report and slot = otro and signer_id = yo) then
    raise exception 'warehouse_ops: ya firmaste el otro espacio; lo firma otra persona' using errcode = '42501';
  end if;
  select full_name into nombre from public.profiles where id = yo;
  insert into public.warehouse_report_signatures (report_id, slot, signer_id, signer_name, signature_png, signed_at)
    values (p_report, p_slot, yo, nombre, p_png, now())
  on conflict (report_id, slot) do update
    set signer_id = excluded.signer_id, signer_name = excluded.signer_name, signature_png = excluded.signature_png, signed_at = now();
  if coalesce(r.stage, 'documented') = 'photographed' and public.warehouse_ops_dos_firmas_validas(null, p_report) then
    update public.warehouse_reports set approved_at = now(), approved_by = yo, approval_sheet = null, edited_by = yo, edited_at = now() where id = p_report;
  end if;
end $$;
revoke all on function public.warehouse_ops_sign_scrap(uuid, text, text) from public, anon;
grant execute on function public.warehouse_ops_sign_scrap(uuid, text, text) to authenticated;

-- 3. Aprobar un grupo a mano: dos firmas de personas distintas (salvo admin del hub)
create or replace function public.warehouse_ops_approve_scrap_group(p_group uuid)
  returns void
  language plpgsql volatile security definer set search_path = public as $$
declare
  yo uuid := auth.uid();
  g record;
begin
  select * into g from public.warehouse_scrap_groups where id = p_group for update;
  if g.id is null then raise exception 'warehouse_ops: grupo desconocido'; end if;
  if yo is null or not public.warehouse_ops_can_manage(g.store) then
    raise exception 'warehouse_ops: solo quien gestiona esa tienda aprueba' using errcode = '42501';
  end if;
  if g.approved_at is not null then raise exception 'warehouse_ops: el grupo ya esta aprobado' using errcode = '22023'; end if;
  if not public.warehouse_ops_dos_firmas_validas(p_group, null) then
    raise exception 'warehouse_ops: faltan las dos firmas (gerente y supervisor), de personas distintas' using errcode = '22023';
  end if;
  update public.warehouse_scrap_groups set approved_at = now(), approved_by = yo where id = p_group;
  update public.warehouse_reports
     set approved_at = now(), approved_by = yo, approval_sheet = null, edited_by = yo, edited_at = now()
   where scrap_group_id = p_group and kind = 'scrap' and coalesce(stage, 'documented') = 'photographed';
end $$;
revoke all on function public.warehouse_ops_approve_scrap_group(uuid) from public, anon;
grant execute on function public.warehouse_ops_approve_scrap_group(uuid) to authenticated;

-- 4. Cambiar la etapa de una merma: para 'approved', dos firmas de personas distintas (salvo admin del hub)
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
  select * into r from public.warehouse_reports where id = p_report for update;
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
    if not public.warehouse_ops_dos_firmas_validas(null, p_report) then
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

-- 5. Datos: firmas dobles de una misma persona (no admin del hub) en grupos o mermas que AUN no se aprueban -> se
--    borra la del espacio que no le toca por su papel (si le tocan los dos o ninguno, la de supervisor). Lo aprobado no se toca.
do $datos$
declare n_g int; n_r int; n_eg int; n_er int;
begin
  -- a) Firmas en grupos/mermas AUN sin aprobar de alguien que, con la regla nueva, no puede firmar ese espacio.
  with borra as (
    delete from public.warehouse_scrap_group_signatures s using public.warehouse_scrap_groups g
     where g.id = s.group_id and g.approved_at is null and not public.warehouse_ops_firmante_valido(s.signer_id, s.slot)
    returning 1
  ) select count(*) into n_eg from borra;
  with borra as (
    delete from public.warehouse_report_signatures s using public.warehouse_reports r
     where r.id = s.report_id and r.approved_at is null and not public.warehouse_ops_firmante_valido(s.signer_id, s.slot)
    returning 1
  ) select count(*) into n_er from borra;
  raise notice '293: firmas de quien ya no puede firmar ese espacio (sin aprobar): % en grupos, % en mermas', n_eg, n_er;
  -- b) Dobles de una misma persona (no admin) que queden.
  with dobles as (
    select s.group_id, s.signer_id
      from public.warehouse_scrap_group_signatures s
      join public.warehouse_scrap_groups g on g.id = s.group_id and g.approved_at is null
      join public.profiles p on p.id = s.signer_id and p.role <> 'admin'
     group by s.group_id, s.signer_id having count(*) = 2
  ), borra as (
    delete from public.warehouse_scrap_group_signatures s using dobles d, public.profiles p
     where s.group_id = d.group_id and s.signer_id = d.signer_id and p.id = d.signer_id
       and s.slot = case when p.role = 'manager' and not ('warehouse_ops_supervisor' = any(coalesce(p.permissions, '{}'))) then 'supervisor'
                         when p.role <> 'manager' and 'warehouse_ops_supervisor' = any(coalesce(p.permissions, '{}')) then 'gerente'
                         else 'supervisor' end
    returning 1
  ) select count(*) into n_g from borra;
  with dobles as (
    select s.report_id, s.signer_id
      from public.warehouse_report_signatures s
      join public.warehouse_reports r on r.id = s.report_id and r.approved_at is null
      join public.profiles p on p.id = s.signer_id and p.role <> 'admin'
     group by s.report_id, s.signer_id having count(*) = 2
  ), borra as (
    delete from public.warehouse_report_signatures s using dobles d, public.profiles p
     where s.report_id = d.report_id and s.signer_id = d.signer_id and p.id = d.signer_id
       and s.slot = case when p.role = 'manager' and not ('warehouse_ops_supervisor' = any(coalesce(p.permissions, '{}'))) then 'supervisor'
                         when p.role <> 'manager' and 'warehouse_ops_supervisor' = any(coalesce(p.permissions, '{}')) then 'gerente'
                         else 'supervisor' end
    returning 1
  ) select count(*) into n_r from borra;
  raise notice '293: firmas dobles quitadas (sin aprobar): % en grupos, % en mermas', n_g, n_r;
end $datos$;

-- ===========================================================================
-- Autocomprobacion
-- ===========================================================================
do $chk$
declare f text;
begin
  foreach f in array array['public.warehouse_ops_sign_scrap(uuid, text, text)', 'public.warehouse_ops_sign_scrap_group(uuid, text, text)'] loop
    if position('warehouse_ops_can_sign_slot(p_slot)' in pg_get_functiondef(f::regprocedure)) = 0 then
      raise exception '293: % no revisa el espacio que le toca a quien firma', f;
    end if;
    if position('slot = otro and signer_id = yo' in pg_get_functiondef(f::regprocedure)) = 0 then
      raise exception '293: % no impide llenar los dos espacios', f;
    end if;
    if has_function_privilege('anon', f, 'execute') then raise exception '293: anon ejecuta %', f; end if;
  end loop;
  if position('warehouse_scrap_groups set approved_at' in pg_get_functiondef('public.warehouse_ops_sign_scrap_group(uuid, text, text)'::regprocedure)) = 0 then
    raise exception '293: sign_scrap_group perdio el auto-aprobar de la 283';
  end if;
  if position('for update' in pg_get_functiondef('public.warehouse_ops_sign_scrap_group(uuid, text, text)'::regprocedure)) = 0
     or position('for update' in pg_get_functiondef('public.warehouse_ops_sign_scrap(uuid, text, text)'::regprocedure)) = 0 then
    raise exception '293: falta el candado de fila al firmar';
  end if;
  foreach f in array array['public.warehouse_ops_sign_scrap_group(uuid, text, text)', 'public.warehouse_ops_sign_scrap(uuid, text, text)',
    'public.warehouse_ops_approve_scrap_group(uuid)', 'public.warehouse_ops_set_scrap_stage(uuid, text, text)'] loop
    if position('warehouse_ops_dos_firmas_validas' in pg_get_functiondef(f::regprocedure)) = 0 then
      raise exception '293: % aprueba sin exigir dos firmantes distintos', f;
    end if;
  end loop;
  if position('warehouse_ops_firmante_valido' in pg_get_functiondef('public.warehouse_ops_dos_firmas_validas(uuid, uuid)'::regprocedure)) = 0 then
    raise exception '293: aprobar no revisa que cada firmante pueda firmar su espacio hoy';
  end if;
  if exists (select 1 from public.warehouse_scrap_group_signatures s join public.warehouse_scrap_groups g on g.id = s.group_id
              where g.approved_at is null and not public.warehouse_ops_firmante_valido(s.signer_id, s.slot))
     or exists (select 1 from public.warehouse_report_signatures s join public.warehouse_reports r on r.id = s.report_id
              where r.approved_at is null and not public.warehouse_ops_firmante_valido(s.signer_id, s.slot)) then
    raise exception '293: quedan firmas sin aprobar de quien no puede firmar ese espacio';
  end if;
  if has_function_privilege('anon', 'public.warehouse_ops_can_sign_slot(text)', 'execute') then
    raise exception '293: anon ejecuta can_sign_slot';
  end if;
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('293_firma_por_papel.sql', '385ae1a1ab9da7e00d55dc4b0885d0661ae085233410adde760db425d5db3883') on conflict (name) do nothing;
