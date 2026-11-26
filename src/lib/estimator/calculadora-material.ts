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
export const TAMANOS_DE_LOSETA = ["7x22", "12x24", "24x24", "24x48", "8x36", "8x48", "22x22", "8x8", "17x17", "12x12"] as const;
export type TamanoDeLoseta = (typeof TAMANOS_DE_LOSETA)[number];

export const PROYECTOS: readonly TipoDeProyecto[] = ["Shower", "Flooring Only", "Wall Only"];
export const DISPOSICIONES: readonly Disposicion[] = ["2 Walls", "3 Walls", "4 Walls"];

/** Máximo de habitaciones o muros en la calculadora de piso o de pared. */
export const MAX_FILAS_DE_MEDIDA = 12;

/** Cómo se mide la pared en la calculadora de pared (D-1203, hoja «Rodriguez Wall Calculator»): en SF o largo × alto. */
export const METODOS_DE_PARED = ["Square footage", "Dimensions"] as const;
export type MetodoDePared = (typeof METODOS_DE_PARED)[number];

/** La junta que separa lechada con arena (≥) de sin arena (≤), en pulgadas (hoja nueva: 1/8"). */
export const JUNTA_LIMITE_LECHADA_IN = 0.125;

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
  /** Ya no se usa (D-1203: la calculadora de pared mide UNA pared). Se conserva para leer lo guardado. */
  muros: Muro[];
  /** Calculadora de pared: cómo se mide (SF directo o largo × alto). */
  paredMetodo: MetodoDePared;
  /** Calculadora de pared: área de la pared (SF), con el método «Square footage». */
  paredAreaSf: number;
  /** Calculadora de pared: largo (ft), con el método «Dimensions». */
  paredLargoFt: number;
  /** Calculadora de pared: alto (ft), con el método «Dimensions». */
  paredAltoFt: number;
  /** Calculadora de pared: aberturas que se restan (SF), con los dos métodos. */
  paredAberturasSf: number;
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
  /** Lechada con arena: SF por bolsa de 25 lb en la loseta y junta de referencia (D-1203). */
  lechadaArenadaSfPorBolsa: number;
  /** Lechada sin arena: SF por bolsa de 25 lb en la referencia (D-1203). */
  lechadaSinArenaSfPorBolsa: number;
  /** C21 */
  lechadaLargoRefIn: number;
  /** C22 */
  lechadaAnchoRefIn: number;
  /** C23 */
  lechadaJuntaRefIn: number;
  /** Profundidad de la junta en pared (in). Clave nueva en D-1203 (3/8"): lo guardado con la vieja (1/4") no se arrastra. */
  lechadaProfParedIn: number;
  /** Profundidad de la junta en piso (in). */
  lechadaProfPisoIn: number;
  /** Profundidad de la junta de referencia (in). */
  lechadaProfRefIn: number;
  /** Calculadora de pared: SF por bolsa de pegamento (hoja nueva: 35, incluye back-buttering). */
  adhesivoSoloParedSfPorBolsa: number;
  /** Calculadora de pared: cuñas por SF (hoja nueva: 0.3). */
  cunasPorSf: number;
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
  paredMetodo: "Square footage",
  paredAreaSf: 300,
  paredLargoFt: 20,
  paredAltoFt: 8,
  paredAberturasSf: 0,
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
  lechadaArenadaSfPorBolsa: 688,
  lechadaSinArenaSfPorBolsa: 722.5,
  lechadaLargoRefIn: 24,
  lechadaAnchoRefIn: 24,
  lechadaJuntaRefIn: 0.125,
  lechadaProfParedIn: 0.375,
  lechadaProfPisoIn: 0.375,
  lechadaProfRefIn: 0.375,
  adhesivoSoloParedSfPorBolsa: 35,
  cunasPorSf: 0.3,
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
      en: "Wall tile, thinset, grout, leveling, trim and backerboard for one wall.",
      es: "Loseta de pared, pegamento, lechada, nivelación, perfil y tablero para una pared.",
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
  salpicaderoLargoFt: { usa: DUCHA },
  salpicaderoAltoFt: { usa: DUCHA },
  habitaciones: { usa: ["Flooring Only"] },
  muros: { usa: [] },
  paredMetodo: { usa: ["Wall Only"] },
  paredAreaSf: { usa: ["Wall Only"] },
  paredLargoFt: { usa: ["Wall Only"] },
  paredAltoFt: { usa: ["Wall Only"] },
  paredAberturasSf: { usa: ["Wall Only"] },
};

