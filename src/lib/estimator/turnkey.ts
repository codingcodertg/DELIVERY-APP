/**
 * Turnkey (material + mano de obra + financiamiento): la cuenta de la plantilla de Excel del dueño, como funciones puras.
 *
 * **Aquí solo hay matemáticas.** Ni precios ni planes: esos viven en `turnkey-datos.ts` y los pide el servidor
 * (`app/estimator/turnkey-actions.ts`) solo a un admin. Así este módulo puede ir al navegador sin que los costos,
 * los márgenes ni las tasas de descuento vayan dentro del JavaScript que descarga un vendedor.
 *
 * La base es la hoja del dueño, con los ajustes que él pidió después (trabajos de piso solamente; la entrega se cotiza
 * igual que cualquier orden; el costo de financiamiento es un monto por plan). Las fórmulas que siguen la hoja dicen
 * de qué celda salen (MATERIAL, LABOR, FIN, BREAKDOWN); lo que cambió se dice en su comentario.
 */

// ---- constantes de la hoja --------------------------------------------------------------------------------------------

/** El impuesto de la hoja: 1.0825 = 1 + 8.25%. Se usa tal cual en las fórmulas (`TASA_CON_IMPUESTO`). */
export const IMPUESTO = 0.0825;
/** `1.0825`, escrito igual que en la hoja para que el orden de las multiplicaciones (y el redondeo) sea el mismo. */
export const TASA_CON_IMPUESTO = 1.0825;
/** El precio de contado es (mano + material) × 2, antes de impuesto (FIN!L3). */
export const MULTIPLICADOR_DE_CONTADO = 2;
/** Credit Card: el mismo precio de contado × 1.04 (FIN!L4). */
export const RECARGO_TARJETA = 1.04;
/** Días de instalación de laminado = ROUNDUP(SF / 450 + 1) (LABOR!K11). */
export const SF_POR_DIA_LAMINADO = 450;
/** Escalones que no se cobran: (tramos − 2) (LABOR!D27). */
export const ESCALONES_LIBRES = 2;
/** La tasa de impuesto que la hoja muestra en BREAKDOWN!D6 (solo se muestra; no entra en ninguna fórmula). */
export const IMPUESTO_EN_DESGLOSE = 0.0825;
/**
 * Viajes extra (ajuste del dueño): si el manejo de ida pasa de 45 minutos, cada día de instalación después del primero
 * es un viaje más, y cada viaje cuesta la mitad de la entrega: (días − 1) × (entrega / 2).
 */
export const MINUTOS_DE_VIAJE_EXTRA = 45;
export const FRACCION_DE_ENTREGA_POR_VIAJE = 0.5;

// ---- catálogo: tipos -----------------------------------------------------------------------------------------------------

/** Un texto bilingüe para una pista corta junto a una fila. */
export interface Pista {
  en: string;
  es: string;
}

/** Grupos de MATERIAL. `preparacion` = material de pegado y preparación; `losa` = azulejo menor a 48×48; `otros` = piso. */
export type GrupoMaterial = "preparacion" | "losa" | "otros";

export interface ArticuloMaterial {
  id: string;
  grupo: GrupoMaterial;
  en: string;
  es: string;
  /** Precio por defecto (ya evaluado: `23.29/350` es 0.0665…). La persona lo puede cambiar para el trabajo. */
  precio: number;
  /** Nota de la hoja, tal cual. */
  nota?: string;
  pista?: Pista;
  /** No cuenta como SF de piso (la decoración se cobra por pieza). Los demás materiales de piso sí cuentan. */
  sinSF?: true;
}

export type SeccionDeMano = "removal" | "tile" | "laminate" | "vinyl" | "carpet" | "otros" | "aparatos" | "entrega" | "limpieza";

export interface ConceptoDeMano {
  id: string;
  seccion: SeccionDeMano;
  en: string;
  es: string;
  /** Pago por unidad (columna «Pay» de la hoja). */
  pago: number;
  nota?: string;
  pista?: Pista;
  /**
   * No cuenta en SF: pies lineales (alfombras y zoclo de azulejo), escalones o piezas (demo de regadera). Solo las filas
   * de piso suman SF de instalación.
   */
  sinSF?: true;
  /** La fila que da los días de instalación (solo laminado, K11). */
  dias?: true;
  /**
   * Fórmula, no se escribe la cantidad:
   * - `escaleras`: (tramos − 2) × pago × SF de instalación, nunca negativo (D27).
   * - `entrega`: la entrega del trabajo, calculada con la calculadora de la ficha (dirección + tienda).
   * - `viajes`: (días − 1) × ½ entrega, solo si el manejo de ida pasa de 45 min.
   */
  formula?: "escaleras" | "entrega" | "viajes";
}

