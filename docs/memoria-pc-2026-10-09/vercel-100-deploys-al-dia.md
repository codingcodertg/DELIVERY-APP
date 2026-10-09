---
name: vercel-100-deploys-al-dia
description: "Vercel corta a los 100 deploys en 24 h (medido 2026-09-17/18: 62 de producción + 38 previews). Cada PR cuesta 3: preview, merge y commit de release."
metadata: 
  node_type: memory
  type: project
  originSessionId: 83590ac0-88d3-4d5e-b9d3-888a2b15db49
  modified: 2026-09-18T13:59:14.235Z
---

El 2026-09-18 el release de D-308 (3d2966f) no se desplegó: el estado de Vercel en el commit decía
«Deployment rate limited — retry in 24 hours». Contado por la API de GitHub: exactamente 100 deploys
en 24 h (62 producción, 38 preview). Producción se quedó sirviendo el commit del merge (ef6a997), con
el código nuevo pero con la `APP_VERSION` vieja, así que ningún cliente recibió el aviso de refrescar.

**Why:** el flujo gasta tres deploys por PR —el preview de la rama, el squash-merge en `main` y el
commit de release que le sigue a los dos minutos—, y un día de muchos encargos pequeños llega a 100.
El deploy del merge es desperdicio puro: lo pisa el del release enseguida.

**How to apply:** en un día de muchas ramas, contar antes de fusionar
(`gh api "repos/…/deployments?per_page=100"` filtrando por `created_at`) y, pasado de ~70, agrupar:
fusionar varias ramas y hacer UN commit de release que las numere todas. «Producción sirve X» se
comprueba por el estado de Vercel en el commit (`gh api repos/…/commits/<sha>/status`), no solo
esperando a `/api/version`: un waiter que no termina puede ser un deploy que nunca empezó. Propuesto
al dueño: `ignoreCommand` en Vercel que salte el build cuando `DECISIONS.md` aún tiene `D-NEXT`.
Ver [[apk-publicado-es-lo-que-corre]].
