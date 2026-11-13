-- 306_pausas_recibo_despues.sql — «Recibos después»: la parada de gasolina se registra en el momento, y su recibo se
-- sube después, sin tocar la hora ni el lugar. Además, nadie crea paradas de atrás, y nadie reescribe una parada.
--
-- Pedido del 2026-11-13 (resumen, no es cita): las paradas se registran en el momento, para saber por qué se salió de la
-- ruta y cuánto tiempo se perdió; el recibo puede subirse después.
--
-- Qué cambia:
-- 1) Se quita `pausas_gasolina_con_recibo`: una parada de gasolina puede cerrarse SIN recibo. Queda pendiente (recibo_foto
--    null y sin_recibo false) hasta que el chofer suba la foto o diga «no tengo». La 167 la exigía al cerrar.
-- 2) Insertar: solo una parada que empieza ahora (±2 min) y sin hora de término.
-- 3) Actualizar: el chofer toca la abierta, o una cerrada de gasolina que AÚN NO tiene recibo (RLS).
-- 4) Trigger (lo que la RLS no puede decir: qué COLUMNAS):
--    · Nunca cambian id, driver_id, motivo, nota, empezo_at ni created_at (ni abierta ni cerrada).
--    · Abierta: solo se puede poner la hora de término, entre el inicio y ahora (con un margen de 10 min para el reloj
--      del teléfono). Así no se puede atrasar el inicio ni poner un fin en el futuro. Cerrar una parada vieja a la hora de
--      su día (en el pasado) cae dentro de esa regla: no hace falta una función aparte.
--      Además pueden cambiar lat, lng, precision_m (ubicación tardía) y el recibo.
--    · Cerrada: solo cambian recibo_foto, recibo_monto y recibo_galones, y la foto no puede quedar vacía. Término, lugar y
--      «no tengo recibo» quedan fijos.
--    · service_role queda fuera (mantenimiento).
--
-- Reversa (solo mientras no haya paradas pendientes que importen; si no, la constraint de abajo no vuelve a entrar):
--   drop trigger if exists pausas_solo_recibo_al_cerrar on public.pausas_del_chofer;
--   drop function if exists public.pausas_del_chofer_solo_recibo();
--   alter table public.pausas_del_chofer add constraint pausas_gasolina_con_recibo check (motivo <> 'gas' or termino_at is null or recibo_foto is not null or sin_recibo);
--   (y las políticas de insert y update, como estaban en la 167)
--
-- NO lleva `begin`/`commit` a propósito (igual que la 167): una migración con su propia transacción cierra la de fuera.

-- 1) La gasolina puede cerrarse sin recibo (queda pendiente).
alter table public.pausas_del_chofer drop constraint if exists pausas_gasolina_con_recibo;

-- 2) Insertar: solo una parada que empieza ahora, sin hora de término.
drop policy if exists "pausas insert" on public.pausas_del_chofer;
create policy "pausas insert" on public.pausas_del_chofer for insert to authenticated
  with check (driver_id = (select auth.uid())
              and termino_at is null
              and empezo_at between now() - interval '2 minutes' and now() + interval '2 minutes');

-- 3) Actualizar: la abierta, o una cerrada de gasolina sin recibo (para subirlo después).
drop policy if exists "pausas update" on public.pausas_del_chofer;
create policy "pausas update" on public.pausas_del_chofer for update to authenticated
  using (driver_id = (select auth.uid())
         and (termino_at is null or (motivo = 'gas' and recibo_foto is null and sin_recibo = false)))
  with check (driver_id = (select auth.uid()));

-- 4) Qué columnas puede cambiar quien no es el servidor (ver la cabecera).
create or replace function public.pausas_del_chofer_solo_recibo()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_setting('role', true) = 'service_role' then
    return new;
  end if;

  -- Nunca, ni abierta ni cerrada: quién, por qué, cuándo empezó, la nota y cuándo se creó.
  if new.id is distinct from old.id
     or new.driver_id is distinct from old.driver_id
     or new.motivo is distinct from old.motivo
     or new.nota is distinct from old.nota
     or new.empezo_at is distinct from old.empezo_at
     or new.created_at is distinct from old.created_at then
    raise exception 'pausas: no se cambia de quién, por qué ni cuándo empezó la parada';
  end if;

  if old.termino_at is null then
    -- Abierta: el fin, si se pone, cae entre el inicio y ahora (margen de 10 min para el reloj del teléfono).
    if new.termino_at is not null
       and (new.termino_at < old.empezo_at or new.termino_at > now() + interval '10 minutes') then
      raise exception 'pausas: la hora de término tiene que estar entre el inicio y ahora';
    end if;
    return new;
  end if;

  -- Cerrada: solo el recibo, y el recibo tiene que quedar puesto.
  if new.termino_at is distinct from old.termino_at
     or new.lat is distinct from old.lat
     or new.lng is distinct from old.lng
     or new.precision_m is distinct from old.precision_m
     or new.sin_recibo is distinct from old.sin_recibo then
    raise exception 'pausas: una parada cerrada solo puede recibir su recibo';
  end if;
  if new.recibo_foto is null then
    raise exception 'pausas: el recibo es una foto';
  end if;
  return new;
end;
$$;

drop trigger if exists pausas_solo_recibo_al_cerrar on public.pausas_del_chofer;
create trigger pausas_solo_recibo_al_cerrar
  before update on public.pausas_del_chofer
  for each row execute function public.pausas_del_chofer_solo_recibo();

notify pgrst, 'reload schema';

-- Comprobación: la constraint quitada, el trigger puesto y las tres políticas. Si algo no cuadra, revienta aquí.
do $chk$
begin
  if exists (select 1 from pg_constraint where conname = 'pausas_gasolina_con_recibo' and conrelid = 'public.pausas_del_chofer'::regclass) then
    raise exception '306: sigue la constraint pausas_gasolina_con_recibo';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'pausas_solo_recibo_al_cerrar' and tgrelid = 'public.pausas_del_chofer'::regclass and not tgisinternal) then
    raise exception '306: falta el trigger pausas_solo_recibo_al_cerrar';
  end if;
  if not exists (select 1 from pg_proc where proname = 'pausas_del_chofer_solo_recibo') then
    raise exception '306: falta la función del trigger';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'pausas_del_chofer') <> 3 then
    raise exception '306: la tabla debe tener exactamente 3 políticas';
  end if;
  if has_table_privilege('anon', 'public.pausas_del_chofer', 'select') then
    raise exception '306: anon no debe poder leer pausas_del_chofer';
  end if;
end
$chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('306_pausas_recibo_despues.sql', '8b5f03774ea1df8e562a1c6a14398e540a56523fd55a7d470623dd9a01d3a894') on conflict (name) do nothing;
