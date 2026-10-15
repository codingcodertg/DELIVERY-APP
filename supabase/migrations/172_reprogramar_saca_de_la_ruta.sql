-- 172: una orden que se reprograma sale de la ruta de su chofer.
--
-- El dueño (2026-10-14): «invoice 170992 got rescheduled for saturday. since it was programmed for todays route Max sees it
-- on his phone but it should be automatically removed from the route if a delivery gets rescheduled». Medido: FU550 pasó
-- de 2026-10-14 a 2026-10-17 a las 13:47:56 y siguió con Maximo Garza como parada 3 hasta que alguien la quitó a mano a
-- las 13:52:12. Cambiar la fecha nunca tocaba el chofer.
--
-- Por qué en la base y no en la pantalla: la fecha la cambian la ficha, «📅 Reprogramar» (D-500, D-534 almacén) y ventas,
-- que SOLO puede cambiar la fecha (D-480, guard de la 125): si la pantalla mandara también `assigned_driver: null`, el
-- guardia rechazaría el cambio del vendedor. Este trigger corre DESPUÉS de los guardias (los BEFORE se disparan por orden
-- alfabético: guard_invoice, guard_stage, guardar_borrada, touch, y este `zz_`), así que el guardia ve un cambio de fecha
-- y nada más, y aquí se quita el chofer.
--
-- Cuándo: la fecha cambia de verdad, la orden tenía chofer, el chofer NO cambió en la misma escritura (quien reasigna a
-- propósito, p. ej. el Gestor moviéndola a la ruta de otro día, manda las dos cosas y se respeta), y la orden aún no se
-- ha recogido (pending, approved, fulfilling, ready). Recogida, entregada o anulada: no se toca.
-- Qué: chofer, posición en la ruta y orden de recogida a null, y un evento en la orden para que quede escrito por qué.
--
-- Sin begin/commit (la memoria «una migración no lleva su propia transacción»).

create or replace function public.reprogramar_saca_de_la_ruta()
  returns trigger language plpgsql security definer set search_path = public as $$
begin
  if NEW.delivery_date is distinct from OLD.delivery_date
     and OLD.assigned_driver is not null
     and NEW.assigned_driver is not distinct from OLD.assigned_driver
     and NEW.stage in ('pending', 'approved', 'fulfilling', 'ready') then
    insert into public.order_events (delivery_id, kind, note, created_by)
      values (NEW.id, 'edited',
              'Removed from ' || OLD.assigned_driver || '''s route: rescheduled from ' || coalesce(OLD.delivery_date::text, '—')
                || ' to ' || coalesce(NEW.delivery_date::text, '—') || ' / Fuera de la ruta de ' || OLD.assigned_driver
                || ': se reprogramó',
              auth.uid());
    NEW.assigned_driver := null;
    NEW.route_seq := null;
    NEW.pickup_seq := null;
  end if;
  return NEW;
end $$;

revoke execute on function public.reprogramar_saca_de_la_ruta() from public, anon, authenticated;

drop trigger if exists deliveries_zz_reprogramar_saca_de_la_ruta on public.deliveries;
create trigger deliveries_zz_reprogramar_saca_de_la_ruta
  before update of delivery_date on public.deliveries
  for each row execute function public.reprogramar_saca_de_la_ruta();

-- Comprobación: el trigger existe, es BEFORE UPDATE y corre después de los guardias (por nombre).
do $chk$
declare ultimo text;
begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.deliveries'::regclass and tgname = 'deliveries_zz_reprogramar_saca_de_la_ruta') then
    raise exception '172: falta el trigger';
  end if;
  select max(tgname) into ultimo from pg_trigger
   where tgrelid = 'public.deliveries'::regclass and not tgisinternal and tgtype & 2 = 2;
  if ultimo <> 'deliveries_zz_reprogramar_saca_de_la_ruta' then
    raise exception '172: el trigger tiene que ser el ultimo BEFORE (hay %)', ultimo;
  end if;
end $chk$;

-- Reversión: drop trigger deliveries_zz_reprogramar_saca_de_la_ruta on public.deliveries;
--            drop function public.reprogramar_saca_de_la_ruta();

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('172_reprogramar_saca_de_la_ruta.sql', '192c435f7d7aa2379a038ac386a38a083b5066243978afa060836bf709823e20') on conflict (name) do nothing;
