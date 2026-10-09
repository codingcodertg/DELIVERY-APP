---
name: in-vacio-filtra-en-postgrest
description: "En nuestro PostgREST, `.in(col, [])` devuelve cero filas; el centinela NO_MATCH es consistencia, no seguridad."
metadata: 
  node_type: memory
  type: project
  originSessionId: 83590ac0-88d3-4d5e-b9d3-888a2b15db49
  modified: 2026-09-11T04:58:07.498Z
---

Medido el 2026-09-10 contra producción, solo lectura, llave de servicio:

```
GET /rest/v1/profiles?select=id              → Content-Range: 0-32/33
GET /rest/v1/profiles?select=id&id=in.()     → HTTP 200, []
```

`supabase-js` construye `in.()` para una lista vacía y PostgREST lo trata como
«ninguna fila», **no** como «sin filtro». El comentario de `NO_MATCH` en
`src/lib/clockin/scope.ts` decía lo contrario y nadie lo había medido; D-237 y
la entrada del centinela de `timeoff.ts` heredaron esa premisa.

**Why:** tres mensajes seguidos describieron una fuga («las ausencias de toda la
compañía») que no existía ni latente. El código quedó igual de bien —un valor en
un sitio en vez de ocho copias—, pero la urgencia se apoyaba en un comentario
tomado como hecho.

**How to apply:** un comentario que afirma cómo se comporta una dependencia es
una premisa hasta que alguien la mide; si una decisión cuelga de ella, medirla
primero (aquí bastó un `curl`). Ver [[comentario-dice-la-verdad]] y
[[verificar-contra-el-codigo-que-ejecuta]].
