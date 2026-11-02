---
name: formato-de-datos-unico
description: "Regla permanente del dueño (2026-10-28): teléfonos con una sola forma (ext. aparte), correos en minúsculas, nombres con mayúscula inicial, sin mayúsculas sueltas en pantalla; se normaliza al guardar, en el servidor"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 83590ac0-88d3-4d5e-b9d3-888a2b15db49
  modified: 2026-10-28T15:03:00.292Z
---

El dueño, 2026-10-28, literal: «Phone numbers: one consistent format everywhere … with extension shown as "ext. 123". Emails: always lowercase. Names: proper capitalization (First Last), never all caps or all lowercase. Fonts, sizes and text casing must be consistent across all fields and screens — no random uppercase labels or mixed styles. Normalize data on input/save.»

**Why:** datos que llegan de Excel y de varias manos (JULIO, salesrhc@…, 19568171583) se veían distintos en cada app; él quiere una sola forma guardada y pintada.

**How to apply:** la forma de teléfono de la app es `956-555-0123` (D-432, `telefonoDeFicha`); correos por `correoDeFicha`; nombres por `nombreDeFicha` (RR. HH., D-727). Al escribir una acción o ruta que guarde teléfono, correo o nombre en cualquier app, pasar por esas (o sus equivalentes de la app) en el servidor, no solo en el campo. También en CLAUDE.md («El formato de los datos es uno en todas las apps»). Ver [[tabla-de-entregas-es-la-referencia]].
