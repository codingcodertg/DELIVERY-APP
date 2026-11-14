/**
 * Geometría pura de la regadera: dónde van las paredes (2, 3 o 4), los paneles de tablero, los tornillos, cómo se
 * repite la loseta y el perfil de la base. Sin three.js ni React: lo que aquí sale es lo que la escena dibuja.
 *
 * Plano: x = largo (L), z = ancho (W), y = alto (H). Origen en la esquina trasera izquierda de la base. Unidades: pies.
 */

import type { EntradasCalculadora, TipoDeProyecto, Disposicion } from "@/lib/estimator/calculadora-material";

export type PuntoPlano = { x: number; z: number };

export type NombrePared = "trasera" | "izquierda" | "derecha" | "frente";

export interface Pared {
  nombre: NombrePared;
  /** Los dos extremos (el primero es donde empieza el largo local de la pared). */
  inicio: PuntoPlano;
  fin: PuntoPlano;
  /** Largo en pies. */
  largo: number;
  /** Vector unitario hacia dentro del cuarto (hacia el centro de la base). */
  hacia: PuntoPlano;
}

/**
 * Las paredes de la disposición. 2 paredes: la trasera y una lateral (L + W, igual que la calculadora). 3 paredes: la
 * trasera y las dos laterales (L + 2W). 4 paredes: también la del frente (2L + 2W).
 */
export function paredesDeLaDisposicion(disposicion: Disposicion, largoFt: number, anchoFt: number): Pared[] {
  const L = largoFt, W = anchoFt;
  const definicion: { nombre: NombrePared; inicio: PuntoPlano; fin: PuntoPlano }[] = [
    { nombre: "trasera", inicio: { x: 0, z: 0 }, fin: { x: L, z: 0 } },
    { nombre: "izquierda", inicio: { x: 0, z: 0 }, fin: { x: 0, z: W } },
  ];
  if (disposicion !== "2 Walls") {
    definicion.push({ nombre: "derecha", inicio: { x: L, z: 0 }, fin: { x: L, z: W } });
  }
  if (disposicion === "4 Walls") {
    definicion.push({ nombre: "frente", inicio: { x: L, z: W }, fin: { x: 0, z: W } });
  }
  const centro = { x: L / 2, z: W / 2 };
  return definicion.map(({ nombre, inicio, fin }) => {
    const largo = Math.hypot(fin.x - inicio.x, fin.z - inicio.z);
    const dx = largo > 0 ? (fin.x - inicio.x) / largo : 0;
    const dz = largo > 0 ? (fin.z - inicio.z) / largo : 0;
    // La normal que apunta al centro: la perpendicular que cae del lado del cuarto.
    let hx = -dz, hz = dx;
    if (hx * (centro.x - inicio.x) + hz * (centro.z - inicio.z) < 0) { hx = -hx; hz = -hz; }
    return { nombre, inicio, fin, largo, hacia: { x: hx, z: hz } };
  });
}

/**
 * Los extremos de pared que quedan a la vista: no hay otra pared que llegue a ese mismo punto. Ahí va el perfil
 * (la tira) de la loseta. En 4 paredes no queda ninguno; en 2 y 3 paredes, los de las paredes sueltas.
 */
export function extremosExpuestos(paredes: readonly Pared[]): { pared: NombrePared; extremo: 0 | 1; punto: PuntoPlano }[] {
  const salida: { pared: NombrePared; extremo: 0 | 1; punto: PuntoPlano }[] = [];
  const iguales = (a: PuntoPlano, b: PuntoPlano) => Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.z - b.z) < 1e-6;
  paredes.forEach((p, i) => {
    ([[0, p.inicio], [1, p.fin]] as const).forEach(([extremo, punto]) => {
      const cubierto = paredes.some((otra, j) => j !== i && (iguales(otra.inicio, punto) || iguales(otra.fin, punto)));
      if (!cubierto) salida.push({ pared: p.nombre, extremo, punto });
    });
  });
  return salida;
}

export interface RectanguloPanel {
  x0: number; x1: number; y0: number; y1: number;
}

