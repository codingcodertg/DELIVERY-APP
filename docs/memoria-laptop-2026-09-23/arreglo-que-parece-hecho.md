---
name: arreglo-que-parece-hecho
description: "Un arreglo que compila, se lee bien y no hace nada es peor que ninguno, porque cierra la pregunta."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 39114734-431c-4e44-a77a-198be3f67540
  modified: 2026-09-12T04:04:59.585Z
---

El fallo más caro de una rama no es el que rompe: es el que **parece arreglado**. Compila, se
lee bien, pasa el verify, y no hace nada. Y además cierra la pregunta, así que nadie vuelve.

Tres de la misma tarde, todos cazados por contraste y no por lectura:

- **Comparar un rol contra la fuente equivocada.** `clockin.profiles` es una **vista** que deriva
  `owner`; el cliente tiene la columna cruda, con otros valores. `exentoDelCierre({ fichaje:
  me.role })` daba `false` siempre. Regla: un rol se compara contra la fuente que lo produce; si
  una vista lo deriva, el cliente no lo tiene aunque la variable se llame igual.
- **Vaciar una caché sin disparar el reintento.** Deja el sitio libre y nadie vuelve a ocuparlo:
  `setX(null)` sobre un estado que ya es `null` no re-renderiza. Mirar las **dependencias del
  efecto** antes de dar el arreglo por bueno.
- **Un `grep` que se muerde a sí mismo.** El comentario que explica por qué una cadena no puede
  estar la nombraba, así que el recuento seguía en 1. Un fichero que no puede contener una cadena
  tampoco puede nombrarla.

**Cómo se cazan:** medir el **antes y el después** del arreglo, no leerlo. Un mutante que lo
deshaga tiene que hacer caer una prueba; si no cae ninguna, el arreglo no está probado y puede que
tampoco esté. Ver [[dato-correcto-conclusion-falsa]] y
[[verificar-contra-el-codigo-que-ejecuta]].
