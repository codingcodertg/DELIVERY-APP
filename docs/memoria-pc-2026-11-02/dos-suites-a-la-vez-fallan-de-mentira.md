---
name: dos-suites-a-la-vez-fallan-de-mentira
description: Dos suites completas de vitest a la vez (release en segundo plano + otra en primer plano) tumban ficheros al azar; releídos solos pasan. Serializar.
metadata:
  node_type: memory
  type: feedback
  originSessionId: 83590ac0-88d3-4d5e-b9d3-888a2b15db49
  modified: 2026-10-30T20:56:01.695Z
---

El 2026-10-30, el release de D-767 (sube.sh en segundo plano) dio 9 ficheros de prueba caídos (map-legend, personalizar, barra-igual…) sin relación con el cambio, mientras yo corría la suite completa de otro worktree en primer plano. Relanzados esos tres ficheros solos: 36/36 en verde. El release se terminó a mano (commit numerado, suite, push, relNNN.sh).

**Why:** dos suites de ~9.600 pruebas a la vez compiten por memoria/CPU y vitest marca caídos ficheros que no lo están; el «3 failed» normal (los tres scripts rotos en main) se vuelve «9 failed» y parece una regresión.

**How to apply:** una sola suite completa a la vez: mientras un sube.sh corre, no lanzar `vitest run` entero en otro worktree (correr solo los ficheros tocados). Si un release cae con ficheros ajenos al cambio, relanzar esos ficheros solos antes de buscar la causa; si pasan, terminar el release a mano. Ver [[workers-acotados]] y [[release-sigue-tras-push-fallido]].