/**
 * Los paneles de tablero de una pared de `longitud` × `alto`: columnas de `anchoPanel` y filas de `altoPanel`, y la
 * última de cada una cortada al borde (en la obra se corta). Coordenadas locales de la pared.
 */
export function panelesDePared(longitud: number, alto: number, anchoPanel: number, altoPanel: number): RectanguloPanel[] {
  const paneles: RectanguloPanel[] = [];
  if (!(longitud > 0) || !(alto > 0) || !(anchoPanel > 0) || !(altoPanel > 0)) return paneles;
  for (let y = 0; y < alto - 1e-9; y += altoPanel) {
    for (let x = 0; x < longitud - 1e-9; x += anchoPanel) {
      paneles.push({ x0: x, x1: Math.min(x + anchoPanel, longitud), y0: y, y1: Math.min(y + altoPanel, alto) });
    }
  }
  return paneles;
}

/** Las juntas entre paneles (las que llevan malla): posiciones verticales y horizontales, sin los bordes. */
export function juntasDePaneles(longitud: number, alto: number, anchoPanel: number, altoPanel: number): { verticales: number[]; horizontales: number[] } {
  const verticales: number[] = [];
  const horizontales: number[] = [];
  for (let x = anchoPanel; x < longitud - 1e-9; x += anchoPanel) verticales.push(x);
  for (let y = altoPanel; y < alto - 1e-9; y += altoPanel) horizontales.push(y);
  return { verticales, horizontales };
}

/**
 * Cómo se reparten `n` tornillos dentro de un panel de `ancho` × `alto`: la rejilla de columnas y filas cuya proporción
 * se parece más a la del panel, con los puntos centrados y con un margen. Siempre salen exactamente `n` puntos.
 */
export function tornillosEnPanel(n: number, ancho: number, alto: number, margen = 0.08): { columnas: number; filas: number; puntos: PuntoPlano[] } {
  const total = Math.max(0, Math.floor(n));
  if (total === 0 || !(ancho > 0) || !(alto > 0)) return { columnas: 0, filas: 0, puntos: [] };
  const objetivo = ancho / alto;
  let mejor = { columnas: 1, filas: total, error: Infinity };
  for (let columnas = 1; columnas <= total; columnas++) {
    const filas = Math.ceil(total / columnas);
    const error = Math.abs(columnas / filas - objetivo);
    if (error < mejor.error) mejor = { columnas, filas, error };
  }
  const { columnas, filas } = mejor;
  const puntos: PuntoPlano[] = [];
  const anchoUtil = Math.max(0, ancho - 2 * margen), altoUtil = Math.max(0, alto - 2 * margen);
  for (let f = 0; f < filas; f++) {
    // La última fila puede venir incompleta: sus tornillos se reparten en su ancho, centrados.
    const enLaFila = f === filas - 1 ? total - f * columnas : columnas;
    for (let c = 0; c < enLaFila; c++) {
      puntos.push({
        x: margen + ((c + 0.5) / enLaFila) * anchoUtil,
        z: margen + ((f + 0.5) / filas) * altoUtil,
      });
    }
  }
  return { columnas, filas, puntos };
}

// ---- Loseta: patrón y repetición -----------------------------------------------------------------------------------

/** El patrón de colocación. Stacked = a plomo; 1/2 y 1/3 = el desfase de cada hilera. */
export type Patron = "apilado" | "medio" | "tercio";
export const PATRONES: readonly Patron[] = ["apilado", "medio", "tercio"];

/** Cuántas hileras tiene el bloque que se repite y cuánto se corre cada una (fracción de la loseta). */
export function bloqueDelPatron(patron: Patron): { hileras: number; desfases: number[] } {
  switch (patron) {
    case "medio": return { hileras: 2, desfases: [0, 0.5] };
    case "tercio": return { hileras: 3, desfases: [0, 1 / 3, 2 / 3] };
    default: return { hileras: 1, desfases: [0] };
  }
}

