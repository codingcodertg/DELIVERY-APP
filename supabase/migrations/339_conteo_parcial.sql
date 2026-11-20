-- 339 · Conteos: se puede pasar a revisar con lo que ya se contó.
--
-- El dueño (2026-11-20): «déjalo click next con lo que sea que ya tiene contado, no tiene que contar todo».
-- warehouse_ops_count_advance (333) pedía todas las líneas contadas para pasar de counting a review. Ahora basta con
-- una. Las líneas SIN contar se quitan del conteo en ese momento (no tienen cantidad, órdenes pendientes ni firma),
-- así la firma (336) y el ajuste siguen viendo solo líneas contadas y no cambian.
--
-- Vuelta atrás: volver a crear warehouse_ops_count_advance con el cuerpo de la 333;
--   delete from public.schema_migrations where name = '339_conteo_parcial.sql';
-- (las líneas quitadas no vuelven: no tenían nada contado.)

create or replace function public.warehouse_ops_count_advance(p_count uuid, p_stage text, p_note text)
  returns void language plpgsql volatile security definer set search_path = public as $$
declare yo uuid := auth.uid(); c record; hechas int;
begin
  if yo is null then raise exception 'warehouse_ops: sin sesion' using errcode = '42501'; end if;
  select * into c from public.warehouse_counts where id = p_count for update;
  if c.id is null then raise exception 'warehouse_ops: conteo desconocido'; end if;
  if not public.warehouse_ops_in_store(c.store) then raise exception 'warehouse_ops: sin acceso a esa tienda' using errcode = '42501'; end if;
  if c.stage = 'organizing' and p_stage = 'counting' then
    update public.warehouse_counts set stage = 'counting', organized_at = now(), organized_by = yo where id = p_count;
  elsif c.stage = 'counting' and p_stage = 'review' then
    select count(*) into hechas from public.warehouse_count_lines l where l.count_id = p_count and l.counted_at is not null;
    if hechas = 0 then raise exception 'warehouse_ops: cuenta al menos un producto' using errcode = '22023'; end if;
    delete from public.warehouse_count_lines l where l.count_id = p_count and l.counted_at is null;
    update public.warehouse_counts set stage = 'review', counting_done_at = now(), counting_done_by = yo where id = p_count;
  elsif c.stage = 'review' and p_stage = 'sign_off' then
    update public.warehouse_counts set stage = 'sign_off', orders_reviewed_at = now(), orders_reviewed_by = yo, orders_note = nullif(btrim(p_note), '') where id = p_count;
  else
    raise exception 'warehouse_ops: de % no se pasa a %', c.stage, p_stage using errcode = '22023';
  end if;
end $$;
revoke all on function public.warehouse_ops_count_advance(uuid, text, text) from public, anon;
grant execute on function public.warehouse_ops_count_advance(uuid, text, text) to authenticated;
-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('339_conteo_parcial.sql', '118dd3b703c2872899903afc972923d73320cef1e3d5c3569420a068f337a140') on conflict (name) do nothing;
