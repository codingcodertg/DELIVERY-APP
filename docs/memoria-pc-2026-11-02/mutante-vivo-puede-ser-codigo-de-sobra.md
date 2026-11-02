---
name: mutante-vivo-puede-ser-codigo-de-sobra
description: un mutante que sobrevive es código de sobra o una prueba floja; preguntar cuál antes de escribir una prueba a medida
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 39114734-431c-4e44-a77a-198be3f67540
  modified: 2026-09-18T02:28:49.364Z
---

Cuando un mutante sobrevive, el reflejo es «me falta una prueba». Son dos casos
distintos y conviene separarlos antes de teclear:

1. **Código de sobra.** Ese código no cambia nada, y por eso nada cae: ordenar
   una lista que quien la consume vuelve a ordenar, vaciar un campo que la
   comprobación de dos líneas más abajo ya vacía. Se **borra**.
2. **Prueba floja.** El comportamiento sí importa, pero la prueba no lo mide:
   miraba que el nombre de una función apareciera en el fichero, y escondida
   tras un `if (false)` seguía apareciendo. Se **aprieta la prueba**.

**Por qué importa la diferencia:** escribirle una prueba a medida al caso 1 fija
un comportamiento que nadie observa —verde para siempre, y la línea sobrante
sigue ahí pareciendo que cumple algo—. Y borrar código en el caso 2 quita
funcionalidad de verdad.

**Cómo se decide:** *«¿quién notaría esto si lo borro?»*. Nadie → sobra. Alguien
→ faltaba la prueba.

Medido el 2026-09-17, tres veces en un día: el `sort` redundante de
`vendedoresDeLaTienda` (borrado), la prueba de los proveedores que solo miraba
el nombre de `faltaParaAnular` (apretada), y el bloque de `aplicaTipo` que
vaciaba la recogida que el colapso de D-276 ya vaciaba (borrado; después el
mutante del colapso tiraba dos pruebas en vez de una). Los tres salieron de
tandas normales, no de buscarlos.

Relacionado: [[tanda-de-mutantes-se-lee-por-nombre]],
[[arreglo-que-parece-hecho]].
