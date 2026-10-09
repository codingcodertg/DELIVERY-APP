---
name: fetch-no-pull-en-worktree
description: en un worktree de rama ya fusionada se hace git fetch, nunca git pull: el pull fusiona main dentro de la rama y deja un merge commit
metadata:
  type: feedback
---

Al retomar el trabajo tras días en la otra máquina les dije a los dos workers «haz `git pull` antes
de nada». worker2 no lo hizo: su worktree estaba en `agregar-material`, una rama ya fusionada por
squash cuyo upstream es `origin/main`, así que un `pull` habría **fusionado main dentro de la rama**
y dejado un merge commit. Hizo `git fetch origin` y me lo dijo.

**Why:** «ponerse al día» no es una sola operación. En el checkout principal, que sigue a `main`, el
pull es lo correcto; en un worktree parado sobre una rama vieja, escribe historia que nadie pidió.
La orden genérica no distingue los dos casos, y quien la recibe está en el segundo.

**How to apply:** al reanudar, a los workers se les dice **`git fetch origin`**; el `pull` es solo
para el checkout que está en `main`. Y cuando llegue el encargo, worktree nuevo desde el main del
momento en vez de actualizar el viejo. Relacionado: [[estado-de-rama-no-es-el-fichero]] y
[[residuo-no-es-quedo-fuera]] — una rama fusionada por squash sigue pareciendo divergente.
