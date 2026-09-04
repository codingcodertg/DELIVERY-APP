# Instrucciones del proyecto

## Documentación viva en Notion — obligatorio

Existe una documentación viva de este proyecto en Notion, y **mantenerla al día
es parte de cada cambio**, no una tarea aparte:

**https://app.notion.com/p/RDZ-Deliveries-Documentaci-n-3c069c11154f812a8684e0d5737b3dbf**

Está para una situación concreta: que alguien que llega **sin ningún contexto**
—una persona nueva, o un asistente en una sesión limpia— pueda entender el
estado de la app y seguir trabajando leyendo solo eso.

Secciones: 📐 Arquitectura · 🗺️ Estado actual · ⚙️ Setup ·
🧠 Decisiones (ADR, base de datos) · 📝 Changelog (base de datos) ·
🔜 Próximos pasos.

### Reglas

1. **Cada cambio de código actualiza Notion en la misma sesión**, sin que nadie
   lo pida. Como mínimo, después de commitear:

   ```bash
   NOTION_TOKEN=ntn_... node scripts/notion/sync.mjs
   ```

   Eso agrega las decisiones y los commits nuevos. **Las páginas de prosa
   (Arquitectura, Estado actual, Setup, Próximos pasos) el script no las puede
   tocar** — si el cambio las afecta, se editan a mano. Detalle en
   `scripts/notion/README.md`.
2. **El historial nunca se borra.** Changelog y ADR solo crecen. Una decisión
   que cambia se marca *Reemplazada* y se escribe una nueva; un dato equivocado
   se corrige **con una nota dentro de la misma entrada**, no reescribiendo.
3. **Se escribe para quien no estuvo.** Nada de "se arregló el bug": qué
   fallaba, por qué, y qué se descartó.
4. **Un cambio de arquitectura toca dos páginas:** Arquitectura y su ADR.
5. Los números llevan fecha, porque envejecen.

El token de Notion **no vive en el repo**. Está en las variables de entorno de
Vercel (`NOTION_TOKEN`) y el asistente lo recibe del usuario cuando hace falta.

## Flujo por cada cambio

> **Quién hace cada paso.** Cuando se trabaja en paralelo (ver *Flujo de ramas*
> abajo) los pasos 1-2 y 5-6 son del **worker**, en su rama; los pasos 3, 7 y 8
> —versión, número `D-0XX` y migraciones— los hace el **orquestador al
> fusionar**, nunca la rama. Trabajando solo en `main` los haces todos tú, en
> este orden.

1. Implementar
2. `npx tsc --noEmit` y `npx vitest run` — o `node scripts/verify.mjs`, que corre
   los tres pasos (tipos, pruebas, build) e inyecta placeholders para las
   variables que falten. En un worktree es la única forma: allí no hay
   `.env.local`, a propósito.
3. Subir versión — **por app, no global** (D-087): en `src/lib/app-versions.ts`,
   sube SOLO la(s) app(s) que el cambio realmente tocó (`deliveries`,
   `recruiting`, `timetracker` — mapa `APP_VERSIONS`). Un cambio dentro de la
   carpeta propia de una app sube solo esa. Un cambio en código compartido
   (`src/lib/*.ts` fuera de `recruiting/`/`timetracker/`, componentes
   genéricos, `src/app/api`) es criterio tuyo: si dudas si afecta a las
   otras, súbelas las tres — un refresh de más es leve, una app que no se
   enteró de un cambio real se queda con código viejo en silencio.
   `package.json`'s `"version"` es aparte: la versión del repo/monorepo,
   súbela también si el cambio amerita marcarlo ahí.

   **Excepción — cambios solo de base de datos** (RLS, políticas, `guard_*`,
   `ANALYZE`, migraciones que no tocan código de cliente): suben **solo
   `package.json`**, **no** `APP_VERSIONS`. Subir un `APP_VERSION` fuerza un
   refresh del cliente (D-029/D-087) y un cambio que vive entero en la base no
   cambia nada que el cliente cargado deba volver a bajar. La regla general es
   "package.json **y** APP_VERSION"; esta es la única excepción, y es explícita,
   no criterio implícito: si el cambio toca *algo* de código de cliente, deja de
   ser solo-base y vuelve a la regla general.
