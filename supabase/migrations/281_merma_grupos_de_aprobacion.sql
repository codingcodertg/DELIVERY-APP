-- 281: Merma: GRUPOS de aprobacion — firmar y aprobar varias mermas de una vez, y archivarlas como grupo (2026-11-10).
--
-- El dueno (10 nov): «selecciono varias, creo un grupo con nombre, le doy Iniciar aprobacion, se firma UNA vez (gerente
-- + supervisor) y con eso se aprueban todas; el grupo queda guardado para revision/archivo, como la hoja impresa pero
-- persistente». Es un camino ADICIONAL: la firma por reporte de la 280 sigue igual.
--
-- Que hace:
--   1. public.warehouse_scrap_groups: un grupo con nombre, tienda, quien lo creo y (si se aprobo) cuando/quien.
--   2. warehouse_reports.scrap_group_id: a que grupo pertenece una merma (una como mucho).
--   3. public.warehouse_scrap_group_signatures: las dos firmas del grupo (gerente + supervisor), como la 280 pero por grupo.
--   4. RLS: lee quien VE la merma de esa tienda (warehouse_ops_can_see, 265). Sin politicas de escritura: solo las RPC.
--   5. warehouse_ops_create_scrap_group(p_name, p_report_ids): crea el grupo con las mermas marcadas (todas de la misma
--      tienda, fotografiadas, sin aprobar y sin grupo); quien llama gestiona esa tienda. Devuelve el id del grupo.
--   6. warehouse_ops_sign_scrap_group(p_group, p_slot, p_png): firma un espacio del grupo (mismas reglas que la 280:
--      dibujo no vacio, gestiona la tienda, no pisa la firma de otro, las dos de personas distintas). Solo si no aprobado.
--   7. warehouse_ops_unsign_scrap_group(p_group, p_slot): quita una firma (quien la puso, o el admin), si no aprobado.
--   8. warehouse_ops_approve_scrap_group(p_group): EXIGE las dos firmas distintas; marca el grupo aprobado y pasa TODAS
--      sus mermas (fotografiadas) a 'approved' a la vez. Sin las dos firmas, RAISE: no se puede aprobar.
--   9. Se reemplaza el trigger warehouse_ops_wipe_sigs_on_edit (280): si cambia el contenido firmado de una merma, ademas
--      de sus firmas por-reporte borra las del GRUPO y lo vuelve a «no aprobado» (sus firmas ya no reflejan el contenido).
--      `scrap_group_id` entra en la lista blanca (asignar un grupo no es un cambio de contenido).
--
-- ORDEN: aplicar antes o despues de desplegar la pantalla. Sin la migracion, la pantalla nota que las RPC/tabla no
--   existen (faltaLaMigracion) y no ofrece grupos; todo lo demas sigue. La 237 y la 280 no se tocan.
-- Depende de la 265 (warehouse_ops_can_see/can_manage/level_of), la 270 (etapas) y la 280 (firmas por reporte).
--
-- Sin begin/commit propios. Para deshacer:
--   drop function if exists public.warehouse_ops_approve_scrap_group(uuid);
--   drop function if exists public.warehouse_ops_sign_scrap_group(uuid, text, text);
--   drop function if exists public.warehouse_ops_unsign_scrap_group(uuid, text);
--   drop function if exists public.warehouse_ops_create_scrap_group(text, uuid[]);
--   drop table if exists public.warehouse_scrap_group_signatures;
--   alter table public.warehouse_reports drop column if exists scrap_group_id;
--   drop table if exists public.warehouse_scrap_groups;
--   -- y volver a crear warehouse_ops_wipe_sigs_on_edit como en la 280 (sin la parte de grupos).
--   delete from public.schema_migrations where name = '281_merma_grupos_de_aprobacion.sql';

-- 1. La tabla de grupos
create table if not exists public.warehouse_scrap_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0 and length(name) <= 120),
  store text not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid references public.profiles(id) on delete set null
);
create index if not exists warehouse_scrap_groups_store on public.warehouse_scrap_groups (store, created_at desc);

-- 2. La membresia: a que grupo pertenece una merma (una como mucho; al borrar el grupo, se suelta)
alter table public.warehouse_reports
  add column if not exists scrap_group_id uuid references public.warehouse_scrap_groups(id) on delete set null;
