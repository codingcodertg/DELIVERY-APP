---
name: confirmar-despliegue-antes-de-decir-listo
description: No decirle al dueño «ya está publicado» hasta que el despliegue de Production en Vercel del commit fusionado termine en success
metadata:
  type: feedback
---

2026-10-06: dije «ya está publicado» de D-482 en cuanto el CI pasó y se fusionó el PR; el dueño recargó y mandó captura: «sigue igual». Vercel tardó ~5 min más en desplegar Production (commit 80c95616, deploy 21:15Z).

**Why:** el dueño prueba en cuanto le digo que está; si aún no desplegó, ve lo viejo y pierde tiempo/confianza.

**How to apply:** después de `gh pr merge`, esperar a que `gh api repos/codingcodertg/DELIVERY-APP/commits/<sha>/status` deje de estar `pending` (contexto Vercel) y que haya deployment `Production` para ese sha; recién entonces decir «publicado, recarga con Ctrl+Shift+R». Meterlo en el mismo comando de espera del release. Ver [[rapidez-sobre-ceremonia]].
