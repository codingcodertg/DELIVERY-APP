---
name: ancla-de-texto-sobrevive-al-mutante
description: un ancla que comprueba que la llamada está en el texto no cae con un mutante que deja la llamada en el texto; hay que fijar el discriminador
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 82a444c4-d068-486f-a40b-3e73b61f92ca
  modified: 2026-10-10T20:56:39.572Z
---

Un ancla de texto que comprueba `expect(tramo).toContain("stopRef.current()")` **no cae** con el
mutante que cambia `if (accion.tipo === "sigue")` por `if (true)`: la llamada sigue estando en el
fichero, solo que ya nunca se alcanza. El mutante quedó vivo y la prueba parecía cubrirlo.

Lo que sí lo caza: fijar el **texto exacto del discriminador** (`'if (accion.tipo === "sigue") {'`)
y el **orden** de los dos caminos (`indexOf` del uno mayor que el del otro).

**Por qué:** este repo corre vitest en `environment: "node"` y no tiene jsdom ni testing-library,
así que un componente de React no se puede renderizar y el cableado solo se puede probar leyendo el
fuente. Un ancla así mide *presencia*, no *comportamiento* — y la presencia sobrevive a casi
cualquier mutante que no borre líneas.

**Cómo aplicarlo:** cuando la prueba de un componente sea un ancla de texto, escribir el mutante que
*conserva* el texto y cambia la decisión, y comprobar que algo cae. Si no cae, el ancla tiene que
apuntar al condicional, no a la llamada. Y decir en la decisión que es un ancla de texto, con su
motivo: lo visto en [[tanda-de-mutantes-se-lee-por-nombre]] y
[[escape-en-plantilla-prueba-inerte]] es el mismo género de prueba inerte.
