---
name: d-next-tambien-en-el-codigo
description: "Al numerar una decisión, el marcador D-NEXT también vive en comentarios del código y en las tablas de la propia entrada; el paso 7 lo comprueba con grep."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 83590ac0-88d3-4d5e-b9d3-888a2b15db49
  modified: 2026-09-20T03:35:48.843Z
---

El marcador `D-NEXT` no está solo en el título de la entrada de `DECISIONS.md`.
El worker lo escribe también **en los comentarios del código** («Tres
desenlaces, no dos (D-NEXT)») y a veces **dentro de la propia entrada** (una
tabla que se cita a sí misma). Sustituir solo el `## D-NEXT ·` deja el resto.

**Why:** el 2026-09-10 numeré D-234 a D-238 sustituyendo el título, y al final
del día `grep -rn D-NEXT src` devolvía **26 líneas en 22 ficheros**, y una fila
de tabla en D-238 seguía diciendo `**D-NEXT**`. Hizo falta un PR aparte (#59)
solo para poner los números, mapeando `git blame` → PR del squash → commit de
release. Un comentario que dice «D-NEXT» dentro de un año no apunta a nada.

**How to apply (paso 7):** tras numerar, dos comprobaciones que tienen que dar
cero antes de commitear la release:

```
grep -c "D-NEXT" DECISIONS.md
git grep -n "D-NEXT" -- src          ← SIN filtros: pruebas y CSS también llevan el marcador
```

Si la segunda no es cero, esas líneas se sustituyen **en el mismo commit de
release**, porque en ese momento el número es único y conocido; después hay que
reconstruirlo por `blame`.

**Segunda lección del mismo día:** el primer arreglo (PR #59) sustituyó 19 de
26 porque conté con un grep y sustituí con otro más estrecho (`--include=*.ts`
y `grep -v .test.`): quedaron 7 en pruebas y CSS. **Después de una sustitución
masiva, repetir el mismo comando del recuento inicial y exigir cero** — medir
el residuo, no la operación. Y si es masiva, que otro cuente lo que queda. Ver
[[estado-de-rama-no-es-el-fichero]] y [[medida-que-no-necesita-explicacion]].

**El límite de la regla, para que no sea una trampa:** `-- src` es a propósito.
**Fuera de `src`, `D-NEXT` se queda**: en `CLAUDE.md`, `docs/WORKFLOW-PARALELO.md`
y `.claude/agents/auditor-rtg.md` es el *nombre* del marcador (lo definen), y en
`docs/PLAN-*.md` («Decisión: D-NEXT al fusionar») es cierto hasta que esa rama
se fusione. Medido el 2026-09-10: 20 fuera de `src`, todos legítimos.

**Una migración no lleva `D-NEXT` nunca, y no se aplica con `D-NEXT` dentro.**
Su checksum (cuerpo antes de `-- @ledger-below`) la congela en el momento en
que alguien la ejecuta; si el marcador va dentro, o se sustituye y
`migrate-status` dice «cambiada» para siempre, o se deja y apunta a nada. El
`.sql` cita la rama o «la decisión que la acompaña». Visto el 2026-09-11 con la
107, antes de la firma. Y el 2026-09-13 apliqué la 104, 105 y 106 **con el
marcador dentro** (el dueño pidió todo de golpe y la regla no se aplicó hacia
atrás): la salida fue reescribir las cabeceras sin marcador y **alinear a mano
la fila de `schema_migrations`** al checksum nuevo antes de fusionar, más
reejecutar los `comment on` que lo nombraban. Antes de aplicar cualquier
`.sql`: `grep -c D-NEXT <fichero>` → 0.

**Y el verify en el checkout principal:** dos veces el mismo día `next build`
falló con `Cannot read properties of undefined (reading 'length')` por la caché
de `.next` (varias sesiones y ramas se turnan sobre ella) y pasó limpio. La
forma es un solo comando, no «si falla, limpia»:
`rm -rf .next && node scripts/verify.mjs`.

**Y del lado del worker (2026-09-18):** entregué la 134 con «(D-NEXT)» en la
cabecera sabiendo esta regla; se aplicó así y ya no se puede tocar. La
comprobación va ANTES de estampar el checksum y de mandar el SHA, no al aplicar:
`grep -c "D-NEXT" supabase/migrations/NNN_x.sql` → 0. El `.sql` cita la decisión
por su tema («el chofer lee sus paradas»), nunca por el marcador.

**Volvió a pasar el 2026-09-19 con la 138** —en un comentario y en el
`comment on column`—, teniendo esta nota escrita. O sea que recordar la regla no
basta: **el grep tiene que ir pegado al comando que estampa el checksum**, que es
el único momento en que el fichero se congela. Un solo comando, y el checksum
solo se escribe si el grep da cero:

```
grep -c D-NEXT supabase/migrations/NNN_x.sql   # 0 o no se sigue
node scripts/db/migrate-status.mjs --sum NNN_x.sql
```

Y ojo con el `comment on column`, que se olvida porque no parece código: se
aplica igual y queda en la base.
