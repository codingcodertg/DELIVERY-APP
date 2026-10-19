---
name: redirect-en-el-camino-de-error
description: "Antes de fusionar, preguntar qué del diff lee algo que solo existe tras la migración y qué hace la app si aún no existe."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 39114734-431c-4e44-a77a-198be3f67540
  modified: 2026-09-11T00:04:20.892Z
---

El 2026-09-10 se fusionó el título por persona con su migración sin aplicar. El
`select` de `profiles` en el layout de `(app)` pedía columnas que no existían,
`profile` llegó nulo y la línea siguiente —`if (!profile) redirect("/login")`—
convirtió el fallo en **un bucle de redirecciones en producción**.

**Por qué no se vio:** el acoplamiento estaba a la vista en el diff, pero nadie
preguntó qué pasa si la migración aún no ha corrido. Y el layout descarta el
`error` de Supabase (`const { data: profile } = …`), así que no distingue «no
hay fila» de «la consulta falló»: la primera merece redirigir, la segunda no.

**Cómo aplicarlo:** en cada rama que añada columnas, contestar por escrito
*«¿qué líneas leen algo que solo existe después de la migración, y qué hace la
app si aún no existe?»*. Las dos mitades: encontrar el acoplamiento **y** mirar
el camino de degradación. Un `redirect` en ese camino convierte cualquier fallo
de consulta en una caída muda. Emparejado con
[[ultima-migracion-que-toca-el-objeto]] y [[comprobar-la-capa-que-manda]].
