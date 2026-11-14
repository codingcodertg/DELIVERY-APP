/**
 * Las losetas se pintan en un canvas, sin imágenes de nadie: mármol, madera, mosaico, metro, negro mate y travertino
 * salen de números (un generador con semilla, así el mismo ajuste siempre pinta lo mismo). La foto que sube el vendedor
 * se pone tal cual en cada loseta. Aquí no hay three.js: la escena convierte el canvas en textura.
 */

import type { TamanoDeLoseta } from "@/lib/estimator/calculadora-material";
import { bloqueDeLaLoseta, bloqueDelPatron, tamanoEnPulgadas, type Patron } from "@/lib/estimator/visualizador/geometria";

export type PresetId = "marmol-blanco" | "marmol-gris" | "madera" | "hexagonal" | "metro" | "negro-mate" | "travertino";
export type FuenteLoseta = PresetId | "foto";
export type ColorLechada = "blanca" | "gris" | "carbon" | "beige";

export const PRESETS: readonly { id: PresetId; en: string; es: string }[] = [
  { id: "marmol-blanco", en: "White marble", es: "Mármol blanco" },
  { id: "marmol-gris", en: "Grey marble", es: "Mármol gris" },
  { id: "madera", en: "Wood-look plank", es: "Madera (tabla)" },
  { id: "hexagonal", en: "Hex mosaic", es: "Mosaico hexagonal" },
  { id: "metro", en: "Subway (3×6 brick)", es: "Metro (ladrillo 3×6)" },
  { id: "negro-mate", en: "Black matte", es: "Negro mate" },
  { id: "travertino", en: "Beige travertine", es: "Travertino beige" },
];

export const LECHADAS: readonly { id: ColorLechada; en: string; es: string; hex: string }[] = [
  { id: "blanca", en: "White", es: "Blanca", hex: "#f3f1ec" },
  { id: "gris", en: "Grey", es: "Gris", hex: "#9ca3af" },
  { id: "carbon", en: "Charcoal", es: "Carbón", hex: "#3f3f46" },
  { id: "beige", en: "Beige", es: "Beige", hex: "#cdb892" },
];

/** Anchos de junta que se ofrecen (pulgadas): 1/16, 1/8, 3/16, 1/4. */
export const JUNTAS_IN: readonly number[] = [0.0625, 0.125, 0.1875, 0.25];

export interface EspecLoseta {
  fuente: FuenteLoseta;
  tamano: TamanoDeLoseta;
  patron: Patron;
  lechada: ColorLechada;
  juntaIn: number;
}

export const ESPEC_POR_DEFECTO: { pared: EspecLoseta; piso: EspecLoseta; salpicadero: EspecLoseta } = {
  pared: { fuente: "marmol-blanco", tamano: "24x48", patron: "apilado", lechada: "blanca", juntaIn: 0.125 },
  piso: { fuente: "hexagonal", tamano: "12x24", patron: "apilado", lechada: "gris", juntaIn: 0.0625 },
  salpicadero: { fuente: "metro", tamano: "8x8", patron: "medio", lechada: "blanca", juntaIn: 0.0625 },
};

/** Una semilla fija → siempre el mismo dibujo. */
function generador(semilla: number): () => number {
  let s = semilla >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Lo que se necesita para pintar una loseta: el canvas y su bloque en pulgadas (para la repetición). */
export interface LosetaPintada {
  canvas: HTMLCanvasElement;
  bloqueIn: { anchoIn: number; altoIn: number };
}

const LADO_MAX_PX = 1024;
const PX_POR_PULG_MAX = 40;

/**
 * Pinta el bloque que se repite: la loseta (o varias hileras, según el patrón) con su junta. La junta es transparente
 * salvo en `horneada` (el salpicadero se pinta con la boquilla ya dentro, porque no lleva capa de lechada detrás).
 */
export function pintaLoseta(spec: EspecLoseta, foto: CanvasImageSource | null, horneada: boolean): LosetaPintada {
  const [ancho, alto] = tamanoEnPulgadas(spec.tamano);
  const bloque = bloqueDeLaLoseta([ancho, alto], spec.patron);
  const { desfases, hileras } = bloqueDelPatron(spec.patron);
  const pxPorPulg = Math.min(PX_POR_PULG_MAX, LADO_MAX_PX / Math.max(bloque.anchoIn, bloque.altoIn));
  const w = Math.max(16, Math.round(bloque.anchoIn * pxPorPulg));
  const h = Math.max(16, Math.round(bloque.altoIn * pxPorPulg));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { canvas, bloqueIn: bloque };

  const lechada = LECHADAS.find((l) => l.id === spec.lechada)?.hex ?? "#f3f1ec";
  if (horneada) {
    ctx.fillStyle = lechada;
    ctx.fillRect(0, 0, w, h);
  } else {
    ctx.clearRect(0, 0, w, h);
  }

  const tw = ancho * pxPorPulg;
  const th = alto * pxPorPulg;
  const junta = Math.max(1, spec.juntaIn * pxPorPulg);
  const media = junta / 2;
  const rng = generador(semillaDe(spec));
  for (let fila = 0; fila < hileras; fila++) {
    const dx = desfases[fila] * tw;
    for (let k = -1; k <= 1; k++) {
      const x = dx + k * tw + media;
      const y = fila * th + media;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, tw - junta, th - junta);
      ctx.clip();
      if (spec.fuente === "foto" && foto) {
        pintaFoto(ctx, foto, x, y, tw - junta, th - junta);
      } else {
        pintaPreset(ctx, spec.fuente === "foto" ? "marmol-blanco" : spec.fuente, x, y, tw - junta, th - junta, pxPorPulg, rng);
      }
      ctx.restore();
    }
  }
  return { canvas, bloqueIn: bloque };
}

