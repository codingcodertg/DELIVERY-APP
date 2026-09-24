-- 143 - Promos: las cinco columnas privadas (el costo y compania) solo las ve el admin
-- ===========================================================================
-- El dueno, 2026-09-24, al dar el modulo a todo ventas y office: "give it access to all sales and
-- office but sales cant see costs", y enseguida: "nvm just admin can see costs" / "not office or sales
-- can't see costs".
--
-- Hasta hoy promo_can_see_private() (140) devolvia true al admin, al gerente (manager) y a office
-- (accounting). La 140 la escribio APARTE de promo_is_decider() justo para este dia: "puede aprobar" y
-- "puede ver el costo" son dos hechos. Aqui cambia solo el segundo. Gerente y office SIGUEN decidiendo.
--
-- Las cinco privadas son notes, demand, months_of_stock, cost y diff (Sheet6 del libro). Van juntas:
-- diff es precio menos costo, asi que dejar diff seria dejar el costo a una resta.
--
-- Solo se reemplaza una funcion. promo_private() la llama por fila y devuelve null a quien no pase;
-- las columnas de la tabla ya estaban revocadas a authenticated (140), asi que nadie las lee directo.
-- La pantalla no calcula nada: pinta las privadas si promo_catalog.private llego no nulo.
--
-- Sin begin/commit propios, a proposito (lo envuelve quien aplica).
-- ===========================================================================

create or replace function public.promo_can_see_private()
  returns boolean language sql stable security definer set search_path = public as $$
  select public.has_promos_access() and public.is_admin();
$$;

revoke execute on function public.promo_can_see_private() from public, anon;
grant  execute on function public.promo_can_see_private() to authenticated;

-- Se comprueba a si misma: que la funcion vigente ya no nombra a manager ni a accounting, y que
-- quien decide sigue siendo el mismo (promo_is_decider no se toca).
do $chk$
declare
  def text := pg_get_functiondef('public.promo_can_see_private()'::regprocedure);
  dec text := pg_get_functiondef('public.promo_is_decider()'::regprocedure);
begin
  if position('manager' in def) > 0 or position('accounting' in def) > 0 then
    raise exception '143: promo_can_see_private sigue nombrando a manager o accounting';
  end if;
  if position('is_admin()' in def) = 0 then
    raise exception '143: promo_can_see_private no mira is_admin()';
  end if;
  if position('''manager'', ''accounting''' in dec) = 0 then
    raise exception '143: promo_is_decider cambio y no debia';
  end if;
end $chk$;

-- Reversion (a mano): volver a la definicion de la 140:
--   create or replace function public.promo_can_see_private()
--     returns boolean language sql stable security definer set search_path = public as $$
--     select public.has_promos_access()
--        and (public.is_admin() or public.current_user_role() in ('manager', 'accounting'));
--   $$;
--   delete from public.schema_migrations where name = '143_promos_costo_solo_admin.sql';

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('143_promos_costo_solo_admin.sql', 'd53c6f9fadc8214c21e9235bb525b228c91b916ccc9d74059718bd709e6a93f1') on conflict (name) do nothing;
