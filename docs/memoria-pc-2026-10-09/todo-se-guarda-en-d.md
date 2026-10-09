---
name: todo-se-guarda-en-d
description: "Desde el 2026-09-30 los respaldos, llaves y entregables van a D:\\CLAUDE; C: se quedó sin espacio."
metadata:
  node_type: memory
  type: feedback
  originSessionId: 83590ac0-88d3-4d5e-b9d3-888a2b15db49
  modified: 2026-09-30T23:48:12.487Z
---

El dueño, 2026-09-30, con C: a 24 GB libres y D: con 1.1 TB: «transfiere todo a d porque ahi tengo mas espacio y ahi tu guarda todo de ahora en adelante».

**Cómo se aplica:** `D:\CLAUDE\respaldos` (fotos de tablas antes de cada cambio), `D:\CLAUDE\respaldos-db` (dumps completos; el nocturno lo hace la tarea programada «RTG respaldo base», guion `respaldo-nocturno.ps1`), `D:\CLAUDE\secretos` (copia de `.env.local` y `encuesta.env`), `D:\CLAUDE\entregas` (Excel y demás ficheros para el dueño). Los guiones nuevos escriben ahí, no en `Documents/CLAUDE/DELIVERIES APP/respaldos` (que quedó como junction hacia D:). Cuando el proyecto entero se mueva a `D:\CLAUDE\DELIVERIES APP`, hay que renombrar la carpeta de memoria/sesiones de `~/.claude/projects` a la clave nueva y correr `git worktree repair`.

**Por qué:** los worktrees de los agentes y sus `.next` se comían C: (56 worktrees, ~10 GB); se limpiaron el 2026-09-30 con su sí. Ver [[disco-lleno-por-next-de-worktrees]].
