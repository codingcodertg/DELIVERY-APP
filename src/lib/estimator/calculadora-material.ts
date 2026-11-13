/**
 * La calculadora de material (la plantilla de Excel «RODRIGUEZ TILE GROUP | MATERIAL CALCULATOR»). Aquí vive el cálculo,
 * sin red ni React: las medidas del proyecto y los parámetros de «Product Settings» entran; salen las áreas y las filas de
 * materiales. Cada fórmula es la de la hoja, celda por celda; las referencias están en los comentarios.
 *
 *   · Hoja 1 «Sales Calculator»: entradas C6..C14, F6..F12, C37, C48, C49; filas de materiales 17–33; áreas 40–43.
 *   · Hoja 2 «Product Settings»: `AJUSTES_POR_DEFECTO` (columna C). Los nombres de las claves dicen qué son; `AJUSTES_META`
 *     trae la celda, la unidad y la nota de cada una tal como salen en la hoja.
 *
 * Los dos números que la hoja deja fijos en la columna «Per package» (35 SF por pieza de liner, 1 LF por tablero) no son
 * ajustes: van como constantes, igual que en la hoja.
 */

export type TipoDeProyecto = "Shower" | "Flooring Only" | "Wall Only";
export type Disposicion = "2 Walls" | "3 Walls" | "4 Walls";

/** Los 9 tamaños de la lista desplegable (la misma lista de la hoja: F6 y F7). */
export const TAMANOS_DE_LOSETA = ["7x22", "12x24", "24x24", "24x48", "8x36", "8x48", "22x22", "8x8", "17x17"] as const;
export type TamanoDeLoseta = (typeof TAMANOS_DE_LOSETA)[number];

export const PROYECTOS: readonly TipoDeProyecto[] = ["Shower", "Flooring Only", "Wall Only"];
export const DISPOSICIONES: readonly Disposicion[] = ["2 Walls", "3 Walls", "4 Walls"];

/** Las entradas de la hoja 1 (azules). Medidas en pies (ft), juntas y espesores en pulgadas (in), cajas en SF. */
export interface EntradasCalculadora {
  /** C6 */
  proyecto: TipoDeProyecto;
  /** C7 */
  largoFt: number;
  /** C8 */
  anchoFt: number;
  /** C9 */
  altoFt: number;
  /** C10 */
  disposicion: Disposicion;
  /** C11: aberturas (puerta, ventana) en SF que se restan de la pared. */
  aberturasSf: number;
  /** C12: profundidad media del mortero (in). */
  morteroProfundidadIn: number;
  /** C13: SF por caja de loseta de pared. */
  cajaParedSf: number;
  /** C14: SF por caja de loseta de piso. */
  cajaPisoSf: number;
  /** F6: tamaño de la loseta de pared («largo x ancho», en pulgadas). */
  tamanoPared: TamanoDeLoseta;
  /** F7: tamaño de la loseta de piso. */
  tamanoPiso: TamanoDeLoseta;
  /** F8: junta de pared (in). */
  juntaParedIn: number;
  /** F9: junta de piso (in). */
  juntaPisoIn: number;
  /** F11: subida del liner por la pared (in). */
  subidaLinerIn: number;
  /** F12: borde extra del liner a cada lado (in). */
  bordeExtraLinerIn: number;
  /** C37: largo total de borde expuesto que lleva perfil (LF). */
  bordeExpuestoLf: number;
  /** C48: largo del salpicadero (ft). */
  salpicaderoLargoFt: number;
  /** C49: alto del salpicadero (ft). */
  salpicaderoAltoFt: number;
}

