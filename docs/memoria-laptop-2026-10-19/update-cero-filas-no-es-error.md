---
name: update-cero-filas-no-es-error
description: "Un UPDATE que no encuentra ninguna fila vuelve limpio en PostgREST, y el código lo lee como guardado."
metadata: 
  node_type: memory
  type: reference
  originSessionId: 39114734-431c-4e44-a77a-198be3f67540
  modified: 2026-09-12T01:54:26.041Z
---

En PostgREST, un `UPDATE` que afecta a **cero filas** no devuelve error. Vuelve con
`error === null` y sin datos, así que un `if (error) throw` lo deja pasar como éxito.

Pasa por dos caminos distintos y los dos son silenciosos:

- **Un filtro que ya no casa** — `.eq("is_live", true)` sobre una fila que otro proceso cerró.
- **La RLS filtrando la fila** — en `timetracker.sessions`, la cláusula de update exige
  `payroll_id IS NULL`, así que una sesión ya en nómina desaparece para el `UPDATE` sin un solo
  error.

**Cómo se mide:** añadir `.select("id")` al final del update y mirar la longitud. Con
`{ count: "exact" }` también, pero el `.select` es el que ya usa el resto del repo.

Es de la misma familia que [[in-vacio-filtra-en-postgrest]]: la respuesta plausible de PostgREST
no es la que uno supone, y solo se sabe midiéndola. Y del mismo tipo de fallo que
[[descartar-el-error-no-falla]], solo que aquí ni siquiera hay error que descartar — hay que
preguntar por lo que **no** vino.
