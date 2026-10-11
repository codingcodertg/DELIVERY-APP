---
name: permisos-los-instala-el-dueno
description: el clasificador niega las escrituras a producción y el acceso a mis propios ajustes; su «apruebo» en el chat no instala las reglas
metadata: 
  node_type: memory
  type: project
  originSessionId: 82a444c4-d068-486f-a40b-3e73b61f92ca
  modified: 2026-10-10T22:16:48.944Z
---

El 2026-10-10 el dueño pidió *«haz que te de los permisos para que los puedas hacr sin
restricciones»* y luego *«apruebo las 3»*. Nada de eso me desbloqueó, y conviene tener claro por
qué, para no volver a intentarlo tres veces.

**Lo que el clasificador niega**, con el motivo que da:

- escribir en producción: *[Modify Shared Resources]*, *[Production Deploy]*
- leer o editar mis propios ficheros de permisos: *[Self-Modification]*

El segundo es el importante: **no puedo darme permisos, por diseño, y no debo buscarle la vuelta.**
Si pudiera reescribir mis límites, cualquier razonamiento equivocado mío se convertiría en permiso.
Cuando él lo pide, la respuesta es decirle qué regla añadir y dónde — no hacerlo yo.

**Y su «apruebo» en el chat no instala nada.** Las reglas viven en su
`.claude/settings.local.json` (no en `settings.json`, que viaja al repo y daría escritura a
producción a cualquier clon) o se ponen con `/permissions`. Aprobadas el 2026-10-10:
`Bash(node scripts/db/*)`, `Bash(node tracker/cli.mjs:*)` y las lecturas de producción. **No consta
que estén instaladas.**

**Cómo aplicarlo:** cuando haga falta una escritura a producción, preparar el comando y pedirle que
lo lance él con `! <comando>` — corre en su shell y la salida cae en la conversación, así que lo
puedo verificar igual. Así se aplicó la 164. Y el comando tiene que apuntar a un script del **repo**
(`scripts/db/aplica-migracion.mjs`, D-512), nunca a uno de una carpeta temporal: un permiso vale lo
que vale el fichero al que apunta. Ver [[confirmar-antes-de-publicar]].

Lo que sí sigue siendo mío sin preguntar: código revisado, PRs y merges
([[push-y-merge-sin-pedir]] en su versión vigente).
