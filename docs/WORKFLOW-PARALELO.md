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
| Donde queda | `<repo>/.claude/worktrees/<nombre>/`, **bloqueado** (`git worktree list` lo marca `locked`) |
| Como se llama la rama | **`worktree-<nombre>`** — Claude Code le pone ese prefijo. `claude -w prueba-flujo` crea la rama `worktree-prueba-flujo`. Medido, no supuesto |
| De donde ramifica | El ajuste `worktree.baseRef`: **`fresh`** (por defecto) ramifica de `origin/<rama-por-defecto>`; `head` ramifica de tu HEAD local |
| Ficheros ignorados que copia | **Solo** los que listes en `.worktreeinclude`, mas `.claude/settings.local.json`, que Claude Code copia por su cuenta (ver el aviso de abajo). `node_modules` **no** viaja: `npm ci` una vez en el worktree |
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

### El fichero que SI viaja aunque no lo pidas: `.claude/settings.local.json`

Medido: al crear un worktree, el unico fichero ignorado que aparece dentro es
`.claude/settings.local.json`. Claude Code lo copia por su cuenta, no por
`.worktreeinclude`. Es razonable —lleva la lista de permisos de la maquina— pero
tiene una consecuencia: **lo que metas en una regla de permiso viaja a cada
worktree**. Si una regla incluye una credencial en la linea de comando (por
ejemplo `Bash(MIGRATE_PASSWORD="..." node script.mjs)`), esa credencial se
replica. Reglas de permiso sin secretos dentro.

---

## 2. Los tres papeles

| | Orquestador | Worker | Auditor |
|---|---|---|---|
| **Donde** | checkout principal, en `main` | worktree `.claude/worktrees/<rama>/` | checkout principal (solo lee) |
| **Modelo** | lo decide el dueno | lo decide el dueno | lo decide el dueno |
| **Escribe codigo** | no | si | no |
| **Pushea** | no (fusiona por PR) | si, **solo su rama** | no |
| **Aplica migraciones** | si, **despues** del merge | no, jamas | no |
| **Sube version / numera D-0XX** | si, al fusionar | no | no |

---

## 3. Montarlo (una vez por tarea)

**Panel 1 — orquestador.** Es la sesion que ya tienes en el checkout principal.
Ponle nombre para que las otras la puedan direccionar:

```bash
cd "C:\Users\andre\Documents\CLAUDE\DELIVERIES APP\rtg-hub"
claude -n orquestador --model opus
```

**Panel 2 — worker.** Crea el worktree y la rama de un golpe:

```bash
cd "C:\Users\andre\Documents\CLAUDE\DELIVERIES APP\rtg-hub"
claude -w feat-nombre-corto -n worker --model opus
```

Queda en `.claude/worktrees/feat-nombre-corto/`, ramificado de `origin/main`
(ajuste `fresh`, el de fabrica). **La rama se llama `worktree-feat-nombre-corto`**,
con el prefijo que pone Claude Code — es el nombre que usaras en el `git push` y
en el `gh pr create`, asi que confirmalo antes de escribirlo:

```bash
git -C ".claude/worktrees/feat-nombre-corto" branch --show-current
```

Lo primero que hace el worker, una sola vez (el worktree llega **sin**
`node_modules`):

```bash
npm ci
```

**Panel 3 — auditor.** En el checkout principal, con el agente del repo:

```bash
cd "C:\Users\andre\Documents\CLAUDE\DELIVERIES APP\rtg-hub"
claude -n auditor --agent auditor-rtg --model opus
```

El agente vive en `.claude/agents/auditor-rtg.md`, versionado en el repo a
proposito: si el auditor fuera config local, cada maquina auditaria distinto.
(`.gitignore` ignora `.claude/*` pero exceptua `!.claude/agents/`.)

Comprueba que los tres se ven, y **apunta las direcciones reales**:

```
ListAgents
```

El nombre de cada fila **es** la direccion. Ojo con esto, que ya costo un
veredicto perdido: si lanzaste el panel 1 sin `-n orquestador`, esa sesion se
llama otra cosa (algo como `deliveries-app-be`), y un mensaje dirigido a
"orquestador" no llega a ninguna parte. `ListAgents` te dice el nombre de las
otras sesiones, pero el tuyo propio lo imprime en la primera linea de su
respuesta: **cada sesion tiene que decirle a las otras como se llama ella**, en
vez de suponer los nombres del documento.

