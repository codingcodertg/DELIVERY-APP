-- 332: paradas con foto. Pedido del dueño, 2026-11-19 (resumen de la reunión con su jefe, no es cita): cuando el chofer
-- termina una parada de CUALQUIER motivo (no solo gasolina) puede subir una foto de lo que se pagó (un recibo, una
-- reparación de llanta) y, si quiere, el monto. Hoy solo la gasolina tiene recibo; un «Otro» con «tire repair» no dejaba
-- subir nada.
--
-- Qué cambia (y nada más):
-- 1) La constraint `pausas_recibo_solo_gasolina` (167) prohibía foto, monto y galones en una parada que no es de
--    gasolina. Se quita y se pone `pausas_galones_solo_gasolina`: la foto y el monto valen para cualquier motivo; los
--    galones y «no tengo recibo» siguen siendo solo de gasolina.
-- 2) La política de UPDATE (306) dejaba tocar una parada CERRADA solo si era de gasolina y no tenía recibo. Ahora es
--    cualquier motivo sin foto y sin «no tengo recibo»: así una parada cerrada de cualquier motivo puede recibir su foto y
--    su monto después, desde la pantalla «Paradas».
-- 3) El trigger 306 (`pausas_del_chofer_solo_recibo`) NO se toca: ya deja cambiar solo la foto, el monto y los galones de
--    una cerrada, sin importar el motivo, y exige que la foto quede puesta. Lo congelado sigue congelado: quién, por qué,
--    cuándo empezó, la nota, el fin, el lugar y «no tengo recibo».
--
-- Antes de aplicar esta migración la app sigue funcionando: si la base rechaza una foto o un monto en una parada que no
-- es de gasolina, la parada se cierra igual (sin la foto ni el monto) y el chofer ve que la foto aún no se pudo guardar.
--
-- Idempotente: drop ... if exists, create policy tras drop policy if exists, add constraint tras drop constraint if
-- exists. Para deshacer (solo mientras no haya filas de otro motivo con foto o monto):
--   alter table public.pausas_del_chofer drop constraint if exists pausas_galones_solo_gasolina;
--   alter table public.pausas_del_chofer add constraint pausas_recibo_solo_gasolina check (motivo = 'gas' or (recibo_foto is null and recibo_monto is null and recibo_galones is null and not sin_recibo));
--   (y la política «pausas update» como estaba en la 306)
--   delete from public.schema_migrations where name = '332_paradas_con_foto.sql';
--
-- NO lleva `begin`/`commit` a propósito (igual que la 167 y la 306).

-- 1) La foto, el monto y la nota de recibo valen para cualquier motivo; los galones, solo para gasolina.
alter table public.pausas_del_chofer drop constraint if exists pausas_recibo_solo_gasolina;
alter table public.pausas_del_chofer drop constraint if exists pausas_galones_solo_gasolina;
alter table public.pausas_del_chofer add constraint pausas_galones_solo_gasolina
  check (motivo = 'gas' or (recibo_galones is null and not sin_recibo));

-- 2) Actualizar: la abierta, o una cerrada (de cualquier motivo) que todavía no tiene foto ni «no tengo recibo».
drop policy if exists "pausas update" on public.pausas_del_chofer;
create policy "pausas update" on public.pausas_del_chofer for update to authenticated
  using (driver_id = (select auth.uid())
         and (termino_at is null or (recibo_foto is null and sin_recibo = false)))
  with check (driver_id = (select auth.uid()));

notify pgrst, 'reload schema';

-- Comprobación: la constraint vieja fuera, la nueva puesta, la política de update con la regla nueva, y el trigger de 306
-- sigue en su sitio. Si algo no cuadra, revienta aquí.
do $chk$
declare
  def text;
begin
  if exists (select 1 from pg_constraint where conname = 'pausas_recibo_solo_gasolina' and conrelid = 'public.pausas_del_chofer'::regclass) then
    raise exception '332: sigue la constraint pausas_recibo_solo_gasolina';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pausas_galones_solo_gasolina' and conrelid = 'public.pausas_del_chofer'::regclass) then
    raise exception '332: falta la constraint pausas_galones_solo_gasolina';
  end if;
  select qual into def from pg_policies where schemaname = 'public' and tablename = 'pausas_del_chofer' and policyname = 'pausas update';
  if def is null or def not like '%recibo_foto IS NULL%' or def like '%motivo%' then
    raise exception '332: la política pausas update no tiene la regla de cualquier motivo';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'pausas_solo_recibo_al_cerrar' and tgrelid = 'public.pausas_del_chofer'::regclass and not tgisinternal) then
    raise exception '332: falta el trigger pausas_solo_recibo_al_cerrar (306)';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'pausas_del_chofer') <> 3 then
    raise exception '332: la tabla debe tener exactamente 3 políticas';
  end if;
end
$chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('332_paradas_con_foto.sql', 'cd3c3216547261b685e384971128d16c6b7f0209f42859f1bd15b69134c62771') on conflict (name) do nothing;
