---
name: tsc-despues-de-la-prueba
description: "vitest no comprueba tipos; correr tsc antes de escribir la prueba no mide la prueba, y CI sale rojo por el fichero de prueba"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 82a444c4-d068-486f-a40b-3e73b61f92ca
  modified: 2026-10-10T22:15:59.082Z
---

Corrí `npx tsc --noEmit` justo después de implementar, salió limpio, y **después** escribí el
fichero de prueba. Las 15 pruebas pasaron en vitest, así que lo dí por bueno. Al volver a correr
tsc por otro motivo salieron **10 errores, todos en el fichero de prueba**: datos construidos como
`{ stage: "ready" }` donde el parámetro pide `Stage`, `Partial<Delivery>` donde la firma exige la
etapa obligatoria, y tipos escogidos con `Pick` que piden campos que el `Partial` deja opcionales.

**Por qué:** vitest **no comprueba tipos**, los borra. Un fichero de prueba puede estar verde y no
compilar. Y CI corre `tsc · vitest · build`, así que lo caza — tarde, con el PR ya subido.

**Cómo aplicarlo:** el `tsc` vale después del **último** fichero tocado, y los de prueba son los
últimos casi siempre. Si tengo que elegir un solo momento: justo antes de `git add`. Lo mismo le
pasó a `inline-colors.test.ts` el mismo día por otra vía —corrí solo las pruebas de la carpeta en
que trabajaba y esa recorre todo `src`—, así que la regla general es: lo que corre CI, córrelo
entero antes de subir, no la parte que creo que toqué. Pariente de
[[comprobar-la-edicion-no-el-comando]] y de [[canario-en-las-dos-direcciones]].
