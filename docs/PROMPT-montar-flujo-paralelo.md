# Prompt para montar el flujo orquestador · worker · auditor en OTRO proyecto

Pegar el bloque de abajo como primer mensaje en una sesión nueva de Claude Code,
dentro del proyecto donde se quiera montar. Lleva incorporadas las lecciones que
costaron tiempo el 2026-09-04 al montarlo aquí por primera vez, para que no haya
que redescubrirlas.

La implementación de referencia es este repositorio:
`docs/WORKFLOW-PARALELO.md`, `.claude/agents/auditor-rtg.md`,
`.github/workflows/ci.yml`, `scripts/verify.mjs`, `.worktreeinclude`, y la
sección "Flujo de ramas" de `CLAUDE.md`.

---

```
Quiero montar en este proyecto un flujo de trabajo en paralelo con tres papeles,
cada uno en su terminal: ORQUESTADOR (esta sesión, checkout principal), WORKER
(escribe código en un worktree, en su propia rama) y AUDITOR (solo lectura,
revisa el diff antes del PR). Nadie empuja a la rama principal directo.

PRIMERO MIDE, NO SUPONGAS. Antes de crear nada:
- `claude --version` y aprende este proyecto: lenguaje, gestor de paquetes,
  cómo se compila, cómo se prueban, si hay CI, si hay CLAUDE.md, si hay un
  registro de decisiones, y qué variables de entorno necesita para compilar.
- Comprueba cómo se comporta `claude -w <nombre>` en esta versión: dónde deja el
  worktree, CÓMO SE LLAMA LA RAMA que crea (puede llevar prefijo), si el worktree
  queda bloqueado, y qué ficheros ignorados copia.
- Comprueba cómo se hablan las sesiones entre sí en esta versión.
Reporta lo medido ANTES de crear nada. Si algo no cuadra con lo que te digo aquí,
gana lo que mides, y dilo.

LUEGO CREA, adaptado a ESTE proyecto y no copiado a ciegas:

1. CI en cada PR a la rama principal: tipos, pruebas y compilación, con los
   comandos reales de este proyecto. Sin un solo secreto de producción: si la
   compilación necesita variables, usa valores placeholder inventados y
   documenta cuáles. El conteo de pruebas debe reportar PASADAS y SALTADAS por
   separado, nunca un solo número, y las saltadas no deben hacer fallar el job.

2. El auditor como subagente versionado en el repo. IMPORTANTE, esto costó un
   veredicto perdido: dale herramientas de SOLO LECTURA más las de mensajería.
   Sin Edit ni Write, pero CON las herramientas para mandar mensajes y para
   listar sesiones. Un auditor sin con qué avisar emite el veredicto en su propia
   pantalla y no le llega a nadie. Y escribe DENTRO del agente la obligación de
   entregar el veredicto a los dos, no solo en el documento del flujo.

   Su checklist debe salir de LAS CLASES DE BUG QUE ESTE PROYECTO YA COMETIÓ.
   Léete el historial de git y el registro de decisiones si existe, y saca de ahí
   los puntos. Los genéricos que sirven en cualquier repo: (a) el diff completo
   contra el alcance encargado, sin scope creep; (b) ¿contradice alguna decisión
   registrada? cítala; (c) ¿hay migraciones o cambios de esquema, y se aplicaron
   desde la rama en vez de después del merge?; (d) tipos, pruebas y compilación
   corridos por él en el worktree; (e) ¿la interfaz promete algo que el sistema no
   hace?; (f) ¿alguna prueba dispara efectos reales fuera de la máquina?
   Veredicto siempre: APROBADO / CAMBIOS (lista numerada con archivo:línea) /
   RECHAZADO (por qué). Y la obligación de decir "no verificado" en vez de dar
   por bueno lo que no midió.

3. Un script que corra las tres verificaciones en un comando, inyectando
   placeholders para las variables que falten. Hace falta porque un worktree
   NO recibe el fichero de variables de entorno, y sin él la compilación falla.
   Así "verde en el worktree" y "verde en el PR" significan lo mismo.

4. Un fichero que controle qué ficheros ignorados se copian al worktree, y
   déjalo SIN secretos a propósito, con la razón escrita dentro. Un worktree con
   las credenciales de producción es una rama con línea de mando a producción.

5. Un documento del flujo con los comandos exactos de esta versión y el
   protocolo de mensajes entre las tres sesiones.

6. La sección del flujo en el CLAUDE.md del proyecto, o créalo si no hay.

REGLAS QUE EL FLUJO DEBE DEJAR ESCRITAS:
- Una rama nunca aplica migraciones ni cambios de esquema a producción. El worker
  escribe el fichero; el orquestador lo aplica DESPUÉS del merge.
- La versión y el número de decisión se asignan AL FUSIONAR, por el orquestador,
  en serie. El worker no sube versión y marca su entrada con un marcador
  literal tipo "D-NEXT" que el orquestador sustituye. Razón: dos ramas paralelas
  que se numeran solas reclaman el mismo número, y eso no se arregla renumerando
  porque otros documentos ya lo citan.
- Nadie empuja a la rama principal directo: protección de rama en el servidor.
  Dame los pasos exactos del panel, porque ese paso es mío.
- Si los despliegues de vista previa usan variables de producción, dilo: no son
  un entorno de pruebas.

TRAMPAS YA CONOCIDAS, no las redescubras:
- La rama del worktree puede NO llamarse como el worktree. Confírmalo antes de
  usar el nombre en un push o en un PR.
- El worktree puede nacer bloqueado: borrarlo requiere desbloquearlo primero.
- Borrar la rama al fusionar falla mientras el worktree la tenga tomada, con un
  mensaje que parece decir que el merge no ocurrió. Sí ocurrió: compruébalo antes
  de tocar nada.
- El fichero de permisos locales de la sesión SÍ viaja al worktree. Si alguna
  regla de permiso lleva una credencial escrita dentro, se replica en cada uno.
- El nombre de la sesión orquestadora NO es "orquestador" salvo que se lance con
  ese nombre. Las direcciones se sacan de la lista de sesiones, no se suponen.
- Si le adelantas contexto al auditor mientras el worker trabaja, dile
  EXPLÍCITAMENTE que no audite todavía. Si no, va a mirar, encuentra cero commits
  y se niega a firmar, que es correcto por su parte y un viaje perdido por la tuya.
- Antes de tocar nada, que el auditor tome la LÍNEA BASE de las pruebas sobre la
  rama limpia. Sin ella luego no se distingue "lo rompió el worker" de "ya estaba
  roto".
- Si la compilación falla en local y el CI de la misma rama está verde, sospecha
  de la caché de compilación antes que del código.

AL FINAL, PRUEBA EL CICLO ENTERO con un cambio trivial, por ejemplo un
comentario: worker, auditor, PR, CI, merge. Reporta cada paso con evidencia. Si
algo del protocolo no funciona en esta versión, dímelo en vez de improvisarlo.

Reporta: lo verificado de la versión, el plan corto, lo creado, los pasos de
protección de rama que me tocan a mí, y el resultado de la prueba. PARA antes de
usarlo en una tarea real.
```
