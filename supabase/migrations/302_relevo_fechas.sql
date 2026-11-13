-- 302: transferencia por relevo — el paso b nunca queda con día ANTERIOR al del paso a (2026-11-12, auditoría de Entregas).
--
-- D-994 cuida el orden dentro del MISMO día (la recogida del paso b empieza 60 min después de la llegada del a) y
-- `guard_relevo` (256) impide RECOGER el b antes de que el a esté entregado. Faltaba la regla entre DÍAS: reprogramar
-- un paso no miraba al otro, y el b podía quedar programado un día antes que el a.
--
-- Disparador nuevo y aparte (no se toca `guard_relevo`): al CAMBIAR `delivery_date` de un paso de relevo
--   · un paso b (c, d...) con día no puede quedar antes del día del paso anterior mientras ese no esté entregado, ni
--     tener día si el anterior no lo tiene;
--   · un paso no puede quedar DESPUÉS del día del paso siguiente (ni sin día si el siguiente lo tiene) mientras el
--     siguiente no haya salido: primero se mueve el siguiente. La app lo hace sola, en ese orden (D-1018).
-- Las funciones del relevo (`activar_relevo` / `deshacer_relevo`) marcan la familia en `rtg.relevo` y pasan sin revisión,
-- igual que en `guard_relevo`. Un paso entregado o anulado no se revisa.
--
-- Additive. 237/238/239 intactas. Para deshacer:
--   drop trigger if exists deliveries_guard_relevo_fecha on public.deliveries;
--   drop function if exists public.guard_relevo_fecha();
--   delete from public.schema_migrations where name = '302_relevo_fechas.sql';

create or replace function public.guard_relevo_fecha()
  returns trigger language plpgsql security definer set search_path = public as $$
declare
  marca text := coalesce(current_setting('rtg.relevo', true), '');
  ant record;
  sig record;
begin
  if NEW.relay_step is null or NEW.delivery_date is not distinct from OLD.delivery_date then return NEW; end if;
  if marca = NEW.order_no::text then return NEW; end if;
  if NEW.stage in ('delivered', 'canceled') then return NEW; end if;

  if NEW.relay_step > 1 and NEW.delivery_date is not null then
    select d.stage, d.delivery_date into ant from public.deliveries d
     where d.order_no = NEW.order_no and d.is_training = NEW.is_training and d.relay_step = NEW.relay_step - 1
     limit 1;
    if found and ant.stage is distinct from 'delivered'
       and (ant.delivery_date is null or ant.delivery_date > NEW.delivery_date) then
      raise exception 'RELEVO_FECHA: this transfer step cannot be scheduled before the previous step (previous step date: %)', coalesce(ant.delivery_date::text, 'no date');
    end if;
  end if;

  select d.stage, d.delivery_date into sig from public.deliveries d
   where d.order_no = NEW.order_no and d.is_training = NEW.is_training and d.relay_step = NEW.relay_step + 1
   limit 1;
  if found and sig.stage not in ('picked_up', 'delivered', 'canceled') and sig.delivery_date is not null
     and (NEW.delivery_date is null or NEW.delivery_date > sig.delivery_date) then
    raise exception 'RELEVO_FECHA: move the next transfer step first: it is scheduled for %, before the new date of this step', sig.delivery_date::text;
  end if;

  return NEW;
end $$;

drop trigger if exists deliveries_guard_relevo_fecha on public.deliveries;
create trigger deliveries_guard_relevo_fecha
  before update of delivery_date on public.deliveries
  for each row execute function public.guard_relevo_fecha();

-- ===========================================================================
-- Autocomprobacion
-- ===========================================================================
do $chk$
declare f text; n int;
begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.deliveries'::regclass and tgname = 'deliveries_guard_relevo_fecha' and not tgisinternal) then
    raise exception '302: falta el disparador deliveries_guard_relevo_fecha';
  end if;
  f := pg_get_functiondef('public.guard_relevo_fecha()'::regprocedure);
  if position('rtg.relevo' in f) = 0 then
    raise exception '302: guard_relevo_fecha debe dejar pasar a las funciones del relevo';
  end if;
  -- Lo que hay hoy no debe quedar atrapado: ningun relevo vivo con el paso siguiente antes que el anterior.
  select count(*) into n
    from public.deliveries a join public.deliveries b
      on b.order_no = a.order_no and b.is_training = a.is_training and b.relay_step = a.relay_step + 1
   where a.relay_step is not null and a.stage not in ('delivered', 'canceled') and b.stage not in ('picked_up', 'delivered', 'canceled')
     and b.delivery_date is not null and (a.delivery_date is null or a.delivery_date > b.delivery_date);
  if n > 0 then
    raise notice '302: hay % relevo(s) vivos con el paso siguiente antes que el anterior; corrigelos reprogramando el paso siguiente', n;
  end if;
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('302_relevo_fechas.sql', '1f3fee9f29cda96fea6cfedceeec18ba841bb916ab75a7994e96002cb5053588') on conflict (name) do nothing;
