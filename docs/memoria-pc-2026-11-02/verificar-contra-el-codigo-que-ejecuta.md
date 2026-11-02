---
name: verificar-contra-el-codigo-que-ejecuta
description: "Para afirmar cómo se comporta una herramienta, leer el código que va a ejecutarse, no su documentación."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 83590ac0-88d3-4d5e-b9d3-888a2b15db49
  modified: 2026-09-09T04:48:58.467Z
---

Cuando haya que afirmar qué hace una herramienta o dependencia, la fuente es
**el código que va a ejecutarse** —el `node_modules` que compila, el fichero de
la versión instalada—, no la página de documentación. La documentación describe
lo que se pretendía; el fichero hace lo que va a pasar.

**Why:** el 2026-09-08, para saber si renombrar la app de escritorio dejaría dos
instalaciones, la documentación de electron-builder estaba caída (una URL vacía,
otra 404). Leer `NsisTarget.js` del propio proyecto dio la respuesta exacta y
mejor: la clave de desinstalación deriva del `appId`, no del nombre del
producto. Y enseñó una puerta que la documentación no habría destacado —
`options.guid ||`, que gana sobre el valor derivado — o sea, un segundo sitio
que vigilar.

**How to apply:** ante una duda sobre comportamiento de una dependencia, ir
primero a su fuente en el repo. Y cuando exista una huella del comportamiento en
la máquina real —una clave del registro, un fichero generado, una fila en la
base—, cruzarla con el código: el código dice qué debería pasar, la huella dice
qué pasó. Ver [[auditoria-no-es-medicion]].
