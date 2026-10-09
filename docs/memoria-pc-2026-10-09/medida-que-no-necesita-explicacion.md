---
name: medida-que-no-necesita-explicacion
description: "Si el número medido necesita una frase que lo explique, es que el comando estaba mal acotado."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 39114734-431c-4e44-a77a-198be3f67540
  modified: 2026-09-10T16:27:26.212Z
---

Conté `git diff … | grep -c '^-'` y salió **1**, y escribí que ese 1 era la
cabecera `--- a/`. El auditor midió lo mismo con `grep -c '^-[^-]'` y salió
**0**, sin explicación adjunta.

**Por qué:** un número que llega con una nota al pie obliga al que lee a
creerse la nota. Si la nota es falsa —o si el 1 hubiera sido una línea borrada
de verdad— el error pasa igual, porque la explicación tapa el dato en vez de
comprobarlo. La forma del comando es parte de la afirmación.

**Cómo aplicarlo:** antes de acompañar una cifra de un «ese uno es X», ajustar
el patrón para que la cifra salga limpia. Vale también al revés: si no consigo
acotarlo, decir en qué no confío, no adornar el número. Emparejado con
[[auditoria-no-es-medicion]] y [[dato-correcto-conclusion-falsa]].
