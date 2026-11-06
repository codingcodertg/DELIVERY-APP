-- ===========================================================================
-- 260 . La llegada prevista de cada parada es la del PLAN VIGENTE, no la primera del dia
-- ===========================================================================
-- PEDIDO. Roberto Rodriguez Jr (admin), 2026-10-26 ("Something is still off with the ETAs") y 2026-11-06
-- ("Something is off with the times"), en el Gestor de Rutas. El duenio, 2026-11-06: es el problema abierto mas
-- importante del Gestor.
--
-- QUE PASABA. La 194 (D-671) apunta la PRIMERA llegada que el Gestor mide para cada parada el dia de su ruta, y no
-- la reescribe nunca. Pero la ruta cambia durante el dia: se crean ordenes, se aniaden, se reordenan. Medido en la
-- ruta de Ernesto Castillo del 2026-11-05: diez horas apuntadas a las 08:28 con un plan, cuatro mas a las 11:14 al
-- aniadir dos ordenes, y la ruta reordenada despues. La columna "ETA" de lo ya hecho mezclaba horas de dos planes
-- en el orden de un tercero: parada 1 prevista 08:50 con la base saliendo 08:53, paradas 3-4 a las 13:33 y la 5 a
-- las 12:39, la 6 a las 08:50 en mitad de la tarde. El "+-min" contra la hora real no queria decir nada.
--
-- QUE HACE. Tres columnas nuevas en `delivery_eta_plans`, y permiso para reescribir la prevista:
--   * `plan_key`  : la clave del plan de la ruta con el que se apunto esa hora (de donde sale, donde acaba y sus
--                   paradas en el orden de la lista; la calcula la app, `claveDelPlan`). Mientras la clave de la ruta
--                   no cambie, la prevista de una parada pendiente no se toca. Cuando cambia, la app vuelve a apuntar
--                   TODAS las pendientes de esa ruta con la medida de ese momento. Lo ya hecho no se reescribe: la app
--                   solo manda paradas pendientes.
--   * `first_eta` : la primera llegada que se apunto ese dia (lo que hasta aqui era `eta`). No se pierde: queda
--                   aqui, y la app no la reescribe.
--   * `plan_at`   : cuando se rehizo la prevista por ultima vez (nulo si nunca).
--   * UPDATE para `authenticated`, con la misma regla que el INSERT de la 194 (quien entra a Entregas y es admin,
--     logistica, gerente u Office). Sigue sin DELETE.
--
-- ORDEN CON EL DESPLIEGUE. Se puede aplicar ANTES de desplegar: la app de antes solo lee `delivery_id, kind, eta` e
-- inserta sin pisar, y nada de eso cambia. Y la app nueva funciona SIN esta migracion: si la base no tiene
-- `plan_key`, sigue con la regla de la 194 (la primera gana). El orden da igual; hasta que esten las dos, la
-- prevista no se rehace.
--
-- Sin begin/commit: quien aplica envuelve el fichero.
--
-- Reversion:
--   revoke update on public.delivery_eta_plans from authenticated;
--   drop policy if exists "delivery_eta_plans update" on public.delivery_eta_plans;
--   update public.delivery_eta_plans set eta = first_eta where first_eta is not null and eta <> first_eta;
--   alter table public.delivery_eta_plans drop column if exists plan_key, drop column if exists first_eta,
--     drop column if exists plan_at;
--   y borrar la fila del registro.

alter table public.delivery_eta_plans
  add column if not exists plan_key text,
  add column if not exists first_eta text,
  add column if not exists plan_at timestamptz;

alter table public.delivery_eta_plans drop constraint if exists delivery_eta_plans_first_eta_ck;
alter table public.delivery_eta_plans
  add constraint delivery_eta_plans_first_eta_ck check (first_eta is null or first_eta ~ '^[0-2][0-9]:[0-5][0-9]$');
alter table public.delivery_eta_plans drop constraint if exists delivery_eta_plans_plan_key_ck;
alter table public.delivery_eta_plans
  add constraint delivery_eta_plans_plan_key_ck check (plan_key is null or plan_key ~ '^[0-9a-f]{16}$');

-- Lo apuntado hasta hoy ES la primera del dia (la 194 no dejaba reescribir): se conserva como tal.
update public.delivery_eta_plans set first_eta = eta where first_eta is null;

-- La prevista se puede rehacer. Sigue sin DELETE.
grant update on public.delivery_eta_plans to authenticated;

drop policy if exists "delivery_eta_plans update" on public.delivery_eta_plans;
create policy "delivery_eta_plans update" on public.delivery_eta_plans for update to authenticated
  using ((select public.has_deliveries_access())
     and (select public.current_user_role()) in ('admin', 'logistics', 'manager', 'accounting'))
  with check ((select public.has_deliveries_access())
     and (select public.current_user_role()) in ('admin', 'logistics', 'manager', 'accounting'));

notify pgrst, 'reload schema';

-- ===========================================================================
-- Autocomprobacion (mira el catalogo)
-- ===========================================================================
do $chk$
begin
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'delivery_eta_plans'
         and column_name in ('plan_key', 'first_eta', 'plan_at')) <> 3 then
    raise exception '260: faltan columnas en delivery_eta_plans';
  end if;
  if not exists (select 1 from pg_class where oid = 'public.delivery_eta_plans'::regclass and relrowsecurity) then
    raise exception '260: la tabla no tiene RLS';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'delivery_eta_plans') <> 3 then
    raise exception '260: se esperaban 3 politicas (select, insert, update)';
  end if;
  if not has_table_privilege('authenticated', 'public.delivery_eta_plans', 'update') then
    raise exception '260: authenticated no puede rehacer la prevista';
  end if;
  if has_table_privilege('authenticated', 'public.delivery_eta_plans', 'delete')
     or has_table_privilege('anon', 'public.delivery_eta_plans', 'select') then
    raise exception '260: la llegada del dia no se borra, y anon no la lee';
  end if;
  if exists (select 1 from public.delivery_eta_plans where first_eta is null) then
    raise exception '260: quedo una fila sin su primera llegada';
  end if;
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('260_eta_del_plan_vigente.sql', '3fcdcbb9a9c7e44863bf72f20291a0271b2696b264edba11bb0a2374862a5b4b') on conflict (name) do nothing;
