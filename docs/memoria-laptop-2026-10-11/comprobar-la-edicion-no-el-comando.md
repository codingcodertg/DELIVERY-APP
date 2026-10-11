---
name: comprobar-la-edicion-no-el-comando
description: Un comando que termina en verde no dice que todos sus pasos lo hicieran; se comprueba el fichero.
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 39114734-431c-4e44-a77a-198be3f67540
  modified: 2026-09-12T20:10:09.937Z
---

Una edición por anclas puede fallar y no verse. Pasó así: `python` con `assert` + `rm -rf .next
&& node scripts/verify.mjs` **en la misma llamada, en segundo plano**, separados por salto de
línea y no por `&&`. El `assert` reventó, las líneas siguientes corrieron igual, y el código de
salida que llegó fue el del verify: **0**. Di por escrita una sección de `DECISIONS.md` que nunca
llegó al fichero, y lo encontró la auditoría.

**Por qué falló el ancla, corregido tras medirlo bien.** No es «después de un rebase los ficheros
quedan en CRLF»: es que este repo se guarda en **LF** y `core.autocrlf=true` convierte a **CRLF
al sacar los ficheros al árbol de trabajo**. Medido con `tr -cd '\r' | wc -c` (ver abajo):
`git show <rev>:DECISIONS.md` → **0 CR**; el mismo fichero abierto en disco → **14.368 CR**.
Un fichero que yo reescribo entero con `newline=''` desde contenido normalizado se queda en LF en
el árbol, y ahí aparece la mezcla: dos ficheros del mismo commit, uno CRLF y otro LF, con las
anclas fallando solo en uno.

**Qué hacer:**

- **Un `grep` de lo que se acaba de escribir**, no el código de salida del paso siguiente.
- **Nunca encadenar una edición y su verificación con salto de línea** en la misma llamada. `&&`,
  o llamadas separadas.
- **Detectar el final de línea del fichero que voy a editar**, no del repo: leer con `newline=''`
  y mirar si hay `\r\n`, y construir el ancla igual.
- **Para contar CR, `tr -cd '\r' | wc -c`.** `grep -c $'\r$'` es **inestable** en este shell:
  contó todas las líneas en una invocación y cero en otra, sobre las mismas entradas. Un método
  inestable da números plausibles en las dos direcciones, que es peor que uno que falla siempre.

**Y la variante contraria, del 2026-09-16: `&&` también corta en silencio.** Encadené con `&&` un
recuento `Q=$(… | grep -cE …)` antes de escribir la línea de verify. `grep -c` **sale con código 1
cuando cuenta cero**, y el recuento de pruebas quitadas era cero: la cadena se cortó ahí, la línea no
se escribió, y lo siguiente —un `git commit` en otra línea— contestó «nada que comitear». Lo vi por
ese mensaje, no por el código de salida.

- **Un recuento que puede dar cero lleva `|| true`** si va dentro de una cadena con `&&`.
- **Y el paso que depende de una escritura se condiciona a un `grep` de lo escrito**, no a que el
  comando anterior terminara: `[ "$(grep -c … fichero)" = "1" ] && git commit …`.

Es de la familia de [[arreglo-que-parece-hecho]]: no es que el arreglo no funcione, es que **no
está**, y el verde de al lado hace creer que sí. Y cuando dos mediciones de los mismos bytes
discrepan, la culpa no es del fichero: se cambia el método antes de seguir.
