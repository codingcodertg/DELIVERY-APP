-- 082: no se puede fichar tiempo sobre tiempo ya fichado.
--
-- Pedido tras el segundo caso que llega a nómina: una fila fantasma de 25.75 h que
-- un tab web engordó sobre una sesión real, y antes las 19.27 h de Nick por
-- olvidarse de parar. Las dos se cazaron mirando. Ninguna avisó.
--
-- Se hace con una restricción EXCLUDE y no con un trigger, a propósito. Un trigger
-- que consulta "¿hay algo que solape?" y luego inserta tiene una ventana entre las
-- dos cosas: dos inserciones simultáneas pueden pasar la comprobación a la vez y
-- entrar las dos. EXCLUDE lo resuelve el índice dentro de la misma operación, así
-- que no hay ventana. Eso es lo que "blindado" quiere decir aquí.
--
-- Rangos SEMIABIERTOS [inicio, fin). Es lo que hace que la costumbre normal siga
-- funcionando: parar a las 13:03 y arrancar otra a las 13:03 NO solapa, y en el
-- historial de Andrés eso pasa a diario. Con rangos cerrados habría rechazado
-- media app.
--
-- El WHERE deja fuera dos casos que no son tiempo trabajado:
--   · end_ms nulo — una sesión sin cierre daría un rango sin tope superior y
--     bloquearía todo lo posterior;
--   · end_ms = start_ms — las filas de 0 segundos que deja un arranque anulado.
--     Un rango vacío no solapa con nada, pero mantenerlas fuera del índice
--     también lo deja más pequeño.
--
-- Alcance: la restricción es por PERSONA (employee_uid con =). Dos personas
-- pueden trabajar a la vez, evidentemente; lo que no puede es una sola estar en
-- dos sitios.
--
-- Cubre los tres caminos por igual, que es el punto: el cronómetro, el "add time"
-- manual y el "adjust" aprobado escriben todos en esta tabla. Antes, aprobar unas
-- horas manuales encima de un tramo ya cronometrado no se quejaba — así se pagó a
-- Nick 0.5 h dos veces el 11 de julio.

create extension if not exists btree_gist with schema extensions;

alter table timetracker.sessions
  drop constraint if exists sessions_no_overlap;

alter table timetracker.sessions
  add constraint sessions_no_overlap
  exclude using gist (
    employee_uid with =,
    tstzrange(
      to_timestamp(start_ms::double precision / 1000.0),
      to_timestamp(end_ms::double precision   / 1000.0)
    ) with &&
  )
  where (start_ms is not null and end_ms is not null and end_ms > start_ms);
