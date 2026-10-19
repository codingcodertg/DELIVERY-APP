---
name: disco-lleno-por-next-de-worktrees
description: "Cada worktree deja un .next de ~1,4 GB; con ocho, el disco C: llegó a 0 bytes y Write falló con ENOSPC. Mirar df antes de verificar; borrar cachés ajenas se pregunta."
metadata: 
  node_type: memory
  type: project
  originSessionId: 39114734-431c-4e44-a77a-198be3f67540
  modified: 2026-09-23T18:27:47.261Z
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

**Medido el 2026-09-23, con un matiz que cambia qué hacer:** un worktree cuesta **664 MB** de base
(`node_modules` propios, no se comparten entre worktrees). El `.next` de ~1,5 GB **es opcional**: solo
aparece si se corre `next build` o `verify.mjs` entero. De los diez medidos, tres tenían `.next` a cero
y ocupaban 664 MB. Yo saqué «~2,1 GB por worktree» de la media teniendo ese dato delante; me lo corrigió
el worker, que dejó el build al CI y ocupa 678 MB. **La palanca en una máquina apretada es dejar el
build al CI —ahorra el 70 % por rama— antes que borrar cachés ajenas**, que además se pregunta cada vez. Doce worktrees dejaron el disco al 94 %, con 15 GB libres.
Quitar los diez cuyas ramas ya estaban fusionadas liberó **14 GB** de golpe y ninguno quedó bloqueado por
Windows. El método que lo hizo seguro: por cada worktree, `status --porcelain` (cero cambios) **y** su
decisión ya numerada en `DECISIONS.md` — no `main...rama`, que tras un squash siempre miente
([[residuo-no-es-quedo-fuera]]). Y se conservan los worktrees donde hay una sesión sentada: borrarlos le
quita el suelo a esa sesión. El dueño lo autorizó tras ver los números, que es lo que convierte «borro
cachés» en una decisión suya y no mía.

**Y el 1,5 GB del `.next` es OPCIONAL, medido por mí el mismo día:** mi worktree de
`dinero-y-millas-una-funcion` ocupa **678 MB en total** —solo `node_modules`— porque dejé el
`next build` al CI y corrí únicamente `tsc` y `vitest`. O sea que los ~2,1 GB son el precio de correr
`verify.mjs` entero, no el de tener un worktree: **dejar el build al CI ahorra el 70 % del disco por
rama**, y en una máquina apretada esa es la palanca, no borrar cachés ajenas.
