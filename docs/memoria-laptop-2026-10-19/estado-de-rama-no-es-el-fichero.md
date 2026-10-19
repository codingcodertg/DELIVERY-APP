---
name: estado-de-rama-no-es-el-fichero
description: "El estado de una rama es HEAD + status, no lo que diga un fichero del árbol de trabajo."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 83590ac0-88d3-4d5e-b9d3-888a2b15db49
  modified: 2026-09-10T17:19:33.895Z
---

Leer un fichero del árbol de trabajo **no dice nada sobre la rama**. El estado
de una rama es `git rev-parse HEAD` y `git status --porcelain`; un fichero
modificado no dice si está commiteado ni si el resto del cambio está terminado.

**Why:** el 2026-09-10, tras un veredicto de CAMBIOS por un fallo de seguridad
en una migración, leí el `.sql` en el worktree del worker, vi la corrección
puesta y le escribí al auditor «queda tu firma sobre el HEAD nuevo». No había
HEAD nuevo: la corrección estaba sin commitear, el HEAD seguía siendo el
rechazado, y había un segundo fichero tocado que delataba faena a medias. Si el
auditor se hubiera fiado, habría firmado un commit que no existe. Y leer el
worktree mientras el worker trabaja es además el intervalo sin dueño de
[[worktree-quieto-tras-rama-lista]], en versión lectura: no rompe nada, pero
produce una conclusión falsa.

**How to apply:** para afirmar el estado de una rama ajena, `rev-parse` y
`status --porcelain` antes que `cat`; y si hace falta el contenido,
`git show HEAD:<fichero>`, que sí es el commit. Lo que se espera es el aviso del
worker con HEAD y hora, no una lectura propia del directorio. Ver
[[auditoria-no-es-medicion]] y [[verificar-contra-el-codigo-que-ejecuta]].
