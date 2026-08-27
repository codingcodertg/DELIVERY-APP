import type { AppKey } from "@/lib/app-versions";

/**
 * Qué app corresponde a una ruta.
 *
 * Vive aparte del componente que lo usa por dos razones: es lógica pura y se puede
 * probar sin montar nada, y porque el sello de versión no va a ser lo último que
 * necesite saber en qué módulo estamos.
 */
const BY_PREFIX: ReadonlyArray<readonly [string, AppKey]> = [
  ["/recruiting", "recruiting"],
  ["/timetracker", "timetracker"],
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
