---
name: push-y-merge-sin-pedir
description: "REEMPLAZADA 2026-09-23: ya NO se sube ni fusiona sin pedir; el dueño pide confirmación antes de cada push/deploy. Historia de la autorización del 16."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 83590ac0-88d3-4d5e-b9d3-888a2b15db49
  modified: 2026-09-23T17:23:51.920Z
---

«P
> **⚠ REEMPLAZADA el 2026-09-23.** Al pedir el sistema de accountability, el dueño escribió «pídeme
> confirmación antes de cualquier acción destructiva o de hacer push/deploy», y al preguntarle si valía solo
> para ese trabajo contestó **«para todo el proyecto»**. Desde entonces **no se sube, no se abre PR para
> fusionar ni se publica sin su confirmación**, también en el trabajo de la app. Lo de abajo queda como
> historia: por qué se dio la autorización del 16 y cómo se usaba. Ver [[confirmar-antes-de-publicar]].
orque no hacen eso en automático, asegúrate que se haga todo sin molestarme» (2026-09-16), tras
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

**«Espero CI» se escribe con un `if`, nunca con una tubería** (2026-09-20, incidente real): un
`gh pr checks | tail && gh pr merge` **fusionó con el CI en rojo**. La tubería devuelve el código de
salida del ÚLTIMO comando —`tail`, que siempre sale 0—, así que el `&&` no comprueba nada; y aunque
no hubiera tubería, lo que hay que mirar es el estado, no que el comando terminara. La forma es
condicionar explícitamente sobre el resultado (`gh pr checks <n> --watch` y, solo si su código es 0,
`gh pr merge`), y si hay duda, leer la conclusión de cada check antes de fusionar. Emparenta con
[[comprobar-la-edicion-no-el-comando]]: el verde de al lado no dice que lo tuyo pasara.

**Y `pg` no es dependencia del proyecto:** para aplicar una migración se instala aparte
(`npm i pg --no-save`). Que un script de `scripts/db/` exista no significa que su cliente esté.
