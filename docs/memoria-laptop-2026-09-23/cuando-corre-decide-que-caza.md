---
name: cuando-corre-decide-que-caza
description: "Antes de añadir una comprobación, medir si la que ya existe la cubre; y mirar en qué momento corre, que es lo que decide qué puede cazar."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 9d5602ef-8669-4169-abbc-3d0b12686868
  modified: 2026-09-18T20:50:03.784Z
---

Cuando pidan «añade esta comprobación también aquí», **medirlo antes de
escribirlo**: romper el dato de verdad y correr cada paso a ver cuál falla. El
2026-09-18 el cuarto paso pedido para `verify.mjs` y CI era **redundante al
100 %** — la prueba de vitest ya ejecuta ese script sobre el fichero real, y
`vitest` es el paso 2 de los dos sitios. La rama no se hizo.

**Y la pregunta que de verdad importa es CUÁNDO corre cada cosa.** CI y
`verify.mjs` corren sobre algo ya commiteado; el fallo que se quería atajar
—`git merge` empalmando `DECISIONS.md`— nace **al resolver el conflicto**, antes
de todo eso. Añadir el paso donde ya estaba cubierto no habría cazado ninguno de
los dos incidentes reales; eso vive en un hook, o en una regla escrita.

**De paso:** una prueba que **ejecuta** el script (en vez de copiar sus reglas)
cubre las dos direcciones — si borras el script, la prueba cae también; medido.
Emparenta con [[regla-prueba-espejo]] y [[tanda-de-mutantes-se-lee-por-nombre]].
