---
name: workers-acotados
description: "Los workers tardaban 1-2 h; el dueño se quejó. Un pedido por worker, máx. 2 a la vez, verify una sola vez, ≤12 mutantes, medición solo a 390 px y escritorio"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 83590ac0-88d3-4d5e-b9d3-888a2b15db49
  modified: 2026-10-12T05:05:23.062Z
---

2026-10-11, el dueño: «porque los agents se han tardado hora y meida!?». Medido: worker del chofer 68 min, worker del Time Tracker 120 min. Causas: le añadí pedidos a mitad (1 y 2), `verify.mjs` entero (~10 min) corrido hasta 4 veces por timeouts con 4 workers + 4 `next dev` a la vez, 50-60 mutantes por tanda, y medición a 7 anchos × 2 idiomas × 2 roles.

**Why:** el dueño quiere ver cada cambio publicado rápido; una hora y media por tanda rompe eso, y correr 4 workers a la vez los hace más lentos a todos.

**How to apply:** un pedido = un worker (lo que llegue después va a otro o lo hago directo: los cambios chicos hechos por mí salieron en 20-30 min); máximo 2 workers a la vez; en el prompt del worker: `verify.mjs` UNA vez al final, mutantes solo de lo construido (≤12), medición solo a 390 px y escritorio con una captura antes/después. Ver [[rapidez-sobre-ceremonia]] y [[confirmar-despliegue-antes-de-decir-listo]].
