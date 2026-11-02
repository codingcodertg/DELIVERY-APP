---
name: no-borrar-el-worktree-sin-leer-el-exit
description: "Un release en segundo plano puede fallar en decisions-check sin haber empujado nada; borrar el worktree en la misma cadena que lo comprueba destruye el único commit (2026-10-31, D-782)."
metadata:
  node_type: memory
  type: feedback
  originSessionId: 83590ac0-88d3-4d5e-b9d3-888a2b15db49
  modified: 2026-10-31T23:52:13.683Z
---

El 2026-10-31 lancé D-781 en segundo plano; mientras corría, OTRA sesión fusionó su propio D-781 (#604, promos). Mi `sube.sh` cayó en `decisions-check` («D-781 va detrás de D-781») antes del push. Yo encadené «tail del log && pull && worktree remove --force && branch -D» en un solo comando: el `tail` mostró «781 exit 1» pero la cadena siguió y borré el worktree y la rama con el único commit del cambio. Lo recuperé por el sha (`git cat-file -t`, `git worktree add -b rama <sha>`), que sigue en el repo hasta que el gc lo barra.

**Why:** el número D lo decide el orden en que las ramas entran a main ([[numero-de-decision-lo-decide-el-merge]]), y otras sesiones (la laptop, el dueño) publican sin avisar; un release que fracasa deja el commit SOLO en la rama local.

**How to apply:** la limpieza del worktree va en un comando aparte, después de LEER «NNN exit 0» y el número de PR en el log, nunca encadenada con `&&` al `tail`. Si una sesión ajena mete un D entre medias, relanzar con el siguiente libre tras `git checkout -- .`. Si ya borré: buscar el sha en la salida del commit anterior y `git worktree add -b <rama> <ruta> <sha>`; quitar antes la junction de node_modules con `cmd /c rmdir`, nunca con `Remove-Item -Recurse` (seguiría el enlace y vaciaría el node_modules real).

**2026-11-02, tercera vez:** borré wt802 con «802 exit 1» en el log sin leerlo (una prueba contaba 9 CampoDecimal). La limpieza va SIEMPRE dentro de `if grep -q "NNN exit 0" log; then …; fi`, nunca en el mismo comando que lee el tail.
