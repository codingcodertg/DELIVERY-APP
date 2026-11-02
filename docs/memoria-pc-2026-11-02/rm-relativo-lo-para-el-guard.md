---
name: rm-relativo-lo-para-el-guard
description: "Un `rm fichero` relativo tras un `cd` en el mismo comando lo bloquea el guard de Bash (lo resuelve contra C:\\); borrar siempre con ruta absoluta."
metadata:
  node_type: memory
  type: feedback
  originSessionId: 83590ac0-88d3-4d5e-b9d3-888a2b15db49
  modified: 2026-10-19T23:34:30.442Z
---

El 2026-10-19 un `cd "D:/…/deliveries-app" && … && rm scratch_x.mjs` fue bloqueado por el guard de Bash: resolvió `scratch_x.mjs` contra `C:\` (la cwd de la sesión, que se reinicia en cada llamada) y lo tomó por un borrado peligroso; el comando entero no corrió.

**Why:** el guard no sigue el `cd` del propio comando; mira la cwd de la sesión (`C:\`).

**How to apply:** los scripts temporales que tienen que vivir en el repo (para resolver `@supabase/supabase-js` o `pg`) se escriben y se borran con la ruta absoluta: `rm "D:/CLAUDE/DELIVERIES APP/deliveries-app/scratch_x.mjs"`. Ver [[todo-se-guarda-en-d]].
