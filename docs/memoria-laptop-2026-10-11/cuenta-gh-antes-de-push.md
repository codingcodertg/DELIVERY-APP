---
name: cuenta-gh-antes-de-push
description: "hay otro Claude Code en esta máquina con la cuenta andresugarte14; antes de CADA push, comprobar que gh está en CARRERSRTG y cambiarla si no"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 83590ac0-88d3-4d5e-b9d3-888a2b15db49
  modified: 2026-09-25T16:51:39.413Z
---

**Antes de cada `git push` o `gh pr create`/`merge`, comprobar la cuenta activa de `gh` y, si no es
`CARRERSRTG`, cambiarla:**

```bash
[ "$(gh api user -q .login)" = "CARRERSRTG" ] || gh auth switch -h github.com -u CARRERSRTG
```

**Why:** el 2026-09-25 el push de la release D-390..D-394 dio 403 porque la cuenta activa era
`andresugarte14` (solo READ en el repo). El dueño lo explicó: *«es que hay 2 claude code running,
entonces tú siempre que vayas a hacer un push asegúrate de que esté escogida esa y si no la cambias»*.
El otro Claude Code usa la otra cuenta y la deja activa; `git push` usa el credential helper de `gh`,
así que hereda la cuenta activa.

**How to apply:** no basta con comprobarlo al empezar la sesión (regla de CLAUDE.md): la otra sesión la
cambia en cualquier momento. Se comprueba justo antes de cada push, en el mismo comando. Cambiarla no
necesita preguntar: lo autorizó el dueño. Relacionado: [[confirmar-antes-de-publicar]].