/** Los parámetros de «Product Settings» (hoja 2, columna C). */
export interface AjustesCalculadora {
  /** C6: SF por tablero. Sin uso en las fórmulas de la hoja (el tablero sale de LF × alto). */
  tableroCoberturaSf: number;
  /** C7 */
  tornillosPorTablero: number;
  /** C8 */
  tornillosPorCaja: number;
  /** C9 */
  rolloMallaLf: number;
  /** C10 */
  mallaPorTableroLf: number;
  /** C11: sin uso (la hoja toma la subida del liner de la entrada F11). */
  liner_subidaSinUsoIn: number;
  /** C12: sin uso (la hoja toma el borde extra de la entrada F12). */
  liner_bordeSinUsoIn: number;
  /** C13 */
  impermeableSfPorGal: number;
  /** C14 */
  impermeableGalPorEnvase: number;
  /** C15 */
  impermeableSolape: number;
  /** C16 */
  adhesivoParedSfPorBolsa: number;
  /** C17 */
  adhesivoPisoSfPorBolsa: number;
  /** C18: pies cúbicos por bolsa de mortero. */
  morteroPiesCubicosPorBolsa: number;
  /** C19 */
  lechadaSfReferencia: number;
  /** C20 */
  lechadaLbPorBolsa: number;
  /** C21 */
  lechadaLargoRefIn: number;
  /** C22 */
  lechadaAnchoRefIn: number;
  /** C23 */
  lechadaJuntaRefIn: number;
  /** C24 */
  lechadaProfundidadParedIn: number;
  /** C25 */
  lechadaProfundidadPisoIn: number;
  /** C26 */
  lechadaProfundidadRefIn: number;
  /** C27 */
  siliconaLfPorTubo: number;
  /** C28 */
  perfilLfPorPieza: number;
  /** C29 */
  clipsPorSf: number;
  /** C30 */
  clipsPorPaquete: number;
  /** C31 */
  cunasPorPaquete: number;
  /** C32 */
  preslopePromedioIn: number;
  /** C33: 0 = no, 1 = sí. */
  preslopeIncluido: number;
  /** C34: 0 = no, 1 = sí. Tablero en proyectos solo de pared. */
  tableroEnSoloPared: number;
  /** C35: 0 = no, 1 = sí. Impermeabilizante en proyectos solo de pared. */
  impermeableEnSoloPared: number;
  /** C38: alto instalado del tablero (ft); 5 convierte SF de pared en LF. */
  tableroAltoFt: number;
  /** C39: ancho de cada panel (LF). */
  tableroAnchoLf: number;
  /** C40: sin uso (la hoja vende LF y no redondea a la unidad). */
  tableroUnidadLf: number;
  /** C41: paneles extra por el trazado de la instalación. */
  tablerosExtra: number;
  /** C43: sin uso en las fórmulas (referencia de la hoja). */
  impermeableReferenciaGal: number;
}

export const ENTRADAS_POR_DEFECTO: EntradasCalculadora = {
  proyecto: "Shower",
  largoFt: 5,
  anchoFt: 3,
  altoFt: 8,
  disposicion: "3 Walls",
  aberturasSf: 0,
  morteroProfundidadIn: 2,
  cajaParedSf: 15.5,
  cajaPisoSf: 15.5,
  tamanoPared: "24x48",
  tamanoPiso: "12x24",
  juntaParedIn: 0.125,
  juntaPisoIn: 0.125,
  subidaLinerIn: 6,
  bordeExtraLinerIn: 0,
  bordeExpuestoLf: 0,
  salpicaderoLargoFt: 3,
  salpicaderoAltoFt: 1,
};

export const AJUSTES_POR_DEFECTO: AjustesCalculadora = {
  tableroCoberturaSf: 15,
  tornillosPorTablero: 30,
  tornillosPorCaja: 575,
  rolloMallaLf: 50,
  mallaPorTableroLf: 6,
  liner_subidaSinUsoIn: 6,
  liner_bordeSinUsoIn: 0,
  impermeableSfPorGal: 40,
  impermeableGalPorEnvase: 1,
  impermeableSolape: 0,
  adhesivoParedSfPorBolsa: 25,
  adhesivoPisoSfPorBolsa: 25,
  morteroPiesCubicosPorBolsa: 0.5,
  lechadaSfReferencia: 280,
  lechadaLbPorBolsa: 25,
  lechadaLargoRefIn: 24,
  lechadaAnchoRefIn: 24,
  lechadaJuntaRefIn: 0.125,
  lechadaProfundidadParedIn: 0.25,
  lechadaProfundidadPisoIn: 0.25,
  lechadaProfundidadRefIn: 0.25,
  siliconaLfPorTubo: 25,
  perfilLfPorPieza: 8,
  clipsPorSf: 2,
  clipsPorPaquete: 100,
  cunasPorPaquete: 100,
  preslopePromedioIn: 1,
  preslopeIncluido: 0,
  tableroEnSoloPared: 0,
  impermeableEnSoloPared: 0,
  tableroAltoFt: 5,
  tableroAnchoLf: 3,
  tableroUnidadLf: 1,
  tablerosExtra: 1,
  impermeableReferenciaGal: 3,
};