export type FormaDePago = "All Upfront" | "Reduced (Fixed Pmt)" | "Deferred (W/ Pmt)" | "Equal (No Int)";

export interface PlanFinanciero {
  /** Clave del plan: la columna B de FIN («Cash», «Credit Card», «Plan 922»…). El desglose la busca por aquí. */
  plan: string;
  /** Fila de FIN (3–37). La fila 37 es la de referencia para el descuento (`L$37`). */
  fila: number;
  forma: FormaDePago;
  /** Cómo se calcula el precio: contado, tarjeta (+4%) o un plan (con tasa de descuento). */
  calculo: "contado" | "tarjeta" | "plan";
  descripcion: string;
  /** APR (columna C). */
  apr: number;
  /** Meses (columna D). `null` = el plazo de los fijos, que la hoja calcula como 1 / factor. 0 = no aplica (contado). */
  plazo: number | null;
  /** Factor de pago (F). */
  factor: number;
  /** Tasa de descuento que cobra el financiador (G). Costo para la casa: solo admin. */
  descuento: number;
  /** Restricciones opcionales (H), tal cual. */
  restricciones?: string;
}

/** Todo lo que el servidor le da al admin: catálogo con precios por defecto, planes y la plantilla de entradas. */
export interface DatosTurnkey {
  materiales: ArticuloMaterial[];
  removal: ConceptoDeMano[];
  instalacion: ConceptoDeMano[];
  extras: ConceptoDeMano[];
  planes: PlanFinanciero[];
  /** Las entradas de la plantilla del dueño (sin entrega: sin dirección no hay tarifa de entrega). */
  plantilla: Entradas;
}

/**
 * Lo que la persona escribe. `cantidades` por id (SF o unidades; lo que no está es 0). `precios` solo guarda los que
 * cambió: lo que no está usa el precio por defecto, y «restablecer» borra la clave.
 */
export interface Entradas {
  cantidades: Record<string, number>;
  precios: Record<string, number>;
  /** El plan que muestra el desglose (una clave de `PlanFinanciero.plan`). */
  planDesglose: string;
  /**
   * La entrega del trabajo. `cargo`: lo que cobra la entrega (el que la persona eligió, o la tarifa de lista de la
   * calculadora si no eligió ninguno). `minutos`: manejo de ida, de la tienda a la dirección. Sin ella, la entrega vale 0.
   */
  entrega?: { cargo: number | null; minutos: number | null };
}

// ---- resultado -----------------------------------------------------------------------------------------------------------

export interface FilaDeConcepto {
  id: string;
  precio: number;
  cantidad: number;
  total: number;
}

export interface Resultado {
  material: {
    /** SUM de los grupos de preparación: material de pegado (incluye la cola de madera, si tiene precio y cantidad). */
    preparacion: number;
    /** Material de piso: losa y otros. */
    piso: number;
    /** Preparación + piso. */
    total: number;
    /** SF de piso: cantidades de losa y otros, sin lo que tiene `sinSF` (decoración). */
    sf: number;
    filas: Record<string, FilaDeConcepto>;
  };
  mano: {
    removal: { sf: number; total: number };
    instalacion: { sf: number; total: number; dias: number };
    extras: { total: number };
    /** Removal + instalación + extras. */
    total: number;
    /** Días totales (solo laminado). */
    dias: number;
    /** SF de instalación: base de $/SF y de las escaleras. Solo filas de piso. */
    sf: number;
    filas: Record<string, FilaDeConcepto>;
  };
  /** FIN!L3: el precio de contado con impuesto. */
  contado: number;
  planes: FilaFinanciera[];
}

export interface FilaFinanciera {
  plan: string;
  fila: number;
  forma: FormaDePago;
  descripcion: string;
  apr: number;
  /** D: meses (plazo real, aunque el dato sea 1/factor). 0 si no aplica. */
  plazo: number;
  factor: number;
  descuento: number;
  restricciones?: string;
  /** L: precio con financiamiento e impuesto. */
  precio: number;
  /**
   * Comisión del financiamiento en $: el precio del plan sin impuesto × su tasa de descuento (G). Es lo que cobra la
   * financiera sobre ese plan. Cambió: la hoja usaba el precio de contado (L$3) para todos los planes.
   */
  negocio: number;
  /** J: PMT/MO = L × F + (L × C) / 12. */
  mensual: number;
  /** K: pagos iguales = L / D. null si el plazo es 0. */
  pagosIguales: number | null;
  /** M: interés = L × C. */
  interes: number;
  /** N: suma = L + M. */
  total: number;
  /** O: $/SF = L / SF de instalación. null si no hay SF. */
  porSF: number | null;
  /** P: C/SF = (L − mano − material) / SF. */
  costoPorSF: number | null;
  /** Q: MGN = (O − P) / O. */
  margen: number | null;
  /** R: Profit = L × Q. Por construcción es mano + material en cualquier plan (ver `desglosar`). */
  utilidad: number | null;
  /** S: DISC% = 1 − L / L37. */
  descuentoPct: number;
  /** T: DISC$ = L37 − L. */
  descuentoDolar: number;
}

