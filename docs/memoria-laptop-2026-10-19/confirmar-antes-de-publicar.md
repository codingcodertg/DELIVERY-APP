---
name: confirmar-antes-de-publicar
description: "2026-09-23 el dueño pidió confirmar cada push/deploy; esa misma noche lo revirtió para el código (\"push todo sin necesidad que te lo diga\"); migraciones y escrituras de datos siguen con su sí"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 83590ac0-88d3-4d5e-b9d3-888a2b15db49
  modified: 2026-09-24T03:57:40.090Z
---

**Vigente desde la noche del 2026-09-23: el código revisado se publica sin preguntar** (push, PR, CI verde,
merge, esperar `/api/version`). El dueño, literal: *«cuando termines push todo sin necesidad que te lo diga»*.

**Sigue necesitando su sí explícito:** aplicar una migración en producción (además el clasificador de modo auto
lo niega: se le pide que la corra él con `!`), escrituras de datos en producción (como reparar fechas) y
cualquier acción destructiva.

Historia, sin borrar: esa misma mañana había pedido «pídeme confirmación antes de cualquier acción destructiva o
de hacer push/deploy», «para todo el proyecto» (tras el cambio en bloque de 162 órdenes,
[[sin-valor-anterior-no-hay-deshacer]]). Eso reemplazó a [[push-y-merge-sin-pedir]]. Por la noche dijo «aplica
todo» a una tanda y luego lo de arriba.

**Why:** quiere que lo aprobado llegue sin que él tenga que dar un clic por cada publicación; lo que le importa
controlar es lo irreversible sobre datos.

**How to apply:** revisar y medir sigue siendo obligatorio antes de publicar —publicar sin preguntar no es
publicar sin revisar. Contar deploys de Vercel ([[vercel-100-deploys-al-dia]]) y agrupar cuando se pueda.
