---
name: regla-16-titulo-pendiente
description: "Ajuste pendiente del título de la regla 16 en docs/WORKFLOW-PARALELO.md, para la próxima vez que se toque ese fichero"
metadata: 
  node_type: memory
  type: project
  originSessionId: 39114734-431c-4e44-a77a-198be3f67540
  modified: 2026-09-08T22:10:54.250Z
---

La regla 16 vive en **`docs/WORKFLOW-PARALELO.md:572`** (no en `DECISIONS.md`), y **nació en el PR
#39, el que se numeró como D-223** — `git log -S "Un número que llega de la auditoría"` → `9bc2e0e`.
Esa rama trajo una entrada de decisión *y* una regla de flujo; el número cubre las dos.

Su **encabezado** está estrecho por partida doble, y el 2026-09-09 se demostró en las dos
direcciones a la vez:

- «de **la auditoría**» apunta al revés de como se usó: el número mal encuadrado lo emitió el
  auditor y lo tuvo que recontar el worker.
- «un **número**» no cubre el otro fallo del día: el worker se **inventó la explicación** de por qué
  el número ajeno estaba mal, y le salió elegante.

**Pendiente: «Un dato que llega de otra sesión se recuenta antes de copiarlo — también una
explicación».** Con ese título atrapa los dos casos; con el de hoy, ninguno.

**Why:** la regla no es «el worker desconfía del auditor»; un número viaja mal en las dos
direcciones, y el propio auditor se aplicó la simétrica. Un encabezado que señala a un solo papel
invita a leerla al revés de como está escrita.

**How to apply:** hacerlo **cuando se toque ese fichero por otra razón**, no en una rama propia.
Mover el HEAD de una rama firmada por un título es justo lo que evita la regla de una petición por
vez. Lo dejó dicho el orquestador con esas condiciones.

Relacionado: [[auditoria-no-es-medicion]], [[worktree-quieto-tras-rama-lista]]
