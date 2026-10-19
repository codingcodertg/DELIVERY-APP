---
name: linea-base-implausible
description: "antes de llamar regresión a una caída, comprobar si el número viejo era creíble; puede que lo roto fuera la línea base"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 82a444c4-d068-486f-a40b-3e73b61f92ca
  modified: 2026-10-10T21:00:31.826Z
---

El contador de teclas del Time Tracker cayó de **632.390** a **847** y lo primero que escribí fue
que «el monitor de teclado murió». Dos medidas lo desarmaron: 632.390 en 9 h 18 son **18,9 teclas
por segundo sostenidas**, que no las teclea nadie; y el `app.asar` instalado **no menciona
`uiohook-napi`** (0 coincidencias) ni trae su binario, que es de donde el repo saca el conteo
global. O sea que el número alto nunca fue creíble y la caída puede ser una **corrección**.

**Por qué importa:** una caída grande se lee como regresión por reflejo, y entonces se busca «qué se
rompió» en vez de «qué era esto antes». Si la línea base era el bug, toda la investigación va al
sitio equivocado — y peor, se le reporta al dueño una avería que no existe.

**Cómo aplicarlo:** antes de construir encima de un delta, preguntarle al número viejo si es
físicamente posible (divídelo por el tiempo y mira la unidad). Y comprobar si el binario o el
despliegue que produjo el número viejo es el mismo que el de ahora: aquí el app instalado era de
agosto, anterior al código legible. Hermano de [[dato-correcto-conclusion-falsa]] y de
[[apk-publicado-es-lo-que-corre]].
