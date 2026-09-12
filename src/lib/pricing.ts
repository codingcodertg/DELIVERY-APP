import type { Settings } from "@/lib/types";
import { cityFromAddress, todayISO } from "@/lib/utils";
import { puntoEnZonaLocal } from "@/lib/delivery-zone";

// ============================================================
// Delivery fee = a function of driving miles (the office's real formulas).
// Two prices per order: a standard "list" fee and a lower "discount" fee a
// rep may offer. Both round to the nearest $10. The fee depends on whether
// the delivery city is LOCAL:
//
//   LOCAL
//     list:      < 11 mi → $100 · > 50 mi → round10(350 + mi) · else round10(120 + mi·0.8)
//     discount:  < 11 mi →  $80 · > 50 mi → round10(200 + mi) · else round10(100 + mi·0.8)
//   NOT LOCAL (also flagged for manager approval)
//     list:      round10(500 + mi)
//     discount:  round10(400 + mi)
// ============================================================

/** Cities inside the LOCAL delivery zone (the red outline on the RGV map). */
export const LOCAL_CITIES_DEFAULT = [
  "La Joya", "Alton", "Edinburg", "Elsa", "Palmview",
  "Mission", "McAllen", "Pharr", "San Juan", "Alamo", "Donna",
  "Weslaco", "Mercedes", "La Feria", "Harlingen", "San Benito",
  "Rio Hondo", "Ranch Viejo", "Brownsville", "Port Isabel", "South Padre",
];

export function localCities(s?: Partial<Settings> | null): string[] {
  const c = s?.local_cities;
  return c && c.length ? c : LOCAL_CITIES_DEFAULT;
}

/** True when `city` is one of the configured local-zone cities (case-insensitive). */
export function isLocalCity(city: string, s?: Partial<Settings> | null): boolean {
  const needle = (city || "").trim().toLowerCase();
  if (!needle) return false;
  return localCities(s).some((c) => c.trim().toLowerCase() === needle);
}

/** Round to the nearest $10 (Excel ROUND(x, -1) for non-negative amounts). */
const round10 = (x: number) => Math.round(x / 10) * 10;

// ---- La fórmula, como datos (D-244) -------------------------------------------------------
//
// El dueño pidió poder VER la fórmula. Lo que hace que la explicación no pueda mentir no es
// escribirla bien: es que **salga del mismo sitio que el número**. Así que los umbrales y las
// constantes viven aquí una vez, las dos funciones de tarifa se construyen sobre ellos, y tanto
// el desglose de un pedido como la tabla de Ajustes se generan de lo mismo. Cambiar un 120 aquí
// cambia el precio, el desglose y la tabla a la vez, o no cambia ninguno.

/** Por debajo de estas millas, el tramo corto: `miles < UMBRAL_CORTO`. */
export const UMBRAL_CORTO = 11;
/** Por encima de estas, el tramo largo: `miles > UMBRAL_LARGO`. */
export const UMBRAL_LARGO = 50;
/** Lo que multiplica a las millas en el tramo del medio. */
export const FACTOR_MEDIO = 0.8;

/** Las cuatro cifras que definen una columna de precios. */
export type TablaTarifa = {
  /** Tramo corto: precio plano, sin millas. */
  planoCorto: number;
  /** Tramo del medio: `base + millas × FACTOR_MEDIO`. */
  baseMedio: number;
  /** Tramo largo: `base + millas`. */
  baseLargo: number;
  /** Fuera de la zona local: `base + millas`, sin tramos. */
  baseNoLocal: number;
};

export const TARIFA_LISTA: TablaTarifa = { planoCorto: 100, baseMedio: 120, baseLargo: 350, baseNoLocal: 500 };
export const TARIFA_DESCUENTO: TablaTarifa = { planoCorto: 80, baseMedio: 100, baseLargo: 200, baseNoLocal: 400 };

export type TramoId = "local-corto" | "local-medio" | "local-largo" | "nolocal";

/** Un precio, con el camino que lo produjo. Los pasos son datos, no texto. */
export type PasoTarifa = {
  tramo: TramoId;
  /** El rango en millas, con los comparadores del código: `< 11`, `11–50`, `> 50`, o todo. */
  desde: number | null;
  hasta: number | null;
  /** La parte fija del tramo. */
  base: number;
  /** Lo que multiplica a las millas: 0 en el tramo plano, 1 en los de «base + millas». */
  factor: number;
  /** `base + millas × factor`, antes de redondear. */
  bruto: number;
  /** Redondeado a $10. */
  redondeado: number;
  /** Recargo de mismo día, 0 si no aplica. */
  recargo: number;
  /** Lo que acaba en el botón. */
  total: number;
};