/**
 * El tamaño, en pulgadas, de la imagen que se repite: una loseta de ancho × alto, con tantas hileras como pida el patrón
 * (el alto del bloque es hileras × alto de la loseta).
 */
export function bloqueDeLaLoseta(tamanoIn: [number, number], patron: Patron): { anchoIn: number; altoIn: number } {
  const [ancho, alto] = tamanoIn;
  const { hileras } = bloqueDelPatron(patron);
  return { anchoIn: ancho, altoIn: alto * hileras };
}

/**
 * Cuántas veces se repite el bloque sobre una superficie de `anchoFt` × `altoFt`. Es el número que hace que el dibujo
 * cuente losetas reales: 12x24 sobre 5 ft × 3 ft = 5 × 1.5 losetas de ancho y alto.
 */
export function repeticionDeLaSuperficie(bloque: { anchoIn: number; altoIn: number }, anchoFt: number, altoFt: number): { x: number; y: number } {
  const x = bloque.anchoIn > 0 ? (anchoFt * 12) / bloque.anchoIn : 1;
  const y = bloque.altoIn > 0 ? (altoFt * 12) / bloque.altoIn : 1;
  return { x, y };
}

/** Las medidas que la calculadora pone en «largo x ancho» (pulgadas). Ej.: «24x48» → [24, 48]. */
export function tamanoEnPulgadas(tamano: string): [number, number] {
  const i = tamano.indexOf("x");
  if (i < 0) return [12, 12];
  const a = Number.parseFloat(tamano.slice(0, i)), b = Number.parseFloat(tamano.slice(i + 1));
  return [a > 0 ? a : 12, b > 0 ? b : 12];
}

// ---- Base: perfil de pendiente --------------------------------------------------------------------------------------

/**
 * Qué tan lejos está un punto de la coladera, de 0 (en la coladera) a 1 (en la esquina). Es la base de todo el perfil de
 * pendiente: la base baja hacia la coladera.
 */
export function distanciaNormalizada(x: number, z: number, largoFt: number, anchoFt: number): number {
  const cx = largoFt / 2, cz = anchoFt / 2;
  const maxima = Math.hypot(cx, cz);
  if (!(maxima > 0)) return 0;
  return Math.min(1, Math.hypot(x - cx, z - cz) / maxima);
}

/**
 * Altura de una capa de la base sobre la capa de abajo, en pies, con un espesor medio de `espesorIn` pulgadas. En la
 * coladera vale el 20% del promedio y en la esquina el 180%; el promedio sobre la base sale cerca del espesor medio.
 */
export function alturaDeLaPendiente(d: number, espesorIn: number): number {
  const medio = Math.max(0, espesorIn) / 12;
  return medio * (0.2 + 1.6 * Math.min(1, Math.max(0, d)));
}

// ---- Escena ---------------------------------------------------------------------------------------------------------

export interface DimensionesEscena {
  proyecto: TipoDeProyecto;
  disposicion: Disposicion;
  largoFt: number;
  anchoFt: number;
  altoFt: number;
  /** Avisos (medidas en 0 o sin sentido que se dibujan con un mínimo). */
  avisos: ("largo" | "ancho" | "alto")[];
}

const MINIMO_FT = 1;

/** Las medidas de la calculadora, tal cual, con un mínimo de 1 ft para que siempre haya algo que dibujar. */
export function dimensionesDeLaEscena(e: Pick<EntradasCalculadora, "proyecto" | "disposicion" | "largoFt" | "anchoFt" | "altoFt">): DimensionesEscena {
  const avisos: DimensionesEscena["avisos"] = [];
  const limpia = (n: number, nombre: "largo" | "ancho" | "alto") => {
    if (Number.isFinite(n) && n >= MINIMO_FT) return n;
    avisos.push(nombre);
    return MINIMO_FT;
  };
  return {
    proyecto: e.proyecto,
    disposicion: e.disposicion,
    largoFt: limpia(e.largoFt, "largo"),
    anchoFt: limpia(e.anchoFt, "ancho"),
    altoFt: limpia(e.altoFt, "alto"),
    avisos,
  };
}
