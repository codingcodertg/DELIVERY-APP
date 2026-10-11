---
name: datos-que-no-contradicen
description: Una prueba de ordenación con datos ya ordenados pasa igual con la implementación equivocada.
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 39114734-431c-4e44-a77a-198be3f67540
  modified: 2026-09-14T20:56:23.137Z
---

Cuando una prueba comprueba **un orden, una prioridad o una preferencia**, los
datos tienen que hacer que las dos reglas candidatas den resultados
**distintos**. Si con esos datos ambas dan lo mismo, la prueba pasa en verde con
la implementación equivocada y no dice nada.

**Why:** el 2026-09-14, en el directorio de la compañía, la regla era «las
tiendas en el orden de Ajustes, no alfabético». Mi prueba usaba Brownsville con
rango 0 y McAllen con rango 1 — o sea que el orden de Ajustes **coincidía con el
alfabeto**. Un mutante que ordenaba por nombre la dejó en verde. La cacé solo
porque corrí el mutante; leyéndola parecía perfecta, y su nombre («manda el
orden de Ajustes, no el alfabeto») afirmaba justo lo que no comprobaba.

**How to apply:** al escribir la prueba, nombrar las dos reglas que compiten
—orden guardado contra alfabeto, fecha contra inserción, rol contra nombre— y
elegir datos donde **se contradigan**. Y dejarlo escrito en el test, porque el
día que alguien «ordene» las fixtures para que se lean mejor, las está
desactivando. El mutante es lo que lo demuestra: si romper la regla no tira la
prueba, los datos son el problema, no el código.

Relacionado: [[arreglo-que-parece-hecho]] y [[regla-prueba-espejo]].
