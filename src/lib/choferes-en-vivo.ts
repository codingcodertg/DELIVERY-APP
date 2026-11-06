import type { DriverLocation } from "@/lib/types";
import { unCamionPorChofer } from "@/lib/recorrido-contra-plan";
import { textoDeLaFusion, type PosicionDeChofer } from "@/lib/posicion-del-chofer";

/**
 * Qué choferes están reportando ahora mismo, y dónde (D-289).
 *
 * Estaba escrito **dos veces**, igual salvo cómo se elige el color: en el mapa de despacho y en el
 * gestor de rutas. Ahora lo pide una tercera pantalla —la ruta del día de Almacén, que ve las
 * posiciones desde la 121— y tres copias de la misma regla acaban diciendo tres cosas. Se escribe
 * una vez, sin React ni traducciones, para poder probarla.
 *
 * Lo que **no** hace: la etiqueta. Cada pantalla la escribe en el idioma de quien mira, que es de
 * donde salían las diferencias entre las dos copias.
 */

/** Pasados estos minutos, una posición deja de ser «en vivo» y no se pinta. */
export const MINUTOS_EN_VIVO = 60;

export type ChoferEnVivo = {
  driver: string;
  lat: number;
  lng: number;
  color: string;
  accuracy_m: number | null;
  /** Minutos desde el fijo, para que la pantalla lo diga y el mapa lo desvanezca. */
  ageMin: number;
  /** D-NEXT: el chofer lleva camión hoy y esta posición sale de fundir su teléfono y el rastreador (`posicionesDeChoferes`). */
  fusion?: PosicionDeChofer["fusion"];
};

/**
 * Las posiciones que valen ahora, con el nombre del chofer resuelto.
 *
 * Se descarta lo que no se puede nombrar —un `driver_id` que no está en la lista de gente— y lo que
 * lleva más de `MINUTOS_EN_VIVO` sin reportar: un punto de hace tres horas en el mapa se lee como
 * «el camión está ahí», que es peor que no pintar nada.
 *
 * `ahora` entra por parámetro para poder probar la frontera sin esperar una hora.
 *
 * D-NEXT: las posiciones pueden venir ya fundidas con el rastreador del camión (`posicionesDeChoferes`): entran igual
 * —una fila por chofer, la misma forma— y lo que dijo la fusión viaja en `fusion` para que la marca lo cuente.
 *
 * D-846: un chofer, UN camión — el de su posición más nueva —, aunque la lista traiga varias suyas (el dueño: «Solo
 * debería ser 1, que sea el driver en ese momento»).
 */
export function choferesEnVivo(
  posiciones: readonly (DriverLocation | PosicionDeChofer)[],
  nombrePorId: Map<string, string>,
  colorDe: (nombre: string) => string,
  ahora: number = Date.now(),
): ChoferEnVivo[] {
  return unCamionPorChofer(posiciones.flatMap((loc) => {
    const driver = nombrePorId.get(loc.driver_id);
    if (!driver) return [];
    const ageMin = (ahora - new Date(loc.recorded_at).getTime()) / 60000;
    if (ageMin > MINUTOS_EN_VIVO) return [];
    return [{ driver, lat: loc.lat, lng: loc.lng, color: colorDe(driver), accuracy_m: loc.accuracy_m ?? null, ageMin, ...("fusion" in loc && loc.fusion ? { fusion: loc.fusion } : {}) }];
  }));
}

/** «🚚 Ana · hace 3 min». La escribe quien pinta, en su idioma. */
export function etiquetaEnVivo(c: ChoferEnVivo, t: (en: string, es: string) => string): string {
  const cuando = c.ageMin < 1
    ? t("now", "ahora")
    : t(`${Math.round(c.ageMin)} min ago`, `hace ${Math.round(c.ageMin)} min`);
  return `🚚 ${c.driver}${c.fusion ? ` (🚛 ${c.fusion.camion.nombre})` : ""} · ${cuando}`;
}

/**
 * La marca lista para el mapa (D-NEXT): la etiqueta de siempre y, si el chofer lleva camión hoy, la tarjeta que se abre
 * en el sitio al tocarla —qué camión, qué fuente se usa y la edad de cada una— y el aviso de «teléfono y camión
 * separados». Sin camión, exactamente lo de antes: solo la etiqueta.
 */
export function marcaEnVivo(c: ChoferEnVivo, t: (en: string, es: string) => string): ChoferEnVivo & { label: string; tarjeta?: { titulo: string; lineas: string[]; aviso: string | null } } {
  const label = etiquetaEnVivo(c, t);
  if (!c.fusion) return { ...c, label };
  const txt = textoDeLaFusion(c.fusion, t);
  return { ...c, label, tarjeta: { titulo: c.driver, lineas: txt.lineas, aviso: txt.aviso } };
}
