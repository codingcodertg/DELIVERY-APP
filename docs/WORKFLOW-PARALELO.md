# Flujo paralelo: orquestador · worker · auditor

Tres sesiones de Claude Code en tres paneles, con papeles distintos y una sola
regla que las ata: **nadie escribe en `main` directo.** El codigo entra por rama,
lo revisa alguien que no lo escribio, y lo fusiona alguien que no lo escribio ni
lo reviso.

Escrito el 2026-09-04 contra **Claude Code 2.1.260**. Los comandos de aqui se
verificaron en esa version; si actualizas y algo no cuadra, gana lo que mides.

---

## 1. Lo que se verifico de esta version

| Cosa | Como esta en 2.1.260 |
|---|---|
| Version | `claude --version` → `2.1.260 (Claude Code)` |
| Crear worktree | `claude -w <nombre>` (o `--worktree <nombre>`) |
| Donde queda | `<repo>/.claude/worktrees/<nombre>/`, en una rama nueva |
| De donde ramifica | El ajuste `worktree.baseRef`: **`fresh`** (por defecto) ramifica de `origin/<rama-por-defecto>`; `head` ramifica de tu HEAD local |
| Ficheros ignorados que copia | **Solo** los que listes en `.worktreeinclude` (un patron por linea, en la raiz del repo). Sin ese fichero no copia **nada** ignorado |
| Mensajeria entre sesiones | `ListAgents` para ver quien hay, `SendMessage` para escribirle. El **nombre** de la sesion es la direccion |
| Nombrar una sesion | `claude -n "<nombre>"` — sale en el prompt, en `/resume` y en `ListAgents` |
| Vista de agentes | `claude agents` (agentes en segundo plano); `claude --bg`, `claude attach <id>`, `claude logs <id>`, `claude stop <id>`, `claude rm <id>` |
| Entrar/salir de worktree en vivo | Herramientas `EnterWorktree` / `ExitWorktree` dentro de la sesion |

### El punto que mas importa: `.env.local` NO viaja al worktree

Esta version copia **unicamente** lo que diga `.worktreeinclude`. Este repo lleva
uno, y esta deliberadamente vacio de secretos. `.env.local` **no se copia**, y no
debe copiarse: lleva `SUPABASE_DB_URL` (Postgres directo a produccion, con su
contrasena) ademas de las llaves de RingCentral, Twilio, Resend y Google Maps.
Un worktree con ese fichero es una rama con linea de mando a produccion y con
credenciales que mandan SMS y cuestan dinero.

Consecuencia practica: en un worktree, `next build` no tiene variables. Por eso
existe **`node scripts/verify.mjs`**, que inyecta los mismos placeholders que el
CI y corre los tres pasos. Usalo en vez de los comandos sueltos.

---

## 2. Los tres papeles

| | Orquestador | Worker | Auditor |
|---|---|---|---|
| **Donde** | checkout principal, en `main` | worktree `.claude/worktrees/<rama>/` | checkout principal (solo lee) |
| **Modelo** | Opus | Opus | Opus (o Sonnet) — **nunca Fable** |
| **Escribe codigo** | no | si | no |
| **Pushea** | no (fusiona por PR) | si, **solo su rama** | no |
| **Aplica migraciones** | si, **despues** del merge | no, jamas | no |
| **Sube version / numera D-0XX** | si, al fusionar | no | no |

---

## 3. Montarlo (una vez por tarea)

**Panel 1 — orquestador.** Es la sesion que ya tienes en el checkout principal.
Ponle nombre para que las otras la puedan direccionar:

```bash
cd "C:\Users\andre\Documents\CLAUDE\DELIVERIES APP\deliveries-app"
claude -n orquestador --model opus
```

**Panel 2 — worker.** Crea el worktree y la rama de un golpe:

```bash
cd "C:\Users\andre\Documents\CLAUDE\DELIVERIES APP\deliveries-app"
claude -w feat-nombre-corto -n worker --model opus
```

Queda en `.claude/worktrees/feat-nombre-corto/`, en la rama del mismo nombre,
ramificada de `origin/main` (ajuste `fresh`, el de fabrica). Lo primero que hace
el worker, una sola vez:

```bash
npm ci
```

**Panel 3 — auditor.** En el checkout principal, con el agente del repo:

```bash
cd "C:\Users\andre\Documents\CLAUDE\DELIVERIES APP\deliveries-app"
claude -n auditor --agent auditor-rtg --model opus
```

El agente vive en `.claude/agents/auditor-rtg.md`, versionado en el repo a
proposito: si el auditor fuera config local, cada maquina auditaria distinto.
(`.gitignore` ignora `.claude/*` pero exceptua `!.claude/agents/`.)

Comprueba que los tres se ven:

```
ListAgents
```

Debe listar `orquestador`, `worker` y `auditor`. Ese nombre **es** la direccion.

---

## 4. El protocolo, mensaje por mensaje

La mensajeria es la herramienta `SendMessage` **dentro** de la sesion, no un
comando de shell. El texto que escribes en pantalla no lo ve nadie mas; para
hablarle a otra sesion hay que llamar a la herramienta.

### (1) Orquestador → worker: la tarea

```
SendMessage
  to: "worker"
  message: "Tarea: <una frase con el resultado esperado>.
            Rama: feat-nombre-corto.
            Alcance: <que ficheros/areas SI>. Fuera de alcance: <que NO>.
            Decisiones que aplican: D-0XX, D-0YY.
            No subas version ni numeres la decision: eso lo hago yo al fusionar.
            Si tu cambio altera comportamiento, escribe la entrada de
            DECISIONS.md con el titulo marcado D-NEXT.
            Cuando pase `node scripts/verify.mjs`, avisa al auditor."
```