create index if not exists warehouse_reports_scrap_group on public.warehouse_reports (scrap_group_id);

-- 3. Las firmas del grupo (como la 280, pero por grupo)
create table if not exists public.warehouse_scrap_group_signatures (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.warehouse_scrap_groups(id) on delete cascade,
  slot text not null check (slot in ('gerente', 'supervisor')),
  signer_id uuid references public.profiles(id) on delete set null,
  signer_name text,
  signature_png text not null,
  signed_at timestamptz not null default now(),
  unique (group_id, slot)
);
create index if not exists warehouse_scrap_group_signatures_group on public.warehouse_scrap_group_signatures (group_id);

-- 4. RLS: lee quien ve la merma de esa tienda; nadie escribe directo (solo las RPC definer)
alter table public.warehouse_scrap_groups enable row level security;
drop policy if exists "warehouse scrap groups read" on public.warehouse_scrap_groups;
create policy "warehouse scrap groups read" on public.warehouse_scrap_groups for select to authenticated
  using (public.warehouse_ops_can_see('scrap', store, null));
revoke all on public.warehouse_scrap_groups from anon;

alter table public.warehouse_scrap_group_signatures enable row level security;
drop policy if exists "warehouse scrap group signatures read" on public.warehouse_scrap_group_signatures;
create policy "warehouse scrap group signatures read" on public.warehouse_scrap_group_signatures for select to authenticated
  using (exists (
    select 1 from public.warehouse_scrap_groups g
     where g.id = group_id and public.warehouse_ops_can_see('scrap', g.store, null)
  ));
revoke all on public.warehouse_scrap_group_signatures from anon;

-- 5. Crear el grupo con las mermas marcadas
create or replace function public.warehouse_ops_create_scrap_group(p_name text, p_report_ids uuid[])
  returns uuid
  language plpgsql volatile security definer set search_path = public as $$
declare
  yo uuid := auth.uid();
  limpio text := btrim(coalesce(p_name, ''));
  la_tienda text;
  cuantas int;
  validas int;
  nombre text;
  nuevo uuid;
begin
  if limpio = '' then raise exception 'warehouse_ops: el grupo necesita un nombre' using errcode = '22023'; end if;
  if length(limpio) > 120 then raise exception 'warehouse_ops: el nombre es muy largo' using errcode = '22023'; end if;
  if p_report_ids is null or array_length(p_report_ids, 1) is null then
    raise exception 'warehouse_ops: no hay mermas seleccionadas' using errcode = '22023';
  end if;
  -- Todas de la MISMA tienda, merma, fotografiadas (con foto y sin aprobar) y sin grupo.
  select count(*), count(*) filter (
      where kind = 'scrap' and coalesce(stage, 'documented') = 'photographed' and scrap_group_id is null
    ), min(store), max(store)
    into cuantas, validas, la_tienda, nombre  -- nombre se reusa como "max(store)" aqui
    from public.warehouse_reports where id = any(p_report_ids);
  if cuantas <> array_length(p_report_ids, 1) then
    raise exception 'warehouse_ops: alguna merma no existe o no se puede ver' using errcode = '22023';
  end if;
  if validas <> cuantas then
    raise exception 'warehouse_ops: solo mermas fotografiadas, sin aprobar y sin grupo' using errcode = '22023';
  end if;
  if la_tienda is distinct from nombre then
    raise exception 'warehouse_ops: todas las mermas deben ser de la misma tienda' using errcode = '22023';
  end if;
  if yo is null or not public.warehouse_ops_can_manage(la_tienda) then
    raise exception 'warehouse_ops: solo quien gestiona esa tienda crea el grupo' using errcode = '42501';
  end if;
  select full_name into nombre from public.profiles where id = yo;
  insert into public.warehouse_scrap_groups (name, store, created_by, created_by_name)
    values (limpio, la_tienda, yo, nombre) returning id into nuevo;
  update public.warehouse_reports set scrap_group_id = nuevo where id = any(p_report_ids);
  return nuevo;
end $$;
revoke all on function public.warehouse_ops_create_scrap_group(text, uuid[]) from public, anon;
grant execute on function public.warehouse_ops_create_scrap_group(text, uuid[]) to authenticated;