Lo mas simple es lanzar el panel 1 con `-n orquestador` para que el nombre real
coincida con el del protocolo.

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
            Worktree: feat-nombre-corto (rama: worktree-feat-nombre-corto).
            Alcance: <que ficheros/areas SI>. Fuera de alcance: <que NO>.
            Decisiones que aplican: D-0XX, D-0YY.
            No subas version ni numeres la decision: eso lo hago yo al fusionar.
            Si tu cambio altera comportamiento, escribe la entrada de
            DECISIONS.md con el titulo marcado D-NEXT.
            Cuando pase `node scripts/verify.mjs`, avisa al auditor."
```

El **alcance escrito** no es burocracia: es contra lo que el auditor mide el
punto (i), scope creep. Sin alcance no hay forma de decir que sobra.

**Si le adelantas contexto al auditor, dile que NO audite todavia.** Adelantarle
el encargo mientras el worker trabaja es util —llega leido y con las decisiones
localizadas— pero un mensaje que nombra una rama, el auditor lo lee como "audita
esa rama". Ya paso dos veces: fue a mirar, encontro cero commits y se nego a
firmar, que es lo correcto por su parte y un viaje perdido por la tuya. Son **dos
mensajes distintos**:

```
SendMessage to: "auditor"
  message: "BRIEFING, NO AUDITES TODAVIA. Rama: <rama>. Lee <plan>.
            Espera a que el worker te avise; el te dira cuando hay commits."
```

y despues, cuando el worker haya avisado, la peticion de auditoria de verdad.

Lo que **si** puede hacer el auditor mientras espera, y conviene pedirselo: correr
`node scripts/verify.mjs` sobre la rama **sin tocar**, para tener la linea base. Sin
ella, luego no se distingue "lo rompio el worker" de "ya estaba roto".

### (2) Worker: trabaja, commitea, avisa al auditor

```bash
node scripts/verify.mjs          # tsc + vitest + build, con placeholders
git add -A
git commit -m "feat(x): ..."     # se queda LOCAL: aun no se pushea
```

```
SendMessage
  to: "auditor"
  message: "Rama worktree-feat-nombre-corto lista para auditoria.
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
git diff --stat main...worktree-feat-nombre-corto
git diff main...worktree-feat-nombre-corto        # entero
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
git push -u origin worktree-feat-nombre-corto
```

```
SendMessage
  to: "orquestador"
  message: "worktree-feat-nombre-corto pusheada y aprobada por el auditor. Abre el PR."
```

### (5) Orquestador: PR, CI, merge

```bash
gh pr create --base main --head worktree-feat-nombre-corto \
  --title "feat(x): ..." --body "<que hacia falta, por que, que se descarto>"
gh pr checks <n> --watch      # espera a que CI ponga verde
gh pr merge <n> --squash      # SIN --delete-branch, ver abajo
```

CI corre `.github/workflows/ci.yml`: tsc, vitest (reportando pasados|saltados) y
next build, con placeholders y **sin un solo secreto de produccion**. Tarda unos
dos minutos y medio. Ademas del check propio veras los de **Vercel**: recuerda
que su preview apunta a la base de **produccion** (seccion 6).

**`--delete-branch` falla mientras el worktree exista**, y el mensaje asusta mas
de lo que debe:

```
failed to delete local branch worktree-feat-nombre-corto:
  cannot delete branch ... used by worktree at '.../.claude/worktrees/...'
```

**El merge ya ocurrio**; lo unico que fallo es el borrado de la rama local.
Compruebalo antes de tocar nada, y luego limpia en el orden del paso (6):

```bash
gh pr view <n> --json state,mergeCommit --jq '{state, merge:.mergeCommit.oid}'
```

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

Y limpiar el worktree cuando la rama ya se fusiono. Claude Code lo crea
**bloqueado**, asi que `git worktree remove` a secas se niega; hay que quitar el
candado primero (o borrarlo con `claude rm <id>`, que ademas limpia el estado de
la sesion):

```bash
git worktree unlock ".claude/worktrees/feat-nombre-corto"
git worktree remove ".claude/worktrees/feat-nombre-corto"
git branch -d worktree-feat-nombre-corto     # si el merge fue squash: -D
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

