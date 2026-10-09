---
name: politica-que-no-decide
description: Una política RLS puede estar viva y no decidir nada; y un .sql que se lee bien puede no aplicarse siquiera.
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 9d5602ef-8669-4169-abbc-3d0b12686868
  modified: 2026-09-18T03:32:27.855Z
---

Antes de escribir una política RLS, mirar **todas** las políticas permisivas que cubren ese comando,
no solo la que voy a cambiar. Las permisivas se suman con `OR`, y una de tipo **`ALL` cubre también
`SELECT`**: con ella puesta, el filtro más cuidado de la política de lectura no decide nada. En este
repo pasa con `deliveries` (`auth write deliveries` es ALL), y **lo cazó el ensayo contra la base, no
leer el fichero**: el filtro por tienda estaba perfecto y el vendedor seguía viendo 153 de 153.

**Why:** estaba escrito desde hacía semanas en **D-100** («Encontrado de paso, NO cambiado»), con los
números medidos y la decisión de aparcarlo. Yo grepeé `supabase/migrations/` y no `DECISIONS.md`, así
que escribí una migración entera sobre una premisa falsa. El segundo golpe el mismo día: la cláusula
`x = any ((select f()))` **ni siquiera aplica** —Postgres la parsea como la forma subconsulta de ANY y
da `operator does not exist: text = text[]`—; hace falta `::text[]`. Ninguna prueba de texto ve eso.

**How to apply:** (1) `grep` del nombre de la tabla **y de la política** en `DECISIONS.md` y `docs/`,
no solo en las migraciones — lo que ya se supo suele estar ahí, y aparcado a propósito; (2) que la
migración se comprometa a sí misma: un `raise exception` si queda otra política permisiva con
`cmd in ('ALL','SELECT')`; (3) lo que solo ve la base, lo mide quien puede aplicarla — yo dejo el caso
escrito y digo que no lo he medido. Ver [[ultima-migracion-que-toca-el-objeto]] y
[[premisa-heredada-no-es-medicion]].
