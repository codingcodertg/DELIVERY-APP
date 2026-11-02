---
name: crlf-tras-rebase
description: "Tras un rebase, los finales de línea pueden diferir entre ficheros del mismo commit; una edición por anclas con \\n falla en silencio."
metadata: 
  node_type: memory
  type: project
  originSessionId: 83590ac0-88d3-4d5e-b9d3-888a2b15db49
  modified: 2026-09-12T20:14:45.507Z
---

En este repo (Windows, `core.autocrlf`), **los blobs de git son LF** (medido
por el auditor el 2026-09-12: 0 bytes CR en `DECISIONS.md` y `middleware.ts`
en `3af8815` y `45b1bd1`); **lo que se mezcla es el árbol de trabajo**, y no por el
rebase sino siempre en Windows: `core.autocrlf=true` saca los ficheros en CRLF
al hacer checkout, y los que se escriben a mano (al resolver un conflicto, o
con un script) quedan como los escribió quien los escribió. Una edición por
anclas con `\n` (`sed`, `Edit`, scripts) no encuentra la ancla en los CRLF y
**no falla ruidosamente**. Y ojo con `grep -c $'\r$'` para medirlo: en este
shell es inestable entre invocaciones; lo fiable es contar bytes,
`tr -cd '\r' | wc -c`.

**Why:** el 2026-09-12, tras rebasar `cierre-sesion-1830`, la sección nueva de
`DECISIONS.md` nunca llegó al fichero: el script de edición falló, y no se
notó porque edición y verify iban en la misma llamada separados por salto de
línea en vez de `&&`, así que el código de salida era el del verify. Lo cazó el
auditor como «comportamiento nuevo sin entrada».

**How to apply:** tras un rebase, `file DECISIONS.md src/...` (o
`grep -c $'\r'`) antes de editar; encadenar edición y verificación con `&&`; y
comprobar la edición con un `grep` de lo que se acaba de escribir, no con el
resultado del paso siguiente. Ver [[medida-que-no-necesita-explicacion]].
