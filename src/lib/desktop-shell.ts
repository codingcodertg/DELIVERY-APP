/**
 * ¿Esta página corre dentro de una app de escritorio? (D-NEXT)
 *
 * El dueño: «pon un botón de recargar en la app de escritorio». Hay **dos**, y se detectan de dos formas
 * distintas, medidas el 2026-09-17:
 *
 * - **Time Tracker** (repo `timetracker-clean`, la que usa el dueño): su `preload.js` expone
 *   `window.ttDesktop` con `isDesktop: true`, que es lo que ya lee `lib/timetracker/desktop.ts`. Su
 *   `main.js` hace `Menu.setApplicationMenu(null)` y no engancha teclas, así que **no tiene F5 ni
 *   Ctrl+R**: hoy no hay forma de recargar, que es de donde sale la petición.
 * - **RTG Hub** (`desktop/` de este repo): no expone ningún puente, pero añade ` RTGHub/<versión>` al
 *   agente de usuario (`desktop/main.js`). Sí tiene F5 y Ctrl+R. Se acepta también `RDZHub/`, el nombre
 *   viejo: D-225 lo cambió y las instalaciones sin actualizar siguen mandando el anterior.
 *
 * Lo que **no** cuenta: la cáscara Android, que manda `RDZDeliveries/` (`lib/app-update.ts`). Es un
 * teléfono, no un escritorio, y ahí recargar se hace tirando de la pantalla.
 */

const TOKEN_DE_ESCRITORIO = /\b(RTGHub|RDZHub)\/\S*/;

type VentanaPosible = {
  ttDesktop?: { isDesktop?: boolean } | null;
  navigator?: { userAgent?: string | null } | null;
};

export function enAppDeEscritorio(w: VentanaPosible | null | undefined): boolean {
  if (!w) return false;
  if (w.ttDesktop?.isDesktop === true) return true;
  return TOKEN_DE_ESCRITORIO.test(w.navigator?.userAgent ?? "");
}
