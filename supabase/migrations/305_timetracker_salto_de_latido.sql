-- 305: una fila viva no puede crecer por un salto de latido mayor que el que el cron ya tolera.
--
-- Hallazgo (2026-11-13, cuenta del dueño, app de escritorio): la laptop se durmió con el cronómetro en marcha y al
-- despertar se contaron 8 h 25 min (sesión 25a25300…, 00:11:25 → 08:36:41 CT) sin una sola captura ni tecla. El
-- cliente ya corta el hueco en su tick (pausa-de-energia.ts, HUECO_DORMIDO_MS = 5 min), pero el cliente no es de
-- fiar solo: una pestaña vieja, un cliente sin actualizar o un INSERT pendiente pueden escribir `end_ms` = ahora.
--
-- Regla: si una fila viva recibe un latido con `end_ms` más de 16 min (LATIDO_MAX_MS = 15 min del cron de huérfanas,
-- más 60 s de margen) después del último que quedó guardado, la base la cierra en ese último latido: `is_live` pasa
-- a false, `end_ms` y `duration_seconds` se quedan como estaban, y `live_note` = 'closed:guard'. Lo que queda después
-- no se paga (D-098), igual que ya pasa con el cron. El cliente ve la fila cerrada y abre una nueva desde que vuelve.
--
-- No toca: filas ya cerradas, altas, cierres del cron o de la pantalla, ediciones de administración ni reaperturas.
-- No borra ni recalcula ningún dato existente.

create or replace function timetracker.corta_salto_de_latido()
returns trigger
language plpgsql
as $fn$
begin
  if OLD.is_live is true and NEW.is_live is true
     and OLD.end_ms is not null and NEW.end_ms is not null
     and NEW.end_ms - OLD.end_ms > 960000 then
    NEW.is_live := false;
    NEW.end_ms := OLD.end_ms;
    NEW.duration_seconds := OLD.duration_seconds;
    NEW.live_note := 'closed:guard';
  end if;
  return NEW;
end
$fn$;

drop trigger if exists sessions_corta_salto_de_latido on timetracker.sessions;
create trigger sessions_corta_salto_de_latido
  before update on timetracker.sessions
  for each row execute function timetracker.corta_salto_de_latido();

-- Verificación: si el trigger no quedó, la migración falla y no queda registrada.
do $chk$
begin
  if not exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'timetracker' and c.relname = 'sessions'
      and t.tgname = 'sessions_corta_salto_de_latido' and not t.tgisinternal
  ) then
    raise exception '305: falta el trigger sessions_corta_salto_de_latido';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'timetracker' and p.proname = 'corta_salto_de_latido'
  ) then
    raise exception '305: falta la función timetracker.corta_salto_de_latido';
  end if;
end
$chk$;

-- Para deshacer (no ejecutar en el flujo normal):
-- drop trigger if exists sessions_corta_salto_de_latido on timetracker.sessions;
-- drop function if exists timetracker.corta_salto_de_latido();
-- delete from public.schema_migrations where name = '305_timetracker_salto_de_latido.sql';

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('305_timetracker_salto_de_latido.sql', '82985d72489c83a06442ce929927bbcd13f57a98b0eac8db1fa87456cf175e37') on conflict (name) do nothing;
