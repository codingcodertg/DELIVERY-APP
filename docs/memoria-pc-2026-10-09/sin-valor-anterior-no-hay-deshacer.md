---
name: sin-valor-anterior-no-hay-deshacer
description: la app registra QUE cambió un campo pero no su valor anterior; un cambio en bloque por error no se puede deshacer desde la base
metadata:
  type: project
---

El 2026-09-23 a las 18:53 (Texas) el dueño cambió por error la fecha de entrega de **162 de 245 órdenes** a
mañana en unos 70 segundos: 110 entregadas (desde el 26 de agosto), 35 aprobadas, 12 listas y otras. Pidió
deshacerlo. **No se pudo del todo**, porque `order_events` guarda «Changed: Delivery Date» **sin el valor
anterior**, y `deliveries` no tiene historial.

Lo que se hizo: foto exacta de las 162 antes de tocar nada (`FOTO_162_ordenes_fecha_manana.json` en el
scratchpad), y las **110 entregadas** devueltas al día de su prueba de entrega (`pod_delivered_at`, hora de
Texas; si falta, el evento `delivered`), en una transacción verificada y con un `order_event` en cada una. Es la
mejor evidencia, no el valor exacto: una entregada tarde tenía otra fecha. Las **52 activas** no tenían ninguna
fuente en la base; solo un plan de ruta del 21 nombraba a 7. `archive_mode` está `on`, así que la única fuente
exacta sería una copia de Supabase, a la que solo accede el dueño.

**Why:** «deshacer» presupone que alguien guardó lo que había. Aquí nadie lo guardaba, y un cambio en bloque
lo convierte en un daño masivo. Ya hubo otro caso de la misma forma en este proyecto: el bloque que borraba
notas en RTG PROMOS ([[no-reenviar-lo-leido]]).

**How to apply:** ante un «deshaz esto», **medir primero el alcance real** (aquí «varias» eran 162) y **guardar
una foto** antes de escribir; buscar la fuente del valor anterior y **decir cuál es exacta y cuál es una
reconstrucción**; nunca pulsar ni sugerir el «Restore» de Supabase, que borra todo lo posterior. Y proponer lo
de fondo: que el registro guarde `antes → después` y que una acción en bloque sobre muchas órdenes pida
confirmación con el número y excluya las entregadas y canceladas. Ver [[comprobar-la-capa-que-manda]].
