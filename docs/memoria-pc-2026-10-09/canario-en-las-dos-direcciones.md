---
name: canario-en-las-dos-direcciones
description: "Al rebasar, mirar también si mi rama rompe las pruebas globales que dejó en main la rama ya fusionada."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 39114734-431c-4e44-a77a-198be3f67540
  modified: 2026-09-10T16:36:43.341Z
---

Al rebasar comprobé que la rama recién fusionada no rompía **mi** prueba
global. El auditor midió la dirección contraria: mi rama toca tres `.tsx`, y
la rama fusionada dejó en `main` su propio canario que recorre todos los
`.tsx`. Aguantaba, pero yo no lo había mirado.

**Por qué:** en este repo varias pruebas cuentan ocurrencias sobre todo
`src/**/*.tsx` en vez de sobre un fichero. Cada merge añade una de esas, así
que la pregunta deja de ser «¿lo nuevo me rompe?» y pasa a ser simétrica. Con
ramas en paralelo el fallo aparece en verde local y rojo en CI, que es el peor
sitio para enterarse.

**Cómo aplicarlo:** en cada rebase, listar lo que tocó la rama fusionada
(`git diff --name-only <squash>^ <squash> -- src`) **y** lo que toca la mía, y
correr los conteos de los canarios de ambas sobre las dos puntas. El `verify`
completo lo cubre de paso, pero la medición explícita es la que dice por qué
pasó. Emparejado con [[medida-que-no-necesita-explicacion]] y
[[auditoria-no-es-medicion]].
