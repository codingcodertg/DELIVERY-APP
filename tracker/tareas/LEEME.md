# Estos ficheros son una FOTO, no la verdad

**Congelados el 2026-09-24.** Desde la migración 144, las tareas viven en
`public.tracker_tareas`, en la base del RTG, y ahí es donde el dueño pulsa «Completado».

**Nada vuelve a escribir esta carpeta.** No es un acuerdo: en el código no existe ninguna función
que lo haga. `tracker/fuente.mjs` solo sabe leerla.

## Por qué no se borró

Son **las palabras del dueño**. En git se revisan en un diff, se pueden buscar sin conexión y
sobreviven a que alguien borre una fila por error. Borrar la carpeta habría cambiado «dos fuentes que
se desincronizan» por «ninguna copia si la base se equivoca».

Lo que evita las dos fuentes no es borrar esta: es que **nadie pueda escribirla**.

## Para qué sirve todavía

- **Leer sin conexión y sin llaves.** `node tracker/cli.mjs list` en un worktree funciona, y avisa de
  que está leyendo la copia.
- **El hook de contexto** (`hook-contexto.mjs`) busca aquí a propósito: tiene que contestar en
  milisegundos y no puede colgarse esperando a la red. Lo que enseña es una **pista** —«esto ya se
  pidió»— y una pista de hace unos días sigue sirviendo. Lo que manda es la base.
- **Volver atrás.** Si la 144 se revierte, aquí está todo lo que había el día de la mudanza.

## Lo que NO sirve

- **Contar.** Un recuento de aquí es el del 24 de septiembre, no el de hoy.
- **Saber qué está «Completado».** Ese estado nació con la base; aquí no hay ninguno.
