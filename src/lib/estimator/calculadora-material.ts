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

/** Máximo de habitaciones o muros en la calculadora de piso o de pared. */
export const MAX_FILAS_DE_MEDIDA = 12;

/** Una habitación de la calculadora de piso: su largo y su ancho (ft). Se suman con las demás. */
export interface Habitacion { nombre: string; largoFt: number; anchoFt: number }
/** Un muro de la calculadora de pared: largo y alto (ft), y las aberturas (SF) que se le restan. */
export interface Muro { nombre: string; largoFt: number; altoFt: number; aberturasSf: number }

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
  /** Solo la calculadora de piso: las habitaciones (cada una con su largo y ancho). Una fila por defecto. */
  habitaciones: Habitacion[];
  /** Solo la calculadora de pared: los muros (cada uno con su largo, alto y aberturas). Una fila por defecto. */
  muros: Muro[];
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
  habitaciones: [{ nombre: "Room 1", largoFt: 5, anchoFt: 3 }],
  muros: [{ nombre: "Wall 1", largoFt: 5, altoFt: 8, aberturasSf: 0 }],
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

/** Las calculadoras. La de ducha es la hoja completa; la de piso y la de pared son la misma hoja con menos campos. */
export interface DatosDeCalculadora { tipo: TipoDeProyecto; etiqueta: Bilingue; descripcion: Bilingue }
export const CALCULADORAS: readonly DatosDeCalculadora[] = [
  {
    tipo: "Shower",
    etiqueta: { en: "Shower calculator", es: "Calculadora de ducha" },
    descripcion: {
      en: "Pan, walls, backerboard, waterproofing and every shower material.",
      es: "Base, paredes, tablero, impermeabilizante y todo el material de la ducha.",
    },
  },
  {
    tipo: "Flooring Only",
    etiqueta: { en: "Floor calculator", es: "Calculadora de piso" },
    descripcion: {
      en: "Floor tile, thinset, grout and trim for one or several rooms.",
      es: "Loseta de piso, pegamento, lechada y perfil para una o varias habitaciones.",
    },
  },
  {
    tipo: "Wall Only",
    etiqueta: { en: "Wall calculator", es: "Calculadora de pared" },
    descripcion: {
      en: "Wall tile, thinset, grout and trim for one or several walls.",
      es: "Loseta de pared, pegamento, lechada y perfil para una o varias paredes.",
    },
  },
];

/**
 * Dónde se usa cada campo: la tabla única que decide qué ve cada calculadora. `usa` = calculadoras que lo usan;
 * `cuandoPared` = en la de pared solo aplica si ese interruptor (0/1) de «Product Settings» está en 1;
 * `condicion` = solo aplica si se cumple (p. ej. la pendiente solo con C33 = 1).
 */
export interface Uso {
  usa: readonly TipoDeProyecto[];
  cuandoPared?: keyof AjustesCalculadora;
  condicion?: (a: AjustesCalculadora) => boolean;
}

const TODAS: readonly TipoDeProyecto[] = ["Shower", "Flooring Only", "Wall Only"];
const DUCHA: readonly TipoDeProyecto[] = ["Shower"];
const DUCHA_Y_PARED: readonly TipoDeProyecto[] = ["Shower", "Wall Only"];
const DUCHA_Y_PISO: readonly TipoDeProyecto[] = ["Shower", "Flooring Only"];

/** Los campos de la hoja 1 (entradas). Piso y pared capturan filas (`habitaciones`, `muros`) en vez de las medidas de ducha. */
export const USO_DE_ENTRADAS: Record<keyof EntradasCalculadora, Uso> = {
  proyecto: { usa: TODAS },
  largoFt: { usa: DUCHA },
  anchoFt: { usa: DUCHA },
  altoFt: { usa: DUCHA },
  disposicion: { usa: DUCHA },
  aberturasSf: { usa: DUCHA },
  morteroProfundidadIn: { usa: DUCHA },
  cajaParedSf: { usa: DUCHA_Y_PARED },
  cajaPisoSf: { usa: DUCHA_Y_PISO },
  tamanoPared: { usa: DUCHA_Y_PARED },
  tamanoPiso: { usa: DUCHA_Y_PISO },
  juntaParedIn: { usa: DUCHA_Y_PARED },
  juntaPisoIn: { usa: DUCHA_Y_PISO },
  subidaLinerIn: { usa: DUCHA },
  bordeExtraLinerIn: { usa: DUCHA },
  bordeExpuestoLf: { usa: TODAS },
  salpicaderoLargoFt: { usa: DUCHA_Y_PARED },
  salpicaderoAltoFt: { usa: DUCHA_Y_PARED },
  habitaciones: { usa: ["Flooring Only"] },
  muros: { usa: ["Wall Only"] },
};

/** Los ajustes de «Product Settings» (hoja 2): dónde se usa cada uno. Vacío = la hoja no lo usa en ninguna fórmula. */
export const USO_DE_AJUSTES: Record<keyof AjustesCalculadora, Uso> = {
  tableroCoberturaSf: { usa: [] },
  tornillosPorTablero: { usa: DUCHA_Y_PARED, cuandoPared: "tableroEnSoloPared" },
  tornillosPorCaja: { usa: DUCHA_Y_PARED, cuandoPared: "tableroEnSoloPared" },
  rolloMallaLf: { usa: DUCHA_Y_PARED, cuandoPared: "tableroEnSoloPared" },
  mallaPorTableroLf: { usa: DUCHA_Y_PARED, cuandoPared: "tableroEnSoloPared" },
  liner_subidaSinUsoIn: { usa: [] },
  liner_bordeSinUsoIn: { usa: [] },
  impermeableSfPorGal: { usa: DUCHA_Y_PARED, cuandoPared: "impermeableEnSoloPared" },
  impermeableGalPorEnvase: { usa: DUCHA_Y_PARED, cuandoPared: "impermeableEnSoloPared" },
  impermeableSolape: { usa: DUCHA_Y_PARED, cuandoPared: "impermeableEnSoloPared" },
  adhesivoParedSfPorBolsa: { usa: DUCHA_Y_PARED },
  adhesivoPisoSfPorBolsa: { usa: DUCHA_Y_PISO },
  morteroPiesCubicosPorBolsa: { usa: DUCHA },
  lechadaSfReferencia: { usa: TODAS },
  lechadaLbPorBolsa: { usa: TODAS },
  lechadaLargoRefIn: { usa: TODAS },
  lechadaAnchoRefIn: { usa: TODAS },
  lechadaJuntaRefIn: { usa: TODAS },
  lechadaProfundidadParedIn: { usa: DUCHA_Y_PARED },
  lechadaProfundidadPisoIn: { usa: DUCHA_Y_PISO },
  lechadaProfundidadRefIn: { usa: TODAS },
  siliconaLfPorTubo: { usa: DUCHA_Y_PARED },
  perfilLfPorPieza: { usa: TODAS },
  clipsPorSf: { usa: DUCHA_Y_PISO },
  clipsPorPaquete: { usa: DUCHA_Y_PISO },
  cunasPorPaquete: { usa: DUCHA_Y_PISO },
  preslopePromedioIn: { usa: DUCHA },
  preslopeIncluido: { usa: DUCHA },
  tableroEnSoloPared: { usa: ["Wall Only"] },
  impermeableEnSoloPared: { usa: ["Wall Only"] },
  tableroAltoFt: { usa: DUCHA_Y_PARED, cuandoPared: "tableroEnSoloPared" },
  tableroAnchoLf: { usa: DUCHA_Y_PARED, cuandoPared: "tableroEnSoloPared" },
  tableroUnidadLf: { usa: [] },
  tablerosExtra: { usa: DUCHA_Y_PARED, cuandoPared: "tableroEnSoloPared" },
  impermeableReferenciaGal: { usa: [] },
};

/** Las filas de materiales (la hoja 1, filas 17–33) y, por calculadora, cuáles aplican. */
export const CLAVES_DE_FILA = [
  "liner", "mortero", "tablero", "tornillos", "malla", "impermeable", "pegamento-pared", "pegamento-piso",
  "loseta-pared", "loseta-piso", "lechada", "silicon", "perfil", "clips", "cunas", "coladera", "pendiente",
] as const;
export type ClaveDeFila = (typeof CLAVES_DE_FILA)[number];

export const USO_DE_FILAS: Record<ClaveDeFila, Uso> = {
  liner: { usa: DUCHA },
  mortero: { usa: DUCHA },
  tablero: { usa: DUCHA_Y_PARED, cuandoPared: "tableroEnSoloPared" },
  tornillos: { usa: DUCHA_Y_PARED, cuandoPared: "tableroEnSoloPared" },
  malla: { usa: DUCHA_Y_PARED, cuandoPared: "tableroEnSoloPared" },
  impermeable: { usa: DUCHA_Y_PARED, cuandoPared: "impermeableEnSoloPared" },
  "pegamento-pared": { usa: DUCHA_Y_PARED },
  "pegamento-piso": { usa: DUCHA_Y_PISO },
  "loseta-pared": { usa: DUCHA_Y_PARED },
  "loseta-piso": { usa: DUCHA_Y_PISO },
  lechada: { usa: TODAS },
  silicon: { usa: DUCHA_Y_PARED },
  perfil: { usa: TODAS },
  clips: { usa: DUCHA_Y_PISO },
  cunas: { usa: DUCHA_Y_PISO },
  coladera: { usa: DUCHA },
  pendiente: { usa: DUCHA, condicion: (a) => a.preslopeIncluido === 1 },
};

