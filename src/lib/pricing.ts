import type { Settings } from "@/lib/types";
import { cityFromAddress, todayISO } from "@/lib/utils";
import { puntoEnZonaLocal } from "@/lib/delivery-zone";

// ============================================================
// Delivery fee = a function of driving miles (the office's real formula).
//
// DOS precios (D-303): lista y descuento. Y desde D-NEXT el descuento **sí es una segunda fila de
// cifras**, que es lo que era antes de D-283. El dueño: «the original calculation of the discount is
// not appearing fix it and work on that». Todo redondea al múltiplo de $5 más cercano.
//
//   LOCAL                            lista                     descuento
//     < 11 mi                        $100 fijo                 $80 fijo
//     11–50 mi                       round5(105 + mi·0.8)      round5(100 + mi·0.8)
//     > 50 mi                        round5(300 + mi·0.8)      round5(105 + mi·0.8)
//   NOT LOCAL (también pide aprobación del gerente)
//     cualquier distancia            round5(500 + mi·0.8)      round5(400 + mi·0.8)
//
// **El descuento es más barato en los CUATRO tramos**, y eso es el cambio. Hasta D-NEXT solo se
// separaba por encima de 50 millas locales, así que en los otros tres la ficha enseñaba «Lista $100 ·
// Descuento $100» — dos botones con el mismo número, que es lo que el dueño leyó como «no aparece».
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
/** Cuál de los dos precios se está calculando (D-303). */
export type Precio = "list" | "discount";

/** Las cifras de UN precio: una base por tramo, y el suelo de los tramos que lo llevan. */
export type TablaTarifa = {
  /** Tramo corto: precio plano, sin millas. No lleva suelo — el plano ya es el precio. */
  planoCorto: number;
  /** Tramo del medio: `base + millas × FACTOR_MILLA`. */
  baseMedio: number;
  /**
   * El suelo del tramo del medio: «min 105», del pedido del dueño.
   *
   * **Hoy no puede morder**, y está a propósito: con `base + 0,80 × millas` el resultado ya empieza
   * en la base a 0 millas y solo sube. Se escribe igual —y por eso no se deriva de `baseMedio`—
   * para que el día que alguien baje la base el suelo siga ahí.
   *
   * Solo del tramo del medio, **no** de todo lo local: el tramo corto es plano y va por debajo de
   * este suelo, y así lo pidió el dueño. Un suelo global lo subiría en silencio.
   */
  minimoMedio: number;
  /** Tramo largo: `base + millas × FACTOR_MILLA`. */
  baseLargo: number;
  /** El suelo del tramo largo, o `null` si ese precio no lleva suelo ahí. */
  minimoLargo: number | null;
  /** Fuera de la zona local: `base + millas × FACTOR_MILLA`, sin tramos. */
  baseNoLocal: number;
};

/**
 * **Una fila de bases por precio** (D-NEXT).
 *
 * Hasta aquí había una sola fila y el descuento era «un tramo que se cobra distinto»: por encima de
 * 50 millas locales se le aplicaba la fórmula del tramo del medio, y en los otros tres tramos
 * **cobraba exactamente lo mismo que la lista**. El dueño lo leyó como que el descuento no existía —
 * *«the original calculation of the discount is not appearing»*— y tenía razón en lo que veía: dos
 * botones con el mismo número no son dos precios.
 *
 * El descuento original —el que había antes de D-283— sí era una tabla propia. Se restaura **su
 * estructura** sobre la fórmula vigente de D-283 (0,80 por milla en todos los tramos que cuentan
 * millas, redondeo a $5), no sus cifras viejas, que iban con otro multiplicador y otro redondeo.
 * Y el tramo largo conserva **lo último que dictó el dueño**, literal: «discounted price for local
 * deliveries over 50 mi will be = 105+(0.80 x miles)».
 *
 * Lo que **no** se duplica: `FACTOR_MILLA`, `REDONDEO`, `UMBRAL_CORTO` y `UMBRAL_LARGO` siguen
 * siendo uno solo para los dos precios. Lo único que cambia entre filas son las bases y los suelos,
 * que es exactamente lo que distingue a un precio del otro. De aquí salen el desglose de la ficha,
 * la tabla de Ajustes y los botones — los tres, de lo mismo.
 */
