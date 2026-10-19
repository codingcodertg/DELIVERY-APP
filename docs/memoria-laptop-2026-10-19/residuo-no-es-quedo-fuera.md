---
name: residuo-no-es-quedo-fuera
description: "Al comparar una rama vieja con main, medir con tres puntos y leer el residuo como «entró y evolucionó», no como «quedó fuera»."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 39114734-431c-4e44-a77a-198be3f67540
  modified: 2026-09-11T04:19:46.493Z
---

Comparando 34 ramas locales con `main` salieron dos trampas seguidas. La
primera: `git diff origin/main <rama>` mide **lo que main ganó después**, así
que una rama de hace seis días parece borrar 20.000 líneas. Lo que la rama
aporta es `git diff origin/main...<rama>`, con tres puntos.

La segunda, y es la que engaña de verdad: aun con tres puntos, muchas ramas
dejan líneas que hoy no están en `main`. **No es que quedaran fuera: entraron y
ramas posteriores las editaron.** El conteo sirve para levantar la mano, no
para concluir.

**Cómo aplicarlo:** en este repo el marcador fiable de que una rama se fusionó
es que **el título de su entrada de `DECISIONS.md` aparezca numerado en el
`DECISIONS.md` de `main`** — el merge por squash rompe la ancestría, así que
`--merged`, `git branch -d` y el patch-id no valen. Y decir siempre qué parte
se comprobó rama por rama y qué parte por muestreo. Emparejado con
[[medida-que-no-necesita-explicacion]] y [[dato-correcto-conclusion-falsa]].

**Corrección (2026-09-10, noche):** los tres puntos **también mienten tras un
squash**, en la dirección opuesta a `--is-ancestor`. Medido con
`feat/copiar-pedidos-whatsapp`, fusionada por squash en el #51: `main...rama`
decía «aporta 48 líneas en 2 ficheros»; `git diff main rama -- <sus ficheros>`
(dos puntos, acotado a los ficheros de la rama) daba **vacío**. El squash crea
un commit nuevo en `main`, el ancestro común no se mueve, y el diff de tres
puntos presenta como pendiente lo que ya entró con otro SHA. Las dos
herramientas fallan por lo mismo y en sentidos contrarios:
`--is-ancestor` → falso «no fusionada»; `main...rama` → falso «trabajo
pendiente». **Lo que decide si se puede borrar es el contenido**: dos puntos
sobre los ficheros de la rama, o buscar el símbolo en `main`. Y tras cada
merge, `git ls-remote --heads origin <rama>` tiene que devolver vacío; el
`--delete-branch` es un intento, no una comprobación.

**Escalera para «¿esta rama ya está dentro?»**, del más barato al que nunca falla:
1. `git ls-remote --heads origin <rama>` → ¿sigue viva?
2. `git cherry origin/main origin/<rama>` → compara por `patch-id`, sobrevive al
   squash; `−` = aplicado. **Solo fiable si la rama es de un commit**: con varios
   commits squasheados en uno, ninguno coincide y marca `+` (falso «pendiente»).
3. `git diff origin/main origin/<rama> -- <sus ficheros>` → vacío = el contenido
   está. Siempre vale.
