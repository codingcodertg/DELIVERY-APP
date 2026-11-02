---
name: numero-de-decision-lo-decide-el-merge
description: "El número D-NNN se asigna en el orden en que las ramas ENTRAN a main, no en el que se empiezan; reservar números por adelantado en una cola de releases obliga a renumerar."
metadata:
  node_type: memory
  type: feedback
  originSessionId: 83590ac0-88d3-4d5e-b9d3-888a2b15db49
  modified: 2026-10-30T21:34:19.446Z
---

El 2026-10-30 reservé D-768, D-769 y D-771 mientras D-770 estaba en vuelo; la 770 fusionó primero y `decisions-check` tumbó las tres («D-769 va detrás de D-770»): hubo que renumerar a 772/773 y, después, la 774 a 776 porque la 775 entró antes. Cada renumeración = reset de lo que prepara.py ya había escrito + otro sube.

**Why:** DECISIONS.md es append-only y el check exige números crecientes por posición; una cadena de releases en serie solo respeta eso si el número se decide en el momento de rebasar, no al crear el worktree.

**How to apply:** en una cola de releases, pasar los números en el orden de la cadena y SOLO después de que lo anterior haya fusionado; si algo se cuela antes, el pendiente toma el siguiente número libre (máximo de DECISIONS en main + 1), nunca uno reservado. Si una rama ya quedó numerada con un número menor que el último de main, `git checkout -- .` para volver al commit con D-NEXT y relanzar con el número nuevo. Ver [[d-next-tambien-en-el-codigo]] y [[decisions-md-no-se-fusiona-solo]].
