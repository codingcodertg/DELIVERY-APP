-- 092 · Una sola sesión viva por persona
--
-- Andrés vio su tarjeta DUPLICADA en "Trabajando ahora": dos sesiones suyas, mismo proyecto,
-- mismo reloj. Medido antes de tocar nada: dos filas creadas **en el mismo segundo**, con
-- 129 ms de diferencia entre sus `start_ms`. Es un doble disparo del botón de empezar.
--
-- ---------------------------------------------------------------------------
-- Por qué el guardián que ya existía no lo vio
-- ---------------------------------------------------------------------------
-- 082 añadió `sessions_no_overlap`, un EXCLUDE sobre `tstzrange(start_ms, end_ms)`. La fila
-- sobrante tenía **start_ms = end_ms**, y en Postgres un rango vacío **no solapa con nada** —
-- ni consigo mismo. Así que la fila era literalmente invisible para la restricción.
--
-- Es un buen recordatorio de que una restricción protege lo que sabe mirar: aquella impide
-- que se solapen dos ratos de trabajo, que es lo que se le pidió, pero "no puede haber dos
-- cronómetros corriendo a la vez" es OTRA regla, y hasta ahora no la escribía nadie.
--
-- ---------------------------------------------------------------------------
-- Primero cerrar lo que quedó suelto
-- ---------------------------------------------------------------------------
-- Una sesión viva de duración cero no es trabajo de nadie: es el eco del doble clic. Se cierra
-- en vez de borrarse — el historial no se tira, y con `is_live = false` deja de contar y deja
-- de dibujar tarjeta.
update timetracker.sessions
   set is_live = false
 where is_live
   and start_ms = end_ms
   and coalesce(duration_seconds, 0) = 0;

-- Y si alguien tuviera varias vivas de verdad, se conserva la más reciente: es la que la
-- persona está mirando en su pantalla, y cerrarle esa sería quitarle el reloj de delante.
update timetracker.sessions s
   set is_live = false
 where s.is_live
   and exists (
     select 1 from timetracker.sessions o
      where o.employee_uid = s.employee_uid
        and o.is_live
        and (o.start_ms > s.start_ms or (o.start_ms = s.start_ms and o.id > s.id))
   );

-- ---------------------------------------------------------------------------
-- La regla que faltaba
-- ---------------------------------------------------------------------------
-- Un índice único parcial: como mucho UNA sesión viva por persona. Es la misma forma que
-- 085 usó para los fichajes abiertos (`time_entries_one_open_per_employee`), y por el mismo
-- motivo — la comprobación equivalente en el cliente pierde la carrera cuando los dos
-- intentos salen con 129 ms de diferencia, porque ninguno ve todavía al otro.
create unique index if not exists sessions_one_live_per_employee
  on timetracker.sessions (employee_uid)
  where is_live;