-- 6. Firmar un espacio del grupo
create or replace function public.warehouse_ops_sign_scrap_group(p_group uuid, p_slot text, p_png text)
  returns void
  language plpgsql volatile security definer set search_path = public as $$
declare
  yo uuid := auth.uid();
  g record;
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
  select signer_id into otro from public.warehouse_scrap_group_signatures where group_id = p_group and slot <> p_slot;
  if otro is not null and otro = yo then
    raise exception 'warehouse_ops: las dos firmas deben ser de personas distintas' using errcode = '22023';
  end if;
  select full_name into nombre from public.profiles where id = yo;
  insert into public.warehouse_scrap_group_signatures (group_id, slot, signer_id, signer_name, signature_png, signed_at)
    values (p_group, p_slot, yo, nombre, p_png, now())
  on conflict (group_id, slot) do update
    set signer_id = excluded.signer_id, signer_name = excluded.signer_name, signature_png = excluded.signature_png, signed_at = now();
end $$;
revoke all on function public.warehouse_ops_sign_scrap_group(uuid, text, text) from public, anon;
grant execute on function public.warehouse_ops_sign_scrap_group(uuid, text, text) to authenticated;

-- 7. Quitar una firma del grupo (solo si no aprobado)
create or replace function public.warehouse_ops_unsign_scrap_group(p_group uuid, p_slot text)
  returns void
  language plpgsql volatile security definer set search_path = public as $$
declare
  yo uuid := auth.uid();
  g record;
  quien uuid;
  admin boolean;
begin
  if p_slot is null or p_slot not in ('gerente', 'supervisor') then
    raise exception 'warehouse_ops: firma desconocida' using errcode = '22023';
  end if;
  select * into g from public.warehouse_scrap_groups where id = p_group;
  if g.id is null then raise exception 'warehouse_ops: grupo desconocido'; end if;
  if g.approved_at is not null then raise exception 'warehouse_ops: el grupo ya esta aprobado' using errcode = '22023'; end if;
  if yo is null or not public.warehouse_ops_can_manage(g.store) then
    raise exception 'warehouse_ops: sin acceso' using errcode = '42501';
  end if;
  select signer_id into quien from public.warehouse_scrap_group_signatures where group_id = p_group and slot = p_slot;
  if quien is null then return; end if;
  admin := coalesce(public.warehouse_ops_level_of(yo), '') in ('admin', 'store_admin');
  if quien <> yo and not admin then
    raise exception 'warehouse_ops: solo quien firmo (o un admin) quita la firma' using errcode = '42501';
  end if;
  delete from public.warehouse_scrap_group_signatures where group_id = p_group and slot = p_slot;
end $$;
revoke all on function public.warehouse_ops_unsign_scrap_group(uuid, text) from public, anon;
grant execute on function public.warehouse_ops_unsign_scrap_group(uuid, text) to authenticated;

-- 8. Aprobar el grupo: exige las dos firmas distintas; aprueba todas sus mermas a la vez
create or replace function public.warehouse_ops_approve_scrap_group(p_group uuid)
  returns void
  language plpgsql volatile security definer set search_path = public as $$
declare
  yo uuid := auth.uid();
  g record;
  firmantes int;
begin
  select * into g from public.warehouse_scrap_groups where id = p_group;
  if g.id is null then raise exception 'warehouse_ops: grupo desconocido'; end if;
  if yo is null or not public.warehouse_ops_can_manage(g.store) then
    raise exception 'warehouse_ops: solo quien gestiona esa tienda aprueba' using errcode = '42501';
  end if;
  if g.approved_at is not null then raise exception 'warehouse_ops: el grupo ya esta aprobado' using errcode = '22023'; end if;
  -- NO se aprueba sin las DOS firmas, y de dos personas distintas.
  select count(distinct signer_id) into firmantes
    from public.warehouse_scrap_group_signatures where group_id = p_group and slot in ('gerente', 'supervisor');
  if not exists (select 1 from public.warehouse_scrap_group_signatures where group_id = p_group and slot = 'gerente')
     or not exists (select 1 from public.warehouse_scrap_group_signatures where group_id = p_group and slot = 'supervisor')
     or firmantes < 2 then
    raise exception 'warehouse_ops: faltan las dos firmas (gerente y supervisor), de personas distintas' using errcode = '22023';
  end if;
  update public.warehouse_scrap_groups set approved_at = now(), approved_by = yo where id = p_group;
  -- Todas las mermas del grupo que esten fotografiadas pasan a aprobada (el guard recalcula `stage`).
  update public.warehouse_reports
     set approved_at = now(), approved_by = yo, approval_sheet = null, edited_by = yo, edited_at = now()
   where scrap_group_id = p_group and kind = 'scrap' and coalesce(stage, 'documented') = 'photographed';
