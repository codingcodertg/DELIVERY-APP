---
name: laptop-estado-y-limites
description: Del 2026-09-19 al 2026-09-23 el orquestador trabajó en la laptop (el 2026-09-23 se volvió a esta PC); qué faltaba configurar aquí y qué no puede hacer esta sesión
metadata: 
  node_type: memory
  type: project
  originSessionId: 82a444c4-d068-486f-a40b-3e73b61f92ca
  modified: 2026-09-20T04:44:59.802Z
---

Desde el 2026-09-19 el orquestador trabaja en la **laptop** (LAPTOP-QKUGV7QN); la otra PC queda quieta en lo que dejó, con sus workers parados.

**Ya no: el 2026-09-23 el dueño volvió a esta PC** (main en 6999253, D-340…D-362 hechas en la laptop) y la que
queda quieta es la laptop. Lo de abajo sigue valiendo como lo que se aprendió ALLÁ, no como dónde se trabaja hoy;
ver [[trabajo-en-la-laptop]]. La memoria no viaja sola entre máquinas: si se vuelve a la otra PC para quedarse, copiar esta carpeta `memory` hacia allá.

- Git no traía identidad en la laptop: un `rebase --continue` falló con «unable to auto-detect email». Se puso `user.name`/`user.email` de CARRERSRTG **local al repo**. Comprobar `git config user.email` antes del primer commit en una máquina nueva.
- El clasificador de permisos de esta sesión **niega las lecturas de producción** hechas con un script propio (PostgREST con service-role). `migrate-status.mjs` sí pasa. Un recuento en producción hay que pedírselo al dueño o que añada la regla de permiso; no se rodea. Ver [[peticion-de-medir-no-autoriza]].
- En `node_modules` no hay `pg`: las consultas van por PostgREST, como `migrate-status.mjs`.
- Los workers aquí se lanzan como agentes en segundo plano con worktree aislado, no como paneles `claude -w`.

**Why:** dos orquestadores a la vez numerando decisiones es lo que el flujo prohíbe, y lo que falta en una máquina nueva se descubre a mitad de un rebase.
**How to apply:** al empezar en cualquier máquina, `git pull`, preguntar en cuál se está, y comprobar la identidad de git junto con las tres cuentas.