El **alcance escrito** no es burocracia: es contra lo que el auditor mide el
punto (i), scope creep. Sin alcance no hay forma de decir que sobra.

### (2) Worker: trabaja, commitea, avisa al auditor

```bash
node scripts/verify.mjs          # tsc + vitest + build, con placeholders
git add -A
git commit -m "feat(x): ..."     # se queda LOCAL: aun no se pushea
```

```
SendMessage
  to: "auditor"
  message: "Rama feat-nombre-corto lista para auditoria.
            Worktree: .claude/worktrees/feat-nombre-corto/
            Tarea encargada: <copia literal del alcance que recibi>.
            verify.mjs: <pasados> pasados | <saltados> saltados, build ok.
            ¿Trae migracion? si/no — y NO la he aplicado."
```

### (3) Auditor: revisa y da veredicto a los dos

Recorre los nueve puntos de `.claude/agents/auditor-rtg.md`. El diff se lee con
tres puntos, contra el ancestro comun:

```bash
git fetch origin
git diff --stat main...feat-nombre-corto
git diff main...feat-nombre-corto        # entero
```

Y corre las verificaciones **en el worktree del worker**, no en el suyo:

```bash
cd ".claude/worktrees/feat-nombre-corto" && node scripts/verify.mjs
```

Luego manda el mismo veredicto a los dos:

```
SendMessage to: "worker"        message: "VEREDICTO: ... (tabla de 9 puntos)"
SendMessage to: "orquestador"   message: "VEREDICTO: ... (tabla de 9 puntos)"
```

- **CAMBIOS** → vuelve al paso (2). El worker arregla y re-avisa.
- **RECHAZADO** → el orquestador decide: replantear o descartar la rama.
- **APROBADO** → sigue el paso (4).

### (4) Worker: pushea SU rama (y solo la suya)

```bash
git push -u origin feat-nombre-corto
```

```
SendMessage
  to: "orquestador"
  message: "feat-nombre-corto pusheada y aprobada por el auditor. Abre el PR."
```

### (5) Orquestador: PR, CI, merge

```bash
gh pr create --base main --head feat-nombre-corto \
  --title "feat(x): ..." --body "<que hacia falta, por que, que se descarto>"
gh pr checks --watch          # espera a que CI ponga verde
gh pr merge --squash --delete-branch
```

CI corre `.github/workflows/ci.yml`: tsc, vitest (reportando pasados|saltados) y
next build, con placeholders y **sin un solo secreto de produccion**.

### (6) Orquestador, DESPUES del merge y en este orden

```bash
git checkout main && git pull

# a) migraciones — solo aqui, nunca desde la rama
node scripts/db/migrate-status.mjs        # que dice antes de aplicar
#    ... aplicar el .sql, con su bloque tras -- @ledger-below ...
node scripts/db/migrate-status.mjs        # que dice despues: "todo al dia"

# b) version: package.json + la(s) app(s) de APP_VERSIONS que se tocaron
#    (solo-base = solo package.json — excepcion escrita en CLAUDE.md)

# c) numerar la decision: D-NEXT -> D-0XX, en serie
```

Y limpiar el worktree cuando la rama ya se fusiono:

```bash
git worktree remove ".claude/worktrees/feat-nombre-corto"
```

---

## 5. Por que la version y el numero D-0XX se asignan al fusionar

Dos ramas en paralelo que suben version cada una producen un conflicto en
`package.json` en el mejor caso, y dos decisiones reclamando el **mismo** D-0XX
en el peor. `DECISIONS.md` es append-only y su numeracion es la columna
vertebral de la documentacion: un numero duplicado no se arregla renumerando,
porque otros documentos ya citan el numero.

La salida es que el numero se asigne **en serie, en el unico punto que es
serie**: el merge. El worker escribe su entrada con el marcador literal
`D-NEXT`; el orquestador lo sustituye por el numero real al fusionar. Lo mismo
con la version: quien fusiona sabe que apps se tocaron de verdad.

---

## 6. Cuatro cosas que este flujo NO te da

1. **El preview de Vercel no es un sandbox de base de datos.** Los deploys de
   preview de este proyecto usan las variables de entorno de **produccion**:
   misma base, mismos datos, mismos usuarios. Un preview que escribe, escribe en
   produccion. Trata cualquier prueba en un preview como una prueba en vivo.
2. **CI no prueba la base.** Corre tipos, unitarias y build. Ninguna politica
   RLS, ningun `guard_*`, ningun trigger se verifica ahi. Eso sigue siendo la
   matriz rol × accion con `ROLLBACK`, a mano, con respaldo hecho.
3. **El auditor no sustituye al dueno.** Aprueba que el cambio este bien hecho,
   no que deba hacerse. Un cambio que contradice un `D-0XX` lo cita y para: lo
   decide Andres.
4. **Un worktree no aisla la base.** Aisla ficheros. Si un comando de la rama
   alcanza produccion, produccion se entera igual. Por eso `.env.local` no viaja.

---

## 7. Proteccion de rama — paso manual del dueno

Todo lo anterior es una convencion hasta que GitHub la haga cumplir. Sin
proteccion, un `git push origin main` distraido se salta el flujo entero. Los
pasos exactos estan en la seccion **"Flujo de ramas"** de `CLAUDE.md` y hay que
hacerlos una vez en el dashboard de `codingcodertg/DELIVERY-APP`.
