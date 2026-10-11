---
name: worktree-nuevo-no-se-usa-desde-dentro
description: "Una sesión clavada en un worktree no puede git, ni leer, ni ESCRIBIR fuera de él: montar un worktree nuevo desde dentro lo deja vacío e inútil."
metadata:
  node_type: memory
  type: project
  originSessionId: 9d5602ef-8669-4169-abbc-3d0b12686868
  modified: 2026-09-23T19:39:54.295Z
---

El 2026-09-23, con la sesión aislada en `.claude/worktrees/dinero-y-millas-una-funcion`, monté
`propuesta-mapa-marcas` como pedía el encargo. El `git worktree add` **sí funcionó** — y eso es
justo lo que engaña. Todo lo demás falló:

- `cd <otro worktree> && git …` → rechazado («git operations must target its own worktree»).
- Un `cat` con `$(…)` calculado dentro → rechazado **aunque no fuera git**, por no poder demostrar
  que no lo era.
- Un heredoc largo → rechazado por «too complex to verify».
- Y la que cierra el asunto: **`Write` a una ruta del otro worktree → rechazado** («edit the worktree
  copy of this file instead»).

O sea que el worktree nuevo quedó **vacío y muerto**: ni escribir el documento dentro.

**Why:** el guard no es solo de git, es **de ruta**. La sesión solo escribe en su propio worktree, y
eso no se descubre hasta el primer `Write`, que llega tarde: para entonces ya montaste el worktree,
ya avisaste al orquestador y ya le dijiste que no borre nada.

**How to apply:** si el encargo dice «worktree nuevo» y **yo** soy quien va a escribir, decirlo antes:
*«no puedo, el guard me clava aquí; o trabajo en este worktree con una rama nueva, o mueves la
sesión»*. Y hacer eso: `git checkout -b <rama> origin/main` **en el worktree donde estoy** (si la rama
está limpia y ya fusionada, cambiarse es gratis), escribir ahí, y commitear. Leer ficheros de otro
worktree por ruta **sí** funciona con `cat`/`grep` planos — solo se rompe al escribir o al hacer git.
Ver [[estado-de-rama-no-es-el-fichero]] y [[disco-lleno-por-next-de-worktrees]] (un worktree que no
compila no necesita `npm ci`: 664 MB ahorrados).