## 7. Las dos cuentas de `gh` en esta maquina — RESUELTO, con un limite

**El sintoma, medido el 2026-09-04:** `gh pr create` respondia
`must be a collaborator (createPullRequest)` y el dispatch manual daba
`403: Must have admin rights`, aunque `git push` funcionaba perfectamente.

**La causa:** dos identidades distintas. `git` usa el Windows Credential Manager,
que guarda a `CARRERSRTG` (con permiso de escritura). `gh` estaba autenticado con
**otra** cuenta, `andresugarte14`, que sobre este repo solo tiene `READ`. De ahi
que el worker pudiera pushear y el orquestador no pudiera abrir el PR.

**El arreglo, ya aplicado por el dueno:** `gh auth login` entrando como
`CARRERSRTG`. Las dos cuentas conviven en el llavero; la activa se cambia con
`gh auth switch`. Comprobacion:

```bash
gh repo view codingcodertg/DELIVERY-APP --json viewerPermission   # -> WRITE
```

**El limite que queda:** el token de `CARRERSRTG` tiene los alcances `gist`,
`read:org` y `repo`, pero **no `workflow`**. Consecuencia concreta: un PR que
modifique `.github/workflows/*.yml` puede ser rechazado al empujarlo por `gh`.
El `git push` normal seguira funcionando, porque va por el Credential Manager,
que es otra credencial. Si algun dia toca cambiar un workflow y GitHub se queja
de alcances, la salida es `gh auth refresh -h github.com -s workflow`.

Alternativa que siempre funciona, por si las credenciales vuelven a enredarse:
el PR se abre **desde la web** con el enlace que GitHub imprime al pushear la
rama, y el CI corre igual, porque lo dispara el evento `pull_request` y no
importa quien lo abrio.

---

## 8. Proteccion de rama — paso manual del dueno

Todo lo anterior es una convencion hasta que GitHub la haga cumplir. Sin
proteccion, un `git push origin main` distraido se salta el flujo entero. Los
pasos exactos estan en la seccion **"Flujo de ramas"** de `CLAUDE.md` y hay que
hacerlos una vez en el dashboard de `codingcodertg/DELIVERY-APP`.

---

## 9. El ciclo probado de punta a punta — 2026-09-04

Antes de estrenar el flujo se corrio entero con un cambio trivial (un comentario
en `src/lib/app-versions.ts`), para que la primera vez que falle algo no sea con
codigo que importa. Resultado: **PR #1, fusionado**.

| Paso | Resultado | Evidencia |
|---|---|---|
| Worktree | ok | `.claude/worktrees/prueba-flujo/`, rama `worktree-prueba-flujo`, sin `.env.local` |
| `npm ci` + `verify.mjs` | ok | 704 pasados \| 3 saltados, build ok |
| Commit del worker | ok | `924386e`, sin subir version ni numerar decision |
| **Auditoria** | **APROBADO con nota** | el auditor corrio los nueve puntos y las tres verificaciones por su cuenta |
| Correccion del hallazgo | ok | `db083a9` |
| Push de la rama | ok | `worktree-prueba-flujo` en `origin` |
| PR | ok, tras arreglar `gh` | `#1` |
| CI | **verde en 2m30s** | run `33896670561`, los siete pasos en verde |
| Merge squash | ok | `281bfd9` en `main` |
| Limpieza | ok, con el tropiezo del candado | `unlock`, `remove`, `branch -D` |

**Lo que la prueba enseño, y ya esta corregido arriba:** la rama lleva prefijo
`worktree-`; el worktree nace bloqueado; `settings.local.json` viaja solo;
`node_modules` no viaja; `--delete-branch` falla si el worktree sigue vivo
aunque el merge si haya ocurrido; y las dos cuentas de `gh`.

**Lo que el auditor encontro.** No fue un simulacro: el comentario original
decia que dos ramas subiendo version chocan en silencio, y eso es al reves. Si
suben la misma app a numeros **distintos**, git da conflicto y te enteras. El
caso callado es que la suban al **mismo** numero: git funde el cambio identico
sin quejarse y los dos cambios salen bajo un solo bump, asi que el cliente que ya
tenia ese numero no vuelve a bajar nada (D-029/D-087). El auditor tambien
confeso lo que **no** pudo medir —no logro crear un repo temporal para probar el
merge— en vez de presentarlo como verificado. Eso es exactamente el estandar que
se le pide.