function semillaDe(spec: EspecLoseta): number {
  const texto = `${spec.fuente}|${spec.tamano}|${spec.patron}`;
  let h = 2166136261;
  for (let i = 0; i < texto.length; i++) h = Math.imul(h ^ texto.charCodeAt(i), 16777619);
  return h >>> 0;
}

function pintaFoto(ctx: CanvasRenderingContext2D, foto: CanvasImageSource, x: number, y: number, w: number, h: number): void {
  const fw = (foto as HTMLImageElement).naturalWidth || (foto as HTMLCanvasElement).width || w;
  const fh = (foto as HTMLImageElement).naturalHeight || (foto as HTMLCanvasElement).height || h;
  // «Cubrir»: se escala para llenar la loseta y se recorta el sobrante al centro.
  const escala = Math.max(w / fw, h / fh);
  const sw = w / escala, sh = h / escala;
  const sx = (fw - sw) / 2, sy = (fh - sh) / 2;
  ctx.drawImage(foto, sx, sy, sw, sh, x, y, w, h);
}

function pintaPreset(
  ctx: CanvasRenderingContext2D, preset: PresetId, x: number, y: number, w: number, h: number, px: number, rng: () => number,
): void {
  switch (preset) {
    case "marmol-blanco": return marmol(ctx, x, y, w, h, px, rng, "#f2f1ed", "#8e8e8e", 0.35);
    case "marmol-gris": return marmol(ctx, x, y, w, h, px, rng, "#8f9296", "#d7d9dc", 0.45);
    case "madera": return madera(ctx, x, y, w, h, px, rng);
    case "hexagonal": return hexagonos(ctx, x, y, w, h, px, rng);
    case "metro": return metro(ctx, x, y, w, h, px);
    case "negro-mate": return negroMate(ctx, x, y, w, h, rng);
    case "travertino": return travertino(ctx, x, y, w, h, px, rng);
  }
}

