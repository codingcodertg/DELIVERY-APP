---
name: numero-copiado-no-se-recuenta
description: Un número que se escribe en más de un sitio se copia del primero; la copia no la recuenta nadie.
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 39114734-431c-4e44-a77a-198be3f67540
  modified: 2026-09-14T20:56:40.051Z
---

Cuando un número describe algo que el código ya tiene —cuántas columnas expone
una función, cuántos ficheros toca una regla—, se cuenta **una vez** y a partir
de ahí se copia a la entrada, al comentario, al título de la prueba y a los
mensajes. Ninguna de esas copias se vuelve a contar, así que un error inicial
viaja entero y con aire de medido.

**Why:** el 2026-09-14 escribí que `public.phone_book()` expone «siete
columnas». Son **ocho**: la enumeración se dejaba fuera `store_rank`. El número
equivocado acabó en el título de la decisión, en su cuerpo, en la cabecera del
`.sql`, en el `comment on function`, en el título de la prueba y en dos mensajes
a otras sesiones. La prueba **sí** las afirmaba una por una, o sea que medía
bien lo que su título contaba mal, y aun así nadie lo notó hasta que el auditor
las contó por su cuenta.

**How to apply:** el número se saca del artefacto, no de la cabeza: cuando la
prueba ya lo enumera, el título se escribe mirando esa lista. Y cuando el mismo
número aparezca en varios sitios, buscarlo antes de cerrar (`grep` de la cifra y
de su palabra) para que las copias digan lo mismo — si una discrepa, el bueno es
el que está más cerca del código. Corregirlo con una nota dentro de la entrada,
no reescribiendo, y decir quién lo contó.

Relacionado: [[dato-correcto-conclusion-falsa]] y [[medida-que-no-necesita-explicacion]].
