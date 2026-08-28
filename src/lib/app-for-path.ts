import type { AppKey } from "@/lib/app-versions";

/**
 * Qué app corresponde a una ruta.
 *
 * Vive aparte del componente que lo usa por dos razones: es lógica pura y se puede
 * probar sin montar nada, y porque el sello de versión no va a ser lo último que
 * necesite saber en qué módulo estamos.
 */
// El ORDEN importa, y es la única razón de que esto sea una lista y no un objeto: desde
// la fase 3b fichaje vive DENTRO de time tracker, así que /timetracker/clock-in empieza
// por /timetracker. El prefijo más específico va primero o el sello enseñaría la versión
// de time tracker en las pantallas de fichaje — el número de otra app, que es peor que
// ninguno. Las pruebas de este módulo lo cazaron en cuanto se movieron las rutas.
const BY_PREFIX: ReadonlyArray<readonly [string, AppKey]> = [
  ["/timetracker/clock-in", "clockin"],
  ["/recruiting", "recruiting"],
  ["/timetracker", "timetracker"],
  // La ruta vieja ya solo redirige, pero durante ese instante la página se sirve bajo ella.
  ["/clock-in", "clockin"],
  ["/erp", "erp"],
];

export function appForPath(pathname: string | null): AppKey {
  const p = pathname ?? "/";
  for (const [prefix, key] of BY_PREFIX) {
    // El separador importa: sin él, `/erpxyz` se leería como ERP.
    if (p === prefix || p.startsWith(prefix + "/")) return key;
  }
  // El hub, el login y las pantallas de deliveries no llevan prefijo propio.
  return "deliveries";
}
