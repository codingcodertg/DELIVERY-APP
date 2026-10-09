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

---

**2026-09-23 — la variante más limpia, y la de método: la función está PERFECTA y el fallo está en
el argumento.**

`cambioEnBloque` conservaba la nota si no se la daban, con sus pruebas y sus mutantes en verde. Pero
los botones de ✓/✕ de la pantalla le pasaban `f.nota` —la copia que esa pantalla había leído— y eso
es una **escritura perdida**: pisa la nota que otra persona escribiera mientras. La función no tenía
ni un fallo. El fallo era la llamada.

**Lo que lo destapó no fue leer: fue un mutante que sobrevivió.** Mi tanda mutaba **solo el módulo
puro**, así que medía solo el módulo puro y decía «todo cubierto». Al meter un mutante **en la
pantalla** —devolver el tercer argumento a la llamada— no cayó ninguna prueba.

**Cómo aplicarlo:**
- Una tanda de mutantes que solo toca la librería **mide solo la librería**. Meter al menos uno **en
  el sitio que la llama**, y si no cae, la cobertura de la función no significaba lo que parecía.
- Al fijar una llamada con una aserción de texto, citar **hasta el cierre**: `f(a, "x")` es
  **subcadena** de `f(a, "x", y)`, así que un `toContain` a secas pasa con el argumento de más
  puesto. Añadir además la negativa (`not.toMatch(/f\(a, "x",/)`).
- Y la regla de diseño que salió de ahí: **un argumento que significa «no lo cambies» se omite, no
  se manda con el valor que se leyó**. Reenviar lo leído convierte cualquier escritura en una
  carrera.

Ver [[tanda-de-mutantes-se-lee-por-nombre]] y [[arreglo-que-parece-hecho]].
