---
name: sed-i-quita-crlf
description: "en Git Bash, `sed -i` reescribe el fichero entero con LF; una edición posterior por anclas con \\r\\n falla"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 83590ac0-88d3-4d5e-b9d3-888a2b15db49
  modified: 2026-10-23T01:22:50.681Z
---

`sed -i` (el de numerar D-NEXT→D-NNN y los bumps) deja el fichero en LF aunque estuviera en CRLF. Git lo normaliza al commit (de ahí los «LF will be replaced by CRLF»), así que el diff sale limpio; lo que rompe es la edición SIGUIENTE: un python que ancla con `\r\n` da `count == 0` (2026-10-22, `mapa-de-apps.test.ts` tras un `sed -i` sin efecto).

**Why:** el fichero cambia de finales sin que el comando lo diga; parece que el ancla está mal escrita.

**How to apply:** antes de anclar, mirar `file <ruta>` o detectar `nl` dentro del script; tras cualquier `sed -i`, no dar por hecho CRLF. Para ediciones, python con `io.open(..., newline="")`. Ver [[crlf-tras-rebase]] y [[comprobar-la-edicion-no-el-comando]].
