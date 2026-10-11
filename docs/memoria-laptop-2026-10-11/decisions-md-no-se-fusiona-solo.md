---
name: decisions-md-no-se-fusiona-solo
description: "DECISIONS.md nunca se resuelve con git merge ni con un script que pegue los dos lados: se toma un lado, se insertan a mano las entradas del otro y se pasa scripts/decisions-check.mjs. Dos empalmes medidos (PR #104 y 2026-09-18)."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 83590ac0-88d3-4d5e-b9d3-888a2b15db49
  modified: 2026-09-18T20:46:39.961Z
---

Mi script de conflictos (pegar el lado HEAD y el lado de la rama) dejó en el PR #104 (564a9b1,
2026-09-17) una copia ENTERA de `DECISIONS.md` dentro de D-279: 590 encabezados para 314 números,
durante un día, con una corrección (nota de D-244) escrita en una sola de las dos copias. El
2026-09-18, al fusionar la rama que lo reparaba, `git merge` volvió a empalmarlo solo (66 409 líneas)
y lo cazó el comprobador nuevo antes del commit.

**Why:** es un fichero append-only que todas las ramas tocan al final; cuando una rama reescribe el
medio (o un lado del conflicto es enorme), «quedarse con los dos lados» duplica el documento, y nada
falla: compila, las pruebas pasan, y se lee bien por arriba.

**How to apply:**
- Al unir una rama: `git checkout <lado-bueno> -- DECISIONS.md`, insertar A MANO solo las entradas
  `## D-…` que el otro lado añadió, y correr `node scripts/decisions-check.mjs --contra <copia de main>`.
  El único «renglón desaparecido» aceptable es uno explicado.
- Antes de cada release: los encabezados `## D-` suben exactamente +1 por decisión, las líneas lo
  esperado, y `uniq -d` de los encabezados da cero. Ver [[d-next-tambien-en-el-codigo]].
- Un script mío que «resuelve» algo en silencio es código sin pruebas sobre la columna vertebral de
  la documentación: o tiene comprobación de salida, o no se usa. Ver [[comprobar-la-edicion-no-el-comando]].
