-- ===========================================================================
-- 194 . La llegada prevista de cada parada, la primera del dia (D-671)
-- ===========================================================================
-- PEDIDO. Roberto Rodriguez Jr (admin), 2026-10-24, con la tabla de paradas del Gestor: «Need a column of "Actual" to know
-- when they delivered vs when was their ETA». El duenio dijo que si a guardar la primera llegada prevista del dia.
--
-- POR QUE UNA TABLA. El Gestor calcula la llegada de cada parada al medir la ruta, en el navegador, y solo de lo que
-- falta: una parada hecha ya no tiene llegada calculada, y nada la guardaba (los planes con llegada, `route_plan_stops`,
-- solo existen los dias que se publica uno: medido el 2026-10-24, el ultimo era del 23). Aqui se apunta, UNA vez por
-- orden, parada y dia, la primera llegada que el Gestor midio ese dia: `insert ... on conflict do nothing` (la primera
-- gana; la app lo pide asi). No se escribe en `deliveries`: no salta su guarda, ni su historial, ni el tiempo real de
-- todas las pantallas por cada medida.
--
-- QUE HACE: la tabla, su RLS (lee quien entra a Entregas; apunta el admin, logistica, gerente u Office, los que usan el
-- Gestor) y su indice por dia.
--
-- Sin begin/commit: quien aplica envuelve el fichero.
--
-- Reversion: `drop table public.delivery_eta_plans;` y borrar la fila del registro. Nada mas la lee.

create table if not exists public.delivery_eta_plans (
  delivery_id uuid not null references public.deliveries(id) on delete cascade,
  plan_date date not null,
  kind text not null check (kind in ('P', 'D')),
  eta text not null check (eta ~ '^[0-2][0-9]:[0-5][0-9]$'),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  primary key (delivery_id, plan_date, kind)
);

create index if not exists delivery_eta_plans_por_dia on public.delivery_eta_plans (plan_date);

alter table public.delivery_eta_plans enable row level security;
revoke all on public.delivery_eta_plans from anon, authenticated;
-- Sin UPDATE ni DELETE: la primera llegada del dia no se reescribe.
grant select, insert on public.delivery_eta_plans to authenticated;

drop policy if exists "delivery_eta_plans select" on public.delivery_eta_plans;
drop policy if exists "delivery_eta_plans insert" on public.delivery_eta_plans;

create policy "delivery_eta_plans select" on public.delivery_eta_plans for select to authenticated
  using ((select public.has_deliveries_access()));

create policy "delivery_eta_plans insert" on public.delivery_eta_plans for insert to authenticated
  with check ((select public.has_deliveries_access())
     and (select public.current_user_role()) in ('admin', 'logistics', 'manager', 'accounting'));

-- ===========================================================================
-- Autocomprobacion (mira el catalogo)
-- ===========================================================================
do $chk$
begin
  if not exists (select 1 from pg_class where oid = 'public.delivery_eta_plans'::regclass and relrowsecurity) then
    raise exception '194: la tabla no tiene RLS';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'delivery_eta_plans') <> 2 then
    raise exception '194: se esperaban 2 politicas';
  end if;
  if has_table_privilege('authenticated', 'public.delivery_eta_plans', 'update')
     or has_table_privilege('authenticated', 'public.delivery_eta_plans', 'delete') then
    raise exception '194: la llegada del dia no se reescribe ni se borra';
  end if;
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('194_eta_del_plan.sql', '67e5d2132417dbcf9cad020f80386fa84804e6e0e95b683466eeed18ec253175') on conflict (name) do nothing;
