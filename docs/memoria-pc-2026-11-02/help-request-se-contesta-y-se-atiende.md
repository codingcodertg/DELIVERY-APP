---
name: help-request-se-contesta-y-se-atiende
description: "Regla permanente del dueño (2026-11-01): cada help request resuelta se contesta en su hilo y se marca «atendida»"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 83590ac0-88d3-4d5e-b9d3-888a2b15db49
  modified: 2026-11-02T01:15:26.023Z
---

Cuando el dueño me pasa un help request (pegado «From: … Page: …») y ya está hecho, contesto en el hilo de la solicitud lo que se corrigió y la marco como atendida. Siempre, sin que me lo pida.

**Why:** el dueño (2026-11-01): «siempre que te mande un help request y ya la hiciste ve al help request, le contestas lo que se corrigió y márcala como handled». Quien pidió recibe el aviso (`ayuda_respuesta`) y la cola de solicitudes queda limpia.

**How to apply:** script `ayuda-contesta.mjs` en el scratch (patrón): `insert into help_messages (request_id, author_id, author_name, body)` con el id del admin careers@ (`acf43ad5-a937-419b-980c-ef57d45b67c6`, nombre «ANDRES UGARTE») y `update help_requests set status='atendida', attended_by, attended_at=now()`. Antes, leer el último autor del hilo para no contestar dos veces. Texto en el idioma del pedido, con la versión de la app y el D-número. Esta escritura en producción está autorizada de forma permanente; el resto de escrituras siguen con su sí.
