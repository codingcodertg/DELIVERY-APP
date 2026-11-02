---
name: precedente-leido-a-medias
description: "Abrir el fichero correcto y leerle la cabecera no es haberlo leído: el aviso que te habría salvado suele estar donde está el código, no en la introducción."
metadata:
  node_type: memory
  type: feedback
  originSessionId: 9d5602ef-8669-4169-abbc-3d0b12686868
  modified: 2026-09-23T20:37:38.032Z
---

El 2026-09-23 escribí en la migración 140
`group_code = any ((select public.promo_visible_groups()))`. Los paréntesis
dobles **no** la vuelven una expresión de array: Postgres la lee como la forma
**subconsulta** de `ANY`, compara `text` contra la única fila —que es un
`text[]`— y la migración **cae en la primera pasada**, sin ejecutar nada; ni sus
autocomprobaciones del final habían corrido nunca.

Ese mismo día **abrí `131_visibilidad_por_tienda.sql`** —era mi precedente para
acotar por tienda— y le leí las **primeras setenta líneas**, que son la
introducción. El aviso está en **131:223-228**, pegado a la línea que lo
necesita, y dice exactamente esto, incluido que ya había pasado en la 124.

**Por qué:** la cabecera de un fichero cuenta *qué* hace; las trampas se
escriben **al lado del código que las tiene**. Leer la introducción da la
sensación de haber leído el fichero, y esa sensación es justo lo que impide
volver a abrirlo.

**Cómo aplicarlo:** cuando abro un fichero como precedente, después de leer la
cabecera hago un `grep` **de la construcción que estoy a punto de escribir**
—`any (`, `security_invoker`, `create or replace`, el nombre de la columna— en
ese mismo fichero y en sus hermanos. Es un comando, no una relectura. Y si el
proyecto ya tropezó con algo (aquí, la 124), el comentario que lo cuenta suele
llevar el número: `grep -rn "la 124" supabase/` habría bastado.

Hermana de [[verificar-contra-el-codigo-que-ejecuta]] y de
[[ultima-migracion-que-toca-el-objeto]]: las tres son la misma pereza en sitios
distintos — dar por leído lo que solo se ha abierto.
