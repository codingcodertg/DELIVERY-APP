import type { DriverLocation } from "@/lib/types";

/**
 * Qué choferes están reportando ahora mismo, y dónde (D-NEXT).
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
};

/**
 * Las posiciones que valen ahora, con el nombre del chofer resuelto.
 *
 * Se descarta lo que no se puede nombrar —un `driver_id` que no está en la lista de gente— y lo que
 * lleva más de `MINUTOS_EN_VIVO` sin reportar: un punto de hace tres horas en el mapa se lee como
 * «el camión está ahí», que es peor que no pintar nada.
 *
 * `ahora` entra por parámetro para poder probar la frontera sin esperar una hora.
 */
export function choferesEnVivo(
  posiciones: DriverLocation[],
  nombrePorId: Map<string, string>,
  colorDe: (nombre: string) => string,
  ahora: number = Date.now(),
): ChoferEnVivo[] {
  return posiciones.flatMap((loc) => {
    const driver = nombrePorId.get(loc.driver_id);
    if (!driver) return [];
    const ageMin = (ahora - new Date(loc.recorded_at).getTime()) / 60000;
    if (ageMin > MINUTOS_EN_VIVO) return [];
    return [{ driver, lat: loc.lat, lng: loc.lng, color: colorDe(driver), accuracy_m: loc.accuracy_m ?? null, ageMin }];
  });
}

/** «🚚 Ana · hace 3 min». La escribe quien pinta, en su idioma. */
export function etiquetaEnVivo(c: ChoferEnVivo, t: (en: string, es: string) => string): string {
  const cuando = c.ageMin < 1
    ? t("now", "ahora")
    : t(`${Math.round(c.ageMin)} min ago`, `hace ${Math.round(c.ageMin)} min`);
  return `🚚 ${c.driver} · ${cuando}`;
}
