---
name: hallazgo-de-paso-se-barre-entero
description: "Un fallo que aparece de paso mientras miras otra cosa no está cerrado hasta que se barre su patrón en todo src; si no, la entrada dice algo falso."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 9d5602ef-8669-4169-abbc-3d0b12686868
  modified: 2026-09-23T18:09:26.568Z
---

Cuando encuentro un fallo **de paso** —mirando un fichero por otra razón— la
tentación es arreglar los que tengo delante y contarlo como cerrado. **No lo
está.**

**La regla, afinada por el orquestador el 2026-09-23 y que es más fuerte que como
la escribí:** cuando el arreglo es de una **forma** y no de un **sitio**, el
barrido mecánico va **antes de tocar nada**, no antes de escribir la entrada. Y
lo que cierra el asunto es **la prueba que recorre el árbol**, nunca la lista de
sitios. Le ha costado al proyecto tres vueltas seguidas: **D-355 → D-362 →
D-363**, cada una arreglando lo que tenía delante.

**Why:** el 2026-09-23 encontré tres `Math.round` de pallets a entero leyendo
`analytics.ts` por otra cosa, los arreglé y la entrada dijo que cerraba el resto
de D-362. **Eran seis**, y tres seguían vivos — uno **ocho líneas debajo** de uno
que sí arreglé, y otro en la pantalla del chofer, la que más se mira. Los
encontró el orquestador. Es el mismo fallo que D-362 documenta de D-355
(«arreglaba un sitio y el fallo era de sumar»), repetido por quien lo estaba
citando. Con tres vivos, la entrada era falsa y el siguiente que abriera el
fichero habría creído que estaba barrido.

**How to apply:**
- Antes de escribir «cierra X», correr el barrido del **patrón** en `src` entero
  y pegar el resultado. Lo que encontré leyendo no es el inventario.
- Y dejar una **prueba de puerta** que recorra `src` y exija **cero**, no una
  lista de sitios: la lista la vuelve a dejar corta el siguiente. Se comprueba
  con tres mutantes — devolver uno de los arreglados, el mismo con paréntesis
  anidados, y **un sitio nuevo en un fichero que nadie ha tocado**.
- La regla de la puerta se escribe **por línea entera**, no por estructura de
  paréntesis: mi primera versión exigía la palabra dentro del `Math.round(` y el
  `[^)]*` se paraba en el `)` de un `Number(` interior. Ver
  [[grep-de-una-linea-no-ve-la-estructura]] y [[residuo-no-es-quedo-fuera]].
