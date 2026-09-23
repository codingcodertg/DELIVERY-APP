---
name: prueba-de-texto-no-fija-el-orden
description: "Una prueba sobre el texto de un .sql no debe fijar el orden de un `and`/`or` ni los espacios; el gemelo con los operandos al revés lo destapa, y la prueba se corre sola antes que el gemelo."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 9d5602ef-8669-4169-abbc-3d0b12686868
  modified: 2026-09-17T15:50:20.166Z
---

Al probar la forma de una condición SQL leyendo el `.sql` (`q.admin or … or (a and b)`), comparar
**conjuntos normalizados**, no cadenas: separar por `or`/`and`, normalizar espacios
(`replace(/\s+/g, " ")`) y ordenar. Un `and` es conmutativo, y fijar el orden hace caer reescrituras
correctas.

**Por qué:** pasó tres encargos seguidos el 2026-09-17 (categorías, roles, roles por app). Las tres
veces lo destapó el **gemelo** —la misma regla con los operandos al revés—, y una vez el primer gemelo
solo cambiaba espacios, así que no destapó nada. La tercera, al arreglarlo, olvidé normalizar los
espacios internos y la prueba **fallaba también sin mutante**: no la había corrido sola antes del gemelo.

**Cómo aplicarlo:** el gemelo de una condición es **el orden de los operandos**, no el espaciado.
Después de tocar una prueba, **correrla sola en verde** y solo entonces el gemelo y la tanda; y si la
prueba cambiada es la que caza varios mutantes, repetir la tanda entera. Ver
[[tanda-de-mutantes-se-lee-por-nombre]] y [[arreglo-que-parece-hecho]].