/** Lo que la hoja deja fijo en la columna «Per package» (no es un ajuste de «Product Settings»). */
export const PIEZA_DE_LINER_SF = 35;
export const TABLERO_POR_PAQUETE_LF = 1;

export interface Bilingue { en: string; es: string }

export interface AjusteMeta {
  clave: keyof AjustesCalculadora;
  /** Celda de la hoja 2 (la columna C). */
  celda: string;
  etiqueta: Bilingue;
  /** Unidad tal como sale en la columna D de la hoja. */
  unidad: string;
  /** Nota tal como sale en la columna E de la hoja (inglés). */
  nota: string;
  /** 0/1 en la hoja: se muestra como casilla. */
  esSiNo?: true;
  /** La hoja no lo usa en ninguna fórmula. Se muestra, pero se avisa. */
  sinUso?: true;
}

/** Los ajustes en el orden de la hoja 2, con su celda, unidad y nota. */
export const AJUSTES_META: readonly AjusteMeta[] = [
  { clave: "tableroCoberturaSf", celda: "C6", etiqueta: { en: "Backerboard coverage", es: "Cobertura del tablero" }, unidad: "SF / panel", nota: "3×5 panel confirmed in training PDF", sinUso: true },
  { clave: "tornillosPorTablero", celda: "C7", etiqueta: { en: "Screws per backerboard", es: "Tornillos por tablero" }, unidad: "screws / panel", nota: "Illustrative; verify fastener spacing and framing" },
  { clave: "tornillosPorCaja", celda: "C8", etiqueta: { en: "Screws per box", es: "Tornillos por caja" }, unidad: "screws / box", nota: "Confirmed in training PDF" },
  { clave: "rolloMallaLf", celda: "C9", etiqueta: { en: "Mesh roll coverage", es: "Rollo de malla" }, unidad: "LF / roll", nota: "6×50 listed in training PDF; verify roll unit (feet vs yards)" },
  { clave: "mallaPorTableroLf", celda: "C10", etiqueta: { en: "Mesh seam length per board", es: "Largo de juntas por tablero" }, unidad: "LF / board", nota: "Rough allowance: check actual board seams" },
  { clave: "liner_subidaSinUsoIn", celda: "C11", etiqueta: { en: "Pan liner upturn (sheet 2)", es: "Subida del liner (hoja 2)" }, unidad: "in", nota: "Editable; minimum based on design/code/manufacturer", sinUso: true },
  { clave: "liner_bordeSinUsoIn", celda: "C12", etiqueta: { en: "Pan liner edge extra (sheet 2)", es: "Borde extra del liner (hoja 2)" }, unidad: "in", nota: "No automatic waste. Add only if required by design", sinUso: true },
  { clave: "impermeableSfPorGal", celda: "C13", etiqueta: { en: "Water shield coverage", es: "Rendimiento del impermeabilizante" }, unidad: "SF / gallon", nota: "Calibration: 103 SF / 3 gallons ≈34.3 SF/gal; 40 SF/gal gives 3 gallons. Verify actual stocked product label." },
  { clave: "impermeableGalPorEnvase", celda: "C14", etiqueta: { en: "Water shield container size", es: "Tamaño del envase" }, unidad: "gallons / pail", nota: "1-gallon containers for reference 3-gallon purchase; change for pails sold in store." },
  { clave: "impermeableSolape", celda: "C15", etiqueta: { en: "Waterproofing overlap", es: "Traslape del impermeabilizante" }, unidad: "fraction", nota: "Set to manufacturer required system overlap, not cutting waste" },
  { clave: "adhesivoParedSfPorBolsa", celda: "C16", etiqueta: { en: "Thinset wall coverage", es: "Rendimiento del pegamento en pared" }, unidad: "SF / 50-lb bag", nota: "Working calibration to 4 wall bags + 1 floor bag on reference shower; verify 44-lb product and back-buttering rate." },
  { clave: "adhesivoPisoSfPorBolsa", celda: "C17", etiqueta: { en: "Thinset floor coverage", es: "Rendimiento del pegamento en piso" }, unidad: "SF / 50-lb bag", nota: "Working calibration for 44-lb thinset and back-buttering; verify actual manufacturer coverage." },
  { clave: "morteroPiesCubicosPorBolsa", celda: "C18", etiqueta: { en: "Mortar bed yield", es: "Rendimiento del mortero seco" }, unidad: "cu ft / 50-lb bag", nota: "Supply reference: 5 bags of 44 lb. Yield is provisional; verify the actual mortar product." },
  { clave: "lechadaSfReferencia", celda: "C19", etiqueta: { en: "Grout coverage reference", es: "Referencia de rendimiento de lechada" }, unidad: "SF per 25-lb bag", nota: "280 SF/bag baseline; actual area scales with joint width/depth and tile dimensions." },
  { clave: "lechadaLbPorBolsa", celda: "C20", etiqueta: { en: "Grout bag weight", es: "Peso de la bolsa de lechada" }, unidad: "lb / bag", nota: "User-provided stocked bag weight" },
  { clave: "lechadaLargoRefIn", celda: "C21", etiqueta: { en: "Grout reference tile length", es: "Largo de la loseta de referencia" }, unidad: "in", nota: "Reference tile for 280 SF coverage; adjustable" },
  { clave: "lechadaAnchoRefIn", celda: "C22", etiqueta: { en: "Grout reference tile width", es: "Ancho de la loseta de referencia" }, unidad: "in", nota: "Reference tile for 280 SF coverage; adjustable" },
  { clave: "lechadaJuntaRefIn", celda: "C23", etiqueta: { en: "Grout reference joint width", es: "Junta de referencia" }, unidad: "in", nota: "Reference joint for 280 SF coverage; adjustable" },
  { clave: "lechadaProfundidadParedIn", celda: "C24", etiqueta: { en: "Grout wall joint depth", es: "Profundidad de junta en pared" }, unidad: "in", nota: "Grout depth; change with tile specifications" },
  { clave: "lechadaProfundidadPisoIn", celda: "C25", etiqueta: { en: "Grout floor joint depth", es: "Profundidad de junta en piso" }, unidad: "in", nota: "Grout depth; change with tile specifications" },
  { clave: "lechadaProfundidadRefIn", celda: "C26", etiqueta: { en: "Grout reference joint depth", es: "Profundidad de junta de referencia" }, unidad: "in", nota: "Baseline depth associated with reference coverage" },
  { clave: "siliconaLfPorTubo", celda: "C27", etiqueta: { en: "Silicone coverage", es: "Rendimiento del silicón" }, unidad: "LF / tube", nota: "PLACEHOLDER; bead size changes yield" },
  { clave: "perfilLfPorPieza", celda: "C28", etiqueta: { en: "Trim piece length", es: "Largo de la pieza de perfil" }, unidad: "LF / piece", nota: "Adjust based on stocked profile" },
  { clave: "clipsPorSf", celda: "C29", etiqueta: { en: "Leveling clips coverage", es: "Clips por SF" }, unidad: "clips / SF", nota: "PLACEHOLDER; actual depends on tile layout" },
  { clave: "clipsPorPaquete", celda: "C30", etiqueta: { en: "Leveling clips per pack", es: "Clips por paquete" }, unidad: "clips / pack", nota: "Set to stocked count" },
  { clave: "cunasPorPaquete", celda: "C31", etiqueta: { en: "Wedges per pack", es: "Cuñas por paquete" }, unidad: "wedges / pack", nota: "Set to stocked count" },
  { clave: "preslopePromedioIn", celda: "C32", etiqueta: { en: "Mortar pre-slope average depth", es: "Profundidad promedio de la pendiente" }, unidad: "in", nota: "Optional step; use installer design" },
  { clave: "preslopeIncluido", celda: "C33", etiqueta: { en: "Mortar pre-slope included", es: "Incluye pendiente de mortero" }, unidad: "0=no; 1=yes", nota: "Pre-slope often not in store sale per PDF", esSiNo: true },
  { clave: "tableroEnSoloPared", celda: "C34", etiqueta: { en: "Board installation required for wall-only", es: "Tablero necesario en solo pared" }, unidad: "0=no; 1=yes", nota: "Wall-only default to tile, thinset and grout; toggle if backing needed", esSiNo: true },
  { clave: "impermeableEnSoloPared", celda: "C35", etiqueta: { en: "Waterproofing for wall-only", es: "Impermeabilizante en solo pared" }, unidad: "0=no; 1=yes", nota: "Enable only when appropriate for wet-area installation", esSiNo: true },
  { clave: "tableroAltoFt", celda: "C38", etiqueta: { en: "Backerboard reference installed height", es: "Alto instalado del tablero" }, unidad: "ft", nota: "used to convert wall SF into LF (change to 3 for rotated board)" },
  { clave: "tableroAnchoLf", celda: "C39", etiqueta: { en: "Backerboard width per panel", es: "Ancho de cada panel" }, unidad: "LF", nota: "3x5 panel width when installed 5 ft tall" },
  { clave: "tableroUnidadLf", celda: "C40", etiqueta: { en: "Backerboard sold unit", es: "Unidad de venta del tablero" }, unidad: "LF per unit", nota: "estimated LF shown in calculator, whole LF rounded for sale", sinUso: true },
  { clave: "tablerosExtra", celda: "C41", etiqueta: { en: "Extra backerboard panels required by layout", es: "Paneles extra por el trazado" }, unidad: "panels", nota: "Installation-layout allowance for 3×5×8 standard reference; not waste; adjust per layout" },
  { clave: "impermeableReferenciaGal", celda: "C43", etiqueta: { en: "Reference waterproofing supply", es: "Referencia de impermeabilizante" }, unidad: "gallons", nota: "Select ONE waterproofing brand (Crest, Hydrorite, or Cemix), not all three", sinUso: true },
];

