# Plan — de "deliveries-app / RDZ Deliveries" a **RTG Hub**, con URL nueva

**Fecha:** 2026-09-04 · **Pedido por:** Andrés · **Estado:** plan en papel, pendiente
de aprobación · **Decisión:** se numera al fusionar (`D-NEXT`)

Decisiones ya tomadas por el dueño (2026-09-04): renombrar el proyecto de Vercel
**sin dominio propio** (la URL vieja muere; migración de golpe), y el alcance es
**todo**: nombre y título de la app, repositorio de GitHub, carpeta local y
`package.json`, y recompilar APK y app de escritorio.

## 1. Lo que se rompe cuando muera `deliveries-app-seven.vercel.app` (medido)

| Depende de la URL vieja | Dónde está cableada | Afectados |
|---|---|---|
| App Android (Capacitor) | `mobile/capacitor.config.ts:20` | quien tenga el APK instalado |
| App de escritorio (Electron) | `desktop/main.js:33` | quien tenga el `.exe` instalado |
| Cron de fichaje | `.github/workflows/tt-cron.yml:32` | cierre de turnos y avisos |
| Login (redirecciones de Supabase Auth) | panel de Supabase, no en el repo | **36 usuarios** |
| Push de fichaje (atadas al origen) | tabla `clockin.push_subscriptions` | **5 suscripciones** |
| Documentación | `ARCHITECTURE.md`, `DECISIONS.md`, handoff, READMEs | nadie en producción |

Y la marca, que está en **tres sitios distintos** y hoy ya es inconsistente:

| Dónde | Hoy | Nota |
|---|---|---|
| `settings.app_name` en la **base** (cabecera del hub) | `RDZ·DELIVERIES` | es **dato**, se cambia desde Ajustes, sin deploy |
| `layout.tsx`, `manifest.ts`, push, `email.ts`, `useLiveLocation.ts` | `RDZ Deliveries` | código |
| escritorio `productName` / hub `constants.ts:384` | `RDZ Hub` | ya decía Hub, pero **RDZ** |

El nombre nuevo es **RTG Hub** (RTG, no RDZ). El módulo de reparto **sigue
llamándose Deliveries**: es un módulo, no la app.

## 2. Lo que NO se toca, y por qué

- **`appId` de Android** (`net.rdztilegroup.deliveries`) y **`appId` de escritorio**
  (`net.rdztilegroup.hub`): cambiarlos convierte la app en **otra app** para el
  sistema; no se actualizaría encima, quedarían dos instaladas. Solo cambia el
  nombre visible.
- El proyecto de Supabase, los schemas, las tablas, las rutas internas
  (`/timetracker`, `/recruiting`, `/erp`).
- El repo `codingcodertg/timetracker` (instalador de TT, ruta de descarga).
- La etiqueta "Deliveries" del módulo en `MODULES` / `MODULE_ACCESS`.

## 3. Orden de operaciones — importa, porque la URL vieja muere de golpe

La ventana de rotura empieza en el paso 4 y se cierra en el 5. Todo lo anterior
se hace **antes** para que esa ventana sea de minutos.

| # | Paso | Quién | Rompe algo |
|---|---|---|---|
| 1 | Rama con los cambios de **nombre** en código (título, manifest, push, correo, live location, `productName`, `appName`, `package.json` name) y **sin** URL todavía | worker → auditor → PR → merge | no |
| 2 | Elegir el nombre del proyecto Vercel: `rtg-hub`. La URL resultante es **desconocida hasta renombrar** (`rtg-hub.vercel.app` si está libre, o con sufijo). | dueño decide | no |
| 3 | **Antes** de renombrar: en Supabase → Auth → URL Configuration, añadir a *Redirect URLs* las candidatas `https://rtg-hub.vercel.app/**` y `https://rtg-hub-rtg2.vercel.app/**` (dejando la vieja). | **dueño**, panel | no |
| 4 | **Renombrar el proyecto en Vercel** (Settings → General → Project Name). Leer la URL nueva real. Desde aquí la vieja deja de responder. | **dueño**, panel | **sí: APK, escritorio, cron, push** |
| 5 | Supabase Auth: *Site URL* → la nueva; quitar la vieja de *Redirect URLs*. | **dueño**, panel | cierra la rotura del login |
| 6 | Rama con la **URL nueva** en `tt-cron.yml`, `desktop/main.js`, `capacitor.config.ts`, docs. Merge. Verificar el cron con *Run workflow* (`verify=1`, no dispara nada). | worker → auditor → PR → merge | cierra cron |
| 7 | Recompilar **APK** y **escritorio** con nombre y URL nuevos, subir a Blob (D-170), avisar a la gente que reinstale. Hasta entonces sus apps no abren. | worker compila; **dueño** distribuye | cierra apps |
| 8 | Push: las 5 suscripciones mueren; cada persona vuelve a activar avisos en la app. Avisarles. | dueño | cierra push |
| 9 | Renombrar el **repo** en GitHub a `RTG-HUB`. GitHub redirige el nombre viejo. Actualizar `git remote`, `CLAUDE.md`, `WORKFLOW-PARALELO.md`, y `download/[app]/route.ts:48` (respaldo del instalador). Comprobar que Vercel sigue enlazado al repo. | dueño renombra; worker actualiza | no (redirige) |
| 10 | `settings.app_name` → `RTG·HUB` desde **Ajustes** de la app. | dueño | no |
| 11 | **Último**: renombrar la **carpeta local** a `rtg-hub`. Cambia la ruta de los tres paneles y de los worktrees: cerrar todo antes, recrear después. | dueño | solo tu máquina |

## 4. Riesgos y reversión

- **Sin respaldo de base** (F-3 diferido). Este plan **no toca la base**, salvo el
  dato `app_name` desde la UI. Aceptable.
- **Reversión del paso 4**: volver a poner `deliveries-app` como nombre en Vercel
  devuelve la URL vieja. Es la única marcha atrás que importa, y existe.
- **Vercel y el repo renombrado**: la integración de GitHub suele seguir el
  rename; se comprueba con un deploy de prueba en el paso 9, y si no, se
  re-enlaza desde Settings → Git.
- **Token de `gh` sin alcance `workflow`**: el paso 6 toca `.github/workflows`.
  Antes: `gh auth refresh -h github.com -s workflow`.
- **Nadie puede probar login/push/APK sin sesión real**: pasos 4-8 los valida el
  dueño en vivo. Que quede dicho.

## 5. Pasos que son solo del dueño (resumen)

Supabase Auth (3 y 5) · rename en Vercel (4) · distribuir instaladores y avisar
reinstalación (7) · avisar re-activar push (8) · rename del repo (9) · cambiar
`app_name` en Ajustes (10) · renombrar carpeta y reabrir paneles (11).

## 6. Decisión (`D-NEXT`)

Qué se pidió (literal), por qué la URL vieja muere (elección consciente frente al
dominio propio, que se descartó), qué NO cambia y por qué (appIds), el orden y su
razón (minimizar la ventana de rotura), y los 36 usuarios / 5 push / 2 binarios
afectados con fecha.
