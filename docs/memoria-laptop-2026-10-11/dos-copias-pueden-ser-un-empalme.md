---
name: dos-copias-pueden-ser-un-empalme
description: "Un documento con todo duplicado puede ser un empalme, no dos versiones; se distingue mirando la línea de la costura."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 9d5602ef-8669-4169-abbc-3d0b12686868
  modified: 2026-09-18T18:28:11.981Z
---

Un fichero largo con cientos de entradas repetidas no es necesariamente «dos
versiones que hay que reconciliar». Antes de proponer nada, **mirar la línea
exacta donde termina una copia y empieza la otra**: si corta una palabra o un
token por la mitad (`$function$` → `$function` seguido del título del
documento), fue una **escritura que se empalmó dentro de una entrada**, no un
append.

**Por qué:** la diferencia decide el arreglo entero. Con dos versiones, hay que
conservar los dos textos. Con un empalme, quitar el bloque insertado y volver a
unir la frase **no pierde nada** — y conservar «las dos» dejaría la frase rota
para siempre. Medido el 2026-09-18 en `DECISIONS.md`: 277 títulos por duplicado,
solo 2 cuerpos distintos, y los 2 se explicaban por el corte (a uno le colgaba la
cola de la entrada siguiente; al otro le faltaba una nota que sí estaba en la
copia que se conserva).

**Cómo se aplica:** comparar los cuerpos por igualdad de cadena, no de tamaño; si
uno *empieza por* el otro, lo de más es de otra entrada. Buscar el token roto en
el historial (`git log -S`) da el commit culpable y el texto íntegro. Y el
criterio de aceptación se escribe como inclusión de conjuntos —todo renglón de
hoy sigue existiendo— no como «se ve bien». Emparenta con
[[numero-copiado-no-se-recuenta]] y [[verificar-contra-el-codigo-que-ejecuta]].
