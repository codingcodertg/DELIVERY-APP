---
name: numerar-cambia-el-checksum
description: sustituir D-NEXT por D-0XX dentro de un .sql de migración cambia su cuerpo y deja viejo el checksum del registro; recalcular con --sum después de numerar
metadata:
  node_type: memory
  type: feedback
  originSessionId: 83590ac0-88d3-4d5e-b9d3-888a2b15db49
  modified: 2026-09-25T20:32:45.462Z
---

**Al numerar una release, si el `.sql` de una migración lleva `D-NEXT` en sus comentarios, la sustitución
cambia el cuerpo y el checksum grabado tras `-- @ledger-below` deja de cuadrar.** Después de numerar,
siempre: `node scripts/db/migrate-status.mjs --sum NNN_x.sql` y comparar con el sha del fichero; si
difiere, regrabarlo (con el sha en una variable tomada con `| head -1`, que `--sum` puede imprimir más de
una vez) y volver a correr vitest.

**Why:** el 2026-09-25, en la release de D-399, `numerar.mjs` cambió 2 `D-NEXT` dentro de
`146_customer_siempre_con_factura.sql`; el sha grabado (767b…) ya no era el del cuerpo (eff1…). Lo cazó
la comparación manual antes de aplicar; aplicada así, `migrate-status` la habría dado por «cambiada».

**How to apply:** en toda release con migración, la comparación `--sum` vs sha grabado va DESPUÉS de
numerar, no antes. Relacionado: [[d-next-tambien-en-el-codigo]], [[numero-copiado-no-se-recuenta]].
