---
name: formato-por-digitos-come-texto
description: un formateador que cuenta dígitos tira el texto pegado al número; mirar las muestras del barrido antes de escribir
metadata:
  node_type: memory
  type: feedback
  originSessionId: 83590ac0-88d3-4d5e-b9d3-888a2b15db49
  modified: 2026-10-22T03:43:05.284Z
---

`telefonoEstandar` contaba dígitos: «956-246-6915 - Viya, A/P» tiene 10 y salía «(956) 246-6915»; el «Viya, A/P» se perdía. Lo vi en los ejemplos que imprime el barrido en modo «ver» de clientes (D-635, 2026-10-21): 106 filas con nombre o nota pegados. Desde D-635, un teléfono con letras no se toca.

**Why:** dos barridos ya habían corrido con esa función (candidatos y órdenes). No perdieron nada solo porque sus datos no tenían letras, y eso lo comprobé en los respaldos después, no antes.

**How to apply:** antes de cualquier `--escribe`, leer las muestras del modo «ver» buscando qué se pierde, no solo qué cambia. Y en un formateador, «lo que no reconozco se queda igual» tiene que cubrir también lo que lleva texto. Ver [[sin-valor-anterior-no-hay-deshacer]].
