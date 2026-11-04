import type { MapLine } from "@/components/LeafletMap";
import type { Fix } from "./track-history";
import { tramos } from "./tramos-del-recorrido";
import { driverOf } from "./route-lanes";

/**
 * D-NEXT: la ruta PLANEADA y lo que el chofer MANEJÓ, en el mismo mapa y en estilos que no se confunden.
 *
 * El dueño, 2026-11-04, con la captura del mapa de Julio: «¿por qué se miran 3 bubbles de Julio? Solo debería ser 1, que
 * sea el driver en ese momento. Ahora quiero que la ruta que lleva el driver esté en otro color al de su ruta, para
 * comparar si de verdad está siguiendo la ruta que es».
 *
 * Dos cosas, las dos puras para poder probarlas:
 *  - **Un camión por chofer** (`unCamionPorChofer`): de todo lo que diga dónde está un chofer, se pinta UNA marca, la de
 *    su posición más nueva. Los dos mapas (Google y Leaflet) y `choferesEnVivo` pasan por aquí.
 *  - **Plan contra recorrido** (`lineasDelRecorridoReal`, `planContraRecorrido`): la ruta planeada sigue en el color del
 *    chofer, pero más ancha, como un pasillo; lo manejado va encima, fino, en tinta oscura con un borde blanco, para que
 *    se lea sobre cualquier color de chofer y sobre el mapa. Donde el chofer siguió la ruta, la línea oscura va DENTRO del
 *    pasillo; donde se salió, se ve fuera. Los huecos sin posiciones siguen punteados y grises como en D-835.
 */

/** Lo manejado (el GPS): tinta oscura. No es ningún color de la paleta de choferes (`fallbackDriverColor`). */
export const COLOR_RECORRIDO_REAL = "#1b2230";
/** El borde de lo manejado, para que la tinta se lea encima del color del chofer (azul, morado, rojo…). */
export const BORDE_RECORRIDO_REAL = "#ffffff";
/** D-835: el tramo sin posiciones, «no sabemos por qué calle». El mismo gris del Recorrido. */
export const COLOR_HUECO = "#8a94a0";
/** El ancho de la línea de lo manejado (su borde suma 2 px a cada lado). */
export const ANCHO_RECORRIDO_REAL = 3;
/** El ancho de la ruta planeada cuando lleva su recorrido encima: más ancha que lo manejado y su borde, para que el color
 *  del chofer se siga viendo a los dos lados. Sin recorrido, la línea de siempre (6). */
export const ANCHO_PLAN_CON_RECORRIDO = 10;

/** Prefijo del id de las líneas de lo manejado (nunca choca con `plan:`, `line:`, `ret:` ni `sel…` del Gestor). */
export const PREFIJO_REAL = "real:";

/**
 * UNA marca por chofer: la de su posición más nueva (la de menos minutos). Mantiene el orden en que aparece cada chofer
 * por primera vez, para que el mapa no reordene sus marcas con cada posición. Sin `ageMin`, gana la primera que llega.
 */
export function unCamionPorChofer<T extends { driver: string; ageMin?: number | null }>(camiones: readonly T[]): T[] {
  const orden: string[] = [];
  const mejor = new Map<string, T>();
  for (const c of camiones) {
    const ya = mejor.get(c.driver);
    if (!ya) { orden.push(c.driver); mejor.set(c.driver, c); continue; }
    if ((c.ageMin ?? Infinity) < (ya.ageMin ?? Infinity)) mejor.set(c.driver, c);
  }
  return orden.map((d) => mejor.get(d)!);
}

/**
 * Lo manejado por cada chofer, como líneas del mapa. `porChofer` va por NOMBRE (la clave de las rutas del Gestor). Los
 * tramos son los de D-835 (`tramos`): sin saltos imposibles, y lo que el teléfono calló, punteado y gris.
 */
export function lineasDelRecorridoReal(
  porChofer: Readonly<Record<string, readonly Fix[]>>,
  opciones: { pasaFiltro?: (chofer: string) => boolean; atenuada?: (chofer: string) => boolean } = {},
): MapLine[] {
  const out: MapLine[] = [];
  for (const [chofer, fixes] of Object.entries(porChofer)) {
    if (opciones.pasaFiltro && !opciones.pasaFiltro(chofer)) continue;
    const dimmed = opciones.atenuada?.(chofer) ?? false;
    tramos(fixes).forEach((t, i) => {
      out.push(t.hueco
        ? { id: `${PREFIJO_REAL}${chofer}:seg${i}`, color: COLOR_HUECO, positions: t.positions, dashed: true, dimmed, encima: true }
        : { id: `${PREFIJO_REAL}${chofer}:seg${i}`, color: COLOR_RECORRIDO_REAL, positions: t.positions, dimmed, encima: true, weight: ANCHO_RECORRIDO_REAL, borde: BORDE_RECORRIDO_REAL });
    });
  }
  return out;
}

/** El chofer de una línea de ruta planeada del Gestor (`plan:X`, `line:X#n`, `ret:X#n`), o `null` si no es una de esas. */
export function choferDeLaLineaPlaneada(id: string): string | null {
  const m = id.match(/^plan:(.+)$/) ?? id.match(/^(?:line|ret):(.+)#\d+$/);
  return m ? driverOf(m[1]) : null;
}

/**
 * La ruta planeada y lo manejado, juntos: la planeada del chofer que tiene recorrido se ensancha (pasillo, en su color) y
 * lo manejado va después, encima. La vuelta vacía a la tienda (`ret:`, punteada) no se ensancha: un pasillo punteado no se
 * lee. Lo que no es de ningún chofer con recorrido sale tal cual.
 */
export function planContraRecorrido(plan: readonly MapLine[], real: readonly MapLine[]): MapLine[] {
  const conRecorrido = new Set(real.filter((l) => !l.dashed).map((l) => l.id.slice(PREFIJO_REAL.length).replace(/:seg\d+$/, "")));
  if (!conRecorrido.size) return [...plan, ...real];
  const ensanchada = plan.map((l) => {
    const chofer = choferDeLaLineaPlaneada(l.id);
    return chofer && conRecorrido.has(chofer) && !l.dashed ? { ...l, weight: ANCHO_PLAN_CON_RECORRIDO } : l;
  });
  return [...ensanchada, ...real];
}
