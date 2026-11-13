-- 306_pausas_recibo_despues.sql — «Recibos después» (D-548): la parada de gasolina se registra en el momento, y su recibo se
-- sube después, sin tocar la hora ni el lugar. Además, nadie crea paradas de atrás, y una parada cerrada solo cambia su recibo.
--
-- El dueño, 2026-11-13: «drivers log stops at the end of the day just to attach receipts… stops must still be logged IN THE
-- MOMENT (the purpose is to know why they went off route and lost time), but receipts can be uploaded LATER».
--
-- Qué cambia:
-- 1) Se quita `pausas_gasolina_con_recibo`: una parada de gasolina puede cerrarse SIN recibo. Queda pendiente (recibo_foto
--    null y sin_recibo false) hasta que el chofer suba la foto o diga «no tengo». La 167 la exigía al cerrar.
-- 2) Insertar: solo una parada que empieza ahora (±2 min) y sin hora de término. La 167 dejaba mandar una empezo_at de atrás.
-- 3) Actualizar: el chofer toca la abierta (como antes) o una cerrada de gasolina que AÚN NO tiene recibo.
-- 4) Trigger: una cerrada solo puede cambiar recibo_foto, recibo_monto y recibo_galones, y la foto no puede quedar vacía.
--    Todo lo demás de una cerrada (inicio, fin, lugar, motivo, nota, «no tengo») queda fijo. service_role queda fuera
--    (mantenimiento).
--
-- Por qué trigger además de RLS: la RLS decide qué FILAS toca el chofer, no qué COLUMNAS. Es el trigger el que deja cambiar
-- solo el recibo.
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

-- 4) En una cerrada solo cambia el recibo, y el recibo tiene que quedar puesto.
create or replace function public.pausas_del_chofer_solo_recibo()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.termino_at is null then
    return new;
  end if;
  if current_setting('role', true) = 'service_role' then
    return new;
  end if;
  if new.driver_id is distinct from old.driver_id
     or new.motivo is distinct from old.motivo
     or new.nota is distinct from old.nota
     or new.empezo_at is distinct from old.empezo_at
     or new.termino_at is distinct from old.termino_at
     or new.lat is distinct from old.lat
     or new.lng is distinct from old.lng
     or new.precision_m is distinct from old.precision_m
     or new.sin_recibo is distinct from old.sin_recibo
     or new.created_at is distinct from old.created_at then
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
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'pausas_gasolina_con_recibo' and conrelid = 'public.pausas_del_chofer'::regclass) then
    raise exception '306: sigue la constraint pausas_gasolina_con_recibo';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'pausas_solo_recibo_al_cerrar' and tgrelid = 'public.pausas_del_chofer'::regclass) then
    raise exception '306: falta el trigger pausas_solo_recibo_al_cerrar';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'pausas_del_chofer') <> 3 then
    raise exception '306: la tabla debe tener exactamente 3 políticas';
  end if;
  if has_table_privilege('anon', 'public.pausas_del_chofer', 'select') then
    raise exception '306: anon no debe poder leer pausas_del_chofer';
  end if;
end $$;

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('306_pausas_recibo_despues.sql', '0de24d33de9722699fa4bd1a666fab1f6c1282a0ea76012e6f193564679d857f') on conflict (name) do nothing;
