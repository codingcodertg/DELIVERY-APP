---
name: la-version-la-decide-la-ruta
description: "Qué APP_VERSION sube lo decide la RUTA de la pantalla (app-for-path.ts), no quién importa el fichero compartido."
metadata:
  node_type: memory
  type: feedback
  originSessionId: 9d5602ef-8669-4169-abbc-3d0b12686868
  modified: 2026-09-24T01:10:12.435Z
---

Al tocar código compartido de `src/lib`, la pregunta «¿qué app subo?» se contesta
mirando **en qué ruta se ve el cambio**, y esa ruta la mapea
`src/lib/app-for-path.ts`. No se contesta razonando «este fichero lo importa el
hub, y el hub es de las tres».

Medido el 2026-09-23. Toqué `ROLE_CAPS` (`constants.ts`), que lo lee `extraCaps`,
que lo usa la pantalla de Usuarios del hub (`src/app/home/users/page.tsx`).
Recomendé subir **las tres** apps «porque el hub es de las tres». Falso: en
`app-for-path.ts` no hay prefijo para `/home`, así que **cae en el `return
"deliveries"` del final** (línea 33). Recruiting y timetracker solo importan
`landingRoute` de ese fichero, que no lee `ROLE_CAPS`.

**Why:** «compartido» es una intuición sobre la arquitectura; el sello de versión
es una tabla de prefijos. Subir de más no rompe nada —es un refresh— pero la
recomendación llega al orquestador como si estuviera medida, y ahí ya pesa.

**How to apply:** la ruta de la pantalla contra la tabla de `app-for-path.ts`, y
`grep` de qué importa de verdad cada app del fichero tocado —no el fichero
entero, **el símbolo**. Es la misma trampa de [[dato-correcto-conclusion-falsa]]:
el dato (el hub lo ven las tres apps) era cierto y la conclusión no.