export interface Desglose {
  plan: string;
  /** REVENUE: L del plan. */
  ingreso: number;
  /** LABOR: total de mano de obra. */
  mano: number;
  /** MATERIAL: total de material. */
  material: number;
  /** FIN FEES: G del plan (la tasa de descuento). */
  finanzas: number;
  /** FEES & TAX: L − 2 × (mano + material). (hoja) */
  cargosEImpuesto: number;
  /** PROFIT: ingreso − (mano + material + cargos). Por construcción = mano + material. (hoja) */
  utilidad: number;
  /** MARGIN: utilidad / ingreso. */
  margen: number | null;
}

// ---- funciones -------------------------------------------------------------------------------------------------------------

function finito(n: unknown): number | null {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/** Cantidad escrita o 0 (lo que no es un número finito cuenta como 0). */
function cantidadDe(e: Entradas, id: string): number {
  return finito(e.cantidades[id]) ?? 0;
}

/** Precio escrito por la persona o el de por defecto. Un precio negativo o no numérico no se acepta: vuelve el de defecto. */
export function precioDe(e: Entradas, id: string, porDefecto: number): number {
  const p = finito(e.precios[id]);
  return p !== null && p >= 0 ? p : porDefecto;
}

/** División que no revienta: sin base (SF = 0) el dato no existe, y la pantalla lo dice con «—». */
function dividir(a: number, b: number): number | null {
  return b ? a / b : null;
}

/**
 * Calcula toda la plantilla: material (MATERIAL), mano de obra (LABOR) y el financiamiento (FIN).
 */
export function calcular(e: Entradas, d: DatosTurnkey): Resultado {
  // ---- MATERIAL --------------------------------------------------------------------------------------------------------
  // Todo material es precio × cantidad (la cola de madera ya no es un monto fijo).
  const filasMaterial: Record<string, FilaDeConcepto> = {};
  let preparacion = 0;
  let piso = 0;
  let sfPiso = 0;
  for (const a of d.materiales) {
    const precio = precioDe(e, a.id, a.precio);
    const cantidad = cantidadDe(e, a.id);
    const total = precio * cantidad;
    filasMaterial[a.id] = { id: a.id, precio, cantidad, total };
    if (a.grupo === "preparacion") preparacion += total;
    else {
      piso += total;
      if (!a.sinSF) sfPiso += cantidad;
    }
  }

  // ---- LABOR ------------------------------------------------------------------------------------------------------------
  // Días de laminado: K11 = ROUNDUP(I11 / 450 + 1, 0). Sin SF de laminado la hoja igual cuenta 1 día.
  const laminado = d.instalacion.find((c) => c.dias);
  const dias = laminado ? Math.ceil(cantidadDe(e, laminado.id) / SF_POR_DIA_LAMINADO + 1) : 0;
  // SF de instalación: solo filas de piso (sin pies lineales, escalones ni piezas).
  const sfInstalacion = d.instalacion.reduce((s, c) => (c.sinSF ? s : s + cantidadDe(e, c.id)), 0);
  // La entrega del trabajo (ver `Entradas.entrega`). Sin ella, 0 y sin viajes extra.
  const cargo = finito(e.entrega?.cargo) ?? 0;
  const minutos = finito(e.entrega?.minutos);

  const filasMano: Record<string, FilaDeConcepto> = {};
  const aplicaFormula = (c: ConceptoDeMano): FilaDeConcepto => {
    if (c.formula === "entrega") return { id: c.id, precio: cargo, cantidad: 1, total: cargo };
    if (c.formula === "viajes") {
      const viajes = minutos !== null && minutos > MINUTOS_DE_VIAJE_EXTRA && dias > 1 ? dias - 1 : 0;
      const precio = cargo * FRACCION_DE_ENTREGA_POR_VIAJE;
      return { id: c.id, precio, cantidad: viajes, total: precio * viajes };
    }
    const pago = precioDe(e, c.id, c.pago);
    if (c.formula === "escaleras") {
      const cantidad = cantidadDe(e, c.id); // tramos
      const f = (cantidad - ESCALONES_LIBRES) * pago * sfInstalacion; // D27
      return { id: c.id, precio: pago, cantidad, total: f < 0 ? 0 : f };
    }
    const cantidad = cantidadDe(e, c.id);
    return { id: c.id, precio: pago, cantidad, total: pago * cantidad };
  };

  // Removal: todas suman, también la demo de regadera (pieza). El SF de removal no cuenta las piezas.
  const removal = { sf: 0, total: 0 };
  for (const c of d.removal) {
    const f = aplicaFormula(c);
    filasMano[c.id] = f;
    removal.total += f.total;
    if (!c.sinSF) removal.sf += f.cantidad;
  }

  const instalacion = { sf: 0, total: 0, dias };
  for (const c of d.instalacion) {
    const f = aplicaFormula(c);
    filasMano[c.id] = f;
    instalacion.total += f.total;
  }
  instalacion.sf = sfInstalacion;

  const extras = { total: 0 };
  for (const c of d.extras) {
    const f = aplicaFormula(c);
    filasMano[c.id] = f;
    extras.total += f.total;
  }

  const manoTotal = removal.total + instalacion.total + extras.total;
  const materialTotal = preparacion + piso;

  // ---- FIN ------------------------------------------------------------------------------------------------------------
  const contado = (manoTotal + materialTotal) * MULTIPLICADOR_DE_CONTADO * TASA_CON_IMPUESTO; // L3
  const base = contado / TASA_CON_IMPUESTO; // precio antes de impuesto

  const precioDelPlan = (p: PlanFinanciero): number => {
    if (p.calculo === "contado") return contado;
    if (p.calculo === "tarjeta") return (manoTotal + materialTotal) * MULTIPLICADOR_DE_CONTADO * RECARGO_TARJETA * TASA_CON_IMPUESTO;
    return ((base / (1 - p.descuento)) * TASA_CON_IMPUESTO); // L5 = ((L3/1.0825)/(1−G))×1.0825
  };

  const precioReferencia = precioDelPlan(d.planes.find((p) => p.fila === 37) ?? d.planes[d.planes.length - 1]);
  const planes: FilaFinanciera[] = d.planes.map((p) => {
    const precio = precioDelPlan(p);
    const plazo = p.plazo === null ? 1 / p.factor : p.plazo; // D = L3/(L3×F) = 1/F para los fijos
    const interes = precio * p.apr; // M = L × C
    const porSF = dividir(precio, sfInstalacion); // O
    const costoPorSF = dividir(precio - manoTotal - materialTotal, sfInstalacion); // P
    const margen = porSF !== null && costoPorSF !== null ? dividir(porSF - costoPorSF, porSF) : null; // Q
    return {
      plan: p.plan,
      fila: p.fila,
      forma: p.forma,
      descripcion: p.descripcion,
      apr: p.apr,
      plazo,
      factor: p.factor,
      descuento: p.descuento,
      restricciones: p.restricciones,
      precio,
      negocio: (precio / TASA_CON_IMPUESTO) * p.descuento, // I = precio sin impuesto × G
      mensual: precio * p.factor + (precio * p.apr) / 12, // J
      pagosIguales: plazo ? precio / plazo : null, // K
      interes,
      total: precio + interes, // N
      porSF,
      costoPorSF,
      margen,
      utilidad: margen === null ? null : precio * margen, // R
      descuentoPct: 1 - precio / precioReferencia, // S
      descuentoDolar: precioReferencia - precio, // T
    };
  });

  return {
    material: { preparacion, piso, total: materialTotal, sf: sfPiso, filas: filasMaterial },
    mano: {
      removal,
      instalacion,
      extras,
      total: manoTotal,
      dias,
      sf: sfInstalacion,
      filas: filasMano,
    },
    contado,
    planes,
  };
}

/**
 * El desglose de un plan (BREAKDOWN). Usa las mismas cifras que `calcular`, así que no puede contradecir a la tabla.
 * La utilidad sale igual que en la hoja: ingreso − (mano + material + cargos), y los cargos son L − 2 × (mano + material),
 * lo que deja la utilidad en mano + material para cualquier plan. Es así en la hoja; se reporta, no se corrige.
 */
export function desglosar(r: Resultado, plan: string): Desglose | null {
  const f = r.planes.find((p) => p.plan === plan);
  if (!f) return null;
  const mano = r.mano.total;
  const material = r.material.total;
  const ingreso = f.precio;
  const cargosEImpuesto = ingreso - mano - material - (mano + material);
  const utilidad = ingreso - (mano + material + cargosEImpuesto);
  return {
    plan,
    ingreso,
    mano,
    material,
    finanzas: f.descuento,
    cargosEImpuesto,
    utilidad,
    margen: dividir(utilidad, ingreso),
  };
}

/** Un número como dinero, con dos decimales y coma de miles («19,035.39»). Solo para mostrar. */
export function dinero(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Un porcentaje con dos decimales («42.15%»). */
export function porcentaje(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `${(n * 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}
