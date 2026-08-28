-- 085 · Fusión fase 2: nadie puede estar fichado dos veces a la vez.
--
-- ---------------------------------------------------------------------------
-- Primero, lo que esta migración NO hace, porque el plan era otro
-- ---------------------------------------------------------------------------
-- La fase 2 iba a prohibir que un fichaje y una sesión de proyecto de la misma persona
-- se solapasen. Se midió antes de escribirlo y resultó estar mal planteada:
--
--   fichaje (clock-in)      media 9.32 h   -> una jornada
--   sesión de proyecto      media 1.46 h   -> una tarea
--
-- Las sesiones ANIDAN dentro de la jornada. Eso no es un error: es justo la razón de que
-- sean dos registros distintos —"¿estuviste?" y "¿en qué?"— y de que la fusión conserve
-- los dos (D-101). Prohibir el cruce habría prohibido el caso normal: fichar la entrada
-- y luego cronometrar dos horas de un proyecto dentro de esa jornada. Y desde 084 las
-- doce personas tienen los dos módulos, así que habría empezado a morder de inmediato.
--
-- El doble cobro entre tablas es un problema de INFORMES, no de restricciones: la nómina
-- unificada (fase 4) tendrá que decir cuál de las dos paga. Se anota ahí, no aquí.
--
-- ---------------------------------------------------------------------------
-- Lo que sí faltaba
-- ---------------------------------------------------------------------------
-- `clockin.time_entries` no tenía NINGUNA restricción de solapamiento — 082 solo cubrió
-- las sesiones. Y había una violación real, callada desde julio: Patricia, el 31, con un
-- fichaje manual de 19 minutos (16:00-16:19) metido dentro de su jornada real de
-- 08:49 a 19:44. Mismo patrón que el de Nick en 082: tiempo manual dentro de tiempo ya
-- registrado, cobrado dos veces. Se retira, con respaldo en
-- scratchpad/solape_fichaje_59ac3a20.json y nota en clockin.audit_log.
--
-- Dos mecanismos, porque uno solo deja media puerta abierta:
--
--   · EXCLUDE para los fichajes CERRADOS — misma persona, rangos que se cruzan.
--   · Un índice único parcial para los ABIERTOS. Un fichaje sin salida no tiene tope
--     superior, así que no entra en el EXCLUDE; sin esto, alguien podría abrir un
--     segundo fichaje mientras tiene uno corriendo, que es exactamente "estar fichado
--     dos veces". Hoy hay tres abiertos y son de tres personas distintas, así que entra
--     limpio.
--
-- Rangos semiabiertos [entrada, salida), igual que en 082: salir a las 13:03 y volver a
-- entrar a las 13:03 no es solaparse.

-- ---------------------------------------------------------------------------
-- La fila que impide activar la regla
-- ---------------------------------------------------------------------------
delete from clockin.time_entries
 where id = '59ac3a20-2e64-47ee-8566-9add3e3f0ba5'
   and manual = true;   -- solo si sigue siendo la entrada manual, no la jornada real

insert into clockin.audit_log (company_id, actor_id, table_name, record_id, action, new_value)
select es.company_id,
       (select id from public.profiles where role = 'admin' order by created_at limit 1),
       'time_entries',
       '59ac3a20-2e64-47ee-8566-9add3e3f0ba5',
       'delete',
       jsonb_build_object(
         'motivo', 'Fichaje manual de 19 min (31 jul 16:00-16:19) dentro de la jornada real 08:49-19:44: tiempo cobrado dos veces. Retirado para activar la regla de no solapamiento (085).',
         'respaldo', 'scratchpad/solape_fichaje_59ac3a20.json')
  from clockin.employee_settings es
 where es.id = (select id from public.profiles where full_name = 'Patricia Hernández');

-- ---------------------------------------------------------------------------
-- La regla
-- ---------------------------------------------------------------------------
create extension if not exists btree_gist with schema extensions;

alter table clockin.time_entries
  drop constraint if exists time_entries_no_overlap;

alter table clockin.time_entries
  add constraint time_entries_no_overlap
  exclude using gist (
    employee_id with =,
    tstzrange(clock_in_at, clock_out_at) with &&
  )
  where (clock_in_at is not null and clock_out_at is not null and clock_out_at > clock_in_at);

-- Un solo fichaje abierto por persona. Lo que el EXCLUDE no puede cubrir.
drop index if exists clockin.time_entries_one_open_per_employee;
create unique index time_entries_one_open_per_employee
  on clockin.time_entries (employee_id)
  where (clock_out_at is null);
