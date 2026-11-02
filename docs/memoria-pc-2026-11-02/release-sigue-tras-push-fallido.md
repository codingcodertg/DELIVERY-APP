---
name: release-sigue-tras-push-fallido
description: "un push que falla por red no paraba el release: el guion leyó el Vercel del commit anterior, apuntó el tracker y encadenó la siguiente decisión con la misma versión"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 83590ac0-88d3-4d5e-b9d3-888a2b15db49
  modified: 2026-10-24T02:57:19.639Z
---

2026-10-23, D-661: GitHub dejó de responder justo en el `git push` de `sube.sh`. El push iba en una tubería (`| grep -v remote:`), así que su fallo no paraba nada; `gh pr create` falló («No commits between main and…»), `N` salió vacío, `gh pr checks` sin número dio PASS, el merge no hizo nada, el tracker creó T-0664 y «VERCEL success» era el estado del commit anterior de main (D-660). La cadena que esperaba ese «success» arrancó D-662 con la MISMA versión (1.381.0).

**Why:** cada paso comprobaba que el anterior «no dio error», no que hubiera hecho su efecto; y la tubería se tragaba el código de salida (lo mismo que [[tuberia-tapa-el-ci]]).

**How to apply:** tras el push, comparar `git ls-remote origin refs/heads/<rama>` con `HEAD`; tras crear el PR, exigir un número `pull/N`; antes de decir publicado, la versión de `/api/version` tiene que ser la nueva, no solo «VERCEL success». Una cadena de releases espera la versión nueva en producción, no una línea de log. Ver [[confirmar-despliegue-antes-de-decir-listo]].
