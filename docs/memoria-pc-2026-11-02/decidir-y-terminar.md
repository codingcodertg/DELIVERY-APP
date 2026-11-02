---
name: decidir-y-terminar
description: "El dueño delegó (2026-09-18) las decisiones de diseño abiertas: «tú toma las decisiones y termina todo». Notion y la hoja real del despachador: «omítelo por ahora»."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 83590ac0-88d3-4d5e-b9d3-888a2b15db49
  modified: 2026-09-18T17:49:26.339Z
---

El 2026-09-18, tras recibir el diseño del motor de rutas con 13 preguntas abiertas y otras tres cosas
pendientes de su respuesta, el dueño contestó: «tu toma la decisiones y termina todo». Y sobre lo único
que no podía decidir por él (el token de Notion y una hoja real del despachador): «eso omítelo por ahora».

**Why:** no quiere ser el cuello de botella de cada pregunta; prefiere un valor por defecto razonable,
medido, que pueda cambiar después.

**How to apply:**
- Ante una pregunta de negocio abierta, decidir con lo medido y dejarlo como **valor por defecto editable
  en Ajustes**, no como regla en el código; escribir la decisión, su fecha y que fue por delegación.
- Contárselo en el resumen como hecho, no como pregunta. Preguntar solo lo que de verdad no se puede
  inferir ni deshacer (datos que solo él tiene, dinero, borrar cosas).
- Los límites de CLAUDE.md no se relajan: ensayo con ROLLBACK, respaldo antes de tocar esquema/guard/RLS,
  nada de efectos reales en terceros. La delegación cubre el «qué», no salta el «cómo».
- No volver a pedirle el token de Notion ni la hoja real en cada mensaje; quedan aparcados hasta que él
  los traiga. Ver [[push-y-merge-sin-pedir]].
