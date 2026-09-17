import type { Settings } from "@/lib/types";
import { cityFromAddress, todayISO } from "@/lib/utils";
import { puntoEnZonaLocal } from "@/lib/delivery-zone";

// ============================================================
// Delivery fee = a function of driving miles (the office's real formula).
// ONE price per order since D-283: the "discount" column is gone — the owner
// asked for a single fee. Everything rounds to the nearest $5. It depends on whether
// the delivery city is LOCAL:
//
//   LOCAL
//     < 11 mi → $100 flat · 11–50 mi → round5(105 + mi·0.8), min $105 · > 50 mi → round5(300 + mi·0.8)
//   NOT LOCAL (also flagged for manager approval)
//     round5(500 + mi·0.8)
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

/**
 * El escalón del redondeo, en dólares (D-283). El dueño: «round to the nearest 5». Antes eran
 * $10, y ese «$10» estaba escrito a mano en dos pantallas; ahora las dos lo leen de aquí.
 */
export const REDONDEO = 5;

/** Al múltiplo de `REDONDEO` más cercano. El .5 sube, como en Excel. */
export const redondear = (x: number) => Math.round(x / REDONDEO) * REDONDEO;

/**
 * El suelo de un tramo, aplicado DESPUÉS de redondear.
 *
 * Con un suelo múltiplo del escalón —105 y 5 lo son— los dos órdenes dan lo mismo, así que hoy da
 * igual. Se aplica después porque es el orden que sobrevive a que alguien ponga un suelo que no
 * sea múltiplo: redondear al final podría dejar el precio por debajo del mínimo.
 */
export const conSuelo = (redondeado: number, minimo: number | null) =>
  minimo == null ? redondeado : Math.max(minimo, redondeado);

// ---- La fórmula, como datos (D-244) -------------------------------------------------------
//
// El dueño pidió poder VER la fórmula. Lo que hace que la explicación no pueda mentir no es
// escribirla bien: es que **salga del mismo sitio que el número**. Así que los umbrales y las
// constantes viven aquí una vez, la función de tarifa se construye sobre ellos, y tanto el
// desglose de un pedido como la tabla de Ajustes se generan de lo mismo. Cambiar un 105 aquí
// cambia el precio, el desglose y la tabla a la vez, o no cambia ninguno.

/** Por debajo de estas millas, el tramo corto: `miles < UMBRAL_CORTO`. */
export const UMBRAL_CORTO = 11;
/** Por encima de estas, el tramo largo: `miles > UMBRAL_LARGO`. */
export const UMBRAL_LARGO = 50;
/**
 * Lo que multiplica a las millas (D-283). Antes solo lo llevaba el tramo del medio; ahora lo
 * llevan los tres que cuentan millas —medio, largo y fuera de zona—, y por eso ya no se llama
 * `FACTOR_MEDIO`.
 */
export const FACTOR_MILLA = 0.8;
/**
 * El suelo del tramo del medio: «min 105», del pedido del dueño.
 *
 * **Hoy no puede morder**, y está a propósito: con `105 + 0,80 × millas` el resultado ya empieza
 * en 105 a 0 millas y solo sube. Se escribe igual para que el día que alguien baje la base el
 * suelo siga ahí, y una prueba fija que sigue siendo el suelo.
 *
 * Solo del tramo del medio, **no** de todo lo local: el tramo corto es plano de 100, por debajo
 * de este suelo, y así lo pidió el dueño. Un suelo global lo subiría a 105 en silencio.
 */
export const MINIMO_MEDIO = 105;

/** Las cuatro cifras de la fórmula. Una sola columna de precios desde D-283. */
export type TablaTarifa = {
  /** Tramo corto: precio plano, sin millas. */
  planoCorto: number;
  /** Tramo del medio: `base + millas × FACTOR_MILLA`, con `MINIMO_MEDIO` de suelo. */
  baseMedio: number;
  /** Tramo largo: `base + millas × FACTOR_MILLA`. */
  baseLargo: number;
  /** Fuera de la zona local: `base + millas × FACTOR_MILLA`, sin tramos. */
  baseNoLocal: number;
};

