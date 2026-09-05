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

## 2. Diseño — corregido el 2026-09-05 tras la aclaración del dueño

> **Nota del mismo día.** La primera versión de este plan proponía *no recargar*
> mientras el reloj corre. El dueño lo rechazó: *"sí quiero poder actualizar,
> pero que no se pierda la continuidad; que cuando se abra siga de donde dejó"*.
> Se conserva el texto original arriba (§1) y se sustituye el diseño. La regla 2
> de documentación: se anota, no se reescribe.

**La actualización se hace, y el reloj no se entera.** Lo que se pierde hoy no es
la sesión (ya está anclada en la base) sino la continuidad en el salto. El
diseño ataca los tres huecos medidos:

1. **Antes de recargar, dejar todo grabado.** Cuando el banner vaya a recargar (y
   en `pagehide` en general), la página del cronómetro escribe un **último latido
   inmediato** con `sendBeacon` y deja una **marca de reanudación** local
   (`tt_resume_<user>` con id de sesión e instante). Cuatro líneas en el sitio
   donde hoy ya está el `beforeunload`.
2. **Al abrir, reanudar sin pasar por el modo "mirón".** La adopción
   (`page.tsx:306-408`) reconstruye desde la base; si la confirmación falla por
   red, con marca de reanudación reciente **sigue contando y reintenta** en vez de
   quedarse mirando sin grabar (D-096 se conserva para la miga sin marca). Se
   re-arma el tick y `desktopStart` en el mismo paso, como ya hace `:391-393`, para
   que las capturas continúen sin hueco.
3. **El reloj sigue contando durante el salto**, porque el tiempo trabajado sale
   de `start_ms` y no del tick: una recarga de segundos o un reinicio de dos
   minutos no restan nada. Para que un **cierre corto** tampoco corte, el umbral
   de huérfana pasa de **5 a 15 minutos** sin latido (`LATIDO_MAX_MS`). Más allá
   de eso la sesión se cierra **en su último latido**, como hoy: ese es el freno
   que impide las 25 h fantasma, y el dueño puede ajustar el número.
4. **Parte B, el cron.** Un trabajo diario que cierre toda sesión `is_live` con
   más de 15 min sin latido, en su último latido, con la misma regla de
   `page.tsx:346-357`. Hoy no existe y la huérfana solo se cierra si alguien
   abre la pantalla. Vercel Hobby tiene sus 2 crons ocupados: se **fusiona con
   `roll-schedules`** (misma hora, mismo secreto) o va a GitHub Actions; se decide
   al implementar y se dice.
5. **F5 / Ctrl+R en `desktop/main.js`**: mismo tratamiento que la recarga del
   banner (grabar antes, reanudar después), no bloqueo.

## 3. Lo que NO se hace

- Capturar pantalla desde este repo: no es posible; el cliente de escritorio es
  otro proyecto. Queda escrito para que nadie lo prometa.
- Auto-stop por inactividad (`idle_seconds` existe pero nadie lo llena,
  `page.tsx:146`): deuda aparte, no de esta rama.
- Cambiar la regla de cierre en el último latido (solo su umbral, de 5 a 15 min).
- Ninguna migración. Ninguna escritura nueva salvo la del cron.

## 4. Verificación

`verify.mjs`; prueba de la marca de reanudación y del umbral (lógica pura extraída a `src/lib/timetracker/live-session.ts`); prueba de la regla del cron sobre datos sintéticos, sin
tocar producción (la ruta se prueba con `?verify=1` como el de fichaje). Nadie
puede reproducir la recarga con sesión real: lo firma el dueño arrancando el
cronómetro y forzando una versión nueva.