// ---- Cálculo ------------------------------------------------------------------------------------------------------------

/** VALUE(LEFT(t; FIND("x";t)-1)) y VALUE(MID(t; FIND("x";t)+1; 9)): «24x48» → [24, 48] (largo x ancho, en pulgadas). */
export function medidasDeLaLoseta(tamano: string): [number, number] {
  const i = tamano.indexOf("x");
  if (i < 0) return [0, 0];
  return [Number.parseFloat(tamano.slice(0, i)) || 0, Number.parseFloat(tamano.slice(i + 1, i + 10)) || 0];
}

/** El «IFERROR(…,0)» de la hoja: lo que no sale finito (división entre cero, etc.) vale 0. */
const finitoOCero = (x: number): number => (Number.isFinite(x) ? x : 0);

/** Medidas sanas: lo que no es número finito cuenta como 0 (como una celda vacía en la hoja). */
const sana = (n: number): number => (Number.isFinite(n) ? n : 0);

/** IFERROR(IF(OR(c<=0;d<=0);0;ROUNDUP(c/d;0));0): cuántos paquetes enteros. */
export function paquetesNecesarios(cantidad: number, porPaquete: number): number {
  if (!(cantidad > 0) || !(porPaquete > 0)) return 0;
  return finitoOCero(Math.ceil(cantidad / porPaquete));
}