/** Las áreas de la sección 03 que cada calculadora muestra. */
export const USO_DE_AREAS: Record<keyof AreasCalculadas, Uso> = {
  pisoSf: { usa: DUCHA_Y_PISO },
  paredSf: { usa: DUCHA_Y_PARED },
  perimetroLf: { usa: DUCHA_Y_PARED },
  tablerosPaneles: { usa: DUCHA_Y_PARED, cuandoPared: "tableroEnSoloPared" },
};

/** ¿Lo usa esta calculadora, con estos ajustes? */
export function aplicaUso(u: Uso, tipo: TipoDeProyecto, a: AjustesCalculadora): boolean {
  if (!u.usa.includes(tipo)) return false;
  if (tipo === "Wall Only" && u.cuandoPared && a[u.cuandoPared] !== 1) return false;
  return u.condicion ? u.condicion(a) : true;
}

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
}

/** Los ajustes en el orden de la hoja 2, con su celda, unidad y nota. */
export const AJUSTES_META: readonly AjusteMeta[] = [
  { clave: "tableroCoberturaSf", celda: "C6", etiqueta: { en: "Backerboard coverage", es: "Cobertura del tablero" }, unidad: "SF / panel", nota: "3×5 panel confirmed in training PDF" },
  { clave: "tornillosPorTablero", celda: "C7", etiqueta: { en: "Screws per backerboard", es: "Tornillos por tablero" }, unidad: "screws / panel", nota: "Illustrative; verify fastener spacing and framing" },
  { clave: "tornillosPorCaja", celda: "C8", etiqueta: { en: "Screws per box", es: "Tornillos por caja" }, unidad: "screws / box", nota: "Confirmed in training PDF" },
  { clave: "rolloMallaLf", celda: "C9", etiqueta: { en: "Mesh roll coverage", es: "Rollo de malla" }, unidad: "LF / roll", nota: "6×50 listed in training PDF; verify roll unit (feet vs yards)" },
  { clave: "mallaPorTableroLf", celda: "C10", etiqueta: { en: "Mesh seam length per board", es: "Largo de juntas por tablero" }, unidad: "LF / board", nota: "Rough allowance: check actual board seams" },
  { clave: "liner_subidaSinUsoIn", celda: "C11", etiqueta: { en: "Pan liner upturn (sheet 2)", es: "Subida del liner (hoja 2)" }, unidad: "in", nota: "Editable; minimum based on design/code/manufacturer" },
  { clave: "liner_bordeSinUsoIn", celda: "C12", etiqueta: { en: "Pan liner edge extra (sheet 2)", es: "Borde extra del liner (hoja 2)" }, unidad: "in", nota: "No automatic waste. Add only if required by design" },
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
  { clave: "tableroUnidadLf", celda: "C40", etiqueta: { en: "Backerboard sold unit", es: "Unidad de venta del tablero" }, unidad: "LF per unit", nota: "estimated LF shown in calculator, whole LF rounded for sale" },
  { clave: "tablerosExtra", celda: "C41", etiqueta: { en: "Extra backerboard panels required by layout", es: "Paneles extra por el trazado" }, unidad: "panels", nota: "Installation-layout allowance for 3×5×8 standard reference; not waste; adjust per layout" },
  { clave: "impermeableReferenciaGal", celda: "C43", etiqueta: { en: "Reference waterproofing supply", es: "Referencia de impermeabilizante" }, unidad: "gallons", nota: "Select ONE waterproofing brand (Crest, Hydrorite, or Cemix), not all three" },
];

// ---- Cálculo ------------------------------------------------------------------------------------------------------------

/** VALUE(LEFT(t; FIND("x";t)-1)) y VALUE(MID(t; FIND("x";t)+1; 9)): «24x48» → [24, 48] (largo x ancho, en pulgadas). */
export function medidasDeLaLoseta(tamano: string): [number, number] {
  const i = tamano.indexOf("x");
  if (i < 0) return [0, 0];
  return [Number.parseFloat(tamano.slice(0, i)) || 0, Number.parseFloat(tamano.slice(i + 1, i + 10)) || 0];
}

/** Suma de una lista de números (una lista vacía vale 0). */
const sumar = (xs: readonly number[]): number => xs.reduce((acc, x) => acc + x, 0);

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

/**
 * Cómo sale una cifra, en inglés y en español: la fórmula en palabras, los pasos con las cifras ya puestas (cada uno
 * termina en su resultado), lo que usa (con su valor y su celda de la hoja) y la última línea, ÷ por paquete → a vender.
 */
export interface Explicacion {
  formula: Bilingue;
  pasos: Bilingue[];
  usa: Bilingue[];
  cierre: Bilingue;
}

export interface FilaCalculada {
  /** Identificador estable de la fila (sirve de clave y para las pruebas). */
  clave: ClaveDeFila;
  material: Bilingue;
  /** C: cantidad necesaria (sin redondear). */
  cantidad: number;
  /** D: por paquete (null si la hoja no lo pone). */
  porPaquete: number | null;
  /** E: a vender (el número que se pide). */
  venta: number;
  unidad: Bilingue;
  nota: Bilingue;
  /** Cómo sale la cantidad y la cifra a vender (se muestra al pulsarlas). */
  explicacion: Explicacion;
}

export interface ResultadoCalculadora {
  areas: AreasCalculadas;
  /** Cómo sale cada área de la sección 03. */
  explicacionAreas: Record<keyof AreasCalculadas, Explicacion>;
  /** C19: LF de tablero, antes de redondear paneles. */
  tablerosLf: number;
  filas: FilaCalculada[];
}

type Idioma = "en" | "es";

/** Las líneas de una explicación en un solo idioma; `explica` las junta en inglés y español. */
interface Piezas {
  formula: string;
  pasos: string[];
  usa: string[];
  cierre: string;
}

const NOMBRE_PROYECTO: Record<TipoDeProyecto, Bilingue> = {
  Shower: { en: "Shower", es: "Ducha" },
  "Flooring Only": { en: "Flooring Only", es: "Solo piso" },
  "Wall Only": { en: "Wall Only", es: "Solo pared" },
};

const NOMBRE_DISPOSICION: Record<Disposicion, Bilingue> = {
  "2 Walls": { en: "2 walls", es: "2 paredes" },
  "3 Walls": { en: "3 walls", es: "3 paredes" },
  "4 Walls": { en: "4 walls", es: "4 paredes" },
};

/** Cifras para leer: a partir de 100, enteras; si no, 3 cifras significativas (5.87, 0.125, 8.1). */
function cifra(lg: Idioma, x: number): string {
  if (!Number.isFinite(x)) return "0";
  const loc = lg === "es" ? "es-US" : "en-US";
  const opciones: Intl.NumberFormatOptions = Math.abs(x) >= 100 ? { maximumFractionDigits: 0 } : { maximumSignificantDigits: 3 };
  return new Intl.NumberFormat(loc, opciones).format(x + 0);
}

/** Ayudas de texto para un idioma: `n` cifras, `t` elige el texto, y las líneas de entradas, ajustes y división. */
function ctx(lg: Idioma) {
  const t = (en: string, es: string): string => (lg === "en" ? en : es);
  const n = (x: number): string => cifra(lg, x);
  /** Una entrada de la hoja 1: «Largo: 5 ft · Hoja 1 C7». */
  const ent = (en: string, es: string, valor: string, celda: string): string =>
    `${t(en, es)}: ${valor} · ${t("Sheet 1", "Hoja 1")} ${celda}`;
  /** Un ajuste de la hoja 2: «Screws per box: 575 · Product Settings C8». */
  const aj = (clave: keyof AjustesCalculadora, valor: number): string => {
    const m = AJUSTES_META.find((x) => x.clave === clave)!;
    return `${m.etiqueta[lg]}: ${n(valor)} · ${t("Product Settings", "Hoja 2")} ${m.celda}`;
  };
  /** La línea de cierre: «91 SF ÷ 15.5 SF per box = 5.87 → rounded up = 6 boxes». */
  const div = (cant: number, porPaq: number, venta: number, uCant: string, uPaq: string, [sing, plur]: [string, string]): string => {
    if (!(porPaq > 0)) return t("The package size is 0, so nothing is sold.", "El tamaño de paquete es 0, así que no se vende nada.");
    return `${n(cant)} ${uCant} ÷ ${n(porPaq)} ${uPaq} = ${n(cant / porPaq)} → ${t("rounded up", "redondeado hacia arriba")} = ${venta} ${venta === 1 ? sing : plur}`;
  };
  return { t, n, ent, aj, div };
}