export const TARIFA: TablaTarifa = { planoCorto: 100, baseMedio: 105, baseLargo: 300, baseNoLocal: 500 };

export type TramoId = "local-corto" | "local-medio" | "local-largo" | "nolocal";

/** Un precio, con el camino que lo produjo. Los pasos son datos, no texto. */
export type PasoTarifa = {
  tramo: TramoId;
  /** El rango en millas, con los comparadores del código: `< 11`, `11–50`, `> 50`, o todo. */
  desde: number | null;
  hasta: number | null;
  /** La parte fija del tramo. */
  base: number;
  /** Lo que multiplica a las millas: 0 en el tramo plano, `FACTOR_MILLA` en los demás. */
  factor: number;
  /** `base + millas × factor`, antes de redondear. */
  bruto: number;
  /** El suelo del tramo, o null si no tiene. */
  minimo: number | null;
  /** El escalón al que se redondeó, para que la pantalla no lo escriba a mano. */
  redondeo: number;
  /** Redondeado al escalón y, si el tramo tiene suelo, subido a él. */
  redondeado: number;
  /** El suelo mordió: el redondeo daba menos. */
  minimoAplicado: boolean;
  /** Recargo de mismo día, 0 si no aplica. */
  recargo: number;
  /** Lo que acaba en el botón. */
  total: number;
};

/**
 * El tramo que le toca a estas millas, y su aritmética.
 *
 * **Es de aquí de donde sale la tarifa**, y no al revés: si el desglose se calculara aparte,
 * podría discrepar del precio el día que alguien tocara uno y no el otro.
 *
 * Los bordes son los del código y no los que uno diría: `< 11` y `> 50`, así que **11 y 50 caen
 * los dos en el tramo del medio**.
 */
export function pasoTarifa(miles: number, local: boolean, recargo = 0): PasoTarifa {
  const cerrar = (p: Omit<PasoTarifa, "redondeado" | "redondeo" | "minimoAplicado" | "total">): PasoTarifa => {
    const alRedondear = redondear(p.bruto);
    const redondeado = conSuelo(alRedondear, p.minimo);
    return { ...p, redondeo: REDONDEO, redondeado, minimoAplicado: redondeado !== alRedondear, total: redondeado + p.recargo };
  };
  if (!local) {
    return cerrar({ tramo: "nolocal", desde: null, hasta: null, base: TARIFA.baseNoLocal, factor: FACTOR_MILLA, minimo: null, bruto: TARIFA.baseNoLocal + miles * FACTOR_MILLA, recargo });
  }
  if (miles < UMBRAL_CORTO) {
    return cerrar({ tramo: "local-corto", desde: null, hasta: UMBRAL_CORTO, base: TARIFA.planoCorto, factor: 0, minimo: null, bruto: TARIFA.planoCorto, recargo });
  }
  if (miles > UMBRAL_LARGO) {
    return cerrar({ tramo: "local-largo", desde: UMBRAL_LARGO, hasta: null, base: TARIFA.baseLargo, factor: FACTOR_MILLA, minimo: null, bruto: TARIFA.baseLargo + miles * FACTOR_MILLA, recargo });
  }
  return cerrar({ tramo: "local-medio", desde: UMBRAL_CORTO, hasta: UMBRAL_LARGO, base: TARIFA.baseMedio, factor: FACTOR_MILLA, minimo: MINIMO_MEDIO, bruto: TARIFA.baseMedio + miles * FACTOR_MILLA, recargo });
}