end $$;
revoke all on function public.warehouse_ops_approve_scrap_group(uuid) from public, anon;
grant execute on function public.warehouse_ops_approve_scrap_group(uuid) to authenticated;

-- 9. El trigger de la 280, ampliado: al cambiar el contenido firmado de una merma, se borran sus firmas por-reporte Y
-- (si esta en un grupo) las del grupo, y el grupo vuelve a «no aprobado». `scrap_group_id` entra en la lista blanca.
create or replace function public.warehouse_ops_wipe_sigs_on_edit()
  returns trigger language plpgsql security definer set search_path = public as $$
declare
  auditoria text[] := array['stage', 'photographed_at', 'approved_at', 'approved_by', 'approval_sheet',
    'dumped_at', 'dumped_by', 'adjusted_at', 'adjusted_by', 'adjustment_proof', 'edited_by', 'edited_at', 'scrap_group_id'];
begin
  if NEW.kind = 'scrap'
     and (to_jsonb(NEW) - auditoria) is distinct from (to_jsonb(OLD) - auditoria) then
    delete from public.warehouse_report_signatures where report_id = NEW.id;
    if NEW.scrap_group_id is not null then
      delete from public.warehouse_scrap_group_signatures where group_id = NEW.scrap_group_id;
      update public.warehouse_scrap_groups set approved_at = null, approved_by = null where id = NEW.scrap_group_id;
    end if;
  end if;
  return NEW;
end $$;

-- ===========================================================================
-- Autocomprobacion
-- ===========================================================================
do $chk$
declare f text;
begin
  foreach f in array array['public.warehouse_scrap_groups', 'public.warehouse_scrap_group_signatures'] loop
    if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = split_part(f, '.', 2)) then
      raise exception '281: falta la tabla %', f;
    end if;
    if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = split_part(f, '.', 2) and rowsecurity) then
      raise exception '281: % no tiene RLS', f;
    end if;
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = split_part(f, '.', 2) and cmd <> 'SELECT') then
      raise exception '281: % no debe tener politicas de escritura (solo las RPC)', f;
    end if;
  end loop;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'warehouse_reports' and column_name = 'scrap_group_id') then
    raise exception '281: falta warehouse_reports.scrap_group_id';
  end if;
  foreach f in array array['public.warehouse_ops_create_scrap_group(text, uuid[])', 'public.warehouse_ops_sign_scrap_group(uuid, text, text)',
    'public.warehouse_ops_unsign_scrap_group(uuid, text)', 'public.warehouse_ops_approve_scrap_group(uuid)'] loop
    if has_function_privilege('anon', f, 'execute') then raise exception '281: anon ejecuta %', f; end if;
  end loop;
  f := pg_get_functiondef('public.warehouse_ops_approve_scrap_group(uuid)'::regprocedure);
  if position('faltan las dos firmas' in f) = 0 or position('count(distinct signer_id)' in f) = 0 then
    raise exception '281: approve_scrap_group no exige las dos firmas distintas';
  end if;
  f := pg_get_functiondef('public.warehouse_ops_wipe_sigs_on_edit()'::regprocedure);
  if position('warehouse_scrap_group_signatures' in f) = 0 or position('scrap_group_id' in f) = 0 then
    raise exception '281: el trigger de invalidacion no cubre los grupos';
  end if;
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('281_merma_grupos_de_aprobacion.sql', '008f3c4b9ae843eb776755a0c81d99d726aaff2e6f9a1c76cf20e441abb49d7a') on conflict (name) do nothing;
