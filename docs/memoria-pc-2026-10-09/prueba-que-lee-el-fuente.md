---
name: prueba-que-lee-el-fuente
description: "Una prueba que busca texto en un fichero falla o pasa por motivos que no son el código: mi propio comentario, otra parte del fichero, o una subcadena de la forma mala."
metadata:
  node_type: memory
  type: feedback
  originSessionId: 9d5602ef-8669-4169-abbc-3d0b12686868
  modified: 2026-09-24T00:19:16.546Z
---

En este repo muchas pruebas miran el **fuente** como texto: «quién llama a qué», «esta
pantalla usa esta clase», «esta ruta no coge la llave de servicio». Son útiles —cazan cosas
que `tsc` no ve— pero fallan de tres maneras que **no tienen nada que ver con el código**.
Las tres me pasaron el 2026-09-23, en el mismo módulo, en una tarde.

**1 · La negativa que tumba mi propio comentario.** `expect(src).not.toContain("<details>")`
se puso roja porque el comentario de al lado decía «era un `<details>` nativo». Y antes,
`not.toContain("createAdminClient")` se puso roja porque el comentario explicaba que esa
función no se usaba. **Una prueba que confunde la prosa con el código es una que alguien
acabará relajando para callarla.** → `sinComentarios(...)` antes de mirar, como
`map-legend.test.ts`.

**2 · La positiva que se cumple por OTRO sitio del fichero.** `toContain('className="sema"')`
pasaba con el estado en texto plano, porque esa clase también estaba en la pastilla de
«Cerrada» de la cabecera, cincuenta líneas más arriba. La prueba decía «hay una pastilla» y
lo que comprobaba era «hay un `sema` en alguna parte». → citar **la expresión entera de ese
sitio**, no un trozo que viva en varios.

**3 · La positiva que es SUBCADENA de la forma mala.** Ya está escrita en
[[no-reenviar-lo-leido]] —`f(a, "x")` es subcadena de `f(a, "x", y)`— y vale igual para los
números: `"<= 20"` pasa con `<= 2000`, y `"between 1 and 40"` con `between 1 and 400`.
→ citar **hasta el cierre** y añadir la negativa del caso malo.

**Why:** las tres dan verde o rojo sin mirar lo que dicen mirar, y las tres se leen bien. La
número 2 es la peor, porque el rojo nunca llega: la prueba se queda verde para siempre
protegiendo algo que ya no está.

**How to apply:** una prueba que lee fuente **no está terminada hasta que un mutante la tumba**.
Y si el mutante sobrevive, la sospecha va primero a la prueba, no al código. Ver
[[tanda-de-mutantes-se-lee-por-nombre]] y [[prueba-alimentada-por-quien-llama]].
