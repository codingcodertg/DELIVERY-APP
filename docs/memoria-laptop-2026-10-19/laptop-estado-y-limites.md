---
name: laptop-estado-y-limites
description: Desde 2026-10-13 se trabaja otra vez en la laptop (la PC hizo D-516…D-536 sin dejar traspaso); qué tiene y qué límites tiene la laptop
metadata: 
  node_type: memory
  type: project
  originSessionId: 82a444c4-d068-486f-a40b-3e73b61f92ca
  modified: 2026-10-11T23:08:44.199Z
---

**Dónde se trabaja hoy: la LAPTOP otra vez desde el 2026-10-13.** La PC trabajó del 11 al 12 de octubre (D-516…D-536, migraciones 165-169) y **no dejó traspaso ni su memoria en el repo**: lo aprendido allá no está aquí. Historia: laptop 19-23 sep → PC 29 sep-8 oct → laptop 9-11 oct (D-504…D-515) → PC 11-12 oct → laptop desde el 13 oct. Ver [[trabajo-en-la-laptop]]. Al irse de una máquina, pedir que deje `docs/HANDOFF-<fecha>.md` y su memoria, como el traspaso `docs/HANDOFF-2026-10-11.md`.

Medido en la laptop el 2026-10-13, al volver: `main` en `825b58c5`, producción deliveries 1.297.0, repo 1.401.0, 168 migraciones (hasta la 169) todas aplicadas, 534 decisiones hasta D-536, sin PRs abiertos. Ramas `feat/png-de-la-ruta`, `feat/colores-mi-ruta` y `release-d530` quedan en origin pero su contenido está en main (solo difieren en números de versión viejos).

Lo que sigue siendo verdad de la laptop, por si se vuelve:
- **Git no trae identidad por defecto aquí.** Comprobar `git config user.email` antes del primer commit.
- **El clasificador de permisos niega tocar producción** con un script propio. `migrate-status.mjs` y el tracker (`node --env-file=.env.local tracker/cli.mjs`) sí pasan. Para aplicar una migración, el dueño corre con `!` `node scripts/db/aplica-migracion.mjs NNN.sql --escribe` (D-512; así se aplicó la 164). Ver [[permisos-los-instala-el-dueno]].
- **8 GB de RAM:** `verify.mjs` completo se ahoga si algo más compila; las pruebas del motor con tope de tiempo fallan por carga (medido el 2026-10-11: 13 caídas en local, CI verde). Correr `tsc` y las pruebas tocadas, y dejar el resto al CI.
- Los workers aquí son agentes en segundo plano con worktree aislado, no paneles `claude -w`.

**Why:** dos orquestadores a la vez numerando decisiones es lo que el flujo prohíbe, y lo que falta en una máquina nueva se descubre a mitad de un rebase.
**How to apply:** al empezar en cualquier máquina, `git pull`, preguntar en cuál se está, y comprobar la identidad de git junto con las tres cuentas.


**2026-10-19, al volver a la PC:** la tanda de la laptop fue D-537…D-589 (2026-10-13 → 10-19). Dos límites medidos esta vez: (1) con 3–4 agentes corriendo vitest a la vez la laptop (8 GB) se queda sin memoria y Claude Code mata las tareas en segundo plano y para los agentes («stalled»); la receta que funcionó fue un agente por vez para la suite y los demás solo con sus ficheros; (2) un agente hizo `taskkill //F //IM node.exe` y cortó a los otros: prohibirlo en el prompt. El traspaso completo está en `docs/HANDOFF-2026-10-19.md`.
