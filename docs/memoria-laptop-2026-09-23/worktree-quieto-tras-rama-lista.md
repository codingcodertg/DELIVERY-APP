---
name: worktree-quieto-tras-rama-lista
description: "Quien revisa mide un commit concreto: decir cuándo un HEAD deja de ser final, y no empujar lo que nadie ha revisado"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 39114734-431c-4e44-a77a-198be3f67540
  modified: 2026-09-08T21:18:01.717Z
---

Acordado el 2026-09-08 entre worker, auditor y orquestador, y adoptado por el orquestador como
regla del flujo paralelo: **tras «rama lista», el worktree queda quieto hasta el veredicto.** Si
llega un cambio a mitad de la auditoría, se avisa al auditor **antes** de tocar nada y él para.

**Why:** el auditor mide un árbol concreto. Si cambia bajo sus pies, sus mediciones dejan de
corresponder al commit que va a firmar, y además los dos procesos chocan en `.next` (el síntoma
fue `ENOENT … .next\build-manifest.json` al prerenderizar, que parece un fallo del código y no lo
es). La regla anterior cubría solo `.next`; el acuerdo la extiende al worktree entero.

**How to apply:** al mandar «rama lista», incluir HEAD **y hora**. Después, no editar ficheros ni
correr builds. Si el orquestador pide un cambio, mandar primero un mensaje al auditor diciendo que
ese HEAD ya no es final y esperar a que confirme que ha parado; al terminar, nuevo HEAD + hora +
verify, y él re-verifica justo antes de firmar. `.next` se declara explícitamente de quién es.

**Ampliación (2026-09-11): el empujón también espera.** El orden fue firma → empujé → llegó
trabajo nuevo del orquestador → cambié → empujé, así que `origin` tuvo un rato un commit que
nadie había auditado. Lo canté por delante, pero eso no lo arregla: **un remoto con un commit sin
firmar no se distingue de uno con todo firmado**, y quien lo mire después no tiene cómo saberlo.
La regla: **si llega trabajo nuevo después de la firma, no se empuja hasta la firma nueva.**

**El papel de auditor se retiró el 2026-09-15** (decisión del dueño): quedan el orquestador y
dos workers, y **revisa el orquestador, por SHA y con `git show`, no sobre mi árbol**. Con eso
decae la parte de congelar el worktree —nadie mide ahí— y `.next` deja de ser territorio
compartido mientras cada uno trabaje en el suyo. Lo que **no** decae, y es lo que hay que
seguir haciendo:

- **Avisar cuando un HEAD deja de ser final.** Si cambio la rama después de haber dicho
  «lista», lo digo antes de tocarla; quien revisa no tiene otra forma de saber que su commit
  envejeció.
- **No empujar hasta que quien revisa lo diga.** La razón de 2026-09-11 sigue entera: un remoto
  con un commit sin revisar no se distingue de uno con todo revisado.
- **Quedarme quieto si me lo piden**, aunque ya no sea el caso por defecto.

Relacionado: [[auditoria-no-es-medicion]]
