---
name: vercel-oom-en-type-check
description: "Un PR que agrupa dos cambios puede morir en el type-check del build de Vercel por OOM aunque tsc y el CI de GitHub pasen; separados, cada uno construye. Separar antes de insistir."
metadata:
  node_type: memory
  type: feedback
  originSessionId: 83590ac0-88d3-4d5e-b9d3-888a2b15db49
  modified: 2026-10-19T18:55:25.118Z
---

**Medido el 2026-10-19 (PR #408, D-592 + D-593):** cuatro builds de Vercel seguidos murieron en «Linting and checking validity of types» tras 28 min, con `[BUILD_UTILS_SPAWN_SIGKILL]` y aviso de OOM del contenedor. `tsc --noEmit` local, `next build` local y el CI de GitHub (tsc · vitest · build) pasaban en 5 min. Ni cambiar `node:crypto` por `crypto` ni sacar el JSX inline a una función (`iconoDeReprogramar`) lo arreglaron. Dos PR de diagnóstico, uno por cambio (#409 y #410), construyeron en Vercel en 5 min cada uno; se publicaron por separado (D-592, D-593) y el deploy de producción de main con los dos juntos también pasó.

**Why:** el type-check del build de Vercel tiene menos memoria que el CI de GitHub y que la PC; «el CI pasa» no dice que Vercel vaya a pasar, y reintentar el mismo PR (commit vacío) gasta deploys (límite de 100/día, [[vercel-100-deploys-al-dia]]) sin cambiar nada.

**How to apply:** si Vercel cae en el type-check con OOM y el CI está verde, no insistir ni «arreglar» el código a ciegas: un PR por decisión (como pide el flujo), y si el PR agrupaba varias, partirlo con PRs de diagnóstico en borrador y publicar cada parte sola. Leer el log con `vercel inspect <dpl> --logs | grep -iE "SIGKILL|Out of Memory|Linting"`.
