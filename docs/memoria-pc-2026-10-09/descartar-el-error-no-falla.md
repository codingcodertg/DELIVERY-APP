---
name: descartar-el-error-no-falla
description: "Un `const { data } = await supabase...` que descarta el error no falla: sigue con datos incompletos, y lo que pase después depende del camino escrito."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 39114734-431c-4e44-a77a-198be3f67540
  modified: 2026-09-18T14:10:18.184Z
---

`const { data: profile } = await supabase.from("profiles")…` es el patrón más
repetido del repo, y esconde que **«no hay fila» y «la consulta falló» llegan
iguales**: `data` nulo. Lo que ocurre después no lo decide el fallo, lo decide el
camino que ya estaba escrito para el caso nulo.

- En un layout ese camino era `redirect("/login")`, y el login vuelve: **bucle
  mudo** en producción (2026-09-10).
- En `src/lib/erp/auth.ts` el camino son valores por defecto: **un rol
  equivocado**, sin aviso. Falla cerrado, así que se ve de menos.

- En `data-provider.tsx`, el aviso de parada asignada a un chofer hacía
  `insert([seed]).select("id")` y descartaba el error. RLS (`notif read own`)
  rechaza el `returning` de una notificación **ajena**, así que la fila entera no
  entraba: **cero avisos `assigned` en toda la historia de la tabla**, sin una
  sola queja porque nadie esperaba uno. Medido con `ROLLBACK` el 2026-09-18
  (D-308) después de que yo me negara a copiar el patrón y dejara escrito por
  qué. **Lo caro no fue el `returning`: fue el `error` que nadie miraba.**

Y el peor caso no está en los helpers, está en **quien los alimenta**: en
`clock-in/api/reports/export/route.ts` hay **dos** lecturas del perfil y solo la
primera se valida; si falla la segunda, el acotado por tienda desaparece y un
gerente exporta a toda la compañía. Su gemelo `xlsx/route.ts` no falla porque
saca el dato de la lectura que ya validó. **La diferencia es una lectura de más.**

**Cómo aplicarlo:** preguntar el `error` **antes** que los datos, y con error no
tomar ninguna decisión de navegación ni de permisos. Al buscar el patrón, contar
**por fichero** y no por línea —la consulta y el `redirect` suelen estar
separados— y acordarse de los **helpers**: un grep sobre `src/app` no ve a quien
lee el perfil desde `src/lib`. Emparejado con
[[redirect-en-el-camino-de-error]] y [[grep-de-una-linea-no-ve-la-estructura]].
