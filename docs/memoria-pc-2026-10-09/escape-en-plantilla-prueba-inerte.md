---
name: escape-en-plantilla-prueba-inerte
description: "Una secuencia de escape de regex dentro de una plantilla JS no llega a la regex: la prueba `not.toMatch` pasa siempre."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 39114734-431c-4e44-a77a-198be3f67540
  modified: 2026-09-15T21:14:57.942Z
---

Dentro de una plantilla normal de JavaScript, la barra invertida se procesa
**antes** de que la cadena llegue a `new RegExp`. La secuencia de límite de
palabra se convierte en el carácter retroceso (U+0008), así que la expresión no
busca lo que parece. Con `toMatch` la prueba fallaría y se notaría; con
`not.toMatch` **pasa siempre**, y nada lo delata.

**Why:** el 2026-09-15, en la migración 109, la prueba «la función no expone
columnas de puertas adentro» recorría seis nombres con `not.toMatch(new
RegExp(…))` en una plantilla. Pasaba con cualquier cuerpo. Mi mutante de la
columna privada sí cayó, pero **por otra prueba** —la de las ocho columnas en su
orden—, y lo di por cubierto. Lo midió el auditor con `node`: el primer código de
la expresión era 8, y no casaba con un cuerpo que contenía la columna.

**How to apply:** para construir una regex desde una plantilla, `String.raw`
(que además no añade barras nuevas, útil cuando el shell se las come). Y lo que
lo habría cazado antes: al correr un mutante, **mirar qué prueba cae**, no solo
que caiga alguna. Si el mutante está pensado para una prueba y cae por otra, la
suya está muerta. El mutante bueno es el que solo esa prueba puede detectar —aquí,
una columna privada que no cambia la firma.

Relacionado: [[arreglo-que-parece-hecho]] y [[datos-que-no-contradicen]].
