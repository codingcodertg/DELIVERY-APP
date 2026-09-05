# Plan — el cronómetro de Time Tracker sobrevive a la actualización, y se cierra solo cuando de verdad no hay nadie

**Fecha:** 2026-09-05 · **Pedido por:** Andrés · **Estado:** plan en papel,
pendiente de aprobación · **Decisión:** `D-NEXT` al fusionar

**Petición literal:** *"el time tracker si se actualiza me hace stop el timer,
entonces quiero que aunque se cierre el app o se actualice o reinicie el timer
siempre estará prendido y que sienta cuando la app ya está online de nuevo para
seguir tomando screenshots y así no perder tiempo contando"*.

## 1. Lo medido

- **La causa exacta:** el banner de actualización está montado dentro de Time
  Tracker (`(timetracker)/layout.tsx:81`) y, al volver a la pestaña con versión
  nueva, hace `window.location.reload()` sin preguntar
  (`AppUpdateBanner.tsx:93-107`). La guarda `safeToReload` (`app-update.ts:82-87`)
  solo mira si hay un modal o un campo enfocado: **no sabe que hay un cronómetro
  corriendo**. Se escribió para el chofer (D-029) y Time Tracker la heredó con el
  versionado por app (D-087) sin revisar la premisa.
- **La recarga NO borra la sesión.** El cronómetro ya está anclado en la base
  (`sessions.is_live` + `start_ms`) y al reabrir se reconstruye
  (`page.tsx:306-408`). Lo que se pierde es la **continuidad**: si la confirmación
  contra el servidor falla, entra en modo "mirón" que no graba latidos ni capturas
  (D-096); y si pasan más de 5 min sin latido, la siguiente apertura la cierra
  como huérfana en su último latido (`page.tsx:346-357`). Eso es lo que se ve como
  "se paró".
- **Frenos que ya existen y hay que conservar:** miga local caduca a 18 h (D-096),
  huérfana a los 5 min sin latido, una sola sesión viva por persona (mig. 092),
  sin solapes (mig. 082), auto-stop por bloqueo del PC solo en escritorio.
- **Freno que falta:** **no hay ningún cron que cierre sesiones huérfanas.** El
  guardián de los 5 min solo corre cuando alguien abre la pantalla. Una sesión de
  alguien que se fue sigue `is_live` para siempre y aparece en "Trabajando ahora".
  El repo ya pagó esto dos veces: **25,75 h** con cero actividad (D-098) y
  **10,42 h** de una noche con la máquina apagada (`page.tsx:341`).
- **Capturas: no se pueden arreglar aquí.** `desktop/` de este repo es la cáscara
  RTG Hub y **no captura nada** (cero `desktopCapturer`, y no expone `ttDesktop` a
  propósito, D-166). Quien captura es el cliente de escritorio de Time Tracker,
  que vive en **otro repositorio**. Lo que sí está aquí y ya funciona: las
  capturas offline se guardan y se suben al volver la red (`offlineQueue.ts:144`),
  y tras la reconstrucción se re-arma la captura (`page.tsx:391-393`).

## 2. Diseño, en dos partes

**Parte A — sobrevivir a la actualización (la queja tal cual):**
1. La página del cronómetro marca el documento mientras `running`
   (`data-tt-running` en `<html>`), y `safeToReload` devuelve `false` si esa marca
   existe. El banner se queda visible con **"Actualizar ahora"** para que la persona
   decida al parar; nunca recarga sola con el reloj corriendo. Cuatro líneas,
   cubiertas por `app-update.test.ts`, que ya prueba `safeToReload`.
2. Un **latido final** con `navigator.sendBeacon` en `pagehide`, para que un
   cierre de pestaña o del PC deje el último `end_ms` grabado en vez de perder
   hasta 10 s.
3. Misma guarda para **F5 / Ctrl+R en `desktop/main.js`**, que hoy recargan sin
   preguntar.

**Parte B — cerrarse solo cuando no hay nadie (el freno):**
4. Un cron diario en `vercel.json` (`/timetracker/api/close-orphans`, con el
   mismo `CRON_SECRET`, guardia `cronAuthorized`) que cierre toda sesión
   `is_live` cuyo último latido tenga más de N minutos, **en su último latido**,
   exactamente la regla que ya aplica `page.tsx:346-357`. Sin esto, "siempre
   prendido" es cómo se llegó a las 25 h.
   Vercel Hobby admite solo 2 crons y ya están ocupados: o se **fusiona con
   `roll-schedules`** (misma hora, mismo secreto) o va a GitHub Actions como el de
   fichaje. Se decide al implementar, y se dice.

## 3. Lo que NO se hace

- Capturar pantalla desde este repo: no es posible; el cliente de escritorio es
  otro proyecto. Queda escrito para que nadie lo prometa.
- Auto-stop por inactividad (`idle_seconds` existe pero nadie lo llena,
  `page.tsx:146`): deuda aparte, no de esta rama.
- Cambiar el mecanismo de adopción ni los frenos existentes.
- Ninguna migración. Ninguna escritura nueva salvo la del cron.

## 4. Verificación

`verify.mjs`; prueba nueva en `app-update.test.ts` (con marca → no recarga; sin
marca → igual que hoy); prueba de la regla del cron sobre datos sintéticos, sin
tocar producción (la ruta se prueba con `?verify=1` como el de fichaje). Nadie
puede reproducir la recarga con sesión real: lo firma el dueño arrancando el
cronómetro y forzando una versión nueva.