function marmol(
  ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, px: number, rng: () => number,
  fondo: string, vena: string, alfa: number,
): void {
  ctx.fillStyle = fondo;
  ctx.fillRect(x, y, w, h);
  const venas = 5 + Math.floor(rng() * 4);
  for (let i = 0; i < venas; i++) {
    ctx.strokeStyle = vena;
    ctx.globalAlpha = alfa * (0.5 + rng() * 0.5);
    ctx.lineWidth = px * (0.02 + rng() * 0.05);
    ctx.beginPath();
    let cx = x + rng() * w, cy = y + rng() * h;
    ctx.moveTo(cx, cy);
    for (let s = 0; s < 3; s++) {
      const nx = cx + (rng() - 0.5) * w * 0.9, ny = cy + (rng() - 0.3) * h * 0.6;
      ctx.bezierCurveTo(cx + (rng() - 0.5) * w * 0.6, cy + (rng() - 0.5) * h * 0.6, nx - w * 0.2, ny + h * 0.2, nx, ny);
      cx = nx; cy = ny;
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function madera(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, px: number, rng: () => number): void {
  const tonos = ["#a86f3f", "#b57b4b", "#94603a", "#bb8454"];
  ctx.fillStyle = tonos[Math.floor(rng() * tonos.length)];
  ctx.fillRect(x, y, w, h);
  for (let i = 0; i < 26; i++) {
    ctx.strokeStyle = "#5c3a22";
    ctx.globalAlpha = 0.12 + rng() * 0.2;
    ctx.lineWidth = px * (0.03 + rng() * 0.06);
    const yy = y + rng() * h;
    ctx.beginPath();
    ctx.moveTo(x, yy);
    ctx.bezierCurveTo(x + w * 0.3, yy + (rng() - 0.5) * h * 0.1, x + w * 0.6, yy + (rng() - 0.5) * h * 0.1, x + w, yy);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function hexagonos(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, px: number, rng: () => number): void {
  ctx.fillStyle = "#f4f3ef";
  ctx.fillRect(x, y, w, h);
  const r = px * 0.6; // radio de cada hexágono: ~0.6 pulgadas
  const dx = r * Math.sqrt(3), dy = r * 1.5;
  ctx.lineWidth = Math.max(1, px * 0.05);
  ctx.strokeStyle = "#cfccc4";
  for (let row = -1, yy = y - r; yy < y + h + r; row++, yy += dy) {
    for (let xx = x - dx + (row % 2 ? dx / 2 : 0); xx < x + w + dx; xx += dx) {
      ctx.fillStyle = rng() > 0.5 ? "#f4f3ef" : "#ecebe6";
      ctx.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = (Math.PI / 3) * k + Math.PI / 6;
        const px2 = xx + r * Math.cos(a), py2 = yy + r * Math.sin(a);
        if (k === 0) ctx.moveTo(px2, py2); else ctx.lineTo(px2, py2);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }
}

function metro(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, px: number): void {
  ctx.fillStyle = "#f7f6f2";
  ctx.fillRect(x, y, w, h);
  const alto = 3 * px, largo = 6 * px;
  ctx.strokeStyle = "#cfcdc6";
  ctx.lineWidth = Math.max(1, px * 0.08);
  let fila = 0;
  for (let yy = y; yy < y + h + alto; yy += alto, fila++) {
    const off = fila % 2 ? largo / 2 : 0;
    ctx.beginPath();
    ctx.moveTo(x, yy);
    ctx.lineTo(x + w, yy);
    ctx.stroke();
    for (let xx = x - largo + off; xx < x + w + largo; xx += largo) {
      ctx.beginPath();
      ctx.moveTo(xx, yy);
      ctx.lineTo(xx, yy + alto);
      ctx.stroke();
    }
  }
}

function negroMate(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, rng: () => number): void {
  ctx.fillStyle = "#1f2023";
  ctx.fillRect(x, y, w, h);
  for (let i = 0; i < 300; i++) {
    ctx.fillStyle = rng() > 0.5 ? "#ffffff" : "#000000";
    ctx.globalAlpha = 0.04 + rng() * 0.05;
    ctx.fillRect(x + rng() * w, y + rng() * h, 1.5, 1.5);
  }
  ctx.globalAlpha = 1;
}

function travertino(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, px: number, rng: () => number): void {
  ctx.fillStyle = "#d8c6a3";
  ctx.fillRect(x, y, w, h);
  for (let i = 0; i < 14; i++) {
    ctx.strokeStyle = "#b9a077";
    ctx.globalAlpha = 0.25 + rng() * 0.25;
    ctx.lineWidth = px * (0.05 + rng() * 0.1);
    const yy = y + rng() * h;
    ctx.beginPath();
    ctx.moveTo(x, yy);
    ctx.lineTo(x + w, yy + (rng() - 0.5) * h * 0.05);
    ctx.stroke();
  }
  ctx.fillStyle = "#9c835b";
  for (let i = 0; i < 40; i++) {
    ctx.globalAlpha = 0.35 + rng() * 0.3;
    ctx.beginPath();
    ctx.ellipse(x + rng() * w, y + rng() * h, px * (0.05 + rng() * 0.12), px * (0.02 + rng() * 0.05), 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/**
 * La textura del adhesivo: surcos de peine (rayas que se repiten). Sirve de color y de relieve.
 * Cada surco es media pulgada: se repite sobre la superficie según el tamaño.
 */
export function pintaAdhesivo(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  ctx.fillStyle = "#d9d3c3";
  ctx.fillRect(0, 0, 64, 64);
  for (let y = 0; y < 64; y += 16) {
    ctx.fillStyle = "#efeadc";
    ctx.fillRect(0, y + 2, 64, 6);
    ctx.fillStyle = "#b5ad98";
    ctx.fillRect(0, y + 9, 64, 3);
  }
  return canvas;
}

/** La lechada en el color que el cliente escoge, sola (para el fondo de las juntas o un plano liso). */
export function colorDeLechada(l: ColorLechada): string {
  return LECHADAS.find((x) => x.id === l)?.hex ?? "#f3f1ec";
}

export const PRESET_EN_ES = PRESETS;