**Una rareza que al principio se anoto como "sin explicar", y resulto tener
causa: la cache `.next` corrupta.** Primero `next build` fallaba y pasaba al
reintentar, sin mensaje. Mas tarde empezo a fallar siempre, ya con error:
`uncaughtException [TypeError: Cannot read properties of undefined (reading
'length')]`, siempre en "Creating an optimized production build".

Se midio en vez de suponer, y el orden importa: **primero se descarto que fuera
el cambio propio**, guardando los cambios con `git stash` y compilando el commit
limpio que el CI ya habia dado verde. Fallo igual, o sea que no era el codigo.
Era el checkout: `.next` ocupaba **2,3 GB** y estaba corrupta.

```bash
rm -rf .next && node scripts/verify.mjs
```

Con eso el build volvio en verde. **La leccion practica:** si `next build` falla
en tu maquina y el CI de la misma rama esta verde, el sospechoso numero uno es tu
`.next`, no el codigo. Borrala antes de dudar del cambio. Y la leccion de metodo:
"falla a veces" casi nunca es azar, es una causa que todavia no se midio.

---

## 10. Lo que fallo en el primer encargo real — 2026-09-04

El primer bug de verdad (los clientes de Supabase robandose el schema) destapo
tres fallos del montaje, ninguno del codigo auditado. Se anotan porque los tres
tienen la misma forma: **una regla escrita en un sitio que el que la necesita no
lee**, que es exactamente el bug que se estaba arreglando.

**1. El auditor no tenia con que avisar.** Su definicion le daba `Read, Grep,
Glob, Bash` y nada mas. Emitio un APROBADO impecable, con la tabla de los nueve
puntos, y **no le llego a nadie**: lo escribio en su propio panel y ahi murio. El
orquestador se quedo esperando un mensaje que era imposible. Arreglado: el
agente ya tiene `SendMessage` y `ListAgents`, y la obligacion de entregar el
veredicto esta escrita **dentro del agente**, no solo en este documento. La
leccion general: si el protocolo pide una accion, el agente tiene que tener la
herramienta para hacerla, y comprobarlo es parte de montar el flujo.

**2. Las direcciones del protocolo eran nombres inventados.** Este documento
decia "manda el veredicto a `orquestador`", pero el panel 1 se habia lanzado sin
`-n orquestador` y en realidad se llamaba `deliveries-app-be`. Arreglado en la
seccion 3: las direcciones se sacan de `ListAgents`, y cada sesion dice como se
llama ella en vez de suponer.

**3. Las sesiones corrieron en un modelo que la regla prohibia, y la regla cayo.**
Medido en el transcript: el auditor corrio en `claude-fable-5-1`, que `CLAUDE.md`
prohibia entonces. El propio auditor lo confeso en su veredicto. **El dueno
revirtio la prohibicion el mismo dia** (necesita Fable), asi que hoy el modelo lo
decide el: ver la regla 5 de "Flujo de ramas" en `CLAUDE.md`, donde queda anotado
el cambio y lo que se midio. Lo que si sobrevive de este fallo es lo practico:
**comprueba el modelo con `/model` dentro de cada panel**, porque `--model` en la
linea de lanzamiento puede quedar pisado por el ajuste por defecto de la cuenta,
que es justo lo que paso aqui.

**Lo que si funciono, y conviene no perderlo de vista.** El auditor se nego a
firmar un veredicto sobre cero cambios cuando se le pidio auditar antes de que
el worker commiteara. Marco como "no verificado" lo unico que no pudo medir, en
vez de darlo por bueno. Y encontro por su cuenta la debilidad de fondo de la
prueba de regresion. El papel de auditor se gana el coste; lo que fallo fue la
tuberia, no el criterio.

---

## 11. Renombrar la carpeta del proyecto (paso 11 del rename a RTG Hub)

La carpeta pasa de `deliveries-app` a `rtg-hub`. **No se puede hacer desde dentro de
una sesion**: Windows no renombra una carpeta que tiene procesos con ella abierta,
y los tres paneles viven ahi. Orden:

