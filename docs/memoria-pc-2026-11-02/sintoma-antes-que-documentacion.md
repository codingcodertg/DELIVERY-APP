---
name: sintoma-antes-que-documentacion
description: "Tres decisiones (D-599, D-604, D-608) para un compositor de RingCentral vacío; la causa era un parámetro mal nombrado (`text` → `content`) que la documentación oficial decía desde el principio. Ante una integración externa que «no hace nada», leer su referencia antes de tocar el gesto, el largo o el portapapeles."
metadata:
  node_type: memory
  type: feedback
  originSessionId: 83590ac0-88d3-4d5e-b9d3-888a2b15db49
  modified: 2026-10-20T15:43:35.581Z
---

2026-10-19/20: el dueño dijo tres veces que el texto no llegaba a RingCentral. Primero arreglé el orden (abrir en el clic, D-599), luego el largo con portapapeles (D-604), y solo a la tercera busqué la referencia de esquemas URI: el parámetro del mensaje es `content`; `text` no existe. Dos releases que atacaron síntomas plausibles pero no medidos, y una premisa heredada de D-581 («el de ¿te puedo llamar? sí aparece») que nunca se había verificado.

**Why:** una hipótesis plausible se parece a una medición; y una API externa no avisa de un parámetro desconocido: lo ignora.

**How to apply:** cuando algo externo (esquema URI, API, webhook) «abre pero no hace nada», el primer paso es su documentación o un `WebSearch` del esquema exacto, antes de cualquier arreglo en mi lado; y una afirmación de «esto sí funciona» que sostiene el diagnóstico se mide o se marca como no verificada. Ver [[premisa-heredada-no-es-medicion]] y [[comprobar-la-capa-que-manda]].