4. `npx next build` (es más estricto que `dev`)
5. **Commit en una rama** — nunca en `main`
6. **Push de la rama** → `gh pr create --base main` → **CI en verde** → merge
   (squash). `git push origin main` no existe en este proyecto: la protección de
   rama lo rechaza
7. Ya fusionado: aplicar migraciones (con `migrate-status` antes y después),
   asignar la versión, y sustituir el marcador `D-NEXT` por el número `D-0XX`
   real. Si cambia el comportamiento: entrada en `DECISIONS.md` **y** en el ADR
   de Notion
8. Actualizar Notion (regla 1)

## Flujo de ramas

Tres papeles, tres sesiones: **orquestador** (checkout principal, en `main`),
**worker** (worktree en `.claude/worktrees/<rama>/`, escribe el código) y
**auditor** (solo lectura, revisa `main...<rama>` antes del PR). El detalle
operativo —comandos exactos, protocolo de mensajes, montaje— está en
`docs/WORKFLOW-PARALELO.md`; el auditor, en `.claude/agents/auditor-rtg.md`.
Aquí van solo las reglas que **no** se negocian.

### 1. Una rama nunca aplica una migración a producción

El worker **escribe** el `.sql` y lo commitea. Aplicarlo es del orquestador,
**después** del merge: `migrate-status` antes, aplicar, `migrate-status` después,
y el bloque de auto-registro tras `-- @ledger-below`. Un worktree aísla
ficheros, no la base: si un comando de la rama alcanza producción, producción se
entera igual.

Lo que **sí** se permite desde la rama: pruebas con `ROLLBACK`, de solo lectura.

### 2. La versión y el número `D-0XX` se asignan al fusionar

El worker **no** toca `package.json` ni `APP_VERSIONS`, y **no** numera su
decisión: escribe su entrada de `DECISIONS.md` con el marcador literal
**`D-NEXT`** en el título. El orquestador la numera al fusionar, en serie.

La razón: `DECISIONS.md` es append-only y su numeración es la columna vertebral
de la documentación. Dos ramas paralelas que se numeran solas producen dos
decisiones reclamando el mismo `D-0XX`, y eso no se arregla renumerando porque
otros documentos ya citan el número. El merge es el único punto que es serie.

### 3. Nadie pushea a `main` directo

Lo hace cumplir GitHub, no la buena voluntad. **Paso manual del dueño**, una vez,
en `github.com/codingcodertg/DELIVERY-APP`:

1. **Settings** → **Rules** → **Rulesets** → **New ruleset** → **New branch
   ruleset**.
2. Nombre: `main protegida`. **Enforcement status**: `Active`.
3. **Bypass list**: déjala **vacía**. (Si te añades como bypass, la regla no te
   protege a ti, que eres justo quien más empuja a `main`.)
4. **Target branches** → **Add target** → **Include default branch**.
5. Marca estas casillas:
   - **Restrict deletions**
   - **Block force pushes**
   - **Require a pull request before merging** → *Required approvals*: `0`
     (el auditor firma en el flujo, no en GitHub; súbelo a `1` si algún día
     alguien más revisa desde la web).
   - **Require status checks to pass** → **Add checks** → busca y añade
     **`tsc · vitest · build`** (es el `name:` del job en
     `.github/workflows/ci.yml`; aparece en la lista **después** del primer PR
     que lo haya corrido). Marca también **Require branches to be up to date
     before merging**.
6. **Create**.

Comprobación de que quedó puesta: `git push origin main` desde un checkout debe
ser **rechazado** por el servidor.

### 4. Los previews de Vercel usan variables de PRODUCCIÓN

Un deploy de preview de este proyecto apunta a la **misma base**: mismos datos,
mismos usuarios, mismas llaves de RingCentral/Twilio/Resend. **No es un sandbox.**
Un preview que escribe, escribe en producción; un preview que manda un SMS, lo
manda de verdad. Trata cualquier prueba en un preview como prueba en vivo, con la
regla permanente de arriba (stub, cuerpo saneado o sandbox) aplicada igual.

### 5. Modelo: Opus. Nunca Fable

