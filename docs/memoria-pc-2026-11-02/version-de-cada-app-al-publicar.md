---
name: version-de-cada-app-al-publicar
description: "sube.sh/prepara.py solo suben la versión de Entregas; un cambio en Time Tracker, RRHH, ERP, etc. necesita subir SU versión en app-versions.ts o la app de escritorio/el banner no avisan y el usuario sigue con el paquete viejo"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 83590ac0-88d3-4d5e-b9d3-888a2b15db49
  modified: 2026-10-30T02:57:14.409Z
---

El 2026-10-29 cuatro releases tocaron Time Tracker (D-737, D-750, D-752, D-755) y `sube.sh` solo subió `deliveries` en `src/lib/app-versions.ts` (y `customers` con `SUBE_CLIENTES=1`). La app de escritorio del Time Tracker no vio versión nueva, no avisó de recargar, y el dueño vio «la foto nunca carga» con el arreglo ya en producción.

**Why:** el banner de actualización compara `APP_VERSIONS[appForPath]` con lo que sirve `/api/version`; si la versión de ESA app no cambia, para ella no hubo release.

**How to apply:** al publicar algo de una app que no es Entregas, subir también su clave en `app-versions.ts` (timetracker, recruiting, erp, promos, estimator, surveys, leads, clockin) en el mismo PR; mejor aún, enseñar a `prepara.py` a subir la de cada app tocada (`git diff --name-only` por carpeta). Ver [[apk-publicado-es-lo-que-corre]] para el móvil.
