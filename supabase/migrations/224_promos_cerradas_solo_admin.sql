-- 224: Promos — una ronda CERRADA solo la ve el admin (D-787, 2026-11-01).
--
-- El dueño: «older promos should be locked and only admin can see all promos but right now every time there is a
-- promo we activate and deactivate it for everybody so everybody can only see November, just admin can see all».
--
-- Que habia: cerrar una ronda (promo_set_round_closed, 140) la congelaba —nadie decide en ella— pero la seguian
-- viendo todos los que tienen el modulo, y el selector de rondas se la ofrecia a cada vendedor.
--
-- Que hace: la fila de promo_rounds, y con ella sus productos, sugerencias y decisiones, la ve quien tiene el modulo
-- SOLO si la ronda esta abierta (closed_at nulo). El admin ve todas, abiertas y cerradas. Asi «activar» una ronda es
-- abrirla (el script de carga la sube cerrada y la abre al final), y «desactivarla» es cerrarla: el resto deja de
-- verla y el admin la conserva. Las politicas de escritura (decisiones) no cambian: el guard de la 140 ya impide
-- decidir en una ronda cerrada, y a quien no la ve, la politica de select ya no le deja ni leerla.
--
-- Sin begin/commit propios. Para deshacer: volver a crear las cuatro politicas de select de la 140 con solo
-- has_promos_access(), drop function public.promo_round_visible(uuid), y borrar la fila del registro.

-- Quien pregunta puede ver la ronda: admin, o ronda abierta. SECURITY DEFINER para no pasar por la RLS de
-- promo_rounds desde dentro de las politicas de las otras tres tablas.
create or replace function public.promo_round_visible(p_round uuid)
  returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or exists (select 1 from public.promo_rounds r where r.id = p_round and r.closed_at is null);
$$;
revoke execute on function public.promo_round_visible(uuid) from public, anon;
grant  execute on function public.promo_round_visible(uuid) to authenticated;

drop policy if exists "promo_rounds select"      on public.promo_rounds;
drop policy if exists "promo_products select"    on public.promo_products;
drop policy if exists "promo_suggestions select" on public.promo_suggestions;
drop policy if exists "promo_decisions select"   on public.promo_decisions;

create policy "promo_rounds select" on public.promo_rounds for select to authenticated
  using ((select public.has_promos_access()) and ((select public.is_admin()) or closed_at is null));

create policy "promo_products select" on public.promo_products for select to authenticated
  using ((select public.has_promos_access()) and public.promo_round_visible(round_id));

create policy "promo_suggestions select" on public.promo_suggestions for select to authenticated
  using ((select public.has_promos_access()) and public.promo_round_visible(round_id));

create policy "promo_decisions select" on public.promo_decisions for select to authenticated
  using ((select public.has_promos_access()) and public.promo_round_visible(round_id));

-- ===========================================================================
-- Autocomprobacion (mira el catalogo)
-- ===========================================================================
do $chk$
declare
  tabla text;
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'promo_round_visible') then
    raise exception '224: falta promo_round_visible';
  end if;
  -- Las cuatro politicas de select miran el modulo (lo exige la 140) Y la ronda.
  foreach tabla in array array['promo_products', 'promo_suggestions', 'promo_decisions'] loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = tabla and cmd = 'SELECT'
                     and qual ~ 'has_promos_access' and qual ~ 'promo_round_visible') then
      raise exception '224: la politica de select de % no mira la ronda', tabla;
    end if;
  end loop;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'promo_rounds' and cmd = 'SELECT'
                   and qual ~ 'has_promos_access' and qual ~ 'closed_at') then
    raise exception '224: la politica de select de promo_rounds no mira closed_at';
  end if;
  -- Sigue habiendo 3 politicas en decisiones (select, insert, update), como pide la 140.
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'promo_decisions') <> 3 then
    raise exception '224: promo_decisions debe seguir con 3 politicas';
  end if;
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum)
  values ('224_promos_cerradas_solo_admin.sql', 'c4072437d67441c7be807103de57e91b1d408c230b1d3db509e1a000173b3ed6') on conflict (name) do nothing;
