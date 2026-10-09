---
name: tuberia-tapa-el-ci
description: "`gh pr checks --watch | grep | tail && gh pr merge` fusiona en rojo — el && lee el exit de tail; y un `;` tras un check fallido sigue hasta el push"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 82a444c4-d068-486f-a40b-3e73b61f92ca
  modified: 2026-09-21T03:21:52.535Z
---

El 2026-09-20 el PR #168 se fusionó con el CI EN ROJO: mi comando era `gh pr checks N --watch --fail-fast 2>&1 | grep tsc | tail -1 && gh pr merge N --squash`. El `&&` lee el código de salida de `tail`, no el de `gh pr checks`. Había funcionado en seis PR seguidos solo porque todos estaban verdes. `main` quedó con una prueba de texto en rojo (#169 lo arregló).

El mismo día, otra variante: `decisions-check ... | tail -2 && tsc; git add && git commit && git push` — el check falló, el `&&` cortó solo el `tsc`, y el `;` siguió hasta el push.

**Why:** es exactamente la sección 12 de `docs/WORKFLOW-PARALELO.md` (merge condicionado al CI), rota por querer una salida corta. La protección de rama de GitHub sigue sin exigir el check, así que nada más lo para.

**How to apply:** el merge va dentro de un `if gh pr checks N --watch --fail-fast > fichero 2>&1; then gh pr merge ...; else echo ROJO; fi` — la salida se recorta DESPUÉS, leyendo el fichero. Ninguna tubería entre la comprobación y el `&&`. Y en una cadena de publicar, todo con `&&`, ningún `;` después de una comprobación. Relacionado: [[comprobar-la-edicion-no-el-comando]], [[cuando-corre-decide-que-caza]].
