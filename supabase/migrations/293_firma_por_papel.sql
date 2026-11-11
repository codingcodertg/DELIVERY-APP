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
--      exigen can_sign_slot(slot) y, salvo el admin del hub, que la MISMA persona no tenga ya el otro espacio.
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
  select * into g from public.warehouse_scrap_groups where id = p_group;
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
  select * into r from public.warehouse_reports where id = p_report;
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
  if coalesce(r.stage, 'documented') = 'photographed'
     and exists (select 1 from public.warehouse_report_signatures where report_id = p_report and slot = 'gerente')
     and exists (select 1 from public.warehouse_report_signatures where report_id = p_report and slot = 'supervisor') then
    update public.warehouse_reports set approved_at = now(), approved_by = yo, approval_sheet = null, edited_by = yo, edited_at = now() where id = p_report;
  end if;
end $$;
revoke all on function public.warehouse_ops_sign_scrap(uuid, text, text) from public, anon;
grant execute on function public.warehouse_ops_sign_scrap(uuid, text, text) to authenticated;

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
  if has_function_privilege('anon', 'public.warehouse_ops_can_sign_slot(text)', 'execute') then
    raise exception '293: anon ejecuta can_sign_slot';
  end if;
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('293_firma_por_papel.sql', '8adc25dd0d0baad7dc19840a4ca2aad88995ca01806ca9658c7183ed37f78fd6') on conflict (name) do nothing;
