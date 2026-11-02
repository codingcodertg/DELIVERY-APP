---
name: commit-de-release-solo-sus-ficheros
description: "un `reset --soft origin/main` sobre un árbol de trabajo viejo fabrica un commit que devuelve a su versión anterior todo lo que main cambió entre medias; antes de publicar, `git show --stat` del commit numerado debe listar solo los ficheros de esa decisión"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 83590ac0-88d3-4d5e-b9d3-888a2b15db49
  modified: 2026-10-30T03:07:47.584Z
---

El 2026-10-29 la rama de D-753 se reconstruyó con `git reset --soft origin/main` desde un worktree cuyo árbol venía de un main anterior a D-749…D-752. El commit resultante fue la foto de ese árbol: 27 ficheros tocados cuando le tocaban 8, y los otros 19 deshicieron D-748 (parte), D-749, D-750, D-751 y D-752. El rebase fue «limpio» (el commit traía los ficheros enteros), la suite pasó (sus pruebas viajaban también en el árbol viejo) y Vercel dijo success. El dueño lo vio como «la foto sigue sin cargar» con el arreglo «publicado». Reparado en D-756.

**Why:** `reset --soft` no toca el árbol de trabajo; lo que se commitea es lo que hay en el worktree, no «mis cambios».

**How to apply:** para rehacer una rama, `git rebase` o cherry-pick de los commits propios sobre `origin/main` recién traído, nunca `reset --soft` con un árbol viejo. Y antes de cada push de release: `git show --stat <commit numerado>` tiene que listar solo los ficheros de la decisión más DECISIONS.md, package.json y app-versions.ts; cualquier otro fichero es un revert escondido. Ver [[residuo-no-es-quedo-fuera]] y [[canario-en-las-dos-direcciones]].
