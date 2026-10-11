---
name: migracion-con-commit-propio-rompe-el-ensayo
description: "Un .sql con begin/commit propios, ejecutado dentro de un ensayo con ROLLBACK, se confirma en producción: el begin anidado es un WARNING y el commit cierra la transacción externa. Pasó el 2026-09-17 con la 124."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 83590ac0-88d3-4d5e-b9d3-888a2b15db49
  modified: 2026-09-18T03:34:46.593Z
---

El 2026-09-17 ensayé la migración 124 (visibilidad por tienda, rehecha por worker2) con mi patrón de
siempre: `begin` → ejecutar el `.sql` → casos → `rollback`. El fichero traía `begin;`/`commit;`
propios en su bloque 1 «para que no haya un instante sin política de escritura». Postgres trató el
`begin` anidado como WARNING y el `commit` interno confirmó **mi** transacción: columna, guardia,
función, políticas partidas y fila del ledger quedaron en producción sin aprobación del dueño y sin
respaldo. La reversión posterior la bloqueó el permiso de la sesión; la decisión pasó al dueño.

**Why:** el ensayo con ROLLBACK solo es un ensayo si el fichero no controla la transacción. Y un
`grep` previo de `^begin;|^commit;` cuesta un segundo; leer la migración entera «para entenderla» no
lo cazó porque el bloque se leía como intención, no como control de transacción.

**How to apply:** antes de ejecutar CUALQUIER `.sql` ajeno dentro de un ensayo o de `apply_one.mjs`,
`grep -nE '^\s*(begin|commit|rollback|start transaction)\s*;' fichero.sql` sobre las líneas sin `--`;
si sale algo, no se ejecuta: se devuelve a la rama con la regla «una migración nunca lleva
begin/commit propios; los pone quien la aplica». Ver [[politica-for-all-tambien-lee]] (misma rama)
y [[peticion-de-medir-no-autoriza]].
