-- 266: Merma: la fecha en que se rompio (warehouse_reports.broken_on) (Warehouse Ops) (2026-11-06).
--
-- El dueno (2026-11-06): «scrap needs to be able to input the date it was broken». El formulario de merma pregunta el
-- dia en que se rompio: por defecto hoy (hora de Texas), se puede cambiar, es obligatorio y no puede ser futuro.
--
-- Que hace:
--   1. public.warehouse_reports.broken_on (date). Solo la merma la lleva; los demas tipos, nula.
--   2. Los reportes de merma que ya hay: el dia en que se reportaron, en hora de Texas (America/Chicago).
--   3. Un trigger BEFORE INSERT, warehouse_report_set_broken_on: la pantalla manda el dia dentro de `answers`
--      (answers.broken_on, 'YYYY-MM-DD'); el trigger lo valida (un dia de verdad, no futuro en Texas), lo pasa a la
--      columna y lo quita de `answers`. Si no viene (una pantalla vieja en cache), pone hoy en Texas.
--      Por que por `answers` y un trigger, y no un parametro nuevo de warehouse_ops_file_report: la funcion no cambia
--      de firma ni de cuerpo (son 130 lineas que ya corren, reescritas cuatro veces), la pantalla desplegada sigue
--      entrando sin tocarla, y la validacion queda en la tabla, donde ninguna reescritura futura de la funcion la
--      puede perder.
--   4. Un check: toda merma tiene fecha del dano; ningun otro tipo la tiene.
--
-- ORDEN: aplicarla ANTES o despues de desplegar la pantalla nueva, da igual.
--   - Pantalla vieja + esta migracion: no manda la fecha; el trigger pone hoy en Texas. Nada cambia para ella.
--   - Pantalla nueva sin esta migracion: answers.broken_on se guarda dentro de `answers` y la columna no existe; la
--     pantalla lee el dia de ahi mientras tanto, y el paso 2b de esta migracion lo recoge al aplicarla.
-- No depende de la 265.
--
-- Sin begin/commit propios. Para deshacer:
--   drop trigger if exists warehouse_reports_broken_on on public.warehouse_reports;
--   drop function if exists public.warehouse_report_set_broken_on();
--   alter table public.warehouse_reports drop constraint if exists warehouse_reports_broken_on_shape;
--   alter table public.warehouse_reports drop column if exists broken_on;
--   delete from public.schema_migrations where name = '266_merma_fecha_del_dano.sql';

-- 1. La columna
alter table public.warehouse_reports add column if not exists broken_on date;

-- 2. Lo que ya hay
-- 2b. Primero, lo que una pantalla nueva haya guardado dentro de answers antes de aplicar esto (si es un dia valido y
--     no futuro); y se quita de answers.
--     Fila por fila y con su `exception`: un texto que no sea una fecha no tumba la migracion, se ignora.
do $previas$
declare f record; d date;
begin
  for f in select id, answers->>'broken_on' as v, (created_at at time zone 'America/Chicago')::date as reportado
             from public.warehouse_reports
            where kind = 'scrap' and broken_on is null and answers->>'broken_on' ~ '^\d{4}-\d{2}-\d{2}$' loop
    begin
      d := f.v::date;
      if d <= f.reportado then update public.warehouse_reports set broken_on = d where id = f.id; end if;
    exception when others then null;
    end;
  end loop;
end $previas$;
update public.warehouse_reports set answers = answers - 'broken_on' where answers ? 'broken_on';
-- 2a. El resto: el dia en que se reporto, en Texas.
update public.warehouse_reports
   set broken_on = (created_at at time zone 'America/Chicago')::date
 where kind = 'scrap' and broken_on is null;
update public.warehouse_reports set broken_on = null where kind <> 'scrap' and broken_on is not null;

-- 3. El trigger
create or replace function public.warehouse_report_set_broken_on()
  returns trigger language plpgsql set search_path = public as $$
declare
  v text := nullif(btrim(coalesce(NEW.answers->>'broken_on', '')), '');
  hoy date := (now() at time zone 'America/Chicago')::date;
  d date;
begin
  if NEW.answers ? 'broken_on' then NEW.answers := NEW.answers - 'broken_on'; end if;
  if NEW.kind <> 'scrap' then
    NEW.broken_on := null;
    return NEW;
  end if;
  if v is null then
    d := coalesce(NEW.broken_on, hoy);
  else
    if v !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'warehouse_ops: la fecha del dano no es valida (%)', v;
    end if;
    begin
      d := v::date;
    exception when others then
      raise exception 'warehouse_ops: la fecha del dano no es valida (%)', v;
    end;
  end if;
  if d > hoy then
    raise exception 'warehouse_ops: la fecha del dano no puede ser futura (%)', d;
  end if;
  NEW.broken_on := d;
  return NEW;
end $$;

drop trigger if exists warehouse_reports_broken_on on public.warehouse_reports;
create trigger warehouse_reports_broken_on before insert on public.warehouse_reports
  for each row execute function public.warehouse_report_set_broken_on();
revoke all on function public.warehouse_report_set_broken_on() from public, anon, authenticated;

-- 4. El check
alter table public.warehouse_reports drop constraint if exists warehouse_reports_broken_on_shape;
alter table public.warehouse_reports add constraint warehouse_reports_broken_on_shape
  check ((kind = 'scrap' and broken_on is not null) or (kind <> 'scrap' and broken_on is null));

create index if not exists warehouse_reports_broken_on on public.warehouse_reports (broken_on desc) where kind = 'scrap';

-- ===========================================================================
-- Autocomprobacion
-- ===========================================================================
do $chk$
begin
  if exists (select 1 from public.warehouse_reports where kind = 'scrap' and broken_on is null) then
    raise exception '266: queda merma sin fecha del dano';
  end if;
  if exists (select 1 from public.warehouse_reports where kind = 'scrap' and broken_on > (now() at time zone 'America/Chicago')::date) then
    raise exception '266: hay merma con fecha del dano futura';
  end if;
  if exists (select 1 from public.warehouse_reports where answers ? 'broken_on') then
    raise exception '266: quedo broken_on dentro de answers';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.warehouse_reports'::regclass and tgname = 'warehouse_reports_broken_on' and not tgisinternal) then
    raise exception '266: falta el trigger de la fecha del dano';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'warehouse_reports' and cmd <> 'SELECT') then
    raise exception '266: warehouse_reports no debe tener politicas de escritura';
  end if;
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('266_merma_fecha_del_dano.sql', '3d71c5d674d8ec394dc765251851d8a33bd1af7ebead191c29f744e7da6e0ce0') on conflict (name) do nothing;
