---
name: rebase-deja-la-entrada-antes
description: "Al rebasar una rama con entrada D-NEXT sobre un main que ganó entradas, git la deja ANTES de las nuevas y decisions-check cae ya numerada; mover el bloque al final antes de lanzar"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 83590ac0-88d3-4d5e-b9d3-888a2b15db49
  modified: 2026-11-02T03:40:16.034Z
---

Tras `git rebase origin/main` en un worktree con una entrada `## D-NEXT` apéndice, git fusiona DECISIONS.md sin conflicto pero coloca mi bloque antes de las entradas que main ganó mientras tanto. Nada avisa hasta que sube.sh numera y `decisions-check` dice «D-795 va detrás de D-797». Me pasó dos veces seguidas el 2026-11-01 (797 y 798) en una cola de ocho releases.

**Why:** el check corre después del rebase y la numeración; la cola larga hace que cada rama rebase sobre varias entradas nuevas.

**How to apply:** tras cada rebase en cola, `node mueve-dnext.mjs <worktree>` (scratch: mueve el bloque `## D-NEXT` al final) + `decisions-check` + amend, antes de lanzar sube. Y no borrar el worktree hasta leer «NNN exit 0» (volví a hacerlo con el 797; se recuperó por el sha «H …» del log). Ver [[no-borrar-el-worktree-sin-leer-el-exit]] y [[decisions-md-no-se-fusiona-solo]].