/**
 * La fórmula entera, como filas, **generada desde los mismos umbrales y constantes** (D-244).
 *
 * Es lo que se enseña en Ajustes para consultarla sin abrir un pedido. Nada de una segunda copia
 * escrita a mano: si alguien cambia un 105 en `TARIFA`, esta tabla cambia con él, y si
 * cambia un comparador, el rango que se lee cambia también.
 *
 * Son **cuatro** reglas desde D-283 —tres tramos locales y la de fuera de zona—, y no ocho: ya
 * no hay columna de descuento. Los rangos salen de los comparadores de `pasoTarifa`, así que dicen `< 11`,
 * `11–50` y `> 50` — con **11 y 50 dentro del tramo del medio**, que es donde los pone el
 * código y no donde los pondría la intuición.
 */
export type FilaFormula = {
  tramo: TramoId;
  zona: "local" | "nolocal";
  /** Los bordes del tramo, tal como los decide `pasoTarifa`. `null` = sin límite por ese lado. */
  desde: number | null;
  hasta: number | null;
  /** La parte fija, el multiplicador y el suelo. El texto lo pone quien pinta. */
  regla: { base: number; factor: number; minimo: number | null };
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
    const p = pasoTarifa(mi, local);
    return {
      tramo: p.tramo,
      zona: local ? "local" : "nolocal",
      desde: p.desde,
      hasta: p.hasta,
      regla: { base: p.base, factor: p.factor, minimo: p.minimo },
    };
  });
}

/**
 * La tarifa de entrega de esas millas, sin el recargo de mismo día (D-283).
 *
 * Es UNA, no dos: donde había «lista» y «descuento» ahora hay un precio. Quien quiera cobrar
 * menos escribe el importe a mano, y la pantalla avisa de que eso necesita aprobación.
 */
export function deliveryFee(miles: number, local = true): number {
  return pasoTarifa(miles, local).redondeado;
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
/** The suggested price (incl. same-day surcharge), or null until miles are known. */
  fee: number | null;
  /** NOT-LOCAL deliveries need manager approval before the price is committed. */
  needsApproval: boolean;
  /** The order is for same-day delivery and a surcharge applies. */
  sameDay: boolean;
  /** The same-day surcharge amount folded into the fee ($), 0 if none. */
  sameDaySurcharge: number;
  /** Qué decidió la zona: el pin del mapa, la ciudad de la dirección, o nada. */
  zoneSource: ZoneSource;
  /**
   * Cómo se llegó a ese número (D-244). `null` mientras no haya millas, que es cuando tampoco
   * hay precio que explicar.
   *
   * Sale del **mismo** cálculo que `fee`, no de uno paralelo: por eso la explicación no puede
   * discrepar del importe del botón.
   */
  breakdown: FeeBreakdown | null;
}

/** El camino del precio, con sus millas. */
export type FeeBreakdown = {
  miles: number;
  local: boolean;
  paso: PasoTarifa;
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
  if (!hasAddr) return { zone: "unknown", city: "", fee: null, needsApproval: false, sameDay, sameDaySurcharge: add, zoneSource: "none", breakdown: null };

  // La zona sale del PUNTO cuando lo hay (D-219): el nombre de la ciudad se saca de texto
  // libre y falla justo donde más duele. Sin punto se cae al método de siempre, sin cambiarlo.
  const porPunto = puntoEnZonaLocal(d.delivery_lat, d.delivery_lng);
  const local = porPunto ?? isLocalCity(city, s);
  const miles = d.route_miles;
  // Un solo cálculo para el número y para la explicación. `total` ya lleva el recargo dentro,
  // así que `fee` sale de aquí en vez de sumarlo otra vez por su cuenta — que es donde se
  // habrían podido separar.
  const desglose: FeeBreakdown | null = miles != null
    ? { miles, local, paso: pasoTarifa(miles, local, add) }
    : null;
  return {
    zone: local ? "local" : "nonlocal",
    zoneSource: porPunto != null ? "pin" : "city",
    city,
    fee: desglose ? desglose.paso.total : null,
    needsApproval: !local,
    sameDay,
    sameDaySurcharge: add,
    breakdown: desglose,
  };
}
