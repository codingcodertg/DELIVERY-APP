---
name: ensanchar-un-defecto-tiene-dos-sitios
description: "Al ampliar un valor por defecto, el camino que lo recalcula para «quien no tiene nada guardado» es el que se queda atrás — y es el de todo el mundo."
metadata:
  node_type: memory
  type: feedback
  originSessionId: 39114734-431c-4e44-a77a-198be3f67540
  modified: 2026-09-24T03:14:24.131Z
---

Al añadir las seis columnas de tienda al arranque de la tabla de promos toqué
`columnasDePromosPorDefecto`. Pero el defecto estaba **en dos sitios**: `columnasVisiblesDePromos`
—la que decide qué se pinta cuando alguien **no** tiene columnas guardadas— leía por su cuenta la
lista estática `COLUMNAS_DE_PROMOS_POR_DEFECTO`. O sea que el cambio no le llegaba a nadie: hoy nadie
tiene columnas guardadas (medido en producción: `promos_columns` = **0 filas**), así que *todo el
mundo* pasa por el camino que no se enteró.

**Why:** la función que se llama «por defecto» es la que se busca y se cambia. La que de verdad lo
aplica suele ser otra —la del `?? defecto`, el `if (!guardado)`, el `useState(() => ...)`— y esa se
queda con la versión vieja sin que nada falle: compila, y el comportamiento antiguo es un
comportamiento válido. Es un [[arreglo-que-parece-hecho]] de manual.

**How to apply:**
- Al cambiar un defecto, buscar **quién más lo calcula**: grep del nombre de la constante, no solo de
  la función. Si aparece en más de un sitio, dejar **un solo cálculo** y que el otro lo llame.
- La prueba que lo caza es la que **ata los dos caminos**: «sin nada guardado, lo mismo que el
  defecto». Aquí ya existía y por eso el fallo duró dos minutos.
- Y preguntar por el dato: si nadie tiene nada guardado, el camino del `??` **es** el camino normal,
  no el raro. Ver [[verificar-contra-el-codigo-que-ejecuta]].
