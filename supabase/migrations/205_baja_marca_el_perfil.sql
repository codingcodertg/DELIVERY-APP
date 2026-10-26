-- ===========================================================================
-- 205 . La baja de RR. HH. marca el perfil: `public.profiles.left_at`
-- ===========================================================================
-- PEDIDO. El duenio, 2026-10-26: «una vez se le da de baja, se tiene que, ya no tiene que volver a salir en ninguna
-- de las aplicaciones. Y se va a una parte de ahi que son empleados dados de baja.»
--
-- POR QUE AQUI. La baja vive en recruiting.employee_files.date_left, que la RLS solo deja leer a RR. HH. (094). Las
-- demas apps (hub, Entregas, Time Tracker, chat, directorio) leen public.profiles y no pueden ver esa fecha. El
-- unico sitio que todas leen es el perfil, y no tenia ninguna marca de «ya no esta» (la cuenta se puede banear en
-- auth, pero eso solo impide entrar; el perfil sigue saliendo en las listas).
--
-- QUE HACE:
--   1. public.profiles.left_at (date, nula = activo): copia de la date_left del expediente enlazado.
--   2. Un disparador en recruiting.employee_files la mantiene: al dar de baja, corregir, reactivar, o cambiar el
--      enlace (profile_id). Nadie la escribe a mano; la fuente de verdad sigue siendo el expediente.
--   3. Relleno de los expedientes que ya tienen baja.
-- Cada app decide despues si esconde a quien tiene left_at <= hoy; esta migracion no esconde nada por si sola.
--
-- Sin begin/commit: quien aplica envuelve el fichero.
--
-- Reversion: drop trigger employee_files_marca_perfil on recruiting.employee_files; drop function
-- recruiting.marca_baja_en_perfil(); alter table public.profiles drop column left_at; y borrar la fila del registro.

alter table public.profiles add column if not exists left_at date;
comment on column public.profiles.left_at is
  '205: fecha de baja del expediente de RR. HH. enlazado (recruiting.employee_files.date_left). La mantiene un disparador; nula = activo.';

create or replace function recruiting.marca_baja_en_perfil() returns trigger
  language plpgsql security definer set search_path = public, recruiting as $fn$
begin
  if tg_op = 'UPDATE' and old.profile_id is not null and old.profile_id is distinct from new.profile_id then
    update public.profiles set left_at = null where id = old.profile_id;
  end if;
  if new.profile_id is not null then
    update public.profiles set left_at = new.date_left where id = new.profile_id and left_at is distinct from new.date_left;
  end if;
  return new;
end $fn$;
revoke all on function recruiting.marca_baja_en_perfil() from public, anon, authenticated;

drop trigger if exists employee_files_marca_perfil on recruiting.employee_files;
create trigger employee_files_marca_perfil
  after insert or update of date_left, profile_id on recruiting.employee_files
  for each row execute function recruiting.marca_baja_en_perfil();

-- Al borrar un expediente, su perfil deja de estar de baja (no hay expediente que lo diga).
create or replace function recruiting.limpia_baja_en_perfil() returns trigger
  language plpgsql security definer set search_path = public, recruiting as $fn$
begin
  if old.profile_id is not null then
    update public.profiles set left_at = null where id = old.profile_id;
  end if;
  return old;
end $fn$;
revoke all on function recruiting.limpia_baja_en_perfil() from public, anon, authenticated;

drop trigger if exists employee_files_limpia_perfil on recruiting.employee_files;
create trigger employee_files_limpia_perfil
  after delete on recruiting.employee_files
  for each row execute function recruiting.limpia_baja_en_perfil();

update public.profiles p set left_at = f.date_left
  from recruiting.employee_files f
  where f.profile_id = p.id and f.date_left is not null and p.left_at is distinct from f.date_left;

-- ===========================================================================
-- Autocomprobacion
-- ===========================================================================
do $chk$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'left_at') then
    raise exception '205: falta profiles.left_at';
  end if;
  if (select count(*) from pg_trigger where tgrelid = 'recruiting.employee_files'::regclass
      and tgname in ('employee_files_marca_perfil', 'employee_files_limpia_perfil')) <> 2 then
    raise exception '205: faltan los disparadores';
  end if;
  if exists (select 1 from recruiting.employee_files f join public.profiles p on p.id = f.profile_id
             where p.left_at is distinct from f.date_left) then
    raise exception '205: hay perfiles cuya left_at no coincide con su expediente';
  end if;
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('205_baja_marca_el_perfil.sql', 'd817316df128773e74528a76527abe760aabb114d130fbd592831b04b1fb01f7') on conflict (name) do nothing;