Orquestador y worker en **Opus**; el auditor en **Opus o Sonnet**. **Fable no**
en ningún papel de este flujo. Se fija con `--model opus` al lanzar cada sesión y
en el `model:` del fichero del agente.

### Por qué `.env.local` no viaja al worktree

Claude Code copia a un worktree **solo** los ficheros ignorados que liste
`.worktreeinclude`. El de este repo está vacío a propósito y `.env.local` **no**
está ahí: lleva `SUPABASE_DB_URL` (Postgres directo a producción, con su
contraseña) y las llaves que mandan SMS, llaman por teléfono y cuestan dinero.
Una rama sin esas llaves no puede violar la regla de efectos en terceros aunque
quiera. Para compilar sin variables: `node scripts/verify.mjs`.

## Antes de cambiar comportamiento

Lee `DECISIONS.md`. Si una petición contradice una decisión registrada, **dilo
antes de implementarla** y cita la entrada: *"esto revierte D-012, que se
decidió porque X — ¿cambió esa razón?"*. No la bloquees; el negocio cambia y
las decisiones caducan. Pero que sea decisión consciente, no olvido.

## Las pruebas no disparan efectos reales en terceros — regla permanente

Ninguna prueba —automática, en vivo, manual, exploratoria— puede provocar un
efecto que salga de esta máquina y toque a una persona o cueste dinero:

- **No** mandar SMS, correos ni WhatsApp reales (RingCentral, Twilio, Resend).
- **No** iniciar llamadas reales (RingCentral RingOut).
- **No** gastar cuota de APIs de pago con datos de prueba (Google Maps/Routes,
  Mapbox) más allá de lo mínimo, y nunca en bucle.
- **No** escribir en sistemas de terceros ni en producción de datos que otros
  vean, salvo que la prueba sea exactamente eso y esté aprobada.

Para probar una ruta o un flujo que dispara uno de esos efectos: se **stubbea**
el proveedor, se **sanea el cuerpo** para que la ruta responda un error de
validación *antes* de llamar al proveedor, o se usa un **sandbox / número que no
enruta y está apagado**. Si no hay forma de probar sin disparar el efecto, se
para y se pregunta — no se dispara "para ver".

Origen: al verificar D-172 (sesión en las rutas abiertas) una prueba con sesión
inició un RingOut real a un número 555 porque no se saneó el cuerpo de
`/api/call`. No se repite.

## Antes de tocar RLS, triggers o permisos en producción

Cambiar una política RLS, un `guard_*`, un grant o el esquema **no se hace a
ciegas**: se entrega primero un plan en papel (inventario de lecturas y
escrituras, políticas literales, qué no debe romperse, matriz de pruebas por rol
con `ROLLBACK`, y el SQL de reversión), se espera aprobación, y **no se aplica en
producción sin un respaldo activo o un `pg_dump` reciente guardado**. El patrón
está en `docs/PLAN-A-2a-profiles-rls.md`.

## Registro de migraciones — obligatorio

`supabase/migrations/*.sql` se aplican a mano; `public.schema_migrations` es el
registro de cuáles corrieron en producción (D-184). El desfase entre repo y base
es cuestión de tiempo, así que:

1. **Antes de aplicar cualquier migración**, correr el estado:

   ```bash
   node scripts/db/migrate-status.mjs
   ```

   Lista lo pendiente (en repo, sin aplicar), lo cambiado (aplicado pero el
   fichero cambió después) y lo huérfano. Sale con código 1 si hay pendientes o
   cambiadas — que "¿qué falta aplicar?" sea un comando, no arqueología.
2. **Toda migración registra su fila.** Al final del `.sql`, tras el marcador
   `-- @ledger-below`, una línea que la auto-inscribe:

   ```sql
   -- @ledger-below
   insert into public.schema_migrations (name, checksum)
     values ('NNN_x.sql', '<sha>') on conflict (name) do nothing;
   ```

   El `<sha>` lo da `node scripts/db/migrate-status.mjs --sum NNN_x.sql` (sha256
   del cuerpo **anterior** al marcador, para que el propio registro no cambie el
   checksum). La tabla es admin-only para leer (RLS, `is_admin()`) y solo la
   escribe service-role o la propia migración (postgres) — ambos saltan RLS.
