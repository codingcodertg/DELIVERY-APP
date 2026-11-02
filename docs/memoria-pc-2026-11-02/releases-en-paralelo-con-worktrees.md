---
name: releases-en-paralelo-con-worktrees
description: "Cómo encadenar varios cambios directos del orquestador sin esperar a cada release — worktrees con junction de node_modules, release desde el árbol principal, y las trampas del guion de release (ruta del scratchpad, sed codicioso)"
metadata:
  node_type: memory
  type: feedback
  originSessionId: ee6d2d78-7206-4c4b-bbf8-2542f9f3facf
  modified: 2026-10-21T17:34:17.719Z
---

Cuando el dueño manda varios pedidos seguidos (2026-10-12: D-533 a D-536 en una tarde), el guion de release (`rel5NN.sh`) ocupa el árbol principal al final (`git switch main && git pull`), así que NO se edita ahí mientras corre. Lo que funcionó:

- Cada cambio nuevo en un **worktree** desde `origin/main`: `git worktree add D:/CLAUDE/entregas/wt5NN -b feat/x origin/main`, y el `node_modules` como junction desde PowerShell: `cmd /c mklink /J "D:\CLAUDE\entregas\wt5NN\node_modules" "D:\CLAUDE\DELIVERIES APP\deliveries-app\node_modules"` (desde Bash el mklink NO se creó y `npx tsc` instaló un paquete basura). `tsc`, vitest y los mutantes corren igual en el worktree.
- Antes de numerar: `git merge origin/main`; DECISIONS.md siempre choca (las dos ramas añaden al final). Resolver con `git checkout --theirs DECISIONS.md` + volver a correr el `decNNN.py` que añade la entrada, `decisions-check --contra origin/main`, y commit. `numerar` sigue valiendo con el sha del commit de la entrada (blame).
- El release se lanza **desde el árbol principal** (el guion hace `cd` a él); el PR se crea con `--head feat/x` porque la rama ya está subida. Quitar el worktree al final: `git worktree remove` + `cmd /c rmdir` del junction.

**Trampas del guion de release (medidas hoy):**
- `S=` dentro del guion apuntaba al scratchpad viejo cuando la sesión cambió de carpeta: el tracker falló con ENOENT y hubo que crear T-0528 a mano. Revisar `S=` al clonar el guion.
- Un `sed "s/feat\/vieja [0-9a-f]*/feat\/nueva $H/"` también pega en `--head feat/vieja --title` (el `[0-9a-f]*` casa vacío) y deja `b3fe009a--title`: `gh pr create` falla y el guion sigue hasta cambiar a main. Anclar el patrón con el `)` de la BODY: `feat\/vieja [0-9a-f]*)`. Y si el guion falla, pararlo (`TaskStop`) antes de que llegue al tracker.

- 2026-10-21 (D-625): con la rama abierta en el worktree, `gh pr merge --delete-branch` fusiona pero no puede borrar la rama, y el respaldo del guion dice «already merged»: no es un fallo. Borrar luego la rama remota (`git push origin --delete`) tras quitar el worktree. Y la cuenta de `gh` se cambia sola a mitad de tarde (otra sesión): el guion comprueba `CARRERSRTG` antes de `pr create` y antes de `pr merge`.
- Al rebasar dos ramas que añaden cada una su bloque al FINAL de globals.css, el conflicto es siempre ese: quedarse con los dos bloques.

**Why:** una tarde de 4 releases encadenadas sin pisarse; el dueño quiere todo publicado sin preguntar.
**How to apply:** segundo pedido mientras hay un release en curso → worktree; antes de lanzar `relNNN.sh`, `grep -n "^S=\|--title" relNNN.sh`.
