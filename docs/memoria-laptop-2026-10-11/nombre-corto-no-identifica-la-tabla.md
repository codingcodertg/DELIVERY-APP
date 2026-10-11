---
name: nombre-corto-no-identifica-la-tabla
description: "Cuando dos esquemas comparten el nombre de una tabla, la consulta lleva el esquema o el número es de otra tabla."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 83590ac0-88d3-4d5e-b9d3-888a2b15db49
  modified: 2026-09-11T04:14:00.922Z
---

En este repo hay tablas con el **mismo nombre corto en esquemas distintos**:
`public.profiles` (roles `admin/manager/sales/…`) y `clockin.profiles` (vista, roles
`owner/manager/employee`, con `store_id`). Un `from("profiles")` en código no dice
cuál es: lo decide el cliente de Supabase que lo llama (`@/lib/clockin/supabase/server`
apunta al esquema `clockin`).

**Why:** el 2026-09-10, para saber a cuántos gerentes afectaba un 403 nuevo en el
export de informes del fichaje, la consulta propuesta decía `profiles` a secas.
Contar en `public.profiles` habría dado un número **creíble, no vacío, y ajeno** a
esa ruta. En `clockin.profiles` salió cero `manager`, y eso cambió el hallazgo de
«urgente» a «preventivo». Un número correcto de la tabla equivocada no chirría por
ningún lado.

**How to apply:** antes de medir, resolver **qué cliente** usa la ruta y por tanto
qué esquema; escribir la consulta con el esquema explícito; y al reportar el número,
decir de qué tabla sale. Si el escalafón de roles del código (`owner`, `employee`)
no coincide con el de la tabla que estoy mirando, estoy en la tabla equivocada. Ver
[[dato-correcto-conclusion-falsa]] y [[medida-que-no-necesita-explicacion]].