1. Cerrar los tres paneles (`/exit` en cada uno). Sin excepciones: un panel
   abierto en un worktree tambien sujeta la carpeta.
2. Antes de cerrar, quitar los worktrees ya fusionados desde el checkout principal
   (`git worktree unlock` + `git worktree remove`), porque git los registra por
   ruta absoluta.
3. Renombrar en el Explorador o en PowerShell:
   `Rename-Item "C:\Users\andre\Documents\CLAUDE\DELIVERIES APP\deliveries-app" rtg-hub`
4. Entrar y reparar lo que git guardo con la ruta vieja:
   `cd "C:\Users\andre\Documents\CLAUDE\DELIVERIES APP\rtg-hub"` y
   `git worktree repair` — sale limpio si no quedaba ningun worktree.
5. `git status` debe seguir limpio y `git remote -v` igual: el remote no cambia
   con la carpeta.

**Lo que se pierde, y hay que saberlo antes:** Claude Code guarda las sesiones y la
memoria POR RUTA. Con la carpeta nueva, `claude --continue` arranca en blanco:
la conversacion del orquestador queda bajo la ruta vieja y se recupera con
`claude --resume` eligiendola en el selector (ctrl+a muestra todos los
proyectos), o se retoma con `docs/HANDOFF-*.md`, que existe para esto. El
`.worktreeinclude`, el agente auditor y `settings.local.json` viajan con la
carpeta y no se pierden.

---

## 12. El merge se condiciona al CI, siempre — porque hoy no lo hice

El 2026-09-05 el PR #7 se fusiono CON EL CI EN ROJO. No lo paro nadie: la
proteccion de rama sigue sin existir (paso del dueno, pendiente desde el primer
dia) y el comando del orquestador encadenaba `gh run watch` y `gh pr merge` sin
condicionar el segundo al primero. La prueba que fallaba resulto ser una prueba
dependiente del reloj y `main` no quedo roto, pero eso fue suerte, no proceso.

Regla desde hoy, hasta que exista la proteccion de rama:

```bash
gh pr checks <n> --watch --fail-fast && gh pr merge <n> --squash
```

El `&&` es la regla: sin verde no hay merge. Y si el CI falla por algo que no es
del PR (una prueba flaky, la cache), se arregla o se investiga ANTES de fusionar,
no despues. Un merge con CI rojo convierte al siguiente PR en el que "hereda" el
rojo, y ahi ya nadie sabe de quien es.

Lo que de verdad lo impide es el ruleset de GitHub con el check `tsc · vitest ·
build` como obligatorio: con eso puesto, `gh pr merge` rechaza fusionar en rojo
aunque el orquestador se equivoque. Sigue siendo el paso mas importante que
falta.

**Agujero que el `&&` no tapa (hallazgo del auditor, 2026-09-05):** si preguntas
por los checks antes de que GitHub haya registrado el job, `gh pr checks` puede
responder "no checks reported" con exit 0, y el `&&` lo toma por verde. Antes de
esperar, comprueba que el check EXISTE:

```bash
until gh pr checks <n> 2>/dev/null | grep -q "tsc · vitest · build"; do sleep 10; done
gh pr checks <n> --watch --fail-fast && gh pr merge <n> --squash
```

---

## 13. Un solo `verify.mjs` a la vez por worktree (medido el 2026-09-05)

El worker y el auditor comparten worktree cuando el auditor entra a verificar la
rama. Si los dos corren `node scripts/verify.mjs` a la vez, se pisan en `.next`:
uno ve "Unexpected end of JSON input", el otro "Could not find a production
build". **Ninguno es del codigo.** Antes de repetir, comprobar que no hay otro
`next build` en marcha; y no confundirlo con la cache corrupta de la seccion 10
(esa es del checkout principal y se arregla con `rm -rf .next`).

Y la de la rama en conflicto: si un PR aparece sin ninguna ejecucion del CI y
solo con los checks de Vercel, mirar `gh pr view <n> --json mergeable`. GitHub
**no lanza `pull_request`** cuando no puede calcular el merge. La salida es
rebase del worker sobre `origin/main`, veredicto del auditor sobre el rebase
(solo comparar diff pre y post, no los nueve puntos), y `--force-with-lease`.
