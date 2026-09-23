---
name: push-y-merge-sin-pedir
description: "El dueño autorizó (2026-09-16) que el orquestador suba, abra PR y fusione las ramas que ya aprobó, sin pedirle aprobar pushes en el panel de cada worker."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 83590ac0-88d3-4d5e-b9d3-888a2b15db49
  modified: 2026-09-16T20:40:21.256Z
---

«Porque no hacen eso en automático, asegúrate que se haga todo sin molestarme» (2026-09-16), tras
varias horas con dos ramas de worker2 aprobadas y paradas porque su sesión no podía hacer `git push`
sin que el dueño lo aprobara en ese panel.

**Why:** el dueño no quiere hacer de puente entre sesiones. Una rama revisada y aprobada que espera
un clic suyo es trabajo terminado que no llega a producción.

**How to apply:**
- Rama aprobada por mí → la subo yo desde el checkout principal
  (`git push origin <sha>:refs/heads/<rama>`, comprobando antes `gh` = CARRERSRTG con WRITE), abro
  el PR, espero CI y fusiono. A los workers: «commitea y dame el SHA».
- No es permiso para saltarse la revisión: se sube exactamente el SHA que revisé.
- Si hay que rebasar tras otro merge, lo monto yo sobre main y compruebo que la huella de `src/` no
  cambia; si cambia, es un cambio nuevo y se revisa como tal. Ver [[canario-en-las-dos-direcciones]]:
  una prueba de «lista exacta» de una rama cae cuando la otra añade un elemento.
- Los límites de CLAUDE.md siguen (efectos en terceros, respaldo antes de esquema), pero sin
  pedirle clics para lo que ya está decidido. Ver [[hub-centraliza-la-cuenta]].