/** Los ajustes de «Product Settings» (hoja 2): dónde se usa cada uno. Vacío = la hoja no lo usa en ninguna fórmula. */
export const USO_DE_AJUSTES: Record<keyof AjustesCalculadora, Uso> = {
  tableroCoberturaSf: { usa: [] },
  tornillosPorTablero: { usa: DUCHA_Y_PARED },
  tornillosPorCaja: { usa: DUCHA_Y_PARED },
  rolloMallaLf: { usa: DUCHA_Y_PARED },
  mallaPorTableroLf: { usa: DUCHA_Y_PARED },
  liner_subidaSinUsoIn: { usa: [] },
  liner_bordeSinUsoIn: { usa: [] },
  impermeableSfPorGal: { usa: DUCHA },
  impermeableGalPorEnvase: { usa: DUCHA },
  impermeableSolape: { usa: DUCHA },
  adhesivoParedSfPorBolsa: { usa: DUCHA },
  adhesivoPisoSfPorBolsa: { usa: DUCHA_Y_PISO },
  morteroPiesCubicosPorBolsa: { usa: DUCHA },
  lechadaArenadaSfPorBolsa: { usa: TODAS },
  lechadaSinArenaSfPorBolsa: { usa: TODAS },
  lechadaLargoRefIn: { usa: TODAS },
  lechadaAnchoRefIn: { usa: TODAS },
  lechadaJuntaRefIn: { usa: TODAS },
  lechadaProfParedIn: { usa: DUCHA_Y_PARED },
  lechadaProfPisoIn: { usa: DUCHA_Y_PISO },
  lechadaProfRefIn: { usa: TODAS },
  adhesivoSoloParedSfPorBolsa: { usa: ["Wall Only"] },
  cunasPorSf: { usa: ["Wall Only"] },
  siliconaLfPorTubo: { usa: DUCHA },
  perfilLfPorPieza: { usa: TODAS },
  clipsPorSf: { usa: TODAS },
  clipsPorPaquete: { usa: TODAS },
  cunasPorPaquete: { usa: TODAS },
  preslopePromedioIn: { usa: DUCHA },
  preslopeIncluido: { usa: DUCHA },
  tableroEnSoloPared: { usa: [] },
  impermeableEnSoloPared: { usa: [] },
  tableroAltoFt: { usa: DUCHA_Y_PARED },
  tableroAnchoLf: { usa: DUCHA_Y_PARED },
  tableroUnidadLf: { usa: [] },
  tablerosExtra: { usa: DUCHA },
  impermeableReferenciaGal: { usa: [] },
};

/** Las filas de materiales (la hoja 1, filas 17–33) y, por calculadora, cuáles aplican. */
export const CLAVES_DE_FILA = [
  "liner", "mortero", "tablero", "tornillos", "malla", "impermeable", "pegamento-pared", "pegamento-piso",
  "loseta-pared", "loseta-piso", "lechada-arenada", "lechada-sin-arena", "silicon", "perfil", "clips", "cunas", "coladera", "pendiente",
] as const;
export type ClaveDeFila = (typeof CLAVES_DE_FILA)[number];

export const USO_DE_FILAS: Record<ClaveDeFila, Uso> = {
  liner: { usa: DUCHA },
  mortero: { usa: DUCHA },
  tablero: { usa: DUCHA_Y_PARED },
  tornillos: { usa: DUCHA_Y_PARED },
  malla: { usa: DUCHA_Y_PARED },
  impermeable: { usa: DUCHA },
  "pegamento-pared": { usa: DUCHA_Y_PARED },
  "pegamento-piso": { usa: DUCHA_Y_PISO },
  "loseta-pared": { usa: DUCHA_Y_PARED },
  "loseta-piso": { usa: DUCHA_Y_PISO },
  "lechada-arenada": { usa: TODAS },
  "lechada-sin-arena": { usa: TODAS },
  silicon: { usa: DUCHA },
  perfil: { usa: TODAS },
  clips: { usa: TODAS },
  cunas: { usa: TODAS },
  coladera: { usa: DUCHA },
  pendiente: { usa: DUCHA, condicion: (a) => a.preslopeIncluido === 1 },
};

/** Las áreas de la sección 03 que cada calculadora muestra. */
export const USO_DE_AREAS: Record<keyof AreasCalculadas, Uso> = {
  pisoSf: { usa: DUCHA_Y_PISO },
  paredSf: { usa: DUCHA_Y_PARED },
  perimetroLf: { usa: DUCHA },
  tablerosPaneles: { usa: DUCHA_Y_PARED },
};