/**
 * El tramo que le toca a estas millas, y su aritmética.
 *
 * **Es de aquí de donde salen las dos funciones de tarifa**, y no al revés: si el desglose se
 * calculara aparte, podría discrepar del precio el día que alguien tocara una y no la otra.
 *
 * Los bordes son los del código y no los que uno diría: `< 11` y `> 50`, así que **11 y 50 caen
 * los dos en el tramo del medio**.
 */
export function pasoTarifa(miles: number, local: boolean, t: TablaTarifa, recargo = 0): PasoTarifa {
  const cerrar = (p: Omit<PasoTarifa, "redondeado" | "total">): PasoTarifa => {
    const redondeado = round10(p.bruto);
    return { ...p, redondeado, total: redondeado + p.recargo };
  };
  if (!local) {
    return cerrar({ tramo: "nolocal", desde: null, hasta: null, base: t.baseNoLocal, factor: 1, bruto: t.baseNoLocal + miles, recargo });
  }
  if (miles < UMBRAL_CORTO) {
    return cerrar({ tramo: "local-corto", desde: null, hasta: UMBRAL_CORTO, base: t.planoCorto, factor: 0, bruto: t.planoCorto, recargo });
  }
  if (miles > UMBRAL_LARGO) {
    return cerrar({ tramo: "local-largo", desde: UMBRAL_LARGO, hasta: null, base: t.baseLargo, factor: 1, bruto: t.baseLargo + miles, recargo });
  }
  return cerrar({ tramo: "local-medio", desde: UMBRAL_CORTO, hasta: UMBRAL_LARGO, base: t.baseMedio, factor: FACTOR_MEDIO, bruto: t.baseMedio + miles * FACTOR_MEDIO, recargo });
}

/**
 * La fórmula entera, como filas, **generada desde los mismos umbrales y constantes** (D-244).
 *
 * Es lo que se enseña en Ajustes para consultarla sin abrir un pedido. Nada de una segunda copia
 * escrita a mano: si alguien cambia un 120 en `TARIFA_LISTA`, esta tabla cambia con él, y si
 * cambia un comparador, el rango que se lee cambia también.
 *
 * Son **ocho** reglas, no cinco: tres tramos locales por dos columnas, más la de fuera de zona
 * por dos. Y los rangos salen de los comparadores de `pasoTarifa`, así que dicen `< 11`,
 * `11–50` y `> 50` — con **11 y 50 dentro del tramo del medio**, que es donde los pone el
 * código y no donde los pondría la intuición.
 */
export type FilaFormula = {
  tramo: TramoId;
  zona: "local" | "nolocal";
  /** Los bordes del tramo, tal como los decide `pasoTarifa`. `null` = sin límite por ese lado. */
  desde: number | null;
  hasta: number | null;
  /** La parte fija y el multiplicador de cada columna. El texto lo pone quien pinta. */
  lista: { base: number; factor: number };
  descuento: { base: number; factor: number };
};

/**
 * Las ocho reglas, **como datos y no como frases**.
 *
 * Devolver texto ya formado fue mi primera versión y estaba mal en un sitio concreto: salía solo
 * en español, y acababa bajo cabeceras traducidas — «Zone · Distance» arriba y «cualquier
 * distancia» debajo. El idioma es de quien mira, no del cálculo, así que aquí salen los números
 * y la pantalla los dice en su idioma.
 *
 * Se generan **evaluando** `pasoTarifa` con una milla de muestra de cada tramo, no
 * describiéndolo: así el rango y la regla no pueden decir una cosa y el precio hacer otra.
 */
export function filasDeLaFormula(): FilaFormula[] {
  const muestras: { local: boolean; mi: number }[] = [
    { local: true, mi: 0 },
    { local: true, mi: UMBRAL_CORTO },
    { local: true, mi: UMBRAL_LARGO + 1 },
    { local: false, mi: 0 },
  ];
  return muestras.map(({ local, mi }) => {
    const l = pasoTarifa(mi, local, TARIFA_LISTA);
    const d = pasoTarifa(mi, local, TARIFA_DESCUENTO);
    return {
      tramo: l.tramo,
      zona: local ? "local" : "nolocal",
      desde: l.desde,
      hasta: l.hasta,
      lista: { base: l.base, factor: l.factor },
      descuento: { base: d.base, factor: d.factor },
    };
  });
}

/** Standard "list" delivery fee for a mile figure. Not-local deliveries use a
 * higher base (500 + miles); local deliveries use the tiered local formula. */
