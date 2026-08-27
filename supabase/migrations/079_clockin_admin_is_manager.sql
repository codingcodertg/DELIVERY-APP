-- 079: un admin de deliveries cuenta como manager/owner DENTRO de clock-in.
--
-- D-095 mueve la configuración de personas de clock-in a Usuarios del hub, así que
-- quien la usa es un admin de deliveries. Las acciones ya lo dejan pasar
-- (lib/clockin/managerCtx.ts), pero la base no, y ese desacuerdo es peor que un
-- "no puedes": las políticas de 074 no lanzan error, filtran filas. Un UPDATE que
-- no encaja con la política afecta CERO filas y devuelve éxito. El admin habría
-- visto el select cambiar, el diálogo cerrarse contento y nada guardado.
--
-- Tres funciones, no treinta y cinco políticas: todas las de 074 preguntan por
-- estas, así que es el único sitio donde hay que decirlo.
--
-- No es un permiso nuevo. Un admin ya puede darse clockin_role = 'owner' desde
-- Usuarios con dos clics — 071 lo autoriza explícitamente. Esto solo evita que
-- tenga que hacerlo para que sus guardados dejen de perderse. Es además lo que
-- public.has_clockin_access() (071) ya dice: `role = 'admin'` entra.
--
-- No viaja al revés: un owner de clock-in no gana nada en el hub.

CREATE OR REPLACE FUNCTION clockin.auth_is_manager()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'clockin, public'
AS $function$
  select coalesce((
    select p.role = 'admin'
        or (p.clockin_role in ('manager','owner') and coalesce(es.active, true))
    from public.profiles p
    left join clockin.employee_settings es on es.id = p.id
    where p.id = (select auth.uid())
  ), false)
$function$;

CREATE OR REPLACE FUNCTION clockin.auth_is_owner()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'clockin, public'
AS $function$
  select coalesce((
    select p.role = 'admin'
        or (p.clockin_role = 'owner' and coalesce(es.active, true))
    from public.profiles p
    left join clockin.employee_settings es on es.id = p.id
    where p.id = (select auth.uid())
  ), false)
$function$;

-- La otra mitad del mismo problema. Casi todas las políticas de 074 comparan
-- `company_id = auth_company_id()`, y esa función lee employee_settings. Un admin
-- sin ficha de fichaje devuelve NULL, y `company_id = NULL` no es falso: es NULL,
-- que para una política es lo mismo que falso. Otra vez cero filas y ningún error.
--
-- El respaldo solo aplica si la compañía es inequívoca. Con varias se deja NULL a
-- propósito, igual que en 078: meter a alguien en la compañía equivocada es peor
-- que no dejarlo entrar.
CREATE OR REPLACE FUNCTION clockin.auth_company_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'clockin, public'
AS $function$
  select coalesce(
    (select es.company_id from clockin.employee_settings es where es.id = (select auth.uid())),
    (select c.id from clockin.companies c
      where (select p.role from public.profiles p where p.id = (select auth.uid())) = 'admin'
        and (select count(*) from clockin.companies) = 1)
  )
$function$;
