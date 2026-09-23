---
name: indexof-menos-uno-pasa-el-orden
description: Una prueba de orden con indexOf(a) < indexOf(b) pasa cuando a no existe (-1); primero afirmar que está.
metadata:
  type: feedback
---

Una prueba de texto que fija un ORDEN con `expect(s.indexOf(a)).toBeLessThan(s.indexOf(b))` pasa también cuando
`a` no está: `indexOf` da -1, y -1 es menor que cualquier posición. La prueba parece vigilar dos cosas (que esté y
que vaya antes) y vigila media.

**Why:** el 2026-09-18, en el incremento de columnas por usuario, el mutante «al guardar ya no se escribe el
navegador» (borrar el `localStorage.setItem`) sobrevivió a una prueba que comprobaba justo que ese `setItem` iba
ANTES del guardado en la base. Lo cazó la tanda de mutantes leída por nombre, no la lectura de la prueba.

**How to apply:** en cada comparación de posiciones, afirmar antes `toBeGreaterThanOrEqual(0)` del operando que
podría faltar — o usar un ayudante que lance si no encuentra (como el `p()` de `plan.test.ts`). Ver
[[tanda-de-mutantes-se-lee-por-nombre]] y [[prueba-de-texto-no-fija-el-orden]].
