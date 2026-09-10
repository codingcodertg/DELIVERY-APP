-- 104 · Titulo por persona en la pastilla del perfil (D-NEXT)
--
-- Hasta hoy la pastilla de una persona decia SIEMPRE la etiqueta de su rol
-- (ROLE_INFO, constants.ts): "Gerente de Oficina" para todos los manager. El
-- dueno quiere escribirla el, por persona: "ese tag es el que quiero poder
-- cambiar y hacerlo como yo quiera".
--
-- Dos columnas nulas. Nulo o vacio = como hoy: la pastilla sigue siendo la del
-- rol, en el idioma activo y con su color. Por eso NO hay que migrar a nadie ni
-- rellenar nada: las 33 filas existentes se quedan en null y no cambian de
-- aspecto. El titulo es una capa encima del rol, no un reemplazo del rol, que
-- sigue decidiendo permisos, aterrizaje y la frase descriptiva de debajo.
--
-- Tres cosas que esta migracion hace cumplir EN LA BASE, no en el dialogo:
--
--   1. El color sale de una lista blanca de siete tokens de la paleta, los
--      mismos que ya usa ROLE_INFO. Ese valor acaba dentro de un `style`
--      inline en el cliente, asi que un valor libre no es solo feo: es la
--      superficie por la que se cuela lo que no queremos. Se guarda el token
--      pelado (`--purple`), y el cliente lo envuelve en var(); asi ni siquiera
--      un `var(...)` completo es aceptable aqui.
--   2. Un tope de 40 caracteres. La pastilla es estrecha.
--   3. Solo un admin escribe title/title_color. Esta es la importante: un
--      titulo libre editable por su dueno es una forma de hacerse pasar por
--      otra cosa — un vendedor poniendose "Administrador" en la insignia,
--      encima con el rojo de admin. La RLS de 099 deja a cada quien EDITAR SU
--      FILA, asi que sin esto un vendedor se lo pondria el mismo. Lo para el
--      guard, que es el unico sitio donde da igual por que camino venga la
--      escritura (dialogo, consola, rpc).
--
-- No toca ninguna politica RLS: 099 sigue mandando sobre QUE FILAS se pueden
-- tocar, y este guard sobre QUE COLUMNAS. Se anaden dos columnas al guard que
-- ya existe en vez de escribir uno nuevo, que es lo que dice el comentario de
-- 099: anadir es mas seguro que reescribir, pero un guard mas por columna
-- serian cinco triggers haciendo la misma pregunta.
--
-- Reversion:
--   alter table public.profiles drop column if exists title, drop column if exists title_color;
--   -- y volver a crear guard_profile_privileged_columns() sin las dos columnas
--   -- (el cuerpo anterior esta en 099_profiles_row_rls.sql:62-75).

alter table public.profiles
  add column if not exists title       text,
  add column if not exists title_color text;

comment on column public.profiles.title is
  'Titulo escrito a mano que sustituye a la etiqueta del rol en la pastilla de esta persona. Null/vacio = la del rol. No se traduce. Solo admin (guard_profile_privileged_columns).';
comment on column public.profiles.title_color is
  'Color de esa pastilla, como token de la paleta (--purple). Solo los siete de TITLE_COLORS. Solo cuenta si hay titulo.';

alter table public.profiles drop constraint if exists profiles_title_len;
alter table public.profiles add constraint profiles_title_len
  check (title is null or char_length(title) <= 40);

alter table public.profiles drop constraint if exists profiles_title_color_allowed;
alter table public.profiles add constraint profiles_title_color_allowed
  check (title_color is null or title_color in
    ('--red', '--purple', '--accent', '--teal', '--amber', '--green', '--ink-soft'));

-- El guard de 099, con title y title_color anadidos. Mismo cuerpo, dos condiciones mas.
create or replace function public.guard_profile_privileged_columns()
  returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Solo un admin cambia permissions/store/username/title/title_color. Un no-admin
  -- editando SU fila puede tocar full_name/avatar_url/active_session_id y nada mas.
  -- Mismo patron que guard_role_change.
  if coalesce(public.current_user_role(), 'sales') <> 'admin'
     and auth.uid() is not null
     and ( NEW.permissions is distinct from OLD.permissions
        or NEW.store       is distinct from OLD.store
        or NEW.username    is distinct from OLD.username
        or NEW.title       is distinct from OLD.title
        or NEW.title_color is distinct from OLD.title_color ) then
    raise exception 'Only an admin can change permissions, store, username or title';
  end if;
  return NEW;
end $$;

-- El trigger de 099 (profiles_guard_privileged) ya apunta a esta funcion: create or
-- replace la cambia por dentro sin tocarlo. No se recrea a proposito, para no dejar un
-- instante sin guardia en una tabla que se escribe en vivo.

-- @ledger-below
insert into public.schema_migrations (name, checksum)
  values ('104_profile_title.sql', 'c03ff763d23b450fc3f30bf82c5c3125d364b10694bcd1398d20960f1f780d1c') on conflict (name) do nothing;
