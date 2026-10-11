---
name: laptop-estado-y-limites
description: Desde 2026-10-11 se vuelve a la PC de escritorio; la laptop queda quieta. Qué tiene y qué límites tiene la laptop
metadata: 
  node_type: memory
  type: project
  originSessionId: 82a444c4-d068-486f-a40b-3e73b61f92ca
  modified: 2026-10-11T23:08:44.199Z
---

**Dónde se trabaja hoy: la PC de escritorio** (`DESKTOP-KOP6MJ6`, repo en `D:\CLAUDE\DELIVERIES APP\deliveries-app`), con el traspaso `docs/HANDOFF-2026-10-11.md`. La laptop (`LAPTOP-QKUGV7QN`) queda quieta. Historia: laptop del 19 al 23 de septiembre → PC del 29 de septiembre al 8 de octubre → laptop del 9 al 11 de octubre (D-504…D-515) → **PC otra vez desde el 2026-10-11**. Ver [[trabajo-en-la-laptop]].

Medido en la laptop el 2026-10-11, al irse: `main` en `5fca5398`, producción deliveries 1.283.0, repo 1.385.0, 163 migraciones todas aplicadas, 513 decisiones hasta D-515.

Lo que sigue siendo verdad de la laptop, por si se vuelve:
- **Git no trae identidad por defecto aquí.** Comprobar `git config user.email` antes del primer commit.
- **El clasificador de permisos niega tocar producción** con un script propio. `migrate-status.mjs` y el tracker (`node --env-file=.env.local tracker/cli.mjs`) sí pasan. Para aplicar una migración, el dueño corre con `!` `node scripts/db/aplica-migracion.mjs NNN.sql --escribe` (D-512; así se aplicó la 164). Ver [[permisos-los-instala-el-dueno]].
- **8 GB de RAM:** `verify.mjs` completo se ahoga si algo más compila; las pruebas del motor con tope de tiempo fallan por carga (medido el 2026-10-11: 13 caídas en local, CI verde). Correr `tsc` y las pruebas tocadas, y dejar el resto al CI.
- Los workers aquí son agentes en segundo plano con worktree aislado, no paneles `claude -w`.

**Why:** dos orquestadores a la vez numerando decisiones es lo que el flujo prohíbe, y lo que falta en una máquina nueva se descubre a mitad de un rebase.
**How to apply:** al empezar en cualquier máquina, `git pull`, preguntar en cuál se está, y comprobar la identidad de git junto con las tres cuentas.