export const TARIFA: Record<Precio, TablaTarifa> = {
  list:     { planoCorto: 100, baseMedio: 105, minimoMedio: 105, baseLargo: 300, minimoLargo: null, baseNoLocal: 500 },
  discount: { planoCorto:  80, baseMedio: 100, minimoMedio: 100, baseLargo: 105, minimoLargo: 105, baseNoLocal: 400 },
};

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
export function pasoTarifa(miles: number, local: boolean, recargo = 0, precio: Precio = "list"): PasoTarifa {
  const cerrar = (p: Omit<PasoTarifa, "redondeado" | "redondeo" | "minimoAplicado" | "total">): PasoTarifa => {
    const alRedondear = redondear(p.bruto);
    const redondeado = conSuelo(alRedondear, p.minimo);
    return { ...p, redondeo: REDONDEO, redondeado, minimoAplicado: redondeado !== alRedondear, total: redondeado + p.recargo };
  };
  // El precio elige la FILA, y ya no hay ningún tramo que se calcule de otra manera (D-NEXT). Antes
  // había una rama —«si es descuento y es largo, usa la base del medio»— y era esa rama la que hacía
  // que los otros tres tramos cobraran lo mismo que la lista.
  const T = TARIFA[precio];
  if (!local) {
    return cerrar({ tramo: "nolocal", desde: null, hasta: null, base: T.baseNoLocal, factor: FACTOR_MILLA, minimo: null, bruto: T.baseNoLocal + miles * FACTOR_MILLA, recargo });
  }
  if (miles < UMBRAL_CORTO) {
    return cerrar({ tramo: "local-corto", desde: null, hasta: UMBRAL_CORTO, base: T.planoCorto, factor: 0, minimo: null, bruto: T.planoCorto, recargo });
  }
  if (miles > UMBRAL_LARGO) {
    return cerrar({ tramo: "local-largo", desde: UMBRAL_LARGO, hasta: null, base: T.baseLargo, factor: FACTOR_MILLA, minimo: T.minimoLargo, bruto: T.baseLargo + miles * FACTOR_MILLA, recargo });
  }
  return cerrar({ tramo: "local-medio", desde: UMBRAL_CORTO, hasta: UMBRAL_LARGO, base: T.baseMedio, factor: FACTOR_MILLA, minimo: T.minimoMedio, bruto: T.baseMedio + miles * FACTOR_MILLA, recargo });
}

/**
 * La fórmula entera, como filas, **generada desde los mismos umbrales y constantes** (D-244).
 *
 * Es lo que se enseña en Ajustes para consultarla sin abrir un pedido. Nada de una segunda copia
 * escrita a mano: si alguien cambia un 105 en `TARIFA`, esta tabla cambia con él, y si
 * cambia un comparador, el rango que se lee cambia también.
 *
 * Son **cuatro** filas —tres tramos locales y la de fuera de zona— con **dos columnas** cada una,
 * lista y descuento (D-303). Los rangos salen de los comparadores de `pasoTarifa`, así que dicen
 * `< 11`, `11–50` y `> 50` — con **11 y 50 dentro del tramo del medio**, que es donde los pone el
 * código y no donde los pondría la intuición.
 */
export type FilaFormula = {
  tramo: TramoId;
  zona: "local" | "nolocal";
  /** Los bordes del tramo, tal como los decide `pasoTarifa`. `null` = sin límite por ese lado. */
  desde: number | null;
  hasta: number | null;
  /**
   * La parte fija, el multiplicador y el suelo de cada precio. El texto lo pone quien pinta.
   *
   * **Desde D-NEXT las cuatro filas dicen dos cosas distintas**, una por columna. Antes tres de las
   * cuatro repetían el mismo número en las dos, y eso es lo que el dueño leyó como que el descuento
   * no aparecía.
   */
  lista: { base: number; factor: number; minimo: number | null };
  descuento: { base: number; factor: number; minimo: number | null };
};

/**
 * Las reglas, **como datos y no como frases**.
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
    // Las dos columnas, **evaluadas**, no descritas: la del descuento sale de pedirle a la misma
    // función el otro precio. Así la tabla no puede decir una cosa y el botón cobrar otra.
    const l = pasoTarifa(mi, local, 0, "list");
    const d = pasoTarifa(mi, local, 0, "discount");
    return {
      tramo: l.tramo,
      zona: local ? "local" : "nolocal",
      desde: l.desde,
      hasta: l.hasta,
      lista: { base: l.base, factor: l.factor, minimo: l.minimo },
      descuento: { base: d.base, factor: d.factor, minimo: d.minimo },
    };
  });
}

/**
 * La tarifa de entrega de esas millas, sin el recargo de mismo día.
 *
 * Por defecto la de **lista**; con `"discount"`, la de descuento (D-303). Las dos salen de
 * `pasoTarifa`, que es de donde sale el precio del botón.
 */
export function deliveryFee(miles: number, local = true, precio: Precio = "list"): number {
  return pasoTarifa(miles, local, 0, precio).redondeado;
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
  /** The suggested LIST price (incl. same-day surcharge), or null until miles are known. */
  list: number | null;
  /**
   * El descuento que un vendedor puede ofrecer, con el recargo dentro (D-303).
   *
   * **Nunca por encima de la lista**, y desde D-NEXT **estrictamente por debajo en los cuatro
   * tramos**: tiene su propia fila de bases. Antes coincidía con la lista en tres de los cuatro.
   */
  discount: number | null;
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

/** El camino de los dos precios, con sus millas. */
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
  // así que `fee` sale de aquí en vez de sumarlo otra vez por su cuenta — que es donde se
  // habrían podido separar.
  const desglose: FeeBreakdown | null = miles != null
    ? { miles, local, list: pasoTarifa(miles, local, add, "list"), discount: pasoTarifa(miles, local, add, "discount") }
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
