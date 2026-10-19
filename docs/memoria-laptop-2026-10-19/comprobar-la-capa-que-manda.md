---
name: comprobar-la-capa-que-manda
description: "Antes de afirmar el efecto de un fallo de permisos, comprobar el servidor, no la pantalla."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 83590ac0-88d3-4d5e-b9d3-888a2b15db49
  modified: 2026-09-10T03:03:52.500Z
---

Un fallo en el cliente **no implica** que el efecto haya ocurrido. Antes de
decirle al dueño qué pasó, comprobar la capa que de verdad decide: la base, sus
funciones y sus permisos.

**Why:** el 2026-09-09 medí que el ERP decidía permisos con el rol de Entregas
en vez del suyo, y le dije al dueño que una empleada «está viendo costes y
márgenes». Era falso. La base ya enmascaraba el coste con `erp.product_cost()`
—`case when can_see_cost() then p.cost else null end`— y tenía el `select`
revocado sobre las tablas. El fallo era real, el efecto no: la pantalla
prometía un permiso que el servidor nunca concedió. La diferencia entre «fuga
de datos» y «la interfaz miente» es enorme para quien lo lee, y esa frase iba
camino de `DECISIONS.md`.

**How to apply:** ante un fallo que parezca de permisos, la primera pregunta es
qué hace el servidor, no qué pinta la pantalla. Y al citar una vista, función o
política, comprobarla contra la **última** migración que la toca, no contra la
que la creó: en un repo acumulativo, la primera que aparece suele estar
sustituida. Ver [[verificar-contra-el-codigo-que-ejecuta]] y
[[auditoria-no-es-medicion]].
