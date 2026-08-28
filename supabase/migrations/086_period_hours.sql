-- 086 · Fusión fase 4: las horas de las dos mitades, en un solo sitio.
--
-- ---------------------------------------------------------------------------
-- Lo que esta vista NO hace: sumar
-- ---------------------------------------------------------------------------
-- Fichaje contesta "¿estuviste?" y las sesiones "¿en qué?". Una sesión de proyecto
-- ocurre DENTRO de una jornada fichada (D-102: 9.32 h de media contra 1.46 h), así que
-- sumarlas paga el mismo rato dos veces.
--
-- Pero elegir una en silencio es igual de malo en el otro sentido: a quien solo cronometra
-- proyectos no se le paga por asistencia, y a quien solo ficha no se le paga por sesiones.
--
-- Así que la vista devuelve **las dos columnas por separado** y una tercera que dice si
-- esa persona tiene las dos cosas en ese periodo. Hoy no le pasa a nadie —la cuadrilla
-- solo ficha, Nick solo cronometra— pero desde 084 las doce personas tienen los dos
-- módulos, así que puede empezar a pasar cualquier día. Cuando pase, lo decide una
-- persona mirando, no una suma.
--
-- ---------------------------------------------------------------------------
-- El periodo
-- ---------------------------------------------------------------------------
-- Los dos módulos ya cuentan la semana igual sin habérselo propuesto: clock-in paga de
-- viernes a jueves, y timetracker tiene weekStartDay = 5 (viernes) en sus ajustes. Se
-- comprobó también en los datos — 221 de 287 sesiones tienen week_of en viernes; las 66
-- en sábado son de cuando ese ajuste era 6, historia vieja.
--
-- La fecha se calcula en America/Chicago, que es donde está la empresa. Los ajustes de
-- timetracker dicen America/Tegucigalpa, que no tiene horario de verano y ahora mismo va
-- una hora por detrás: son 2 sesiones de 287 las que caen en otro día por eso, las dos
-- dentro de la misma semana de pago, así que en nómina no cambia nada. Se unifica aquí y
-- se corrige el ajuste aparte.

create or replace view timetracker.period_hours
with (security_invoker = on) as
with punches as (
  select
    e.employee_id                                                     as employee_id,
    -- El viernes de la semana que contiene esta entrada, en hora local.
    (date_trunc('week', (e.clock_in_at at time zone 'America/Chicago') + interval '3 days')::date
       - interval '3 days')::date                                     as period_start,
    -- Misma regla que clockin/payroll.ts: la comida FICHADA manda y `lunch_minutes` es
    -- solo el respaldo de las entradas sin pausa fichada. Repetirla aquí en vez de
    -- inventar otra es lo único que hace que esta vista y esa pantalla digan lo mismo.
    greatest(
      0,
      extract(epoch from (e.clock_out_at - e.clock_in_at)) / 60.0
        - coalesce(
            (select sum(extract(epoch from (x.returned_at - x.left_at)) / 60.0)
               from clockin.exceptions x
              where x.time_entry_id = e.id and x.reason = 'lunch'
                and x.left_at is not null and x.returned_at is not null),
            coalesce(e.lunch_minutes, 0)
          )
    )                                                                 as minutes
  from clockin.time_entries e
  where e.clock_out_at is not null and e.clock_out_at > e.clock_in_at
),
sessions as (
  select
    s.employee_uid                                                    as employee_id,
    (date_trunc('week', (to_timestamp(s.start_ms / 1000.0) at time zone 'America/Chicago') + interval '3 days')::date
       - interval '3 days')::date                                     as period_start,
    s.duration_seconds / 60.0                                         as minutes
  from timetracker.sessions s
  where s.start_ms is not null and s.duration_seconds > 0
),
todos as (
  select employee_id, period_start, sum(minutes) as m, 0::numeric as p from punches   group by 1, 2
  union all
  select employee_id, period_start, 0::numeric,        sum(minutes) from sessions  group by 1, 2
)
select
  t.employee_id,
  p.full_name,
  t.period_start,
  (t.period_start + interval '6 days')::date        as period_end,
  round(sum(t.m) / 60.0, 2)                         as horas_fichaje,
  round(sum(t.p) / 60.0, 2)                         as horas_proyecto,
  -- La bandera que hace útil a la vista: alguien con las dos cosas este periodo. No se
  -- suman; se avisa.
  (sum(t.m) > 0 and sum(t.p) > 0)                   as revisar
from todos t
join public.profiles p on p.id = t.employee_id
group by t.employee_id, p.full_name, t.period_start;

grant select on timetracker.period_hours to authenticated, service_role;
