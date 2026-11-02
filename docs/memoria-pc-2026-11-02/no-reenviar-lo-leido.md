---
name: no-reenviar-lo-leido
description: un campo que la acción no cambia se omite del envío; reenviarlo con el valor leído borra en bloque o pisa lo que otro escribió
metadata:
  type: feedback
---

**Un campo que la acción no pretende cambiar se OMITE del envío; no se manda con el valor que se leyó.**

Medido en RTG PROMOS (D-369, 2026-09-23), dos veces en la misma pantalla:
- **Aprobar en bloque borraba las notas.** `cambioEnBloque` mandaba `note: nota ?? null` aunque la acción era
  cambiar el estado. El manager escribe «descontinuado» en tres productos, aprueba todos de golpe, y las
  notas desaparecen sin aviso. Medido en la base con `ROLLBACK`: con `note = null` en el `on conflict`, se
  borran; sin la columna, se conservan.
- **El botón de una fila reenviaba `f.nota`**: la nota de la copia en memoria. Si otra persona la cambió
  mientras tanto, se pisa. Es una **escritura perdida**, peor que la anterior porque ni se ve pasar.

**Why:** reenviar lo leído convierte cualquier escritura en una carrera contra quien escribió después, y a
un valor por defecto (`null`) en un borrado. Lo que una acción no cambia no debe viajar.

**How to apply:** con `@supabase/postgrest-js` (2.112.4, `dist/index.mjs:3227-3240`) un `upsert` de un
lote usa como `columns` la **unión de las claves de todas las filas**, y con `defaultToNull` activo por
defecto, una fila a la que le falta una clave que otra sí trae la recibe como `null`. Así que **todas las
filas de un lote llevan exactamente las mismas claves**, y la que no se toca no la lleva ninguna. En las
pruebas: `"note" in fila`, no `fila.note === undefined`. Y **una función correcta no dice nada de quién la
llama**: el mutante que sobrevivió fue el de la pantalla reenviando la nota, porque ninguna prueba miraba
las llamadas, solo la función pura. Al fijar una llamada por texto, citar hasta el paréntesis de cierre:
`f(a, "x")` es subcadena de `f(a, "x", y)`. Ver [[prueba-alimentada-por-quien-llama]] y
[[leer-la-implementacion-instalada]].
