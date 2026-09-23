---
name: prueba-alimentada-por-quien-llama
description: "Una prueba de una decisión se alimenta de lo que produce quien la llama, no de lo que la decisión sabría contestar."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 39114734-431c-4e44-a77a-198be3f67540
  modified: 2026-09-18T15:12:41.662Z
---

Escribí una prueba de `decisionReabrir` dándole una fila **ya cerrada con la nota de cierre
puesta**. La función contestaba «reabrir» y la prueba pasaba. Pero **la pantalla nunca produce esa
entrada en ese punto**: le pasa la fila **viva**, con el `live_note` del último latido, y la nota
de cierre la escribe ella dos líneas más abajo. O sea que el arreglo no se ejecutaba en ninguna
carga real y la prueba lo tapaba.

**La regla:** una prueba de una decisión se alimenta de **lo que produce quien la llama**, no de
lo que la decisión sabría contestar. Si hay que inventar la entrada para que la prueba pase, la
entrada probablemente no existe.

**Cómo se comprueba en un minuto:** el mutante que devuelve la condición vieja tiene que caer
**con la entrada real**. En este caso pasó de caer **cero** pruebas a caer **siete**; esa
diferencia es la prueba de que la prueba sirve.

**Variante peor, y me pasó el 2026-09-18:** probar **una pieza de la decisión** cuando la decisión
está repartida entre esa pieza y el llamante. `tiendasDeLaOrden` devuelve `[store]` en una orden de
cliente —correcto para la cola de almacén— y el tablero de ventas le sumaba «solo si es tienda a
tienda»… **en el comentario, no en el código**. Escribí una prueba que decía «en una orden de cliente
solo cuenta la que vende» y afirmaba `true`: **cierta sobre la pieza, y ese `true` era el defecto**.
Un vendedor veía las órdenes de sus compañeros de tienda. Ninguna prueba miraba dónde se decidía.

Cuando una decisión vive medio en una función y medio en el llamante, **no hay prueba honesta de la
pieza**: hay que juntarla en una función con nombre (`ventasVeLaOrden`) y probar esa, con datos. Si
una prueba afirma un valor que solo es correcto *dentro de un contexto*, el contexto tiene que estar
en la prueba o la prueba miente.

Es la misma familia, vista desde otros ángulos:
- Comparar cadenas en un solo idioma habría pasado con el fallo dentro.
- Fijar `void` en vez de «no bloquea» consagraba la duda: la prueba protegía la implementación.
- Y [[arreglo-que-parece-hecho]], que es el resultado de las tres.

Ver también [[regla-prueba-espejo]]: si lo que decide acaba en la base, se importa la función.
Esta regla es la otra mitad — importar la función no basta si se le da de comer algo que nadie
le da.
