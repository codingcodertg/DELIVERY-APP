-- 237: Ventas no agenda para HOY despues de las 12 del mediodia, hora de Texas (D-845).
--
-- El dueño, 2026-11-04: «recuerda la regla, sales no pueden ingresar una orden para el mismo dia despues de las 12, tiene
-- que ser para el dia siguiente».
--
-- La pantalla ya lo hace (`src/lib/corte-de-ventas.ts`: la ficha, enviar un borrador, reenviar una rechazada, «solo la
-- fecha», duplicar y «Reprogramar»). Esto lo repite en la base para quien llame a Supabase sin pasar por la pantalla:
-- la politica de UPDATE de `deliveries` solo pide el modulo, y el guard de etapas (`guard_delivery_stage`) deja a ventas
-- crear `pending`/`approved` y cambiar la fecha en `draft`/`pending`/`rejected`, con cualquier fecha.
--
-- La regla (la misma que `cortaPorMediodia` del cliente):
--   · Solo el rol `sales` (como el guard, un perfil sin rol cuenta como ventas). Admin, gerente, logistica, almacen,
--     office y chofer no cambian. La llave de servicio y los crons (`auth.uid()` nulo) tampoco.
--   · Solo una orden que QUEDA programada: `pending`, `approved`, `fulfilling`, `ready`. Un borrador no se agenda (D-532:
--     el tope le cae al enviarlo); anulada, rechazada, recogida y entregada, tampoco.
--   · Solo cuando la escritura AGENDA: orden nueva; fecha que cambia; o una orden que SALE de borrador o rechazada (enviar
--     o reenviar) aunque no cambie la fecha. Una orden que ya estaba programada para hoy y se toca sin cambiarle la fecha
--     (anularla, una nota) pasa.
--   · Desde las 12:00 en America/Chicago (con su cambio de horario), la fecha tiene que ser posterior a hoy en Texas.
--
-- No es un guard nuevo dentro de `guard_delivery_stage`: es una funcion y un disparador aparte, para no reescribir el guard
-- vivo (que ya tiene seis versiones). `reprogramar_orden` (173) es security definer, pero `auth.uid()` sigue siendo quien
-- llama, asi que tambien pasa por aqui.
--
-- Sin begin/commit: quien aplica envuelve el fichero. **Sin aplicar** cuando se escribio: la aplica el orquestador tras
-- fusionar, con `migrate-status` antes y despues.
--
-- Ensayo por rol, con ROLLBACK (pendiente; no corrido desde la rama). Fijar la hora con una orden de prueba:
--   C1 ventas, 11:59 Texas, INSERT pending para hoy                    -> pasa
--   C2 ventas, 12:00 Texas, INSERT pending para hoy                    -> SALES_NOON_CUTOFF
--   C3 ventas, 12:00 Texas, INSERT pending para mañana                 -> pasa
--   C4 ventas, 15:00 Texas, INSERT draft para hoy                      -> pasa (el borrador no agenda)
--   C5 ventas, 15:00 Texas, UPDATE draft -> pending, fecha de hoy       -> SALES_NOON_CUTOFF
--   C6 ventas, 15:00 Texas, UPDATE rejected -> pending, fecha de hoy    -> SALES_NOON_CUTOFF
--   C7 ventas, 15:00 Texas, UPDATE pending, fecha mañana -> hoy         -> SALES_NOON_CUTOFF
--   C8 ventas, 15:00 Texas, UPDATE pending de hoy -> canceled           -> pasa
--   C9 ventas, 15:00 Texas, rpc reprogramar_orden(SU aprobada, hoy)     -> SALES_NOON_CUTOFF
--   C10 gerente / logistica / admin, 15:00 Texas, INSERT/UPDATE para hoy -> pasa
--   C11 llave de servicio (auth.uid() nulo), 15:00, para hoy            -> pasa
--
-- Reversion:
--   drop trigger if exists deliveries_guard_corte_ventas on public.deliveries;
--   drop function if exists public.guard_corte_mediodia_ventas();
--   delete from public.schema_migrations where name = '237_corte_mediodia_ventas.sql';

create or replace function public.guard_corte_mediodia_ventas()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  ahora_tx timestamp := now() at time zone 'America/Chicago';
begin
  if auth.uid() is null then return NEW; end if;
  if coalesce(public.current_user_role(), 'sales') <> 'sales' then return NEW; end if;
  if NEW.delivery_date is null then return NEW; end if;
  if coalesce(NEW.stage, 'draft') not in ('pending','approved','fulfilling','ready') then return NEW; end if;
  if TG_OP = 'UPDATE'
     and NEW.delivery_date is not distinct from OLD.delivery_date
     and OLD.stage in ('pending','approved','fulfilling','ready') then
    return NEW;
  end if;
  if extract(hour from ahora_tx) >= 12 and NEW.delivery_date <= ahora_tx::date then
    raise exception 'After 12:00 noon, sales orders start tomorrow. Pick tomorrow or a later day. / Después de las 12:00 del mediodía, las órdenes de ventas son para mañana. Elige mañana o un día posterior.'
      using hint = 'SALES_NOON_CUTOFF';
  end if;
  return NEW;
end $function$
;

drop trigger if exists deliveries_guard_corte_ventas on public.deliveries;
create trigger deliveries_guard_corte_ventas before insert or update on public.deliveries
  for each row execute function public.guard_corte_mediodia_ventas();

-- ===========================================================================
-- Se comprueba a si misma (mira el catalogo y el codigo, sin las lineas de comentario)
-- ===========================================================================
do $chk$
declare
  def    text := pg_get_functiondef('public.guard_corte_mediodia_ventas()'::regprocedure);
  codigo text := regexp_replace(regexp_replace(def, '^[ \t]*--.*$', '', 'gn'), '\s+', ' ', 'g');
begin
  if position('America/Chicago' in codigo) = 0 then
    raise exception '237: la hora no se lee en Texas';
  end if;
  if position('extract(hour from ahora_tx) >= 12 and NEW.delivery_date <= ahora_tx::date' in codigo) = 0 then
    raise exception '237: falta la regla de las 12';
  end if;
  if position('coalesce(public.current_user_role(), ''sales'') <> ''sales'' then return NEW;' in codigo) = 0 then
    raise exception '237: falta la salida de los roles que no son ventas';
  end if;
  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.deliveries'::regclass and tgname = 'deliveries_guard_corte_ventas'
                    and not tgisinternal and tgenabled = 'O'
                    and tgfoid = 'public.guard_corte_mediodia_ventas()'::regprocedure) then
    raise exception '237: el disparador deliveries_guard_corte_ventas no esta o no esta activo';
  end if;
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum)
  values ('237_corte_mediodia_ventas.sql', 'ec9515e57dbd981adaa3025e2d45644ab811558ee34d71e5581eb3b2b09aebad') on conflict (name) do nothing;
