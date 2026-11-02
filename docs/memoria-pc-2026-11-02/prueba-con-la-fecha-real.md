---
name: prueba-con-la-fecha-real
description: "Una prueba que deja que la función use `new Date()` pasa en local y cae en el CI (UTC, otro día): fijar «ahora» en TODAS las llamadas, no solo en las que lo afirman."
metadata:
  node_type: memory
  type: feedback
  originSessionId: 83590ac0-88d3-4d5e-b9d3-888a2b15db49
  modified: 2026-10-20T00:18:32.650Z
---

D-604 (2026-10-19, 19:13 hora local = 00:13 UTC del día 20): la prueba de la cita «sin tienda» llamaba a `textoConfirmacionPresencial` sin pasar `ahora`, y afirmaba «mañana a las 10:30 a.m.»; en el CI ya era el día 20 y la función escribió «hoy». Verde en local, rojo en el CI, un release caído.

**Why:** la función tiene `ahora: Date = new Date()` por defecto; cada llamada de prueba que no lo pasa depende del reloj y de la zona horaria de la máquina que la corre.

**How to apply:** si una función recibe `ahora`/`hoy` como parámetro, el fichero de prueba lo pasa en todas las llamadas (una constante arriba), aunque la afirmación no mire la fecha; y se puede comprobar en local con `TZ=UTC node node_modules/vitest/vitest.mjs run <fichero>`. Ver [[datos-que-no-contradicen]].
