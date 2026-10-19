---
name: trabajo-en-la-laptop
description: la memoria de Claude es por máquina y no se sincroniza sola; al cambiar de PC se traspasa por el repo y el índice se funde, no se pisa
metadata:
  type: project
---

El dueño alterna dos máquinas con el mismo usuario y la misma ruta: esta PC y su laptop
(`LAPTOP-QKUGV7QN`). Trabajó en la laptop del 2026-09-19 al 2026-09-23 (D-340…D-362) y el 2026-09-23
volvió a esta PC. La memoria de Claude vive en `~/.claude/projects/<ruta>/memory/`, **fuera del
repo**, así que cada máquina aprende por su cuenta y lo aprendido allá no llega aquí solo.

**Why:** la base es una sola y es producción; dos orquestadores numerando `D-0XX` o aplicando
migraciones a la vez es lo que el flujo prohíbe ([[decisions-md-no-se-fusiona-solo]]). Y una sesión
que empieza sin la memoria de la otra máquina repite errores ya pagados.

**How to apply:** al abrir sesión, `git pull`, `migrate-status`, `decisions-check`, y preguntar en
qué máquina se trabaja; la otra queda quieta. Para traspasar la memoria se copia a
`docs/memoria-laptop-<fecha>/` y viaja con el repo — así llegó la de la laptop el 2026-09-23. Al
instalarla, **`MEMORY.md` es el índice y se sobrescribe entero**: hay que fundir las dos listas por
el nombre del fichero enlazado, no pisar. Medido ese día: de 51 ficheros comunes, 50 eran idénticos
salvo CRLF y solo el índice difería de verdad. Comparar con `diff` tras `tr -d '\r'` o todo parece
distinto. Si las copias discrepan, gana la de la máquina; la del repo es una foto con fecha.
Ver [[laptop-estado-y-limites]].
