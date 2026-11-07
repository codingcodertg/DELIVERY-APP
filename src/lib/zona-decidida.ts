import type { FeeSuggestion, ZoneSource } from "@/lib/pricing";

/**
 * UNA sola decisión de zona para todo lo que la pinta (D-NEXT).
 *
 * Francisca Reyes (ayuda 50e906e6, 1.405.0): «DICE QUE NO ES LOCAL PERO SÍ ES» — la orden sin pin a «3004 E Sabinal Ave,
 * Hidalgo, TX, USA» salía NO LOCAL con «ciudad (TX)». D-690 arregló la lectura de la ciudad (`ciudadDeEntrega`) y llevó el
 * polígono a la frontera. Esto cierra lo que quedaba abierto: la pastilla LOCAL / NO LOCAL, el aviso «No local — requiere
 * aprobación» y el «por qué» (pin, ciudad, millas) salían de tres sitios distintos en la ficha y en el cotizador, cada uno
 * con su propia lectura de `FeeSuggestion`. Hoy coinciden porque los tres leen el mismo booleano, pero nada lo garantizaba:
 * el día que alguien cambie uno, la pantalla vuelve a decir LOCAL arriba y «No local» abajo.
 *
 * **La regla, dicha una vez.** La zona la decide el PUNTO cuando lo hay (dentro del polígono `LOCAL_ZONE_DEFAULT`, cuyo borde
 * sur es el río, D-219/D-690); sin punto, la CIUDAD de la dirección contra la lista de Ajustes (o la de defecto). Las millas
 * NO deciden la zona: no hay ningún umbral de millas en Ajustes; las millas solo ponen el precio dentro de la zona que ya se
 * decidió. Cuando el pin y la ciudad discrepan, manda el pin —es donde está la entrega; la ciudad es texto— y el «por qué»
 * lo dice para que quien mira sepa qué mover (el pin, no la dirección).
 *
 * **Lo que pide aprobación.** `needsApproval` aquí es SOLO la zona: `!local`. El aviso de «Igualar precio (menor al
 * descuento)» es de la tarifa, no de la zona, y sigue aparte (`bajoElDescuento`, EntregaCotizacion; la comparación en la
 * ficha). Los dos pueden salir a la vez y no se contradicen: uno habla de dónde, el otro de cuánto.
 */
export type ZonaDecidida = {
  /** `null` = no se puede decidir (sin dirección). La pastilla no se pinta. */
  local: boolean | null;
  source: ZoneSource;
  city: string;
  miles: number | null;
  /** Aprobación POR LA ZONA. Siempre `local === false`, nunca otra cosa. */
  needsApproval: boolean;
  /** El motivo, en el idioma de la pantalla: «por el pin guardado», «por la ciudad de la dirección (Hidalgo) — …». */
  why: string;
};

/** Quién puso el pin que se está mirando, para decirlo en el motivo. `null` = no hay pin visible distinto del guardado. */
export type PinVisible = "geocoded" | "manual" | "saved" | null;

export function zonaDecidida(
  s: Pick<FeeSuggestion, "zone" | "zoneSource" | "city">,
  miles: number | null | undefined,
  t: (en: string, es: string) => string,
  pin: PinVisible = null,
): ZonaDecidida {
  const local = s.zone === "unknown" ? null : s.zone === "local";
  return {
    local,
    source: s.zoneSource,
    city: s.city,
    miles: miles ?? null,
    needsApproval: local === false,
    why: motivoDeLaZona(s, t, pin),
  };
}

/**
 * El «por qué» de la zona, el mismo texto en la ficha y en el cotizador (D-220: un «No local» sin motivo se lee como un
 * error del sistema). Tres estados del pin, ninguno advierte de perder el punto (D-221: el borrador se guarda con el pedido).
 */
export function motivoDeLaZona(s: Pick<FeeSuggestion, "zoneSource" | "city">, t: (en: string, es: string) => string, pin: PinVisible = null): string {
  if (s.zoneSource === "pin") {
    if (pin === "geocoded") return t("from the point the address search found", "por el punto que encontró la búsqueda de dirección");
    if (pin === "manual") return t("from the pin you just dropped", "por el pin que acaba de colocar");
    return t("from the saved pin", "por el pin guardado");
  }
  if (s.zoneSource === "city") {
    return t(`from the address city (${s.city || "not recognized"}) — no pin on this order`,
      `por la ciudad de la dirección (${s.city || "no reconocida"}) — esta orden no tiene pin`);
  }
  return "";
}
