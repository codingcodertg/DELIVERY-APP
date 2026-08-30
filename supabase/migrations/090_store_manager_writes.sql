-- 090 · Que el nivel de 089 se pueda GUARDAR
--
-- 089 creó el escalafón de gerente de tienda y la lista de tiendas extra. Faltaba la mitad de
-- escritura, y sin ella el nivel nuevo habría durado exactamente hasta el primer guardado:
--
--   1. El disparador de la vista traducía `role` así:
--
--          when new.role in ('owner','manager') then 'admin'
--
--      es decir, guardar a alguien como **manager lo convertía en admin**. El nivel se
--      colapsaba solo, en silencio, y la persona pasaba a ver la empresa entera — justo lo
--      contrario de lo que se pedía.
--
--   2. `extra_store_ids` no estaba en el UPDATE, así que conceder una tienda no guardaba nada
--      y el desplegable volvía a su sitio al recargar, sin error.

create or replace function clockin.profiles_update()
  returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles
     set full_name        = coalesce(new.full_name, old.full_name),
         timetracker_role = case
                              when new.role is null then old.role
                              -- 'owner' es como la vista llama al admin; 'manager' es su
                              -- propio nivel y ya NO se traduce a admin.
                              when new.role = 'owner'  then 'admin'
                              when new.role = 'manager' then 'manager'
                              else 'employee'
                            end
   where id = old.id;

  update clockin.employee_settings
     set company_id          = new.company_id,
         phone               = new.phone,
         language            = new.language,
         active              = new.active,
         location_consent_at = new.location_consent_at,
         store_id            = new.store_id,
         tutorial_seen_at    = new.tutorial_seen_at,
         default_schedule    = new.default_schedule,
         custom_schedule     = new.custom_schedule,
         is_runner           = new.is_runner,
         vehicle_id          = new.vehicle_id,
         "position"          = new."position",
         extra_store_ids     = coalesce(new.extra_store_ids, '{}'::uuid[])
   where id = old.id;

  return new;
end $$;