export interface AreasCalculadas {
  /** C40 */
  pisoSf: number;
  /** C41 */
  paredSf: number;
  /** C42 */
  perimetroLf: number;
  /** C43 */
  tablerosPaneles: number;
}

export interface FilaCalculada {
  /** Identificador estable de la fila (sirve de clave y para las pruebas). */
  clave: string;
  material: Bilingue;
  /** C: cantidad necesaria (sin redondear). */
  cantidad: number;
  /** D: por paquete (null si la hoja no lo pone). */
  porPaquete: number | null;
  /** E: a vender (el número que se pide). */
  venta: number;
  unidad: Bilingue;
  nota: Bilingue;
}

export interface ResultadoCalculadora {
  areas: AreasCalculadas;
  /** C19: LF de tablero, antes de redondear paneles. */
  tablerosLf: number;
  filas: FilaCalculada[];
}

export function calcular(entradas: EntradasCalculadora, ajustes: AjustesCalculadora): ResultadoCalculadora {
  const e = entradas;
  const a = ajustes;
  const L = sana(e.largoFt), W = sana(e.anchoFt), H = sana(e.altoFt);
  const ab = sana(e.aberturasSf);
  const esDucha = e.proyecto === "Shower";
  const esPiso = e.proyecto === "Flooring Only";
  const esPared = e.proyecto === "Wall Only";

  // C36: salpicadero. Va dentro del área de pared; en solo piso vale 0.
  const salpicaderoSf = esPiso ? 0 : sana(e.salpicaderoLargoFt) * sana(e.salpicaderoAltoFt);

  // C40: piso (ducha y solo piso).
  const pisoSf = esDucha || esPiso ? Math.max(0, L * W) : 0;

  // C42: perímetro de pared (LF). Ducha: L + (2, 3 o 4 paredes). Solo pared: L.
  const perimetroLf = esDucha
    ? L + (e.disposicion === "2 Walls" ? W : e.disposicion === "3 Walls" ? 2 * W : L + 2 * W)
    : esPared ? L : 0;

  // C41: pared (SF). Ducha: H × perímetro. Solo pared: L × H. Menos aberturas, más salpicadero.
  const paredSf = esDucha || esPared ? Math.max(0, H * perimetroLf - ab + salpicaderoSf) : 0;

  // C19: tablero en LF (pared sin el salpicadero, entre el alto instalado). Ducha, o solo pared si C34 = 1.
  const tableroAqui = esDucha || (esPared && a.tableroEnSoloPared === 1);
  const tablerosLfCrudo = tableroAqui ? Math.max(0, paredSf - salpicaderoSf) / a.tableroAltoFt : 0;
  const tablerosLf = tablerosLfCrudo > 0 && Number.isFinite(tablerosLfCrudo) ? tablerosLfCrudo : 0;

  // C43: paneles enteros + los del trazado. Depende de C19.
  const tablerosPaneles = tablerosLf <= 0 ? 0 : finitoOCero(Math.ceil(tablerosLf / a.tableroAnchoLf)) + a.tablerosExtra;

  // Liner (C17): el piso más la subida y el borde extra a cada lado, en pies.
  const margenLiner = (2 * (sana(e.subidaLinerIn) + sana(e.bordeExtraLinerIn))) / 12;
  const linerSf = esDucha ? (L + margenLiner) * (W + margenLiner) : 0;

  // Mortero (C18) y pendiente (C33): pie cúbico = área del piso × profundidad / 12.
  const morteroPc = esDucha ? (pisoSf * sana(e.morteroProfundidadIn)) / 12 : 0;
  const pendientePc = esDucha && a.preslopeIncluido === 1 ? (pisoSf * a.preslopePromedioIn) / 12 : 0;

  // Impermeabilizante (C22).
  const paredSinSalpicadero = Math.max(0, paredSf - salpicaderoSf);
  const impermeableSf = esDucha
    ? (paredSinSalpicadero + pisoSf) * (1 + a.impermeableSolape)
    : esPared && a.impermeableEnSoloPared === 1 ? paredSinSalpicadero : 0;

  // Silicón (C28): perímetro + alto × (4, 2 o 1 esquinas según la disposición); solo pared: alto × 2.
  const factorDeEsquinas = e.disposicion === "4 Walls" ? 4 : e.disposicion === "3 Walls" ? 2 : 1;
  const siliconaLf = esDucha ? perimetroLf + H * factorDeEsquinas : esPared ? H * 2 : 0;

  // Clips y cuñas (C30, C31): (piso + pared) × clips por SF.
  const clipsCant = (pisoSf + paredSf) * a.clipsPorSf;

  const filas: FilaCalculada[] = [
    fila("liner", { en: "Shower pan liner / cuero de marrano", es: "Cuero de marrano (liner de la ducha)" },
      linerSf, PIEZA_DE_LINER_SF, { en: "5×7 pieces", es: "piezas 5×7" },
      "One 5×7 liner piece covers the sample pan cut (24 SF); verify available sheet dimensions and upturns."),
    fila("mortero", { en: "Mortar bed / mortero seco", es: "Mortero seco (cama de la ducha)" },
      morteroPc, a.morteroPiesCubicosPorBolsa, { en: "bags", es: "bolsas" },
      "44-lb mortar bags per Supply Calculator; volume yield still requires product confirmation."),
    fila("tablero", { en: "Backerboard (linear feet)", es: "Tablero de cemento (pies lineales)" },
      tablerosLf, TABLERO_POR_PAQUETE_LF, { en: "LF", es: "LF" },
      "Estimated 17.6 LF installed; 7 whole 3-ft-wide panels = 21 LF sold. Layout panels editable in settings.",
      sana(tablerosPaneles * a.tableroAnchoLf)),
    fila("tornillos", { en: "Backerboard screws", es: "Tornillos para tablero" },
      tablerosPaneles * a.tornillosPorTablero, a.tornillosPorCaja, { en: "boxes", es: "cajas" },
      "575 screws per box; verify screw spacing & substrate"),
    fila("malla", { en: "Joint mesh tape", es: "Malla para juntas" },
      tablerosPaneles * a.mallaPorTableroLf, a.rolloMallaLf, { en: "rolls", es: "rollos" },
      "Roll coverage in linear feet; seam estimate"),
    fila("impermeable", { en: "Water Shield waterproofing", es: "Impermeabilizante (Water Shield)" },
      impermeableSf, a.impermeableSfPorGal * a.impermeableGalPorEnvase, { en: "gallons", es: "galones" },
      "Working 3-gallon standard reference; one waterproofing brand only; verify actual coverage and packaging."),
    fila("pegamento-pared", { en: "Thinset for walls", es: "Pegamento para pared" },
      paredSf, a.adhesivoParedSfPorBolsa, { en: "bags", es: "bolsas" },
      "44-lb thinset working rate for standard shower; back-buttering included; verify coverage."),
    fila("pegamento-piso", { en: "Thinset for flooring", es: "Pegamento para piso" },
      pisoSf, a.adhesivoPisoSfPorBolsa, { en: "bags", es: "bolsas" },
      "44-lb thinset working rate for standard shower; back-buttering included; verify coverage."),
    fila("loseta-pared", { en: "Wall tile", es: "Loseta de pared" },
      paredSf, e.cajaParedSf, { en: "boxes", es: "cajas" },
      "Boxes use SF per box; tile size used only for grout estimate"),
    fila("loseta-piso", { en: "Floor tile", es: "Loseta de piso" },
      pisoSf, e.cajaPisoSf, { en: "boxes", es: "cajas" },
      "Boxes use SF per box; tile size used only for grout estimate"),
    fila("lechada", { en: "Grout / TEXcolor", es: "Lechada / TEXcolor" },
      calculaLechada(e, a, pisoSf, paredSf), a.lechadaLbPorBolsa, { en: "bags", es: "bolsas" },
      "25-lb bags; coverage in SF/bag depends on joint width, depth and tile dimensions."),
    fila("silicon", { en: "Silicone sealant / TEX2", es: "Silicón / TEX2" },
      siliconaLf, a.siliconaLfPorTubo, { en: "tubes", es: "tubos" },
      "Calculated from estimated linear feet of corner joints"),
    fila("perfil", { en: "Tile trim", es: "Perfil de loseta" },
      sana(e.bordeExpuestoLf), a.perfilLfPorPieza, { en: "pieces", es: "piezas" },
      "Based on specified exposed edge length; enter length below"),
    fila("clips", { en: "Leveling clips", es: "Clips niveladores" },
      clipsCant, a.clipsPorPaquete, { en: "packs", es: "paquetes" },
      "Allowance adjustable / verify tile pattern and layout"),
    fila("cunas", { en: "Leveling wedges", es: "Cuñas niveladoras" },
      clipsCant, a.cunasPorPaquete, { en: "packs", es: "paquetes" },
      "Allowance adjustable / wedges may be reusable"),
    fila("coladera", { en: "Shower drain", es: "Coladera de ducha" },
      esDucha ? 1 : 0, 1, { en: "each", es: "c/u" },
      "One shower drain by default; confirm installation type"),
    fila("pendiente", { en: "Mortar pre-slope", es: "Pendiente de mortero" },
      pendientePc, a.morteroPiesCubicosPorBolsa, { en: "bags", es: "bolsas" },
      "Optional; typically builder / framer scope, confirm with installer"),
  ];

  return {
    areas: { pisoSf, paredSf, perimetroLf, tablerosPaneles },
    tablerosLf,
    filas,
  };
}

