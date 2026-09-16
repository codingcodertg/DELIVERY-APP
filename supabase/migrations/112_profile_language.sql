-- 112 · Un solo idioma para todas las apps, por persona
--
-- La decision que la acompana es la de la rama `hub-mi-perfil`, en DECISIONS.md (la segunda
-- entrada de esa rama). Se cita la rama y no el numero: el checksum congela este cuerpo.
--
-- EL HUECO. Habia tres idiomas independientes, y D-122 lo dejo escrito como decision aparte:
--   * hub, Entregas, RR. HH. y ERP -> localStorage rtg_prefs.lang, por equipo;
--   * Time Tracker                 -> localStorage tt_lang, por equipo (D-206);
--   * avisos de fichaje            -> clockin.employee_settings.language, por persona (D-106).
-- Cambiarlo en uno no cambiaba los otros. El dueno: «el idioma debe ser general para todo».
--
-- LA FUENTE UNICA ES ESTA COLUMNA, por persona, para que siga a la persona entre equipos. Las dos
-- claves de localStorage quedan como copia para pintar antes de que responda la red (lib/prefs.tsx).
--
-- NULL A PROPOSITO, SIN VALOR POR DEFECTO Y SIN RELLENAR AQUI. Null significa «esta persona aun no
-- tiene idioma en el sistema nuevo». El navegador lo rellena la primera vez con lo que ya ve en
-- pantalla, y solo si sus dos copias locales coinciden (lib/idioma.ts, idiomaAlCargar). Rellenarlo
-- desde aqui obligaria a elegir sin saber que idioma tiene cada uno en su pantalla, y alguien veria
-- su app cambiar de idioma solo por desplegar.
--
-- QUIEN LA ESCRIBE: cada persona su propia fila. La politica de la 099 deja actualizar la fila
-- propia, y el guard de columnas privilegiadas (vigente en la 104) prohibe una lista cerrada
-- —permissions, store, username, erp_role, title, title_color— en la que el idioma no esta. No hace
-- falta tocar ni la politica ni el guard.
--
-- LOS AVISOS TAMBIEN LA SIGUEN. La vista clockin.profiles, que es de donde el servidor de fichaje
-- lee el idioma, pasa a leer primero esta columna y despues la vieja. Mientras esta este vacia, los
-- avisos siguen en el idioma de siempre. La vista se copia ENTERA de su definicion vigente (089),
-- porque create or replace la reemplaza completa; solo cambia la linea del idioma, y la prueba lo
-- comprueba contra la 089. El trigger que escribe a traves de la vista (vigente en la 090) no se
-- toca: sigue copiando el idioma a employee_settings, que queda como respaldo y ya no manda.

-- ===========================================================================
-- 1. La columna
-- ===========================================================================
alter table public.profiles
  add column if not exists language text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'profiles_language_check'
       and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_language_check
      check (language in ('en', 'es'));
  end if;
end $$;

comment on column public.profiles.language is
  'Idioma de la persona para todas las apps y los avisos (112). Null = aun no elegido en el sistema nuevo: cada app usa su copia local y los avisos, clockin.employee_settings.language.';

-- ===========================================================================
-- 2. La vista de fichaje lee primero el idioma unico
-- ===========================================================================
create or replace view clockin.profiles
with (security_invoker = on) as
  select p.id,
    es.company_id,
    p.full_name,
    case
      when p.role = 'admin' or p.timetracker_role = 'admin' then 'owner'
      when p.timetracker_role = 'manager' then 'manager'
      else 'employee'
    end as role,
    es.phone,
    coalesce(p.language, es.language, 'en') as language,
    coalesce(es.active, true) as active,
    es.location_consent_at,
    p.created_at,
    es.store_id,
    es.tutorial_seen_at,
    es.default_schedule,
    es.custom_schedule,
    coalesce(es.is_runner, false) as is_runner,
    es.vehicle_id,
    es."position",
    coalesce(es.extra_store_ids, '{}'::uuid[]) as extra_store_ids
  from public.profiles p
  join clockin.employee_settings es on es.id = p.id;

-- ===========================================================================
-- Reversion
-- ===========================================================================
--   -- la vista con la linea de la 089: coalesce(es.language, 'en') as language
--   -- (copiar la vista de la 089 entera, por lo mismo que arriba)
--   alter table public.profiles drop constraint if exists profiles_language_check;
--   alter table public.profiles drop column if exists language;   -- borra lo elegido

-- ===========================================================================
-- Comprobacion despues de aplicarla (de solo lectura)
-- ===========================================================================
--   select count(*) filter (where language is null) as sin_elegir,
--          count(*) filter (where language = 'es')  as es,
--          count(*) filter (where language = 'en')  as en
--     from public.profiles;                                   -- recien aplicada: todo sin_elegir
--   select count(*) from clockin.employee_settings where language = 'es';
--     -- cuantas personas tienen hoy los avisos en espanol: son las que pueden notar el cambio
--   select count(*) from clockin.profiles cp
--     join clockin.employee_settings es on es.id = cp.id
--    where cp.language is distinct from es.language;          -- recien aplicada: 0

-- @ledger-below
insert into public.schema_migrations (name, checksum)
  values ('112_profile_language.sql', 'a4758244ee137396028a8efcb95c218f25cbb9767ba2f7b5dab92ba11a962a99') on conflict (name) do nothing;
