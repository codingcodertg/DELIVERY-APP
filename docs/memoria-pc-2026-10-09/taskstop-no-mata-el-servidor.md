---
name: taskstop-no-mata-el-servidor
description: "TaskStop cierra el shell pero deja vivo el `next dev` hijo: el puerto sigue ocupado y contesta con el árbol ya cambiado."
metadata:
  node_type: memory
  type: feedback
  originSessionId: 39114734-431c-4e44-a77a-198be3f67540
  modified: 2026-09-24T03:13:30.605Z
---

`TaskStop` sobre el shell que lanzó `npx next dev -p NNNN` **no mata el `next dev`**. El shell se va,
la tarea sale «completada», y el proceso hijo sigue escuchando el puerto.

Lo que pasó el 2026-09-23: paré el servidor de un worktree, hice `git checkout` a otro commit en ese
mismo worktree y lancé un servidor nuevo. El nuevo murió al instante con `EADDRINUSE` —y esa muerte
llega como «exit code 0», así que no parece un fallo—. El puerto seguía respondiendo: era **el
servidor viejo, sirviendo el árbol que yo acababa de cambiar debajo**. Medí contra eso y me dio cero
filas en los cinco roles, que es justo la forma que tiene un resultado falso de parecer un hallazgo.

**Why:** un puerto que contesta 200 no dice qué código está sirviendo. Y el `exit 0` del proceso que
sí era mío hace que el fallo no se lea como fallo.

**How to apply:**
- Tras `TaskStop`, **liberar el puerto a mano** antes de volver a levantar:
  `Get-NetTCPConnection -LocalPort NNNN -State Listen` → `Stop-Process -Id <PID> -Force`, y volver a
  comprobar que ya no escucha.
- Mirar **la salida del servidor nuevo**, no solo que el puerto conteste: `EADDRINUSE` está ahí.
- Un puerto por árbol, y no reutilizar el mismo número al cambiar de commit.
- Si una medición da un cero redondo en todos los casos, sospechar del servidor antes que del código.
  Emparenta con [[comprobar-la-capa-que-manda]] y [[grep-de-una-linea-no-ve-la-estructura]].
