---
name: el-maximo-no-dice-que-este-todo
description: "MAX(id) mide dónde acaba una tabla, no si está completa; para «cuánto falta» hay que sacar la lista y buscar los huecos."
metadata:
  node_type: memory
  type: feedback
  originSessionId: 9d5602ef-8669-4169-abbc-3d0b12686868
  modified: 2026-09-24T02:24:57.693Z
---

Preguntar por el **máximo** de una columna de ids y restar contesta «hasta dónde
llega», no «cuánto hay». Son la misma respuesta solo si la serie es continua, y
eso es justo lo que no se ha comprobado.

Medido el 2026-09-23. El espejo de `DECISIONS.md` en Notion: `MAX(ID)` daba
**D-308**, el repo iba por D-372, y escribí «faltan 64». La lista entera dice otra
cosa: **94 filas**, D-001 a D-088 seguidas y luego D-303 a D-308, con **nada entre
medias**. Faltaban **276**. Y las seis de arriba las había creado alguien a mano,
así que hasta la fecha «más reciente» apuntaba al sitio equivocado.

**Why:** el número estaba bien medido y aun así el informe era falso por un factor
de cuatro. Es [[dato-correcto-conclusion-falsa]] con una consulta en medio: la
consulta da autoridad al número y esconde que la pregunta no era esa. Y un valor
raro en la punta —seis filas sueltas 200 números más allá— es señal de un parche
manual, no de que el proceso llegara hasta ahí.

**How to apply:** para «cuánto falta», `group_concat` o `COUNT(*)` y comparar
contra la lista de origen; nunca `MAX` menos `MIN`. Y contar el origen de verdad
antes de restar: aquí el repo tenía **370** entradas y no 372, porque D-124 y
D-178 nunca existieron. Ver [[numero-copiado-no-se-recuenta]].
