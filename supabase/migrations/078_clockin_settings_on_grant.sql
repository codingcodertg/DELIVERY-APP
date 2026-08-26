-- 078: dar acceso a clock-in tiene que crear también su fila de employee_settings.
--
-- Síntoma: la tarjeta de Fichaje no aparece en el hub para un admin. Eso es lo
-- correcto — module_access se otorga por persona y a nadie se le otorgó 'clockin'
-- salvo a los 11 que vinieron en la migración. Pero al ir a otorgarlo salió lo
-- de verdad importante:
--
-- 077 dejó clockin.profiles como un INNER JOIN entre public.profiles y
-- clockin.employee_settings. Otorgar acceso (UI de Usuarios, o SQL) solo escribe
-- clockin_role y module_access en public.profiles. Sin fila en employee_settings
-- el join no devuelve nada, así que las 71 llamadas que hacen .from("profiles")
-- ven a esa persona como inexistente: entra al módulo y el módulo no sabe quién
-- es. Peor que un "no tienes acceso", porque parece roto en vez de cerrado.
--
-- Timetracker no tiene este problema porque su layout lee employee_settings por
-- separado y, si falta, usa valores por defecto en memoria (D-066). Aquí no se
-- puede: la vista es el contrato, y una vista vacía no tiene dónde poner un
-- defecto.
--
-- Se arregla en la base y no en el código que otorga, por dos razones:
--   1. Hay más de un camino para otorgar (el diálogo de Usuarios, un script, SQL
--      a mano). Un trigger los cubre todos; un insert en data-provider.tsx cubre
--      uno.
--   2. La política "employee_settings manager insert" (074) exige ser manager u
--      owner DE CLOCK-IN. Un admin de deliveries que todavía no tiene clockin_role
--      no puede insertar la fila — justo el caso de quien otorga por primera vez.
--      SECURITY DEFINER en el trigger evita ese huevo-y-gallina sin abrir la
--      política a nadie más.
--
-- company_id: se toma la única compañía si hay exactamente una. Si algún día hay
-- varias, se deja NULL a propósito en vez de adivinar — un manager la asigna.
-- Adivinar aquí metería a alguien en la compañía equivocada y todo el scoping de
-- clock-in cuelga de esa columna (clockin.auth_company_id()).

create or replace function public.ensure_clockin_settings()
  returns trigger language plpgsql security definer set search_path = '' as $$
declare only_company uuid;
begin
  if NEW.clockin_role is null then
    return NEW;                    -- revocar no borra la fila: su historial sigue
  end if;                          -- colgando de ella y volver a otorgar es común.

  -- Solo si es inequívoco: con una sola compañía no hay nada que adivinar, con
  -- varias sí, y ahí se prefiere NULL a una suposición.
  select c.id into only_company
    from clockin.companies c
   where (select count(*) from clockin.companies) = 1;

  insert into clockin.employee_settings (id, company_id)
  values (NEW.id, only_company)
  on conflict (id) do nothing;

  return NEW;
end $$;

revoke execute on function public.ensure_clockin_settings() from public, anon;

drop trigger if exists profiles_ensure_clockin_settings on public.profiles;
create trigger profiles_ensure_clockin_settings
  after insert or update of clockin_role on public.profiles
  for each row execute function public.ensure_clockin_settings();

-- Backfill: quien ya tenga clockin_role sin fila. Hoy son cero — los 11 de la
-- migración se poblaron a mano — pero la migración tiene que valer también
-- aplicada sobre una base donde alguien ya otorgó acceso antes que esto.
insert into clockin.employee_settings (id, company_id)
select p.id, (select id from clockin.companies limit 1)
  from public.profiles p
 where p.clockin_role is not null
   and not exists (select 1 from clockin.employee_settings es where es.id = p.id)
on conflict (id) do nothing;