/** Une las dos lenguas de una explicación. Cada lengua da las mismas líneas, en el mismo orden. */
function explica(construye: (lg: Idioma) => Piezas): Explicacion {
  const en = construye("en");
  const es = construye("es");
  return {
    formula: { en: en.formula, es: es.formula },
    pasos: en.pasos.map((p, i) => ({ en: p, es: es.pasos[i] ?? p })),
    usa: en.usa.map((p, i) => ({ en: p, es: es.usa[i] ?? p })),
    cierre: { en: en.cierre, es: es.cierre },
  };
}

/** Una fila que da 0 por una razón fija (el tipo de proyecto, un ajuste en 0…): el motivo en las dos lenguas. */
function cero(formula: Bilingue, motivo: Bilingue): Explicacion {
  return {
    formula,
    pasos: [{ en: `0 because ${motivo.en}`, es: `0 porque ${motivo.es}` }],
    usa: [],
    cierre: { en: "Nothing to sell: 0.", es: "Nada que vender: 0." },
  };
}

/** Desglose de la lechada (C27): lo que suman las juntas de pared y de piso, la referencia y la conversión a libras. */
function desgloseLechada(e: EntradasCalculadora, a: AjustesCalculadora, pisoSf: number, paredSf: number) {
  const [pa, pb] = medidasDeLaLoseta(e.tamanoPared);
  const [pc, pd] = medidasDeLaLoseta(e.tamanoPiso);
  const jp = sana(e.juntaParedIn), jq = sana(e.juntaPisoIn);
  const termPared = paredSf * ((1 / (pa + jp) + 1 / (pb + jp)) * jp) * a.lechadaProfundidadParedIn;
  const termPiso = pisoSf * ((1 / (pc + jq) + 1 / (pd + jq)) * jq) * a.lechadaProfundidadPisoIn;
  const referencia = ((1 / (a.lechadaLargoRefIn + a.lechadaJuntaRefIn) + 1 / (a.lechadaAnchoRefIn + a.lechadaJuntaRefIn)) * a.lechadaJuntaRefIn) * a.lechadaProfundidadRefIn;
  const sfEquivalentes = finitoOCero((termPared + termPiso) / referencia);
  const lb = finitoOCero(sfEquivalentes * (a.lechadaLbPorBolsa / a.lechadaSfReferencia));
  return { pa, pb, pc, pd, jp, jq, termPared, termPiso, referencia, sfEquivalentes, lb };
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

  // Solo piso: cada habitación es largo × ancho, y se suman. Ducha: el L × W de la hoja.
  const pisoPorHabitacion = esPiso ? e.habitaciones.map((h) => Math.max(0, sana(h.largoFt) * sana(h.anchoFt))) : [];

  // Solo pared: cada muro es (alto × largo − aberturas), y se suman. Ducha: no se usa.
  const murosPared = esPared ? e.muros : [];
  const paredPorMuro = murosPared.map((m) => Math.max(0, sana(m.altoFt) * sana(m.largoFt) - sana(m.aberturasSf)));

  // C40: piso (ducha: L × W; solo piso: suma de habitaciones).
  const pisoSf = esDucha ? Math.max(0, L * W) : esPiso ? sumar(pisoPorHabitacion) : 0;

  // C42: perímetro de pared (LF). Ducha: L + (2, 3 o 4 paredes). Solo pared: suma de los largos de los muros.
  const perimetroLf = esDucha
    ? L + (e.disposicion === "2 Walls" ? W : e.disposicion === "3 Walls" ? 2 * W : L + 2 * W)
    : esPared ? sumar(murosPared.map((m) => sana(m.largoFt))) : 0;

  // C41: pared (SF). Ducha: H × perímetro − aberturas + salpicadero. Solo pared: suma de muros + salpicadero.
  const paredSf = esDucha
    ? Math.max(0, H * perimetroLf - ab + salpicaderoSf)
    : esPared ? Math.max(0, sumar(paredPorMuro) + salpicaderoSf) : 0;

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

  // Silicón (C28): perímetro + alto × (4, 2 o 1 esquinas según la disposición); solo pared: 2 esquinas por muro (alto × 2).
  const factorDeEsquinas = e.disposicion === "4 Walls" ? 4 : e.disposicion === "3 Walls" ? 2 : 1;
  const alturasPared = murosPared.map((m) => sana(m.altoFt));
  const siliconaLf = esDucha ? perimetroLf + H * factorDeEsquinas : esPared ? sumar(alturasPared) * 2 : 0;

  // Clips y cuñas (C30, C31): (piso + pared) × clips por SF. Son para nivelar loseta de piso: en solo pared no aplican.
  const clipsCant = esPared ? 0 : (pisoSf + paredSf) * a.clipsPorSf;

  const lechada = desgloseLechada(e, a, pisoSf, paredSf);

  // ---- Explicaciones: solo leen las cifras de arriba; no cambian ninguna.
  const tipo = NOMBRE_PROYECTO[e.proyecto];
  /** «project type is Flooring Only (no walls)»: el motivo de un cero por tipo de proyecto. */
  const motivoProyecto = (extra: Bilingue): Bilingue => ({
    en: `project type is ${tipo.en} ${extra.en}`,
    es: `el tipo de proyecto es ${tipo.es} ${extra.es}`,
  });
  const motivoSinTablero: Bilingue = esPiso
    ? motivoProyecto({ en: "(no backerboard)", es: "(sin tablero)" })
    : esPared && a.tableroEnSoloPared !== 1
      ? { en: "project type is Wall Only and Product Settings C34 = 0 (no backerboard)", es: "el tipo de proyecto es Solo pared y Hoja 2 C34 = 0 (sin tablero)" }
      : { en: "wall area is 0, so there is no backerboard length", es: "el área de pared es 0, así que no hay largo de tablero" };
  const motivoSinImpermeable: Bilingue = esPiso
    ? motivoProyecto({ en: "(waterproofing is for showers)", es: "(el impermeabilizante es para duchas)" })
    : { en: "project type is Wall Only and Product Settings C35 = 0", es: "el tipo de proyecto es Solo pared y Hoja 2 C35 = 0" };
  const sinPared: Bilingue = motivoProyecto({ en: "(no walls)", es: "(sin paredes)" });
  const sinPiso: Bilingue = motivoProyecto({ en: "(no floor)", es: "(sin piso)" });
  const soloDucha = (en: string, es: string): Bilingue => motivoProyecto({ en, es });

  // Las dos fórmulas del perímetro, según la disposición (las mismas que calcula C42).
  const formulaPerimetro: Bilingue = e.disposicion === "2 Walls"
    ? { en: "length + width", es: "largo + ancho" }
    : e.disposicion === "3 Walls"
      ? { en: "length + 2 × width", es: "largo + 2 × ancho" }
      : { en: "length + (length + 2 × width)", es: "largo + (largo + 2 × ancho)" };
  const perimetroConNumeros = e.disposicion === "2 Walls"
    ? `${cifra("en", L)} + ${cifra("en", W)}`
    : e.disposicion === "3 Walls"
      ? `${cifra("en", L)} + 2 × ${cifra("en", W)}`
      : `${cifra("en", L)} + (${cifra("en", L)} + 2 × ${cifra("en", W)})`;

  // Solo piso: una línea por habitación y la suma. Solo pared: una línea por muro y la suma.
  const expPisoHabitaciones = esPiso
    ? explica((lg) => {
        const { n, t } = ctx(lg);
        const nombres = e.habitaciones.map((h, i) => h.nombre.trim() || t(`Room ${i + 1}`, `Habitación ${i + 1}`));
        const suma = pisoPorHabitacion.map(n).join(" + ") || "0";
        return {
          formula: t("Floor area (SF) = sum of rooms, each length × width", "Área de piso (SF) = suma de habitaciones, cada una largo × ancho"),
          pasos: [
            ...e.habitaciones.map((h, i) => `${nombres[i]}: ${n(sana(h.largoFt))} × ${n(sana(h.anchoFt))} = ${n(pisoPorHabitacion[i])} SF`),
            t(`Floor area = ${suma} = ${n(pisoSf)} SF`, `Área de piso = ${suma} = ${n(pisoSf)} SF`),
          ],
          usa: [`${t("Rooms", "Habitaciones")}: ${e.habitaciones.length} · ${t("floor calculator", "calculadora de piso")}`],
          cierre: t("Used for: floor tile, floor thinset, floor grout, trim and clips.",
            "Se usa en: loseta de piso, pegamento de piso, lechada de piso, perfil y clips."),
        };
      })
    : null;

  const expParedMuros = esPared
    ? explica((lg) => {
        const { n, t, ent } = ctx(lg);
        const suma = paredPorMuro.map(n).join(" + ") || "0";
        return {
          formula: t("Wall area (SF) = sum of walls, each height × length − openings, + backsplash",
            "Área de pared (SF) = suma de muros, cada uno alto × largo − aberturas, + salpicadero"),
          pasos: [
            ...murosPared.map((m, i) => {
              const nombre = m.nombre.trim() || t(`Wall ${i + 1}`, `Muro ${i + 1}`);
              const bruta = sana(m.altoFt) * sana(m.largoFt) - sana(m.aberturasSf);
              const aviso = bruta < 0 ? t(" (can't be below 0)", " (no puede ser menor que 0)") : "";
              return `${nombre}: ${n(sana(m.altoFt))} × ${n(sana(m.largoFt))} − ${n(sana(m.aberturasSf))} = ${n(paredPorMuro[i])} SF${aviso}`;
            }),
            t(`Wall area = ${suma} + ${n(salpicaderoSf)} backsplash = ${n(paredSf)} SF`,
              `Área de pared = ${suma} + ${n(salpicaderoSf)} salpicadero = ${n(paredSf)} SF`),
          ],
          usa: [
            `${t("Walls", "Muros")}: ${murosPared.length} · ${t("wall calculator", "calculadora de pared")}`,
            ent("Backsplash", "Salpicadero", `${n(salpicaderoSf)} SF (${n(sana(e.salpicaderoLargoFt))} ft × ${n(sana(e.salpicaderoAltoFt))} ft)`, "C48 × C49"),
          ],
          cierre: t("Used for: wall tile, wall thinset, backerboard, waterproofing, wall grout and trim.",
            "Se usa en: loseta de pared, pegamento de pared, tablero, impermeabilizante, lechada de pared y perfil."),
        };
      })
    : null;

  const expPerimetroMuros = esPared
    ? explica((lg) => {
        const { n, t } = ctx(lg);
        const suma = murosPared.map((m) => n(sana(m.largoFt))).join(" + ") || "0";
        return {
          formula: t("Perimeter (LF) = sum of wall lengths", "Perímetro (LF) = suma de los largos de los muros"),
          pasos: [t(`Perimeter = ${suma} = ${n(perimetroLf)} LF`, `Perímetro = ${suma} = ${n(perimetroLf)} LF`)],
          usa: [`${t("Walls", "Muros")}: ${murosPared.length}`],
          cierre: t("Used for: wall area and silicone.", "Se usa en: área de pared y silicón."),
        };
      })
    : null;

  const explicacionAreas: Record<keyof AreasCalculadas, Explicacion> = {
    pisoSf: esDucha
      ? explica((lg) => {
          const { n, t, ent } = ctx(lg);
          return {
            formula: t("Floor area (SF) = length × width", "Área de piso (SF) = largo × ancho"),
            pasos: [t(`Floor area = ${n(L)} × ${n(W)} = ${n(pisoSf)} SF`, `Área de piso = ${n(L)} × ${n(W)} = ${n(pisoSf)} SF`)],
            usa: [ent("Length", "Largo", `${n(L)} ft`, "C7"), ent("Width", "Ancho", `${n(W)} ft`, "C8")],
            cierre: t("Used for: floor tile, floor thinset, liner, mortar bed, floor grout, pre-slope and clips.",
              "Se usa en: loseta de piso, pegamento de piso, liner, cama de mortero, lechada de piso, pendiente y clips."),
          };
        })
      : esPiso && expPisoHabitaciones
        ? expPisoHabitaciones
        : cero({ en: "Floor area (SF) = length × width", es: "Área de piso (SF) = largo × ancho" }, sinPiso),
    paredSf: esDucha
      ? explica((lg) => {
          const { n, t, ent } = ctx(lg);
          const expr = esDucha ? `(${perimetroConNumeros})` : n(L);
          const raw = H * perimetroLf - ab + salpicaderoSf;
          const final = raw < 0
            ? t(`${n(raw)} → 0 SF (can't be below 0)`, `${n(raw)} → 0 SF (no puede ser menor que 0)`)
            : `${n(raw)} SF`;
          return {
            formula: t(`Wall area (SF) = height × (${formulaPerimetro.en}) − openings + backsplash`,
              `Área de pared (SF) = alto × (${formulaPerimetro.es}) − aberturas + salpicadero`),
            pasos: [t(`Wall area = ${n(H)} × ${expr} − ${n(ab)} + ${n(salpicaderoSf)} = ${final}`,
              `Área de pared = ${n(H)} × ${expr} − ${n(ab)} + ${n(salpicaderoSf)} = ${final}`)],
            usa: [
              ent("Height", "Alto", `${n(H)} ft`, "C9"),
              ent("Length", "Largo", `${n(L)} ft`, "C7"),
              ...(esDucha ? [ent("Width", "Ancho", `${n(W)} ft`, "C8"),
                ent("Shower layout", "Disposición de la ducha", t(NOMBRE_DISPOSICION[e.disposicion].en, NOMBRE_DISPOSICION[e.disposicion].es), "C10")] : []),
              ent("Wall openings", "Aberturas en pared", `${n(ab)} SF`, "C11"),
              ent("Backsplash", "Salpicadero", `${n(salpicaderoSf)} SF (${n(sana(e.salpicaderoLargoFt))} ft × ${n(sana(e.salpicaderoAltoFt))} ft)`, "C48 × C49"),
            ],
            cierre: t("Used for: wall tile, wall thinset, backerboard, waterproofing, wall grout and clips.",
              "Se usa en: loseta de pared, pegamento de pared, tablero, impermeabilizante, lechada de pared y clips."),
          };
        })
      : esPared && expParedMuros
        ? expParedMuros
        : cero({ en: "Wall area (SF) = height × wall perimeter − openings + backsplash", es: "Área de pared (SF) = alto × perímetro − aberturas + salpicadero" }, sinPared),
    perimetroLf: esDucha
      ? explica((lg) => {
          const { n, t, ent } = ctx(lg);
          const lineaPerimetro = esDucha
            ? t(`Perimeter = ${perimetroConNumeros} = ${n(perimetroLf)} LF`, `Perímetro = ${perimetroConNumeros} = ${n(perimetroLf)} LF`)
            : t(`Perimeter = ${n(L)} = ${n(perimetroLf)} LF (one wall)`, `Perímetro = ${n(L)} = ${n(perimetroLf)} LF (una pared)`);
          return {
            formula: esDucha
              ? t(`Perimeter (LF) = ${formulaPerimetro.en}`, `Perímetro (LF) = ${formulaPerimetro.es}`)
              : t("Perimeter (LF) = length (one wall)", "Perímetro (LF) = largo (una pared)"),
            pasos: [lineaPerimetro],
            usa: [ent("Length", "Largo", `${n(L)} ft`, "C7"),
              ...(esDucha ? [ent("Width", "Ancho", `${n(W)} ft`, "C8"),
                ent("Shower layout", "Disposición de la ducha", t(NOMBRE_DISPOSICION[e.disposicion].en, NOMBRE_DISPOSICION[e.disposicion].es), "C10")] : [])],
            cierre: t("Used for: wall area and silicone.", "Se usa en: área de pared y silicón."),
          };
        })
      : esPared && expPerimetroMuros
        ? expPerimetroMuros
        : cero({ en: "Perimeter (LF) = length (shower and wall-only)", es: "Perímetro (LF) = largo (ducha y solo pared)" }, sinPared),
    tablerosPaneles: tablerosLf > 0
      ? explica((lg) => {
          const { n, t, ent, aj } = ctx(lg);
          const redondeado = Math.ceil(tablerosLf / a.tableroAnchoLf);
          return {
            formula: t("Full panels = rounded up (backerboard LF ÷ panel width) + extra panels from the layout",
              "Paneles completos = redondeado hacia arriba (LF de tablero ÷ ancho del panel) + paneles extra del trazado"),
            pasos: [
              t(`${n(tablerosLf)} LF ÷ ${n(a.tableroAnchoLf)} LF per panel = ${n(tablerosLf / a.tableroAnchoLf)} → rounded up = ${redondeado} panels`,
                `${n(tablerosLf)} LF ÷ ${n(a.tableroAnchoLf)} LF por panel = ${n(tablerosLf / a.tableroAnchoLf)} → redondeado hacia arriba = ${redondeado} paneles`),
              t(`${redondeado} + ${n(a.tablerosExtra)} extra = ${n(tablerosPaneles)} panels`,
                `${redondeado} + ${n(a.tablerosExtra)} extra = ${n(tablerosPaneles)} paneles`),
            ],
            usa: [`${t("Backerboard LF", "LF de tablero")}: ${n(tablerosLf)} LF · ${t("backerboard row", "fila de tablero")}`,
              aj("tableroAnchoLf", a.tableroAnchoLf), aj("tablerosExtra", a.tablerosExtra)],
            cierre: t(`Sold as ${n(tablerosPaneles)} panels × ${n(a.tableroAnchoLf)} LF = ${n(tablerosPaneles * a.tableroAnchoLf)} LF.`,
              `Se vende como ${n(tablerosPaneles)} paneles × ${n(a.tableroAnchoLf)} LF = ${n(tablerosPaneles * a.tableroAnchoLf)} LF.`),
          };
        })
      : cero({ en: "Full panels = backerboard LF ÷ panel width, rounded up, + extra", es: "Paneles completos = LF de tablero ÷ ancho del panel, redondeado, + extra" }, motivoSinTablero),
  };

  const expLiner = esDucha
    ? explica((lg) => {
        const { n, t, ent } = ctx(lg);
        const sub = sana(e.subidaLinerIn), borde = sana(e.bordeExtraLinerIn);
        return {
          formula: t("Liner (SF) = (length + 2 × (upturn + extra edge) ÷ 12) × (width + 2 × (upturn + extra edge) ÷ 12)",
            "Liner (SF) = (largo + 2 × (subida + borde extra) ÷ 12) × (ancho + 2 × (subida + borde extra) ÷ 12)"),
          pasos: [
            t(`Allowance per side = 2 × (${n(sub)} + ${n(borde)}) ÷ 12 = ${n(margenLiner)} ft`,
              `Margen por lado = 2 × (${n(sub)} + ${n(borde)}) ÷ 12 = ${n(margenLiner)} ft`),
            t(`Liner = (${n(L)} + ${n(margenLiner)}) × (${n(W)} + ${n(margenLiner)}) = ${n(linerSf)} SF`,
              `Liner = (${n(L)} + ${n(margenLiner)}) × (${n(W)} + ${n(margenLiner)}) = ${n(linerSf)} SF`),
          ],
          usa: [ent("Length", "Largo", `${n(L)} ft`, "C7"), ent("Width", "Ancho", `${n(W)} ft`, "C8"),
            ent("Liner upturn", "Subida del liner", `${n(sub)} in`, "F11"),
            ent("Pan liner extra edge", "Borde extra del liner", `${n(borde)} in`, "F12"),
            t(`Piece size: ${PIEZA_DE_LINER_SF} SF (fixed in the sheet, Per package)`, `Pieza: ${PIEZA_DE_LINER_SF} SF (fijo en la hoja, Por paquete)`)],
          cierre: ctx(lg).div(linerSf, PIEZA_DE_LINER_SF, paquetesNecesarios(linerSf, PIEZA_DE_LINER_SF), "SF", t("SF per piece", "SF por pieza"), [t("piece", "pieza"), t("pieces", "piezas")]),
        };
      })
    : cero({ en: "Liner (SF) = (length + 2 × upturn ÷ 12) × (width + 2 × upturn ÷ 12)", es: "Liner (SF) = (largo + 2 × subida ÷ 12) × (ancho + 2 × subida ÷ 12)" },
      motivoProyecto({ en: "(the pan liner is for showers)", es: "(el liner es solo para duchas)" }));

  const expMortero = esDucha
    ? explica((lg) => {
        const { n, t, ent, aj, div } = ctx(lg);
        return {
          formula: t("Mortar bed (cu ft) = floor area × average depth ÷ 12", "Mortero seco (pie³) = área de piso × profundidad promedio ÷ 12"),
          pasos: [t(`Mortar = ${n(pisoSf)} SF × ${n(e.morteroProfundidadIn)} in ÷ 12 = ${n(morteroPc)} cu ft`,
            `Mortero = ${n(pisoSf)} SF × ${n(e.morteroProfundidadIn)} pulg ÷ 12 = ${n(morteroPc)} pies³`)],
          usa: [ent("Average mortar depth", "Profundidad promedio del mortero", `${n(e.morteroProfundidadIn)} in`, "C12"),
            aj("morteroPiesCubicosPorBolsa", a.morteroPiesCubicosPorBolsa)],
          cierre: div(morteroPc, a.morteroPiesCubicosPorBolsa, paquetesNecesarios(morteroPc, a.morteroPiesCubicosPorBolsa),
            "cu ft", t("cu ft per bag", "pies³ por bolsa"), [t("bag", "bolsa"), t("bags", "bolsas")]),
        };
      })
    : cero({ en: "Mortar bed (cu ft) = floor area × average depth ÷ 12", es: "Mortero seco (pie³) = área de piso × profundidad ÷ 12" },
      motivoProyecto({ en: "(the mortar bed is for showers)", es: "(la cama de mortero es solo para duchas)" }));

  const expTablero = tablerosLf > 0
    ? explica((lg) => {
        const { n, t, ent, aj, div } = ctx(lg);
        return {
          formula: t("Backerboard (LF) = (wall area − backsplash) ÷ installed board height",
            "Tablero (LF) = (área de pared − salpicadero) ÷ alto instalado del tablero"),
          pasos: [t(`(${n(paredSf)} − ${n(salpicaderoSf)}) ÷ ${n(a.tableroAltoFt)} ft = ${n(tablerosLf)} LF`,
            `(${n(paredSf)} − ${n(salpicaderoSf)}) ÷ ${n(a.tableroAltoFt)} pies = ${n(tablerosLf)} LF`)],
          usa: [`${t("Wall area", "Área de pared")}: ${n(paredSf)} SF · ${t("section 03", "sección 03")}`,
            ent("Backsplash", "Salpicadero", `${n(salpicaderoSf)} SF`, "C48 × C49"),
            aj("tableroAltoFt", a.tableroAltoFt), aj("tableroAnchoLf", a.tableroAnchoLf), aj("tablerosExtra", a.tablerosExtra)],
          cierre: t(`${n(tablerosLf)} LF ÷ ${n(a.tableroAnchoLf)} LF per panel = ${n(tablerosLf / a.tableroAnchoLf)} → rounded up = ${tablerosPaneles - a.tablerosExtra} + ${n(a.tablerosExtra)} extra = ${tablerosPaneles} panels → ${n(tablerosPaneles * a.tableroAnchoLf)} LF to sell`,
            `${n(tablerosLf)} LF ÷ ${n(a.tableroAnchoLf)} LF por panel = ${n(tablerosLf / a.tableroAnchoLf)} → redondeado = ${tablerosPaneles - a.tablerosExtra} + ${n(a.tablerosExtra)} extra = ${tablerosPaneles} paneles → ${n(tablerosPaneles * a.tableroAnchoLf)} LF a vender`),
        };
      })
    : cero({ en: "Backerboard (LF) = (wall area − backsplash) ÷ installed board height", es: "Tablero (LF) = (área de pared − salpicadero) ÷ alto instalado" }, motivoSinTablero);

  const expTornillos = tablerosPaneles > 0
    ? explica((lg) => {
        const { n, t, ent, aj, div } = ctx(lg);
        return {
          formula: t("Screws = panels × screws per board", "Tornillos = paneles × tornillos por tablero"),
          pasos: [t(`${n(tablerosPaneles)} panels × ${n(a.tornillosPorTablero)} screws = ${n(tablerosPaneles * a.tornillosPorTablero)} screws`,
            `${n(tablerosPaneles)} paneles × ${n(a.tornillosPorTablero)} tornillos = ${n(tablerosPaneles * a.tornillosPorTablero)} tornillos`)],
          usa: [`${t("Panels", "Paneles")}: ${n(tablerosPaneles)} · ${t("section 03", "sección 03")}`, aj("tornillosPorTablero", a.tornillosPorTablero), aj("tornillosPorCaja", a.tornillosPorCaja)],
          cierre: div(tablerosPaneles * a.tornillosPorTablero, a.tornillosPorCaja, paquetesNecesarios(tablerosPaneles * a.tornillosPorTablero, a.tornillosPorCaja),
            t("screws", "tornillos"), t("screws per box", "tornillos por caja"), [t("box", "caja"), t("boxes", "cajas")]),
        };
      })
    : cero({ en: "Screws = panels × screws per board", es: "Tornillos = paneles × tornillos por tablero" }, motivoSinTablero);

  const expMalla = tablerosPaneles > 0
    ? explica((lg) => {
        const { n, t, ent, aj, div } = ctx(lg);
        return {
          formula: t("Mesh (LF) = panels × seam LF per board", "Malla (LF) = paneles × LF de juntas por tablero"),
          pasos: [t(`${n(tablerosPaneles)} panels × ${n(a.mallaPorTableroLf)} LF = ${n(tablerosPaneles * a.mallaPorTableroLf)} LF`,
            `${n(tablerosPaneles)} paneles × ${n(a.mallaPorTableroLf)} LF = ${n(tablerosPaneles * a.mallaPorTableroLf)} LF`)],
          usa: [`${t("Panels", "Paneles")}: ${n(tablerosPaneles)} · ${t("section 03", "sección 03")}`, aj("mallaPorTableroLf", a.mallaPorTableroLf), aj("rolloMallaLf", a.rolloMallaLf)],
          cierre: div(tablerosPaneles * a.mallaPorTableroLf, a.rolloMallaLf, paquetesNecesarios(tablerosPaneles * a.mallaPorTableroLf, a.rolloMallaLf),
            "LF", t("LF per roll", "LF por rollo"), [t("roll", "rollo"), t("rolls", "rollos")]),
        };
      })
    : cero({ en: "Mesh (LF) = panels × seam LF per board", es: "Malla (LF) = paneles × LF de juntas por tablero" }, motivoSinTablero);

  const expImpermeable = impermeableSf > 0
    ? explica((lg) => {
        const { n, t, ent, aj, div } = ctx(lg);
        const envase = a.impermeableGalPorEnvase;
        const porEnvase = a.impermeableSfPorGal * envase;
        return {
          formula: t("Waterproofing (SF) = (wall area − backsplash + floor area) × (1 + overlap); wall-only: wall area − backsplash",
            "Impermeabilizante (SF) = (área de pared − salpicadero + área de piso) × (1 + traslape); solo pared: área de pared − salpicadero"),
          pasos: [
            t(`Wall minus backsplash = ${n(paredSf)} − ${n(salpicaderoSf)} = ${n(paredSinSalpicadero)} SF`,
              `Pared menos salpicadero = ${n(paredSf)} − ${n(salpicaderoSf)} = ${n(paredSinSalpicadero)} SF`),
            esDucha
              ? t(`(${n(paredSinSalpicadero)} + ${n(pisoSf)}) × (1 + ${n(a.impermeableSolape)}) = ${n(impermeableSf)} SF`,
                `(${n(paredSinSalpicadero)} + ${n(pisoSf)}) × (1 + ${n(a.impermeableSolape)}) = ${n(impermeableSf)} SF`)
              : t(`Wall only: no floor added, overlap not applied = ${n(impermeableSf)} SF`,
                `Solo pared: sin piso ni traslape = ${n(impermeableSf)} SF`),
          ],
          usa: [`${t("Floor area", "Área de piso")}: ${n(pisoSf)} SF · ${t("section 03", "sección 03")}`,
            ent("Backsplash", "Salpicadero", `${n(salpicaderoSf)} SF`, "C48 × C49"),
            aj("impermeableSolape", a.impermeableSolape), aj("impermeableSfPorGal", a.impermeableSfPorGal), aj("impermeableGalPorEnvase", envase)],
          cierre: div(impermeableSf, porEnvase, paquetesNecesarios(impermeableSf, porEnvase), "SF",
            t(`SF per container (${n(a.impermeableSfPorGal)} SF/gal × ${n(envase)} gal)`, `SF por envase (${n(a.impermeableSfPorGal)} SF/gal × ${n(envase)} gal)`),
            [t("container", "envase"), t("containers", "envases")]),
        };
      })
    : cero({ en: "Waterproofing (SF) = (wall area − backsplash + floor area) × (1 + overlap)", es: "Impermeabilizante (SF) = (área de pared − salpicadero + área de piso) × (1 + traslape)" }, motivoSinImpermeable);

  const expPegamentoPared = paredSf > 0
    ? explica((lg) => {
        const { n, t, aj, div } = ctx(lg);
        return {
          formula: t("Wall thinset (bags) = wall area ÷ SF per bag", "Pegamento de pared (bolsas) = área de pared ÷ SF por bolsa"),
          pasos: [t(`Amount needed = wall area = ${n(paredSf)} SF`, `Cantidad = área de pared = ${n(paredSf)} SF`)],
          usa: [aj("adhesivoParedSfPorBolsa", a.adhesivoParedSfPorBolsa)],
          cierre: div(paredSf, a.adhesivoParedSfPorBolsa, paquetesNecesarios(paredSf, a.adhesivoParedSfPorBolsa), "SF",
            t("SF per bag", "SF por bolsa"), [t("bag", "bolsa"), t("bags", "bolsas")]),
        };
      })
    : cero({ en: "Wall thinset (bags) = wall area ÷ SF per bag", es: "Pegamento de pared (bolsas) = área de pared ÷ SF por bolsa" }, sinPared);

  const expPegamentoPiso = pisoSf > 0
    ? explica((lg) => {
        const { n, t, aj, div } = ctx(lg);
        return {
          formula: t("Floor thinset (bags) = floor area ÷ SF per bag", "Pegamento de piso (bolsas) = área de piso ÷ SF por bolsa"),
          pasos: [t(`Amount needed = floor area = ${n(pisoSf)} SF`, `Cantidad = área de piso = ${n(pisoSf)} SF`)],
          usa: [aj("adhesivoPisoSfPorBolsa", a.adhesivoPisoSfPorBolsa)],
          cierre: div(pisoSf, a.adhesivoPisoSfPorBolsa, paquetesNecesarios(pisoSf, a.adhesivoPisoSfPorBolsa), "SF",
            t("SF per bag", "SF por bolsa"), [t("bag", "bolsa"), t("bags", "bolsas")]),
        };
      })
    : cero({ en: "Floor thinset (bags) = floor area ÷ SF per bag", es: "Pegamento de piso (bolsas) = área de piso ÷ SF por bolsa" }, sinPiso);

  const expLosetaPared = paredSf > 0
    ? explica((lg) => {
        const { n, t, ent, div } = ctx(lg);
        return {
          formula: t("Wall tile (boxes) = wall area ÷ SF per box", "Loseta de pared (cajas) = área de pared ÷ SF por caja"),
          pasos: [t(`Amount needed = wall area = ${n(paredSf)} SF`, `Cantidad = área de pared = ${n(paredSf)} SF`)],
          usa: [ent("Wall tile SF per box", "SF por caja de loseta de pared", n(e.cajaParedSf), "C13")],
          cierre: div(paredSf, e.cajaParedSf, paquetesNecesarios(paredSf, e.cajaParedSf), "SF",
            t("SF per box", "SF por caja"), [t("box", "caja"), t("boxes", "cajas")]),
        };
      })
    : cero({ en: "Wall tile (boxes) = wall area ÷ SF per box", es: "Loseta de pared (cajas) = área de pared ÷ SF por caja" }, sinPared);

  const expLosetaPiso = pisoSf > 0
    ? explica((lg) => {
        const { n, t, ent, div } = ctx(lg);
        return {
          formula: t("Floor tile (boxes) = floor area ÷ SF per box", "Loseta de piso (cajas) = área de piso ÷ SF por caja"),
          pasos: [t(`Amount needed = floor area = ${n(pisoSf)} SF`, `Cantidad = área de piso = ${n(pisoSf)} SF`)],
          usa: [ent("Floor tile SF per box", "SF por caja de loseta de piso", n(e.cajaPisoSf), "C14")],
          cierre: div(pisoSf, e.cajaPisoSf, paquetesNecesarios(pisoSf, e.cajaPisoSf), "SF",
            t("SF per box", "SF por caja"), [t("box", "caja"), t("boxes", "cajas")]),
        };
      })
    : cero({ en: "Floor tile (boxes) = floor area ÷ SF per box", es: "Loseta de piso (cajas) = área de piso ÷ SF por caja" }, sinPiso);

  const expLechada = explica((lg) => {
    const { n, t, ent, aj, div } = ctx(lg);
    const d = lechada;
    const dp = a.lechadaProfundidadParedIn, dq = a.lechadaProfundidadPisoIn, dr = a.lechadaProfundidadRefIn;
    return {
      formula: t("Grout (lb) = (wall joints + floor joints) ÷ reference joint volume × (lb per bag ÷ reference SF)",
        "Lechada (lb) = (juntas de pared + juntas de piso) ÷ volumen de junta de referencia × (lb por bolsa ÷ SF de referencia)"),
      pasos: [
        paredSf > 0
          ? t(`Wall joints = ${n(paredSf)} × ((1 ÷ (${n(d.pa)} + ${n(d.jp)}) + 1 ÷ (${n(d.pb)} + ${n(d.jp)})) × ${n(d.jp)}) × ${n(dp)} = ${n(d.termPared)}`,
            `Juntas de pared = ${n(paredSf)} × ((1 ÷ (${n(d.pa)} + ${n(d.jp)}) + 1 ÷ (${n(d.pb)} + ${n(d.jp)})) × ${n(d.jp)}) × ${n(dp)} = ${n(d.termPared)}`)
          : t("Wall joints = 0 (no wall area)", "Juntas de pared = 0 (sin área de pared)"),
        pisoSf > 0
          ? t(`Floor joints = ${n(pisoSf)} × ((1 ÷ (${n(d.pc)} + ${n(d.jq)}) + 1 ÷ (${n(d.pd)} + ${n(d.jq)})) × ${n(d.jq)}) × ${n(dq)} = ${n(d.termPiso)}`,
            `Juntas de piso = ${n(pisoSf)} × ((1 ÷ (${n(d.pc)} + ${n(d.jq)}) + 1 ÷ (${n(d.pd)} + ${n(d.jq)})) × ${n(d.jq)}) × ${n(dq)} = ${n(d.termPiso)}`)
          : t("Floor joints = 0 (no floor area)", "Juntas de piso = 0 (sin área de piso)"),
        t(`Reference joint per SF = ((1 ÷ (${n(a.lechadaLargoRefIn)} + ${n(a.lechadaJuntaRefIn)}) + 1 ÷ (${n(a.lechadaAnchoRefIn)} + ${n(a.lechadaJuntaRefIn)})) × ${n(a.lechadaJuntaRefIn)}) × ${n(dr)} = ${n(d.referencia)}`,
          `Junta de referencia por SF = ((1 ÷ (${n(a.lechadaLargoRefIn)} + ${n(a.lechadaJuntaRefIn)}) + 1 ÷ (${n(a.lechadaAnchoRefIn)} + ${n(a.lechadaJuntaRefIn)})) × ${n(a.lechadaJuntaRefIn)}) × ${n(dr)} = ${n(d.referencia)}`),
        t(`Reference SF = (${n(d.termPared)} + ${n(d.termPiso)}) ÷ ${n(d.referencia)} = ${n(d.sfEquivalentes)} SF`,
          `SF de referencia = (${n(d.termPared)} + ${n(d.termPiso)}) ÷ ${n(d.referencia)} = ${n(d.sfEquivalentes)} SF`),
        t(`Pounds = ${n(d.sfEquivalentes)} SF × ${n(a.lechadaLbPorBolsa)} lb ÷ ${n(a.lechadaSfReferencia)} SF = ${n(d.lb)} lb`,
          `Libras = ${n(d.sfEquivalentes)} SF × ${n(a.lechadaLbPorBolsa)} lb ÷ ${n(a.lechadaSfReferencia)} SF = ${n(d.lb)} lb`),
      ],
      usa: [
        ...(esDucha || esPared ? [
          ent("Wall tile size", "Tamaño de loseta de pared", `${e.tamanoPared} in`, "F6"),
          ent("Wall joint", "Junta en pared", `${n(d.jp)} in`, "F8"),
          `${t("Wall area", "Área de pared")}: ${n(paredSf)} SF · ${t("section 03", "sección 03")}`,
        ] : []),
        ...(esDucha || esPiso ? [
          ent("Floor tile size", "Tamaño de loseta de piso", `${e.tamanoPiso} in`, "F7"),
          ent("Floor joint", "Junta en piso", `${n(d.jq)} in`, "F9"),
          `${t("Floor area", "Área de piso")}: ${n(pisoSf)} SF · ${t("section 03", "sección 03")}`,
        ] : []),
        aj("lechadaProfundidadParedIn", dp), aj("lechadaProfundidadPisoIn", dq),
        aj("lechadaSfReferencia", a.lechadaSfReferencia), aj("lechadaLbPorBolsa", a.lechadaLbPorBolsa),
        aj("lechadaLargoRefIn", a.lechadaLargoRefIn), aj("lechadaAnchoRefIn", a.lechadaAnchoRefIn),
        aj("lechadaJuntaRefIn", a.lechadaJuntaRefIn), aj("lechadaProfundidadRefIn", dr),
      ],
      cierre: div(d.lb, a.lechadaLbPorBolsa, paquetesNecesarios(d.lb, a.lechadaLbPorBolsa), "lb",
        t("lb per bag", "lb por bolsa"), [t("bag", "bolsa"), t("bags", "bolsas")]),
    };
  });

  const expSilicon = esDucha || esPared
    ? explica((lg) => {
        const { n, t, ent, aj, div } = ctx(lg);
        return esDucha
          ? {
            formula: t("Silicone (LF) = perimeter + height × corners (2 walls: 1 corner, 3 walls: 2, 4 walls: 4)",
              "Silicón (LF) = perímetro + alto × esquinas (2 paredes: 1 esquina, 3 paredes: 2, 4 paredes: 4)"),
            pasos: [t(`Silicone = ${n(perimetroLf)} + ${n(H)} × ${factorDeEsquinas} = ${n(siliconaLf)} LF`,
              `Silicón = ${n(perimetroLf)} + ${n(H)} × ${factorDeEsquinas} = ${n(siliconaLf)} LF`)],
            usa: [ent("Height", "Alto", `${n(H)} ft`, "C9"),
              ent("Shower layout", "Disposición de la ducha", t(NOMBRE_DISPOSICION[e.disposicion].en, NOMBRE_DISPOSICION[e.disposicion].es), "C10"),
              t(`Perimeter (section 03): ${n(perimetroLf)} LF`, `Perímetro (sección 03): ${n(perimetroLf)} LF`),
              aj("siliconaLfPorTubo", a.siliconaLfPorTubo)],
            cierre: div(siliconaLf, a.siliconaLfPorTubo, paquetesNecesarios(siliconaLf, a.siliconaLfPorTubo), "LF",
              t("LF per tube", "LF por tubo"), [t("tube", "tubo"), t("tubes", "tubos")]),
          }
          : {
            formula: t("Silicone (LF) = sum of wall heights × 2 (two vertical corners per wall)",
              "Silicón (LF) = suma de las alturas de los muros × 2 (dos esquinas verticales por muro)"),
            pasos: [t(`Silicone = (${alturasPared.map(n).join(" + ") || "0"}) × 2 = ${n(siliconaLf)} LF`,
              `Silicón = (${alturasPared.map(n).join(" + ") || "0"}) × 2 = ${n(siliconaLf)} LF`)],
            usa: [`${t("Walls", "Muros")}: ${murosPared.length} · ${t("wall calculator", "calculadora de pared")}`,
              aj("siliconaLfPorTubo", a.siliconaLfPorTubo)],
            cierre: div(siliconaLf, a.siliconaLfPorTubo, paquetesNecesarios(siliconaLf, a.siliconaLfPorTubo), "LF",
              t("LF per tube", "LF por tubo"), [t("tube", "tubo"), t("tubes", "tubos")]),
          };
      })
    : cero({ en: "Silicone (LF) = perimeter + height × corners", es: "Silicón (LF) = perímetro + alto × esquinas" },
      motivoProyecto({ en: "(no corners)", es: "(sin esquinas)" }));

  const expPerfil = explica((lg) => {
    const { n, t, ent, aj, div } = ctx(lg);
    const borde = sana(e.bordeExpuestoLf);
    return {
      formula: t("Trim (pieces) = exposed tile edge (LF) ÷ LF per piece", "Perfil (piezas) = borde expuesto de loseta (LF) ÷ LF por pieza"),
      pasos: [borde > 0
        ? t(`Exposed edge = ${n(borde)} LF`, `Borde expuesto = ${n(borde)} LF`)
        : t("0 because no exposed tile edge is entered (sheet C37 = 0)", "0 porque no hay borde expuesto capturado (hoja 1 C37 = 0)")],
      usa: [ent("Exposed tile edge for trim", "Borde expuesto para perfil", `${n(borde)} LF`, "C37"), aj("perfilLfPorPieza", a.perfilLfPorPieza)],
      cierre: div(borde, a.perfilLfPorPieza, paquetesNecesarios(borde, a.perfilLfPorPieza), "LF",
        t("LF per piece", "LF por pieza"), [t("piece", "pieza"), t("pieces", "piezas")]),
    };
  });

  const expClips = esPared ? cero({ en: "Clips = (floor SF + wall SF) × clips per SF", es: "Clips = (SF de piso + SF de pared) × clips por SF" },
    motivoProyecto({ en: "(leveling clips are for floor tile)", es: "(los clips nivelan la loseta de piso)" })) : explica((lg) => {
    const { n, t, aj, div } = ctx(lg);
    return {
      formula: t("Clips = (floor SF + wall SF) × clips per SF", "Clips = (SF de piso + SF de pared) × clips por SF"),
      pasos: [t(`Clips = (${n(pisoSf)} + ${n(paredSf)}) × ${n(a.clipsPorSf)} = ${n(clipsCant)} clips`,
        `Clips = (${n(pisoSf)} + ${n(paredSf)}) × ${n(a.clipsPorSf)} = ${n(clipsCant)} clips`)],
      usa: [`${t("Floor area", "Área de piso")}: ${n(pisoSf)} SF · ${t("section 03", "sección 03")}`,
        `${t("Wall area", "Área de pared")}: ${n(paredSf)} SF · ${t("section 03", "sección 03")}`,
        aj("clipsPorSf", a.clipsPorSf), aj("clipsPorPaquete", a.clipsPorPaquete)],
      cierre: div(clipsCant, a.clipsPorPaquete, paquetesNecesarios(clipsCant, a.clipsPorPaquete), "clips",
        t("clips per pack", "clips por paquete"), [t("pack", "paquete"), t("packs", "paquetes")]),
    };
  });

  const expCunas = esPared ? cero({ en: "Wedges = same count as clips", es: "Cuñas = mismo conteo que los clips" },
    motivoProyecto({ en: "(leveling wedges are for floor tile)", es: "(las cuñas nivelan la loseta de piso)" })) : explica((lg) => {
    const { n, t, aj, div } = ctx(lg);
    return {
      formula: t("Wedges = same count as clips = (floor SF + wall SF) × clips per SF", "Cuñas = mismo conteo que los clips = (SF de piso + SF de pared) × clips por SF"),
      pasos: [t(`Wedges = clips count = ${n(clipsCant)}`, `Cuñas = conteo de clips = ${n(clipsCant)}`)],
      usa: [`${t("Floor area", "Área de piso")}: ${n(pisoSf)} SF · ${t("section 03", "sección 03")}`,
        `${t("Wall area", "Área de pared")}: ${n(paredSf)} SF · ${t("section 03", "sección 03")}`,
        aj("clipsPorSf", a.clipsPorSf), aj("cunasPorPaquete", a.cunasPorPaquete)],
      cierre: div(clipsCant, a.cunasPorPaquete, paquetesNecesarios(clipsCant, a.cunasPorPaquete), "clips",
        t("wedges per pack", "cuñas por paquete"), [t("pack", "paquete"), t("packs", "paquetes")]),
    };
  });

  const expColadera = esDucha
    ? explica((lg) => {
        const { t } = ctx(lg);
        return {
          formula: t("Drains = 1 per shower", "Coladeras = 1 por ducha"),
          pasos: [t("Drains = 1 (one shower drain, fixed rule)", "Coladeras = 1 (una coladera por ducha, regla fija)")],
          usa: [],
          cierre: t("1 drain ÷ 1 per drain = 1 → rounded up = 1 drain", "1 coladera ÷ 1 por coladera = 1 → redondeado hacia arriba = 1 coladera"),
        };
      })
    : cero({ en: "Drains = 1 per shower", es: "Coladeras = 1 por ducha" },
      motivoProyecto({ en: "(the drain is for showers)", es: "(la coladera es solo para duchas)" }));

  const expPendiente = esDucha && a.preslopeIncluido === 1
    ? explica((lg) => {
        const { n, t, aj, div } = ctx(lg);
        return {
          formula: t("Pre-slope (cu ft) = floor area × average pre-slope depth ÷ 12", "Pendiente (pie³) = área de piso × profundidad promedio de la pendiente ÷ 12"),
          pasos: [t(`Pre-slope = ${n(pisoSf)} SF × ${n(a.preslopePromedioIn)} in ÷ 12 = ${n(pendientePc)} cu ft`,
            `Pendiente = ${n(pisoSf)} SF × ${n(a.preslopePromedioIn)} pulg ÷ 12 = ${n(pendientePc)} pies³`)],
          usa: [aj("preslopePromedioIn", a.preslopePromedioIn), aj("preslopeIncluido", a.preslopeIncluido), aj("morteroPiesCubicosPorBolsa", a.morteroPiesCubicosPorBolsa)],
          cierre: div(pendientePc, a.morteroPiesCubicosPorBolsa, paquetesNecesarios(pendientePc, a.morteroPiesCubicosPorBolsa), "cu ft",
            t("cu ft per bag", "pies³ por bolsa"), [t("bag", "bolsa"), t("bags", "bolsas")]),
        };
      })
    : esDucha
      ? cero({ en: "Pre-slope (cu ft) = floor area × average depth ÷ 12", es: "Pendiente (pie³) = área de piso × profundidad ÷ 12" },
        { en: "pre-slope is not included (Product Settings C33 = 0)", es: "la pendiente no está incluida (Hoja 2 C33 = 0)" })
      : cero({ en: "Pre-slope (cu ft) = floor area × average depth ÷ 12", es: "Pendiente (pie³) = área de piso × profundidad ÷ 12" },
        motivoProyecto({ en: "(pre-slope is for showers)", es: "(la pendiente es solo para duchas)" }));

  const filas: FilaCalculada[] = [
    fila("liner", { en: "Shower pan liner / cuero de marrano", es: "Cuero de marrano (liner de la ducha)" },
      linerSf, PIEZA_DE_LINER_SF, { en: "5×7 pieces", es: "piezas 5×7" },
      "One 5×7 liner piece covers the sample pan cut (24 SF); verify available sheet dimensions and upturns.", expLiner),
    fila("mortero", { en: "Mortar bed / mortero seco", es: "Mortero seco (cama de la ducha)" },
      morteroPc, a.morteroPiesCubicosPorBolsa, { en: "bags", es: "bolsas" },
      "44-lb mortar bags per Supply Calculator; volume yield still requires product confirmation.", expMortero),
    fila("tablero", { en: "Backerboard (linear feet)", es: "Tablero de cemento (pies lineales)" },
      tablerosLf, TABLERO_POR_PAQUETE_LF, { en: "LF", es: "LF" },
      "Estimated 17.6 LF installed; 7 whole 3-ft-wide panels = 21 LF sold. Layout panels editable in settings.", expTablero,
      sana(tablerosPaneles * a.tableroAnchoLf)),
    fila("tornillos", { en: "Backerboard screws", es: "Tornillos para tablero" },
      tablerosPaneles * a.tornillosPorTablero, a.tornillosPorCaja, { en: "boxes", es: "cajas" },
      "575 screws per box; verify screw spacing & substrate", expTornillos),
    fila("malla", { en: "Joint mesh tape", es: "Malla para juntas" },
      tablerosPaneles * a.mallaPorTableroLf, a.rolloMallaLf, { en: "rolls", es: "rollos" },
      "Roll coverage in linear feet; seam estimate", expMalla),
    fila("impermeable", { en: "Water Shield waterproofing", es: "Impermeabilizante (Water Shield)" },
      impermeableSf, a.impermeableSfPorGal * a.impermeableGalPorEnvase, { en: "gallons", es: "galones" },
      "Working 3-gallon standard reference; one waterproofing brand only; verify actual coverage and packaging.", expImpermeable),
    fila("pegamento-pared", { en: "Thinset for walls", es: "Pegamento para pared" },
      paredSf, a.adhesivoParedSfPorBolsa, { en: "bags", es: "bolsas" },
      "44-lb thinset working rate for standard shower; back-buttering included; verify coverage.", expPegamentoPared),
    fila("pegamento-piso", { en: "Thinset for flooring", es: "Pegamento para piso" },
      pisoSf, a.adhesivoPisoSfPorBolsa, { en: "bags", es: "bolsas" },
      "44-lb thinset working rate for standard shower; back-buttering included; verify coverage.", expPegamentoPiso),
    fila("loseta-pared", { en: "Wall tile", es: "Loseta de pared" },
      paredSf, e.cajaParedSf, { en: "boxes", es: "cajas" },
      "Boxes use SF per box; tile size used only for grout estimate", expLosetaPared),
    fila("loseta-piso", { en: "Floor tile", es: "Loseta de piso" },
      pisoSf, e.cajaPisoSf, { en: "boxes", es: "cajas" },
      "Boxes use SF per box; tile size used only for grout estimate", expLosetaPiso),
    fila("lechada", { en: "Grout / TEXcolor", es: "Lechada / TEXcolor" },
      lechada.lb, a.lechadaLbPorBolsa, { en: "bags", es: "bolsas" },
      "25-lb bags; coverage in SF/bag depends on joint width, depth and tile dimensions.", expLechada),
    fila("silicon", { en: "Silicone sealant / TEX2", es: "Silicón / TEX2" },
      siliconaLf, a.siliconaLfPorTubo, { en: "tubes", es: "tubos" },
      "Calculated from estimated linear feet of corner joints", expSilicon),
    fila("perfil", { en: "Tile trim", es: "Perfil de loseta" },
      sana(e.bordeExpuestoLf), a.perfilLfPorPieza, { en: "pieces", es: "piezas" },
      "Based on specified exposed edge length; enter length below", expPerfil),
    fila("clips", { en: "Leveling clips", es: "Clips niveladores" },
      clipsCant, a.clipsPorPaquete, { en: "packs", es: "paquetes" },
      "Allowance adjustable / verify tile pattern and layout", expClips),
    fila("cunas", { en: "Leveling wedges", es: "Cuñas niveladoras" },
      clipsCant, a.cunasPorPaquete, { en: "packs", es: "paquetes" },
      "Allowance adjustable / wedges may be reusable", expCunas),
    fila("coladera", { en: "Shower drain", es: "Coladera de ducha" },
      esDucha ? 1 : 0, 1, { en: "each", es: "c/u" },
      "One shower drain by default; confirm installation type", expColadera),
    fila("pendiente", { en: "Mortar pre-slope", es: "Pendiente de mortero" },
      pendientePc, a.morteroPiesCubicosPorBolsa, { en: "bags", es: "bolsas" },
      "Optional; typically builder / framer scope, confirm with installer", expPendiente),
  ];

  return {
    areas: { pisoSf, paredSf, perimetroLf, tablerosPaneles },
    explicacionAreas,
    tablerosLf,
    filas,
  };
}

/**
 * Una fila. C = cantidad; D = por paquete; E = paquetes a vender (ROUNDUP), salvo el tablero, que vende LF enteros
 * (paneles × ancho) y se le pasa `venta`.
 */
function fila(
  clave: ClaveDeFila, material: Bilingue, cantidad: number, porPaquete: number, unidad: Bilingue, nota: string,
  explicacion: Explicacion, venta?: number,
): FilaCalculada {
  const c = sana(cantidad);
  return {
    clave, material, cantidad: c, porPaquete: porPaquete > 0 ? porPaquete : null,
    venta: venta ?? paquetesNecesarios(c, porPaquete),
    unidad, nota: { en: nota, es: NOTAS_ES[nota] ?? nota }, explicacion,
  };
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