export function listFee(miles: number, local = true): number {
  return pasoTarifa(miles, local, TARIFA_LISTA).redondeado;
}

/** Discounted delivery fee a rep may offer. Not-local: 400 + miles. */
export function discountFee(miles: number, local = true): number {
  return pasoTarifa(miles, local, TARIFA_DESCUENTO).redondeado;
}

export type DeliveryZone = "local" | "nonlocal" | "unknown";

/**
 * De dónde salió la zona (D-220). No es adorno: el aviso «No local» sin motivo se lee como un
 * error del sistema, y quien lo mira no sabe si le falta poner el pin o si de verdad la entrega
 * está fuera. El dueño perdió un rato justo en eso.
 */
export type ZoneSource = "pin" | "city" | "none";

export interface FeeSuggestion {
  zone: DeliveryZone;
  /** Detected delivery city (best effort), for display. */
  city: string;
  /** Suggested standard price (incl. same-day surcharge), or null until miles are known. */
  list: number | null;
  /** Suggested discounted price a rep may offer (incl. same-day surcharge). */
  discount: number | null;
  /** NOT-LOCAL deliveries need manager approval before the price is committed. */
  needsApproval: boolean;
  /** The order is for same-day delivery and a surcharge applies. */
  sameDay: boolean;
  /** The same-day surcharge amount folded into list/discount ($), 0 if none. */
  sameDaySurcharge: number;
  /** Qué decidió la zona: el pin del mapa, la ciudad de la dirección, o nada. */
  zoneSource: ZoneSource;
  /**
   * Cómo se llegó a esos dos números (D-244). `null` mientras no haya millas, que es cuando
   * tampoco hay precio que explicar.
   *
   * Sale del **mismo** cálculo que `list` y `discount`, no de uno paralelo: por eso la
   * explicación no puede discrepar del importe del botón.
   */
  breakdown: FeeBreakdown | null;
}

/** Los dos caminos, el de la tarifa de lista y el del descuento, con sus millas. */
export type FeeBreakdown = {
  miles: number;
  local: boolean;
  list: PasoTarifa;
  discount: PasoTarifa;
};

/** Suggest the delivery fee for an order from its driving miles (the formulas
 * above) plus a same-day surcharge when the delivery date is today. The
 * delivery city only sets the zone badge + approval flag. */
export function suggestDeliveryFee(
  d: {
    delivery_address?: string | null; route_miles?: number | null; delivery_date?: string | null;
    delivery_lat?: number | null; delivery_lng?: number | null;
  },
  s?: Partial<Settings> | null,
): FeeSuggestion {
  const hasAddr = !!(d.delivery_address || "").trim();
  const city = cityFromAddress(d.delivery_address, localCities(s));
  // Same-day surcharge: when the delivery is today and an admin has set an
  // amount in Settings (default 0 = off).
  const surcharge = Math.max(0, Number(s?.same_day_surcharge ?? 0));
  const sameDay = !!d.delivery_date && d.delivery_date === todayISO() && surcharge > 0;
  const add = sameDay ? surcharge : 0;
  if (!hasAddr) return { zone: "unknown", city: "", list: null, discount: null, needsApproval: false, sameDay, sameDaySurcharge: add, zoneSource: "none", breakdown: null };

  // La zona sale del PUNTO cuando lo hay (D-219): el nombre de la ciudad se saca de texto
  // libre y falla justo donde más duele. Sin punto se cae al método de siempre, sin cambiarlo.
  const porPunto = puntoEnZonaLocal(d.delivery_lat, d.delivery_lng);
  const local = porPunto ?? isLocalCity(city, s);
  const miles = d.route_miles;
  // Un solo cálculo para el número y para la explicación. `total` ya lleva el recargo dentro,
  // así que `list` y `discount` salen de aquí en vez de sumarlo otra vez por su cuenta — que
  // es donde se habrían podido separar.
  const desglose: FeeBreakdown | null = miles != null
    ? {
        miles, local,
        list: pasoTarifa(miles, local, TARIFA_LISTA, add),
        discount: pasoTarifa(miles, local, TARIFA_DESCUENTO, add),
      }
    : null;
  return {
    zone: local ? "local" : "nonlocal",
    zoneSource: porPunto != null ? "pin" : "city",
    city,
    list: desglose ? desglose.list.total : null,
    discount: desglose ? desglose.discount.total : null,
    needsApproval: !local,
    sameDay,
    sameDaySurcharge: add,
    breakdown: desglose,
  };
}
