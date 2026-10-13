-- 170: talones de pago de Time Tracker.
--
-- Pedido del dueño (2026-10-13): «haz los paystubs para el time tracker app». La cuadrilla que ficha
-- en sitio no tenía tarifa por hora en la app, y se le paga directo, sin retenciones: el talón de la
-- app es el oficial. Dos tablas nuevas, las dos SOLO de administrador de Time Tracker:
--
--   timetracker.pay_rates  — la tarifa por hora de cada persona (presencial), con su multiplicador y su
--                            umbral semanal de extras (1.5× pasadas 40 h por defecto, la regla FLSA).
--   timetracker.paystubs   — la FOTO de lo que se pagó: una fila por talón, que no se recalcula. Una
--                            por persona y periodo en el presencial; una por lote pagado en el remoto.
--
-- El empleado NO lee ninguna de las dos (D-489: el empleado no ve dinero en la app). La política es
-- una sola, FOR ALL, con `is_timetracker_admin()` en using y with check, envuelta en (select ...) para
-- que se evalúe una vez por consulta (estilo initplan de la 080).
--
-- Sin begin/commit: quien la aplica abre la transacción (ver la memoria «una migración no lleva su
-- propia transacción»).

create table if not exists timetracker.pay_rates (
  employee_uid    uuid primary key references public.profiles(id) on delete cascade,
  hourly_rate     numeric(10,2) not null check (hourly_rate >= 0),
  ot_multiplier   numeric(4,2)  not null default 1.5 check (ot_multiplier >= 1),
  ot_weekly_hours numeric(5,2)  not null default 40  check (ot_weekly_hours > 0),
  updated_at      timestamptz   not null default now(),
  updated_by      uuid
);

create table if not exists timetracker.paystubs (
  id             uuid primary key default gen_random_uuid(),
  employee_uid   uuid not null references public.profiles(id),
  employee_name  text,
  kind           text not null check (kind in ('onsite','remote')),
  period_start   date not null,
  period_end     date not null,
  pay_date       date not null,
  method         text,
  regular_hours  numeric(8,2)  not null default 0,
  ot_hours       numeric(8,2)  not null default 0,
  hourly_rate    numeric(10,2),
  ot_rate        numeric(10,2),
  lines          jsonb not null default '[]'::jsonb,   -- remoto: [{label, regular, ot, rate, otRate, pay}]
  gross          numeric(12,2) not null,
  adjustments    jsonb not null default '[]'::jsonb,   -- [{label, amount}]
  net            numeric(12,2) not null,
  payroll_id     uuid references timetracker.payrolls(id) on delete set null,
  created_by     uuid,
  created_at     timestamptz not null default now()
);

-- Unicidad. El diseño pedía `unique (employee_uid, kind, period_start)`, y para el remoto no vale: un
-- remoto puede cobrar DOS lotes en la misma semana (se paga a media semana y luego el resto; cada lote
-- es su propio «Pago» en Nómina › Remoto), y con esa clave el segundo talón chocaría con el primero.
-- Así que la regla se parte en dos, y cada mitad dice lo que de verdad es único:
--   presencial: uno por persona y periodo;
--   remoto:     uno por lote pagado.
create unique index if not exists paystubs_onsite_unico on timetracker.paystubs (employee_uid, period_start) where kind = 'onsite';
create unique index if not exists paystubs_lote_unico   on timetracker.paystubs (payroll_id) where payroll_id is not null;
create index if not exists paystubs_empleado_periodo    on timetracker.paystubs (employee_uid, period_start);

alter table timetracker.pay_rates enable row level security;
alter table timetracker.paystubs  enable row level security;

drop policy if exists "tt pay_rates admin" on timetracker.pay_rates;
create policy "tt pay_rates admin" on timetracker.pay_rates
  for all to authenticated
  using ((select public.is_timetracker_admin()))
  with check ((select public.is_timetracker_admin()));

drop policy if exists "tt paystubs admin" on timetracker.paystubs;
create policy "tt paystubs admin" on timetracker.paystubs
  for all to authenticated
  using ((select public.is_timetracker_admin()))
  with check ((select public.is_timetracker_admin()));

-- Permisos de tabla: el reparto de la 061 (authenticated y service_role) sin anon, que la 081 retiró
-- de todo el esquema. Los privilegios por defecto de la 061/081 ya lo darían; se escriben a mano para
-- que no dependa de quién ejecute esto.
revoke all on timetracker.pay_rates, timetracker.paystubs from anon;
grant select, insert, update, delete on timetracker.pay_rates, timetracker.paystubs to authenticated;
grant all on timetracker.pay_rates, timetracker.paystubs to service_role;

-- Comprobación: las dos tablas existen, con RLS y con su única política.
do $chk$
begin
  if to_regclass('timetracker.pay_rates') is null or to_regclass('timetracker.paystubs') is null then
    raise exception '170: faltan las tablas';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'timetracker.pay_rates'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'timetracker.paystubs'::regclass) then
    raise exception '170: RLS apagada en pay_rates o paystubs';
  end if;
  if (select count(*) from pg_policies where schemaname = 'timetracker' and tablename = 'pay_rates') <> 1
     or (select count(*) from pg_policies where schemaname = 'timetracker' and tablename = 'paystubs') <> 1 then
    raise exception '170: pay_rates y paystubs llevan UNA política cada una (admin)';
  end if;
  if has_table_privilege('anon', 'timetracker.paystubs', 'select') or has_table_privilege('anon', 'timetracker.pay_rates', 'select') then
    raise exception '170: anon no debe tener permisos';
  end if;
  if to_regclass('timetracker.paystubs_onsite_unico') is null or to_regclass('timetracker.paystubs_lote_unico') is null then
    raise exception '170: faltan los índices únicos';
  end if;
end $chk$;

-- Ensayo por rol (con ROLLBACK, a mano): ver docs/PLAN-170-talones-de-pago.md.

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('170_talones_de_pago.sql', '947b87f48132340a65d812a1b4bb934224d7780b8b49b7cb8be28d8f89ad8ac1') on conflict (name) do nothing;
