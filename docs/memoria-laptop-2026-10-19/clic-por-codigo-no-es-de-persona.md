---
name: clic-por-codigo-no-es-de-persona
description: medir una pantalla con clics sintéticos inventa fallos que nadie puede provocar; el elemento tiene que estar a la vista
metadata:
  type: feedback
---

Conduciendo el navegador, un `.click()` sobre un elemento **fuera de la pantalla** abre menús donde una persona no podría
abrirlos. El 2026-09-23 así reporté «el menú de filtrar abre fuera de pantalla, con Aplicar 226 px por debajo del borde»: era
mi herramienta pulsando una cabecera que estaba a 1048 px en una ventana de 900. Abriéndolo como se abre de verdad, cabía.
El fallo real era otro —«Aplicar» se iba con el desplazamiento **dentro** del menú cuando la columna tenía 45 valores—, y lo
encontré solo al medir bien.

**Why:** un informe con un fallo inventado cuesta más que uno con un fallo de menos: el orquestador manda arreglar algo que no
está roto, y lo que sí lo estaba sigue ahí. Además quema la credibilidad del resto del informe, que sí estaba medido.

**How to apply:** antes de pulsar, traer el elemento a la vista (`scrollIntoView({block:"center"})`) y comprobar que su caja
cae dentro de la ventana; si no cabe ni así, ESO es el hallazgo. Y al medir si algo «se ve», compararlo con la caja de su
contenedor con desplazamiento propio, no solo con la ventana: un botón dentro de un menú que hace scroll está fuera de vista
aunque sus coordenadas caigan en la pantalla. Mismo día, misma tanda: contar «9 casitas» que eran los 9 ancestros de UN icono,
por contar sobre `*` en vez de sobre los elementos que son la marca. Ver [[herramienta-cdp-sin-dependencias]] y
[[dato-correcto-conclusion-falsa]].