/**
 * Una fila. C = cantidad; D = por paquete; E = paquetes a vender (ROUNDUP), salvo el tablero, que vende LF enteros
 * (paneles × ancho) y se le pasa `venta`.
 */
function fila(
  clave: string, material: Bilingue, cantidad: number, porPaquete: number, unidad: Bilingue, nota: string,
  venta?: number,
): FilaCalculada {
  const c = sana(cantidad);
  return {
    clave, material, cantidad: c, porPaquete: porPaquete > 0 ? porPaquete : null,
    venta: venta ?? paquetesNecesarios(c, porPaquete),
    unidad, nota: { en: nota, es: NOTAS_ES[nota] ?? nota },
  };
}

/**
 * C27: la lechada en libras. Término de pared: pared × ((1/(largo+junta) + 1/(ancho+junta)) × junta) × profundidad;
 * igual para el piso. La suma se divide entre la referencia (junta 1/8, 0.25 in) y se escala por 25 lb / 280 SF.
 */
function calculaLechada(e: EntradasCalculadora, a: AjustesCalculadora, pisoSf: number, paredSf: number): number {
  const [pa, pb] = medidasDeLaLoseta(e.tamanoPared);
  const [pc, pd] = medidasDeLaLoseta(e.tamanoPiso);
  const jp = sana(e.juntaParedIn), jq = sana(e.juntaPisoIn);
  const terminoPared = paredSf * ((1 / (pa + jp) + 1 / (pb + jp)) * jp) * a.lechadaProfundidadParedIn;
  const terminoPiso = pisoSf * ((1 / (pc + jq) + 1 / (pd + jq)) * jq) * a.lechadaProfundidadPisoIn;
  const denominador = ((1 / (a.lechadaLargoRefIn + a.lechadaJuntaRefIn) + 1 / (a.lechadaAnchoRefIn + a.lechadaJuntaRefIn)) * a.lechadaJuntaRefIn) * a.lechadaProfundidadRefIn;
  return finitoOCero(((terminoPared + terminoPiso) / denominador) * (a.lechadaLbPorBolsa / a.lechadaSfReferencia));
}

