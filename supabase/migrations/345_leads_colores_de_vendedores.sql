-- ===========================================================================
-- 345 - Leads: el PUESTO de cada vendedor, para darle su color en las tarjetas.
-- ===========================================================================
-- ESCRITA Y NO APLICADA: aplicarla es del dueño, con migrate-status antes y después.
--
-- QUE HACE. Pedido del dueño (2026-11-24, con una maqueta en Excel): cuando un vendedor ya está trabajando un lead, la
-- tarjeta lleva arriba una franja con su nombre, la fecha y la etapa, «every rep will have their specific color for
-- their tag […] automáticamente se cambia el color al de ellos».
--
-- Para que el color de cada quien sea SUYO (el mismo en todas las pantallas y para todo el que mira) y no se repita,
-- hace falta un orden que todos vean igual. La pantalla no puede sacarlo: cada persona solo lee el historial de los
-- leads que alcanza, así que dos tiendas ordenarían distinto. Lo da esta función, que sí lo ve todo:
--
--   leads_colores_de_vendedores()   una fila por persona que alguna vez dejó una huella en un lead (`lead_events.actor`),
--                                   con su PUESTO: 1 el primero que trabajó un lead, 2 el segundo… La pantalla pinta
--                                   el color número `puesto` de su paleta.
--
-- Por qué el orden de llegada: la primera huella de alguien no cambia nunca, así que quien llega después se pone al
-- final y a nadie le cambia el color. No guarda nada: no hay tabla, ni disparador, ni escritura.
-- Límite conocido: si se borrara el lead donde alguien dejó su primera huella (el historial se va con él), su puesto
-- podría correrse. No hay borrado de leads en la app (se archivan).
--
-- QUIEN LA LEE. Quien tiene acceso a Leads (`has_leads_access`, 162). Devuelve ids de perfil y un número: ni nombres,
-- ni leads, ni notas.
--
-- LO QUE NO TOCA. Ninguna tabla, política ni función existente. Ningún dato.
--
-- Sin begin/commit propios: quien aplica envuelve el fichero en una transacción.
-- Vuelta atrás: drop function public.leads_colores_de_vendedores();
-- ===========================================================================

create or replace function public.leads_colores_de_vendedores()
  returns table (profile_id uuid, puesto integer)
  language sql stable security definer set search_path = public, pg_temp as $$
  select e.actor, (row_number() over (order by min(e.at), e.actor))::integer
    from public.lead_events e
   where e.actor is not null
     and public.has_leads_access()
   group by e.actor;
$$;

revoke execute on function public.leads_colores_de_vendedores() from public, anon;
grant  execute on function public.leads_colores_de_vendedores() to authenticated;

-- Comprobaciones: si algo no cuadra, la transacción se deshace entera.
do $$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'leads_colores_de_vendedores' and p.prosecdef) then
    raise exception '345: falta leads_colores_de_vendedores (o no es security definer)';
  end if;
  if has_function_privilege('anon', 'public.leads_colores_de_vendedores()', 'execute') then
    raise exception '345: anon puede ejecutar leads_colores_de_vendedores';
  end if;
end $$;

notify pgrst, 'reload schema';
-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('345_leads_colores_de_vendedores.sql', 'caf4c0395e45bbba7a4641f45edf2163ba6fa96082b96cc01c98f27b13c3273f') on conflict (name) do nothing;
