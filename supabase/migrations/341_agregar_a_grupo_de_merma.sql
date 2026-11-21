-- 341 · Agregar mermas a un grupo PENDIENTE en vez de crear otro.
--
-- Roberto (2026-11-21, ayuda): «Make an option where I can choose to add to a Pending Group instead of making a new group».
-- warehouse_ops_add_to_scrap_group(p_group, p_report_ids): las mismas reglas que crear el grupo (281) —merma, fotografiada,
-- sin grupo, de la tienda del grupo, y solo quien puede iniciar la aprobación de esa tienda—, y el grupo sin aprobar.
-- Como cambia lo que se firma, las firmas del grupo se borran (igual que al sacar una, 296).
--
-- Vuelta atrás: drop function public.warehouse_ops_add_to_scrap_group(uuid, uuid[]);
--   delete from public.schema_migrations where name = '341_agregar_a_grupo_de_merma.sql';

create or replace function public.warehouse_ops_add_to_scrap_group(p_group uuid, p_report_ids uuid[])
  returns void language plpgsql security definer set search_path = public as $$
declare
  yo uuid := auth.uid();
  g record;
  cuantas int;
  validas int;
begin
  if p_report_ids is null or array_length(p_report_ids, 1) is null then
    raise exception 'warehouse_ops: no hay mermas seleccionadas' using errcode = '22023';
  end if;
  select * into g from public.warehouse_scrap_groups where id = p_group for update;
  if g.id is null then raise exception 'warehouse_ops: grupo desconocido' using errcode = '22023'; end if;
  if g.approved_at is not null then raise exception 'warehouse_ops: el grupo ya esta aprobado' using errcode = '22023'; end if;
  if yo is null or not public.warehouse_ops_can_start_approval(g.store) then
    raise exception 'warehouse_ops: solo el gerente de la tienda cambia el grupo' using errcode = '42501';
  end if;
  select count(*), count(*) filter (
      where kind = 'scrap' and coalesce(stage, 'documented') = 'photographed' and scrap_group_id is null and store = g.store)
    into cuantas, validas
    from public.warehouse_reports where id = any(p_report_ids);
  if cuantas <> array_length(p_report_ids, 1) then
    raise exception 'warehouse_ops: alguna merma no existe o no se puede ver' using errcode = '22023';
  end if;
  if validas <> cuantas then
    raise exception 'warehouse_ops: solo mermas fotografiadas, sin grupo y de la tienda del grupo' using errcode = '22023';
  end if;
  update public.warehouse_reports set scrap_group_id = p_group where id = any(p_report_ids);
  delete from public.warehouse_scrap_group_signatures where group_id = p_group;
end $$;

revoke all on function public.warehouse_ops_add_to_scrap_group(uuid, uuid[]) from public;
grant execute on function public.warehouse_ops_add_to_scrap_group(uuid, uuid[]) to authenticated;
-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('341_agregar_a_grupo_de_merma.sql', '07ba1bfa8986cf0ab0985e49401bbf065d1f51e5159f352374c46fa3cf93912d') on conflict (name) do nothing;
