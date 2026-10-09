---
name: revertir-toca-tres-entradas
description: "Revertir una decisión deja mintiendo a la que ELLA había reemplazado; la nota va en las dos, no solo en la que se revierte."
metadata:
  node_type: memory
  type: feedback
  originSessionId: 9d5602ef-8669-4169-abbc-3d0b12686868
  modified: 2026-09-24T01:09:01.677Z
---

Cuando una decisión reemplaza a otra, la vieja se queda con una nota dentro:
*«⚠ Reemplazada por D-356»*. Si mañana se revierte D-356, esa nota **pasa a ser
falsa** y nadie la mira: la revisión natural es abrir la entrada que se revierte,
ponerle su nota, y darlo por hecho.

Medido el 2026-09-23. La cadena era D-239 → reemplazada por D-356 → D-356
revertida al día siguiente. Tres entradas, no una:

1. La **nueva**, que cuenta qué se hace y por qué.
2. La **revertida** (D-356), con su nota dentro, **en el mismo commit que la
   revierte** — si no, hay una ventana en la que el repo dice lo contrario de lo
   que hace el código.
3. La que la revertida había reemplazado (D-239): una nota nueva diciendo que
   *esa sustitución se deshizo* y que **vuelve a estar vigente**. La nota vieja se
   deja donde está, porque pasó.

**Why:** el historial no se borra, así que una nota caducada no desaparece: se
queda ahí pareciendo vigente. Quien llegue sin contexto lee D-239, ve
«reemplazada» y la descarta — que es exactamente la decisión que sí manda.

**How to apply:** al revertir, `grep` del número que se revierte en todo
`DECISIONS.md`, no solo su propia entrada, y mirar a quién dice reemplazar. Vale
igual para el código: [[d-next-tambien-en-el-codigo]]. Y la premisa que falló en
D-356 conviene escribirla en su nota —allí era «con la ventana se pierde lo
programado a futuro», y era falso porque la ventana no tiene techo—, porque un
número solo dice qué cambió, no por qué se creyó lo que se creyó:
[[premisa-heredada-no-es-medicion]].
