---
name: disco-lleno-por-next-de-worktrees
description: "Cada worktree deja un .next de ~1,4 GB; con ocho, el disco C: llegó a 0 bytes y Write falló con ENOSPC. Mirar df antes de verificar; borrar cachés ajenas se pregunta."
metadata: 
  node_type: memory
  type: project
  originSessionId: 39114734-431c-4e44-a77a-198be3f67540
  modified: 2026-09-17T16:58:16.288Z
---

El 2026-09-17 el disco C: (237 GB) llegó a **0 bytes libres** a mitad de un encargo: dos `Write` de
pruebas fallaron con `ENOSPC` y el build de `verify.mjs` no habría cabido. Medido con `du`: cada
worktree de `.claude/worktrees/` tenía un `.next` de 1,3–1,4 GB (ocho), más 1,4 GB en el checkout
principal. El `du` de `%LOCALAPPDATA%\Temp` no terminó en 5 minutos, así que ese lado quedó sin medir.

El dueño aprobó **esa vez** borrar los `.next` de los worktrees. Se liberaron ~12 GB. Uno de los
ocho (`directorio-ext-tienda`) ya no tenía `.next` al pasar: otra sesión lo había quitado entre la
medida y el borrado.

**Why:** `rm -rf .next && node scripts/verify.mjs` vuelve a generar 1,4 GB por worktree, y los
worktrees de ramas ya fusionadas no se limpian solos. Un disco a cero no solo rompe mi build: deja sin
escribir a todas las sesiones de la máquina, orquestador incluido.

**How to apply:** antes de verificar, `df -h /c`. Si queda menos de ~3 GB, decirlo. Borrar cachés de
otros worktrees se pregunta cada vez: la aprobación de aquel día no vale para la siguiente, y una
sesión puede tener un build corriendo ahí. Ver [[peticion-de-medir-no-autoriza]].
