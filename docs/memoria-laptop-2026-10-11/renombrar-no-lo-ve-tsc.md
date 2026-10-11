---
name: renombrar-no-lo-ve-tsc
description: "Al renombrar un campo, las pruebas de texto de otras decisiones caen en silencio; tsc en verde no las ve."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 9d5602ef-8669-4169-abbc-3d0b12686868
  modified: 2026-09-18T02:34:48.096Z
---

Cuando un cambio **renombra** un campo o una firma (`f.regla.minimo` → `f.lista.minimo`,
`feeSuggestion.fee` → `.list`), `npx tsc --noEmit` se pone verde en cuanto arreglo los usos
**de código**, pero este repo tiene muchas pruebas que citan el nombre **como texto**
(`expect(src).toContain("f.regla.minimo")`) y esas siguen rojas sin que nada avise.

**Why:** el 2026-09-17, en `tarifa-con-descuento`, corrí solo las dos suites que había tocado,
vi «48 passed» y seguí. Una prueba de D-244 en `fee-formula-text.test.ts` llevaba media hora en
rojo. Lo descubrí de rebote: caía con **todos** los mutantes, incluido el gemelo, y un gemelo
que rompe algo es la señal de que lo roto no es el mutante.

**How to apply:** al renombrar, antes de darlo por hecho, `grep -rn "<nombre-viejo>" src` —
incluidas las pruebas— y correr **todas** las suites que lo nombren, no solo las que edité.
Y en la tanda de mutantes, una prueba que cae con *cada* cambio no es una prueba estricta: está
rota en la base. Ver [[canario-en-las-dos-direcciones]] y [[comprobar-la-edicion-no-el-comando]].
