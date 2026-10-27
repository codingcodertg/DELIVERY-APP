-- ===========================================================================
-- 206 . El turno del chofer dice desde que app se marco y como va su GPS
-- ===========================================================================
-- PEDIDO. El duenio, 2026-10-27, con la auditoria del GPS: «porque los gps en los drivers julio max y ellos porque
-- no me aparece en el app todo el recorrido de ellos» y luego «haz las 3 y dame el comando de la migracion».
--
-- POR QUE AQUI. Cuando el GPS de un telefono falla, la app lo sabe (el estado del rastreo: sin permiso, sin GPS,
-- o ni siquiera es la APK sino un navegador) y lo tiraba: no se ensenaba ni se escribia. Por eso nadie pudo decir
-- que le pasaba al telefono de Maximo (cero puntos desde el 2 de septiembre con turnos todos los dias). El unico
-- sitio que ya existe por turno es public.driver_shifts; ahi va.
--
-- QUE HACE: tres columnas en public.driver_shifts, todas nulas en lo viejo:
--   app     text        'apk/6' (la APK y su versionCode) o 'navegador'. La escribe «Marcar entrada».
--   gps     text        el ultimo estado del rastreo en ese turno: 'live' | 'starting' | 'denied' | 'unavailable' |
--                       'off'. Lo escribe el rastreador cada vez que cambia.
--   gps_at  timestamptz cuando se escribio `gps`.
-- Sin politicas nuevas: «auth write driver_shifts» (FOR ALL, has_deliveries_access) ya deja al chofer escribir su
-- fila, y «auth read driver_shifts» ya deja leerla a la oficina.
--
-- Sin begin/commit: quien aplica envuelve el fichero.
--
-- Reversion: alter table public.driver_shifts drop column app, drop column gps, drop column gps_at; y borrar la
-- fila del registro.

alter table public.driver_shifts
  add column if not exists app text,
  add column if not exists gps text,
  add column if not exists gps_at timestamptz;

comment on column public.driver_shifts.app is
  '206: desde que app se marco la entrada: ''apk/<versionCode>'' o ''navegador''. Nula = turno anterior a la 206.';
comment on column public.driver_shifts.gps is
  '206: ultimo estado del rastreo en este turno (live, starting, denied, unavailable, off). Lo escribe el rastreador.';
comment on column public.driver_shifts.gps_at is
  '206: cuando se escribio gps.';

alter table public.driver_shifts drop constraint if exists driver_shifts_gps_check;
alter table public.driver_shifts add constraint driver_shifts_gps_check
  check (gps is null or gps in ('live', 'starting', 'denied', 'unavailable', 'off'));

do $chk$
begin
  if (select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'driver_shifts' and column_name in ('app', 'gps', 'gps_at')) <> 3 then
    raise exception '206: faltan columnas en driver_shifts';
  end if;
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('206_turno_dice_app_y_gps.sql', '9763f994b88d2e9b3435605d893a5ffe0a69c35bd550c6401b89eb4bac141f2d') on conflict (name) do nothing;
