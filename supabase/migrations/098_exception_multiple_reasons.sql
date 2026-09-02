-- 098 · Una excepción puede tener MÁS DE UN motivo (D-163)
--
-- Hasta ahora se elegía uno y solo uno. Y los datos dicen que no alcanza:
--
--     type              reason                  filas
--     out_of_radius     other                     56   ← 72 % de las de fuera de radio
--     out_of_radius     moving_between_stores      8
--     out_of_radius     customer_visit             8
--     out_of_radius     delivery                   1
--
-- **Cincuenta y seis de setenta y ocho dicen "otro".** Eso no es que la gente salga por
-- motivos raros: es que sale por dos a la vez —va a una entrega Y de paso pasa por otra
-- tienda— y al tener que elegir uno se rinde y marca "otro". El resultado es que la única
-- pregunta que esta pantalla existe para responder —¿por qué está fuera?— se contesta con
-- un encogimiento de hombros en tres de cada cuatro casos.
--
-- ---------------------------------------------------------------------------
-- Columna nueva, y `reason` se queda
-- ---------------------------------------------------------------------------
-- `reasons` es un array del MISMO enum: la lista de valores válidos sigue siendo una sola, y
-- añadir un motivo mañana sigue siendo `alter type ... add value`, sin tocar esto.
--
-- `reason` **no se borra ni se deja de escribir**. Lo leen los informes, la cola de
-- pendientes, las exportaciones y el histórico ya guardado; convertirlo en un array de golpe
-- obligaría a tocar cada uno de esos sitios en la misma tanda, y cualquiera que se escapara
-- fallaría en silencio. Así que a partir de ahora se escriben los dos: `reasons` lleva todo
-- lo elegido y `reason` el primero. Cuando ya no quede nada leyendo `reason`, se retira; hoy
-- no es el día.
--
-- El relleno hacia atrás importa: sin él, el historial tendría dos formas —filas viejas con
-- motivo y sin lista, filas nuevas con las dos— y cada pantalla que lo lea tendría que saber
-- de la costura. Con una línea, todas las filas se leen igual.

alter table clockin.exceptions
  add column if not exists reasons clockin.leave_reason[];

update clockin.exceptions
   set reasons = array[reason]
 where reason is not null
   and reasons is null;

comment on column clockin.exceptions.reasons is
  'Todos los motivos elegidos (D-163). `reason` sigue llevando el primero, para lo que ya lo lee.';

-- Buscar "todas las veces que alguien salió por una entrega" tiene que mirar dentro del
-- array, y sin índice eso es recorrer la tabla entera. Hoy son 145 filas y da igual; el día
-- que sean cien mil, no.
create index if not exists exceptions_reasons_gin on clockin.exceptions using gin (reasons);