/** ¿Lo usa esta calculadora, con estos ajustes? */
export function aplicaUso(u: Uso, tipo: TipoDeProyecto, a: AjustesCalculadora): boolean {
  if (!u.usa.includes(tipo)) return false;
  if (tipo === "Wall Only" && u.cuandoPared && a[u.cuandoPared] !== 1) return false;
  return u.condicion ? u.condicion(a) : true;
}

/**
 * Lo que una calculadora muestra con estos ajustes: los campos de la hoja 1 (`habitaciones` en piso, `muros` en pared),
 * las filas de materiales, las áreas de la sección 03 y los ajustes de «Product Settings». La pantalla pinta solo esto:
 * lo que no aplica no sale (no se deshabilita). Pedido en la reunión del 23 nov 2026 (D-1145): «quita lo que no se
 * necesita cuando cambian la opción».
 */
export interface CamposQueAplican {
  entradas: (keyof EntradasCalculadora)[];
  filas: ClaveDeFila[];
  areas: (keyof AreasCalculadas)[];
  ajustes: (keyof AjustesCalculadora)[];
  /** La línea de la nota de materiales sobre la subida del liner solo aplica si hay liner (ducha). */
  notaDeLiner: boolean;
}

export function camposQueAplican(tipo: TipoDeProyecto, a: AjustesCalculadora): CamposQueAplican {
  const filas = CLAVES_DE_FILA.filter((c) => aplicaUso(USO_DE_FILAS[c], tipo, a));
  return {
    entradas: (Object.keys(USO_DE_ENTRADAS) as (keyof EntradasCalculadora)[]).filter((c) => aplicaUso(USO_DE_ENTRADAS[c], tipo, a)),
    filas,
    areas: (Object.keys(USO_DE_AREAS) as (keyof AreasCalculadas)[]).filter((c) => aplicaUso(USO_DE_AREAS[c], tipo, a)),
    ajustes: (Object.keys(USO_DE_AJUSTES) as (keyof AjustesCalculadora)[]).filter((c) => aplicaUso(USO_DE_AJUSTES[c], tipo, a)),
    notaDeLiner: filas.includes("liner"),
  };
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
  { clave: "lechadaArenadaSfPorBolsa", celda: "C19", etiqueta: { en: "Sanded grout coverage (reference)", es: "Rendimiento de lechada con arena (referencia)" }, unidad: "SF per 25-lb bag", nota: "688 SF/bag at the reference tile, joint and depth; used for joints of 1/8 in or wider." },
  { clave: "lechadaSinArenaSfPorBolsa", celda: "C20", etiqueta: { en: "Unsanded grout coverage (reference)", es: "Rendimiento de lechada sin arena (referencia)" }, unidad: "SF per 25-lb bag", nota: "Unsanded 289 SF/10 lb scaled to 25 lb (722.5); used for joints of 1/8 in or narrower." },
  { clave: "lechadaLargoRefIn", celda: "C21", etiqueta: { en: "Grout reference tile length", es: "Largo de la loseta de referencia" }, unidad: "in", nota: "Reference tile for the grout coverage; adjustable" },
  { clave: "lechadaAnchoRefIn", celda: "C22", etiqueta: { en: "Grout reference tile width", es: "Ancho de la loseta de referencia" }, unidad: "in", nota: "Reference tile for the grout coverage; adjustable" },
  { clave: "lechadaJuntaRefIn", celda: "C23", etiqueta: { en: "Grout reference joint width", es: "Junta de referencia" }, unidad: "in", nota: "Reference joint for the grout coverage; adjustable" },
  { clave: "lechadaProfParedIn", celda: "C24", etiqueta: { en: "Grout wall joint depth", es: "Profundidad de junta en pared" }, unidad: "in", nota: "Grout depth; change with tile specifications" },
  { clave: "lechadaProfPisoIn", celda: "C25", etiqueta: { en: "Grout floor joint depth", es: "Profundidad de junta en piso" }, unidad: "in", nota: "Grout depth; change with tile specifications" },
  { clave: "lechadaProfRefIn", celda: "C26", etiqueta: { en: "Grout reference joint depth", es: "Profundidad de junta de referencia" }, unidad: "in", nota: "Baseline depth associated with reference coverage" },
  { clave: "adhesivoSoloParedSfPorBolsa", celda: "C44", etiqueta: { en: "Thinset coverage (wall calculator)", es: "Rendimiento del pegamento (calculadora de pared)" }, unidad: "SF / 44-lb bag", nota: "44 lb; includes back-buttering" },
  { clave: "cunasPorSf", celda: "C45", etiqueta: { en: "Wedge allowance (wall calculator)", es: "Cuñas por SF (calculadora de pared)" }, unidad: "wedges / SF", nota: "Reusable; 1–2 packs per 500 SF" },
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

/** La parte del área que ocupa la junta: 1 − (a × b) ÷ ((a + j) × (b + j)). */
const parteDeJunta = (a: number, b: number, j: number): number => 1 - (a * b) / ((a + j) * (b + j));

/**
 * Lechada de UNA superficie (D-1203, hoja «Rodriguez Wall Calculator»). El rendimiento de referencia (SF por bolsa de
 * 25 lb, en la loseta, junta y profundidad de referencia) se ajusta por cuánta junta lleva esta loseta y su profundidad:
 * ajuste = (junta de referencia × prof. de referencia) ÷ (junta de esta loseta × su profundidad); se redondea hacia
 * abajo. Con arena solo con junta ≥ 1/8"; sin arena solo con junta ≤ 1/8". Fuera de eso vale 0 (= N/A).
 */
export function lechadaDeSuperficie(tamano: string, juntaIn: number, profIn: number, a: AjustesCalculadora) {
  const [la, lb] = medidasDeLaLoseta(tamano);
  const j = sana(juntaIn);
  const referencia = parteDeJunta(a.lechadaLargoRefIn, a.lechadaAnchoRefIn, a.lechadaJuntaRefIn) * a.lechadaProfRefIn;
  const esta = parteDeJunta(la, lb, j) * profIn;
  const ajuste = finitoOCero(referencia / esta);
  const arenada = j >= JUNTA_LIMITE_LECHADA_IN ? Math.floor(a.lechadaArenadaSfPorBolsa * ajuste) : 0;
  const sinArena = j <= JUNTA_LIMITE_LECHADA_IN ? Math.floor(a.lechadaSinArenaSfPorBolsa * ajuste) : 0;
  return { la, lb, j, profIn, ajuste, arenada, sinArena };
}

export function calcular(entradas: EntradasCalculadora, ajustes: AjustesCalculadora): ResultadoCalculadora {
  const e = entradas;
  const a = ajustes;
  const L = sana(e.largoFt), W = sana(e.anchoFt), H = sana(e.altoFt);
  const ab = sana(e.aberturasSf);
  const esDucha = e.proyecto === "Shower";
  const esPiso = e.proyecto === "Flooring Only";
  const esPared = e.proyecto === "Wall Only";

  // C36: salpicadero. Va dentro del área de pared de la ducha; en piso y pared (D-1203) vale 0.
  const salpicaderoSf = esDucha ? sana(e.salpicaderoLargoFt) * sana(e.salpicaderoAltoFt) : 0;

  // Solo piso: cada habitación es largo × ancho, y se suman. Ducha: el L × W de la hoja.
  const pisoPorHabitacion = esPiso ? e.habitaciones.map((h) => Math.max(0, sana(h.largoFt) * sana(h.anchoFt))) : [];

  // Solo pared (D-1203): UNA pared, medida en SF o largo × alto, menos las aberturas.
  const paredBruta = e.paredMetodo === "Dimensions" ? sana(e.paredLargoFt) * sana(e.paredAltoFt) : sana(e.paredAreaSf);
  const paredAberturas = sana(e.paredAberturasSf);

  // C40: piso (ducha: L × W; solo piso: suma de habitaciones).
  const pisoSf = esDucha ? Math.max(0, L * W) : esPiso ? sumar(pisoPorHabitacion) : 0;

  // C42: perímetro de pared (LF). Ducha: L + (2, 3 o 4 paredes). Solo pared: suma de los largos de los muros.
  const perimetroLf = esDucha
    ? L + (e.disposicion === "2 Walls" ? W : e.disposicion === "3 Walls" ? 2 * W : L + 2 * W)
    : 0;

  // C41: pared (SF). Ducha: H × perímetro − aberturas + salpicadero. Solo pared: suma de muros + salpicadero.
  const paredSf = esDucha
    ? Math.max(0, H * perimetroLf - ab + salpicaderoSf)
    : esPared ? Math.max(0, paredBruta - paredAberturas) : 0;

  // C19: tablero en LF (pared sin el salpicadero, entre el alto instalado). Solo ducha.
  const tablerosLfCrudo = esDucha ? Math.max(0, paredSf - salpicaderoSf) / a.tableroAltoFt : 0;
  const tablerosLf = tablerosLfCrudo > 0 && Number.isFinite(tablerosLfCrudo) ? tablerosLfCrudo : 0;

  // Solo pared (D-1203): paneles = área ÷ (ancho × alto del panel, 3 × 5 = 15 SF), redondeado hacia arriba, sin extra.
  const panelSf = sana(a.tableroAnchoLf) * sana(a.tableroAltoFt);
  // C43: paneles enteros + los del trazado. Ducha: depende de C19.
  const tablerosPaneles = esPared
    ? paquetesNecesarios(paredSf, panelSf)
    : tablerosLf <= 0 ? 0 : finitoOCero(Math.ceil(tablerosLf / a.tableroAnchoLf)) + a.tablerosExtra;

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
    : 0;

  // Silicón (C28): perímetro + alto × (4, 2 o 1 esquinas según la disposición). Solo ducha (la hoja de pared no lo trae).
  const factorDeEsquinas = e.disposicion === "4 Walls" ? 4 : e.disposicion === "3 Walls" ? 2 : 1;
  const siliconaLf = esDucha ? perimetroLf + H * factorDeEsquinas : 0;

  // Clips (C30): (piso + pared) × clips por SF, en las tres. Cuñas: ducha y piso, el mismo conteo; pared (D-1203):
  // área × cuñas por SF, redondeado hacia arriba.
  const clipsCant = (pisoSf + paredSf) * a.clipsPorSf;
  const cunasCant = esPared ? Math.ceil(finitoOCero(paredSf * a.cunasPorSf)) : clipsCant;

  // Pegamento de pared: la calculadora de pared usa su propio rendimiento (D-1203: 35 SF por bolsa).
  const pegamentoParedSfPorBolsa = esPared ? a.adhesivoSoloParedSfPorBolsa : a.adhesivoParedSfPorBolsa;
  const claveAdhesivoPared: keyof AjustesCalculadora = esPared ? "adhesivoSoloParedSfPorBolsa" : "adhesivoParedSfPorBolsa";

  // Lechada (D-1203): con arena y sin arena, dos alternativas (no se suman). Por superficie con área: SF ÷ rendimiento.
  const superficiesDeLechada = [
    ...(paredSf > 0 ? [{ nombre: { en: "wall", es: "pared" } as Bilingue, area: paredSf, ...lechadaDeSuperficie(e.tamanoPared, e.juntaParedIn, a.lechadaProfParedIn, a) }] : []),
    ...(pisoSf > 0 ? [{ nombre: { en: "floor", es: "piso" } as Bilingue, area: pisoSf, ...lechadaDeSuperficie(e.tamanoPiso, e.juntaPisoIn, a.lechadaProfPisoIn, a) }] : []),
  ];
  // Cada tipo cubre solo las superficies cuya junta está en su rango (ducha con junta fina en pared y gruesa en piso:
  // la de arena lleva el piso y la sin arena la pared). Sin ninguna en rango, es N/A.
  const lechadaDe = (tipoL: "arenada" | "sinArena") => {
    const validas = superficiesDeLechada.filter((x) => x[tipoL] > 0);
    const fuera = superficiesDeLechada.filter((x) => !(x[tipoL] > 0)).map((x) => x.nombre);
    const area = sumar(validas.map((x) => x.area));
    const fueraDeRango = validas.length === 0 && fuera.length > 0;
    if (area <= 0) return { area: sumar(superficiesDeLechada.map((x) => x.area)), fueraDeRango, fuera, bolsas: 0, rendimiento: null as number | null, venta: 0 };
    const bolsas = sumar(validas.map((x) => x.area / x[tipoL]));
    return { area, fueraDeRango: false, fuera, bolsas, rendimiento: area / bolsas, venta: Math.ceil(bolsas - 1e-9) };
  };
  const lechadaArenada = lechadaDe("arenada");
  const lechadaSinArena = lechadaDe("sinArena");

  // ---- Explicaciones: solo leen las cifras de arriba; no cambian ninguna.
  const tipo = NOMBRE_PROYECTO[e.proyecto];
  /** «project type is Flooring Only (no walls)»: el motivo de un cero por tipo de proyecto. */
  const motivoProyecto = (extra: Bilingue): Bilingue => ({
    en: `project type is ${tipo.en} ${extra.en}`,
    es: `el tipo de proyecto es ${tipo.es} ${extra.es}`,
  });
  const motivoSinTablero: Bilingue = esPiso
    ? motivoProyecto({ en: "(no backerboard)", es: "(sin tablero)" })
    : { en: "wall area is 0, so there is no backerboard", es: "el área de pared es 0, así que no hay tablero" };
  const motivoSinImpermeable: Bilingue = motivoProyecto({ en: "(waterproofing is for showers)", es: "(el impermeabilizante es para duchas)" });
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

  const expParedUna = esPared
    ? explica((lg) => {
        const { n, t, ent } = ctx(lg);
        const porMedidas = e.paredMetodo === "Dimensions";
        const bruta = porMedidas
          ? t(`${n(sana(e.paredLargoFt))} ft × ${n(sana(e.paredAltoFt))} ft = ${n(paredBruta)} SF`, `${n(sana(e.paredLargoFt))} ft × ${n(sana(e.paredAltoFt))} ft = ${n(paredBruta)} SF`)
          : `${n(paredBruta)} SF`;
        return {
          formula: porMedidas
            ? t("Net wall area (SF) = length × height − openings", "Área neta de pared (SF) = largo × alto − aberturas")
            : t("Net wall area (SF) = wall area − openings", "Área neta de pared (SF) = área de pared − aberturas"),
          pasos: [
            t(`Wall = ${bruta}`, `Pared = ${bruta}`),
            t(`Net = ${n(paredBruta)} − ${n(paredAberturas)} = ${n(paredSf)} SF`, `Neta = ${n(paredBruta)} − ${n(paredAberturas)} = ${n(paredSf)} SF`),
          ],
          usa: [
            porMedidas
              ? t("Measurement method: Dimensions", "Método de medida: largo × alto")
              : t("Measurement method: Square footage", "Método de medida: pies cuadrados"),
            ent("Openings / deductions", "Aberturas / descuentos", `${n(paredAberturas)} SF`, "E6"),
          ],
          cierre: t("Used for: wall tile, thinset, grout, clips, wedges and backerboard.",
            "Se usa en: loseta de pared, pegamento, lechada, clips, cuñas y tablero."),
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
      : esPared && expParedUna
        ? expParedUna
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
      : cero({ en: "Perimeter (LF) = length (shower and wall-only)", es: "Perímetro (LF) = largo (ducha y solo pared)" }, sinPared),
    tablerosPaneles: esPared && tablerosPaneles > 0
      ? explica((lg) => {
          const { n, t, aj } = ctx(lg);
          return {
            formula: t("Panels = net wall area ÷ (panel width × panel length), rounded up", "Paneles = área neta de pared ÷ (ancho × largo del panel), redondeado hacia arriba"),
            pasos: [t(`${n(paredSf)} SF ÷ (${n(a.tableroAnchoLf)} × ${n(a.tableroAltoFt)} = ${n(panelSf)} SF) = ${n(paredSf / panelSf)} → rounded up = ${tablerosPaneles} panels`,
              `${n(paredSf)} SF ÷ (${n(a.tableroAnchoLf)} × ${n(a.tableroAltoFt)} = ${n(panelSf)} SF) = ${n(paredSf / panelSf)} → redondeado hacia arriba = ${tablerosPaneles} paneles`)],
            usa: [aj("tableroAnchoLf", a.tableroAnchoLf), aj("tableroAltoFt", a.tableroAltoFt)],
            cierre: t("Only if new substrate is needed; verify the panel layout.", "Solo si se necesita sustrato nuevo; verifica el trazado de los paneles."),
          };
        })
      : tablerosLf > 0
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

  const expTablero = esPared && tablerosPaneles > 0
    ? explica((lg) => {
        const { n, t, aj, div } = ctx(lg);
        return {
          formula: t("Backerboard (panels) = net wall area ÷ SF per panel (width × length)", "Tablero (paneles) = área neta de pared ÷ SF por panel (ancho × largo)"),
          pasos: [t(`Amount needed = net wall area = ${n(paredSf)} SF`, `Cantidad = área neta de pared = ${n(paredSf)} SF`)],
          usa: [aj("tableroAnchoLf", a.tableroAnchoLf), aj("tableroAltoFt", a.tableroAltoFt)],
          cierre: div(paredSf, panelSf, tablerosPaneles, "SF", t("SF per panel", "SF por panel"), [t("panel", "panel"), t("panels", "paneles")]),
        };
      })
    : tablerosLf > 0
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
          usa: [aj(claveAdhesivoPared, pegamentoParedSfPorBolsa)],
          cierre: div(paredSf, pegamentoParedSfPorBolsa, paquetesNecesarios(paredSf, pegamentoParedSfPorBolsa), "SF",
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

  const expLechadaDe = (tipoL: "arenada" | "sinArena") => explica((lg) => {
    const { n, t, aj } = ctx(lg);
    const r = tipoL === "arenada" ? lechadaArenada : lechadaSinArena;
    const claveRef: keyof AjustesCalculadora = tipoL === "arenada" ? "lechadaArenadaSfPorBolsa" : "lechadaSinArenaSfPorBolsa";
    const refSf = a[claveRef];
    const nombreTipo = tipoL === "arenada" ? t("sanded", "con arena") : t("unsanded", "sin arena");
    const regla = tipoL === "arenada" ? t("joint 1/8 in or wider", "junta de 1/8 in o más") : t("joint 1/8 in or narrower", "junta de 1/8 in o menos");
    return {
      formula: t(`Grout ${nombreTipo} (bags) = area ÷ SF per bag; SF per bag = ${n(refSf)} × joint adjustment (rounded down). Only for ${regla}.`,
        `Lechada ${nombreTipo} (bolsas) = área ÷ SF por bolsa; SF por bolsa = ${n(refSf)} × ajuste por junta (redondeado hacia abajo). Solo con ${regla}.`),
      pasos: superficiesDeLechada.length === 0
        ? [t("0 because there is no tile area", "0 porque no hay área de loseta")]
        : [
          ...superficiesDeLechada.map((x) => {
            const cov = x[tipoL];
            const cab = `${t(x.nombre.en, x.nombre.es)} ${x.la}x${x.lb}, ${t("joint", "junta")} ${n(x.j)} in, ${t("depth", "prof.")} ${n(x.profIn)} in`;
            return cov > 0
              ? t(`${cab}: adjustment ${n(x.ajuste)} → ${n(cov)} SF per bag; ${n(x.area)} SF ÷ ${n(cov)} = ${n(x.area / cov)} bags`,
                `${cab}: ajuste ${n(x.ajuste)} → ${n(cov)} SF por bolsa; ${n(x.area)} SF ÷ ${n(cov)} = ${n(x.area / cov)} bolsas`)
              : t(`${cab}: N/A — joint outside the rated range for ${nombreTipo} grout`, `${cab}: N/A — la junta está fuera del rango de la lechada ${nombreTipo}`);
          }),
        ],
      usa: [aj(claveRef, refSf), aj("lechadaLargoRefIn", a.lechadaLargoRefIn), aj("lechadaAnchoRefIn", a.lechadaAnchoRefIn),
        aj("lechadaJuntaRefIn", a.lechadaJuntaRefIn), aj("lechadaProfRefIn", a.lechadaProfRefIn)],
      cierre: r.fueraDeRango
        ? t("N/A: choose the other grout type.", "N/A: usa el otro tipo de lechada.")
        : r.venta > 0
          ? t(`${n(r.bolsas)} bags → rounded up = ${r.venta} ${r.venta === 1 ? "bag" : "bags"}. ${r.fuera.length ? "The surface out of range takes the other grout." : "Sanded and unsanded are alternatives: sell one."}`,
            `${n(r.bolsas)} bolsas → redondeado hacia arriba = ${r.venta} ${r.venta === 1 ? "bolsa" : "bolsas"}. ${r.fuera.length ? "La superficie fuera de rango lleva la otra lechada." : "Con arena y sin arena son alternativas: se vende una."}`)
          : t("Nothing to sell: 0.", "Nada que vender: 0."),
    };
  });
  const expLechadaArenada = expLechadaDe("arenada");
  const expLechadaSinArena = expLechadaDe("sinArena");

  const expSilicon = esDucha
    ? explica((lg) => {
        const { n, t, ent, aj, div } = ctx(lg);
        return {
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
        };
      })
    : cero({ en: "Silicone (LF) = perimeter + height × corners", es: "Silicón (LF) = perímetro + alto × esquinas" },
      motivoProyecto({ en: "(silicone is for showers)", es: "(el silicón es para duchas)" }));

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

  const expClips = explica((lg) => {
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

  const expCunas = esPared ? explica((lg) => {
    const { n, t, aj, div } = ctx(lg);
    return {
      formula: t("Wedges = net wall area × wedges per SF, rounded up", "Cuñas = área neta de pared × cuñas por SF, redondeado hacia arriba"),
      pasos: [t(`Wedges = ${n(paredSf)} × ${n(a.cunasPorSf)} = ${n(paredSf * a.cunasPorSf)} → ${n(cunasCant)} wedges`,
        `Cuñas = ${n(paredSf)} × ${n(a.cunasPorSf)} = ${n(paredSf * a.cunasPorSf)} → ${n(cunasCant)} cuñas`)],
      usa: [aj("cunasPorSf", a.cunasPorSf), aj("cunasPorPaquete", a.cunasPorPaquete)],
      cierre: div(cunasCant, a.cunasPorPaquete, paquetesNecesarios(cunasCant, a.cunasPorPaquete), t("wedges", "cuñas"),
        t("wedges per pack", "cuñas por paquete"), [t("pack", "paquete"), t("packs", "paquetes")]),
    };
  }) : explica((lg) => {
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
    esPared
      ? fila("tablero", { en: "Backerboard", es: "Tablero de cemento" },
        paredSf, panelSf, { en: "panels", es: "paneles" },
        "If new substrate needed; area estimate", expTablero, tablerosPaneles)
      : fila("tablero", { en: "Backerboard (linear feet)", es: "Tablero de cemento (pies lineales)" },
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
      paredSf, pegamentoParedSfPorBolsa, { en: "bags", es: "bolsas" },
      esPared ? "44 lb; includes back-buttering" : "44-lb thinset working rate for standard shower; back-buttering included; verify coverage.", expPegamentoPared),
    fila("pegamento-piso", { en: "Thinset for flooring", es: "Pegamento para piso" },
      pisoSf, a.adhesivoPisoSfPorBolsa, { en: "bags", es: "bolsas" },
      "44-lb thinset working rate for standard shower; back-buttering included; verify coverage.", expPegamentoPiso),
    fila("loseta-pared", { en: "Wall tile", es: "Loseta de pared" },
      paredSf, e.cajaParedSf, { en: "boxes", es: "cajas" },
      "Boxes use SF per box; tile size used only for grout estimate", expLosetaPared),
    fila("loseta-piso", { en: "Floor tile", es: "Loseta de piso" },
      pisoSf, e.cajaPisoSf, { en: "boxes", es: "cajas" },
      "Boxes use SF per box; tile size used only for grout estimate", expLosetaPiso),
    filaDeLechada("lechada-arenada", { en: "Grout — sanded", es: "Lechada con arena" }, lechadaArenada, expLechadaArenada),
    filaDeLechada("lechada-sin-arena", { en: "Grout — unsanded", es: "Lechada sin arena" }, lechadaSinArena, expLechadaSinArena),
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
      cunasCant, a.cunasPorPaquete, { en: "packs", es: "paquetes" },
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

/** Una fila de lechada (D-1203): bolsas de 25 lb; N/A si la junta está fuera del rango de ese tipo. */
function filaDeLechada(
  clave: ClaveDeFila, material: Bilingue,
  r: { area: number; fueraDeRango: boolean; fuera: Bilingue[]; rendimiento: number | null; venta: number }, explicacion: Explicacion,
): FilaCalculada {
  const base = r.fueraDeRango
    ? "N/A — joint outside the rated range; choose the other grout type"
    : "SF per 25-lb bag; sanded and unsanded are alternatives, choose one";
  const nota: Bilingue = { en: base, es: NOTAS_ES[base] ?? base };
  if (!r.fueraDeRango && r.fuera.length > 0) {
    nota.en = `Covers only the surface in range; the ${r.fuera.map((x) => x.en).join(" and ")} joint is outside it — use the other grout there.`;
    nota.es = `Cubre solo la superficie en rango; la junta de ${r.fuera.map((x) => x.es).join(" y ")} está fuera — ahí usa la otra lechada.`;
  }
  return {
    clave, material, cantidad: sana(r.area), porPaquete: r.rendimiento !== null && r.rendimiento > 0 ? r.rendimiento : null,
    venta: r.venta, unidad: { en: "bags", es: "bolsas" }, nota, explicacion,
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
  "N/A — joint outside the rated range; choose the other grout type": "N/A — la junta está fuera del rango; usa el otro tipo de lechada.",
  "SF per 25-lb bag; sanded and unsanded are alternatives, choose one": "SF por bolsa de 25 lb; con arena y sin arena son alternativas: elige una.",
  "If new substrate needed; area estimate": "Si se necesita sustrato nuevo; estimado por área.",
  "44 lb; includes back-buttering": "44 lb; incluye el pegado por la cara trasera.",
  "Calculated from estimated linear feet of corner joints": "Calculado con los pies lineales estimados de las juntas de esquina.",
  "Based on specified exposed edge length; enter length below": "Según el largo de borde expuesto; captúralo abajo.",
  "Allowance adjustable / verify tile pattern and layout": "Margen ajustable; verifica el patrón y el trazado de la loseta.",
  "Allowance adjustable / wedges may be reusable": "Margen ajustable; las cuñas pueden reutilizarse.",
  "One shower drain by default; confirm installation type": "Una coladera por defecto; confirma el tipo de instalación.",
  "Optional; typically builder / framer scope, confirm with installer": "Opcional; normalmente lo incluye el constructor; confirma con el instalador.",
};