/** Notas en español de las filas (la hoja las trae en inglés). */
const NOTAS_ES: Record<string, string> = {
  "One 5×7 liner piece covers the sample pan cut (24 SF); verify available sheet dimensions and upturns.": "Una pieza 5×7 cubre el corte de ejemplo de 24 SF; verifica las medidas disponibles y las subidas.",
  "44-lb mortar bags per Supply Calculator; volume yield still requires product confirmation.": "Bolsas de 44 lb según la calculadora de suministro; el rendimiento por volumen aún requiere confirmar el producto.",
  "Estimated 17.6 LF installed; 7 whole 3-ft-wide panels = 21 LF sold. Layout panels editable in settings.": "Estimado 17.6 LF instalados; 7 paneles enteros de 3 ft de ancho = 21 LF a vender. Los paneles del trazado se editan en los ajustes.",
  "575 screws per box; verify screw spacing & substrate": "575 tornillos por caja; verifica la separación y el sustrato.",
  "Roll coverage in linear feet; seam estimate": "Rendimiento del rollo en pies lineales; estimado de juntas.",
  "Working 3-gallon standard reference; one waterproofing brand only; verify actual coverage and packaging.": "Referencia estándar de 3 galones; una sola marca de impermeabilizante; verifica el rendimiento y el empaque reales.",
  "44-lb thinset working rate for standard shower; back-buttering included; verify coverage.": "Rendimiento de trabajo de 44 lb para una ducha estándar; incluye el pegado por la cara trasera; verifica el rendimiento.",
  "Boxes use SF per box; tile size used only for grout estimate": "Las cajas se cuentan por SF por caja; el tamaño de la loseta solo sirve para estimar la lechada.",
  "25-lb bags; coverage in SF/bag depends on joint width, depth and tile dimensions.": "Bolsas de 25 lb; el rendimiento en SF por bolsa depende del ancho y la profundidad de la junta y del tamaño de la loseta.",
  "Calculated from estimated linear feet of corner joints": "Calculado con los pies lineales estimados de las juntas de esquina.",
  "Based on specified exposed edge length; enter length below": "Según el largo de borde expuesto; captúralo abajo.",
  "Allowance adjustable / verify tile pattern and layout": "Margen ajustable; verifica el patrón y el trazado de la loseta.",
  "Allowance adjustable / wedges may be reusable": "Margen ajustable; las cuñas pueden reutilizarse.",
  "One shower drain by default; confirm installation type": "Una coladera por defecto; confirma el tipo de instalación.",
  "Optional; typically builder / framer scope, confirm with installer": "Opcional; normalmente lo incluye el constructor; confirma con el instalador.",
};
