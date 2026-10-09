---
name: arreglo-de-forma-se-barre-antes
description: cuando el arreglo es de una FORMA y no de un sitio, el barrido mecánico va antes de tocar nada, y el mutante que vale se mete donde la rama no toca
metadata:
  type: feedback
---

Tres vueltas seguidas con el mismo fallo: **D-355** arregló un sitio, **D-362** encontró quince y
arregló cuatro, **D-363** (2026-09-23) cerró los seis que quedaban — uno de ellos era la pantalla del
chofer («Viaje 1 · 0 pallets» con cuatro órdenes de 0,1) y otro el resumen que se publica en Notion,
que imprimía «4.430000000000001». En la última vuelta el worker arregló tres sitios que había visto
leyendo por otra cosa, y yo encontré tres más con un `grep`; él mismo lo dijo: «arreglé lo que estaba
mirando y nunca barrí el patrón».

**Why:** un fallo de forma —sumar suelto, redondear a mano, una regla copiada— no vive en un sitio,
vive en todos los que nadie ha mirado. Arreglar los que se ven deja una entrada que afirma haber
cerrado algo y un fichero que parece barrido, y eso es peor que no tocarlo: el siguiente confía.

**How to apply:** en cuanto el arreglo sea de una forma, el barrido mecánico va **antes de tocar
nada**, no antes de afirmar que cierra. Lo que cierra el asunto no es la lista de sitios sino **una
prueba que recorre el árbol entero** y falla con uno nuevo. Y el mutante que la valida se mete **en
un fichero que la rama no toca**: reintroducirlo donde ya arreglaste solo prueba que la prueba ve lo
que ya viste — ese matiz me lo devolvió el worker sobre mi propia verificación. Ojo con la regla de
la prueba: la primera versión de aquélla exigía «pallets» dentro de los paréntesis del `Math.round`
y el `[^)]*` se paraba en el `)` de `Number(`; una regla por línea entera no tiene esa trampa
([[grep-de-una-linea-no-ve-la-estructura]]). Y una puerta escrita sobre una grafía no cubre la
variante sin ella: la de pallets no caza un total que se pinte crudo sin `Math.round`.
Ver [[tanda-de-mutantes-se-lee-por-nombre]] y [[dato-correcto-conclusion-falsa]].
