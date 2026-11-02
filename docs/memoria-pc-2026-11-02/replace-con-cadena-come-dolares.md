---
name: replace-con-cadena-come-dolares
description: "Cuatro formas medidas de que una edición resuelva un escape en silencio — String.replace con `$$`, `node -e` entre comillas, la herramienta Write con `\\u`/`\\b`, y el heredoc de Bash que convierte la barra doble en una. Construir la barra por código y barrer bytes."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 9d5602ef-8669-4169-abbc-3d0b12686868
  modified: 2026-09-17T16:58:33.546Z
---

Al escribir código con escapes (`$$` de plpgsql, `̀`, `\b`, `\$`), la edición puede
resolverlos y dejar el fichero distinto de lo que se tecleó, sin que ningún verde lo diga.
Tres mecanismos medidos el 2026-09-16, en la rama de la 111:

1. **`String.replace(ancla, cadena)`**: en la cadena de reemplazo `$$` es «un `$`». Un
   guard plpgsql quedó `as $ … end $;`, SQL inválido, con el checksum ya calculado encima.
   Usar `split(ancla).join(cadena)`.
2. **`node -e "…"` o `sed` entre comillas del shell**: `\b` se volvió RETROCESO y `\$` perdió
   la barra. No meter regex ni `$` ahí; escribir el script a un fichero.
3. **La herramienta Write resuelve `\uXXXX` al escribir.** Reescribí `phone-book.ts` y la
   regex de `normaliza` pasó a caracteres combinantes literales; el primer arreglo, con
   `String.raw`, salió igual. Lo cazó el orquestador leyendo bytes, no una prueba. Para
   escribir una barra desde un script: `String.fromCharCode(92)`.

4. **Heredoc en la herramienta Bash, aun con `<<'PY'`: `\\` llega como `\`; una barra sola llega
   intacta** (medido el 2026-09-17). Dentro de una cadena normal de Python, `\\n` tecleado acaba
   siendo un salto de línea real: una regex de prueba quedó partida en tres líneas, y el ancla de un
   mutante, cortada en dos. Para texto con barras dobles, usar la herramienta Edit, o `chr(92)`.

**Por qué:** los cuatro «funcionan» o fallan lejos del sitio, y el diff los esconde (el
literal se ve igual que el escape en muchas vistas).

**Cómo aplicarlo:** tras editar escapes, releer la línea con `cat -A` o `JSON.stringify`, y
barrer los ficheros tocados buscando U+0300–U+036F y controles (menos tab/LF/CR) **con un
control de que el detector ve uno**: `grep -P '\x{0300}'` sin locale UTF-8 da error y 0
líneas, que parece limpio. Recalcular el checksum si tocó un `.sql`. Ver
[[comprobar-la-edicion-no-el-comando]], [[escape-en-plantilla-prueba-inerte]] y
[[tanda-de-mutantes-se-lee-por-nombre]].
