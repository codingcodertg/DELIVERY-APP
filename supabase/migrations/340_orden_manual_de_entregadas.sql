-- 340 · El admin acomoda a mano las entregas YA HECHAS en el Gestor de Rutas.
--
-- El dueño (2026-11-21): «déjame solo al admin poder rearrange órdenes en el routes manager aunque ya estén delivered».
-- Lo hecho se pinta por su hora real (pod_delivered_at). `done_sort_at` es la hora con la que se ORDENA la fila cuando el
-- admin la movió; la hora real no se toca. Nula = se ordena por la hora real, como siempre.
-- Solo un admin puede cambiarla (trigger).
--
-- Vuelta atrás: drop trigger deliveries_done_sort_admin on public.deliveries; drop function public.deliveries_done_sort_admin();
--   alter table public.deliveries drop column done_sort_at;
--   delete from public.schema_migrations where name = '340_orden_manual_de_entregadas.sql';

alter table public.deliveries add column if not exists done_sort_at timestamptz;

create or replace function public.deliveries_done_sort_admin()
  returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.done_sort_at is distinct from old.done_sort_at and auth.uid() is not null and not public.is_admin() then
    raise exception 'deliveries: solo un admin acomoda las entregas hechas' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists deliveries_done_sort_admin on public.deliveries;
create trigger deliveries_done_sort_admin before update of done_sort_at on public.deliveries
  for each row execute function public.deliveries_done_sort_admin();
-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('340_orden_manual_de_entregadas.sql', '24858e9cdff8f6ca959c40b3c44e63affca4eadf5a955368daff5fbf62e0bb35') on conflict (name) do nothing;
