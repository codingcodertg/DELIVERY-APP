---
name: rapidez-sobre-ceremonia
description: El dueño pidió ir más rápido (2026-10-04): limpieza de worktrees una vez por semana, y no repetir verificaciones que ya hace otro.
metadata:
  type: feedback
---

El dueño, 2026-10-04: «PORQUE TARDA TANTO TODO AHORA? MEJOR ESO DE BORRAR LO DUPLICADO DE LOS WORKTREES QUE SE HAGA UNA VEZ A LA SEMANA PARA NO PERDER TANTO TIEMPO».

**Why:** cada cambio pasaba por worker (verify + mutantes + demo) y luego el orquestador repetía verify, esperaba CI (4 min) y limpiaba el worktree; un retoque de texto tardaba 30-50 min.

**How to apply:** los worktrees de workers terminados se dejan y se borran una vez por semana (los lunes, o cuando C:/D: baje de 20 GB), no tras cada merge. Si el worker ya pasó `verify.mjs` sobre origin/main actual, el orquestador no lo repite: fusiona, numera, sube versión, `tsc` + decisions-check, y deja el build y las pruebas a CI. Cambios pequeños de pantalla (texto, columna, botón) los hace el orquestador directo, sin worker ni tanda larga de mutantes; mutantes solo donde hay lógica o dinero. Agrupar en un solo PR lo que llegue junto. Migraciones y datos siguen con ensayo y sí del dueño. Ver [[decidir-y-terminar]] y [[todo-se-guarda-en-d]].
