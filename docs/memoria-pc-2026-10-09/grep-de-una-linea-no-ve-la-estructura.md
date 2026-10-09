---
name: grep-de-una-linea-no-ve-la-estructura
description: "Un grep de línea no ve lo que está repartido en varias, y su cero parece una respuesta."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 39114734-431c-4e44-a77a-198be3f67540
  modified: 2026-09-11T02:57:01.317Z
---

Dos veces el mismo día. Yo conté los sitios que pintan una insignia buscando
`sema` y `roleLabel` en la misma línea: `TopBar` no salió, porque su clase está
en `:246` y su etiqueta en `:252`. El auditor contó los triggers de una tabla
con un `grep` de línea y le dio **cero**, sabiendo que la migración crea uno:
`create trigger` y su tabla van en líneas distintas.

**Por qué es peligroso:** el resultado no es un error, es un número. Un cero
parece «no hay» y se escribe en un veredicto como un hecho.

**El método, que vale para cualquier conteo y no solo para un grep: nombrar antes
un caso que TIENE que aparecer, y mirar si aparece.** Las dos veces se cazó así,
no por suerte: su cero era imposible porque sabía que la migración crea un
trigger; mi cuenta no incluía `TopBar`, que yo sabía que pinta una insignia. Un
conteo sin un positivo conocido al lado no tiene con qué chocar, y «revisa tu
grep» no sirve: un comando equivocado parece correcto.

**Y la variante que costó tres cuentas seguidas (2026-09-11):** contar «cuántas
pantallas no tienen guarda de rol». La auditoría dijo 7 (buscaba `role ===` y
«Not available»), yo dije 4 (`grep -n 'me.role'`), y eran **2**. Los dos
patrones veían **una forma de guarda —la suya—** y daban por ausente la que usaba
otra: `canPlanRoutes(me)` y `canFulfill(me)` no contienen `me.role`. **Una
guarda tiene tantas formas como el repo haya inventado.** El número bueno salió
abriendo los ficheros y buscando el `return` que corta.

**Cómo aplicarlo:** cuando lo que se cuenta es una estructura de varias líneas
—una etiqueta JSX, un `create trigger`, una policy, una llamada con argumentos
en bloque— buscar el ancla que va sola (`create trigger (\w+)`, el nombre del
componente) y leer el bloque, o usar `-A`/multiline. Y sospechar de cualquier
conteo que dé cero. Emparejado con [[medida-que-no-necesita-explicacion]] y
[[dato-correcto-conclusion-falsa]].

**Tercera forma, y ya no es un grep (2026-09-23):** midiendo en el navegador conté las filas de una
tabla con `/ID #([0-9]+)/` sobre el texto de cada fila. Sembré cuatro órdenes de prueba y **ninguna
aparecía**, en cinco roles. Estuve a punto de reportar que la ventana de fechas las escondía. No las
escondía nada: al ponerles `order_code`, la celda pinta `ID #SEM-9020` en vez de `ID #9020`, y mi
regex pedía dígitos. Lo cazó buscar una de ellas en el buscador de la propia pantalla —salió— y leer
el texto crudo de esa fila. **El contador era mío, no de la app.** Antes de escribir «no sale»,
enseñar la fila por otro camino y leerla tal cual.
