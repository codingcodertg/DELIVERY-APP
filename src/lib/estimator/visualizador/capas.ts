/**
 * Las capas de la regadera: los números, colores y nombres de la lámina «Shower Materials / Materiales para ducha»
 * (la del dueño), más la base, el drenaje y los perfiles que la lámina no numera. Aquí solo hay datos y el orden en
 * que se instalan; la escena (three.js) decide cómo se dibujan.
 */

import type { Bilingue } from "@/lib/estimator/calculadora-material";

export type IdCapa =
  | "base-mortero" | "coladera" | "membrana" | "mortero-final" | "tablero" | "tornillos" | "malla"
  | "impermeable" | "adhesivo" | "loseta-piso" | "niveladores" | "loseta-pared" | "salpicadero"
  | "perfiles" | "boquilla" | "silicon";

export interface CapaDef {
  id: IdCapa;
  /** El número de la lámina; `null` si la lámina no lo numera (base, coladera). */
  numero: number | null;
  nombre: Bilingue;
  /** Qué hace, en una o dos frases, para el vendedor. */
  que: Bilingue;
  /** Color del número en la lista (el de la lámina). */
  color: string;
}

/**
 * En el ORDEN DE INSTALACIÓN: así se va armando, de abajo hacia arriba y hacia adentro. La lámina numera las capas
 * de la ducha; la base y la coladera van primero porque se hacen antes de cualquier membrana.
 */
export const CAPAS: readonly CapaDef[] = [
  {
    id: "base-mortero", numero: null,
    nombre: { en: "Mortar pre-slope", es: "Base de mortero con pendiente" },
    que: { en: "Sloped mortar base under the pan. It makes the water run to the drain.", es: "Base de mortero con pendiente bajo la ducha. Hace que el agua corra hacia la coladera." },
    color: "#78716c",
  },
  {
    id: "coladera", numero: null,
    nombre: { en: "Shower drain", es: "Coladera" },
    que: { en: "The drain sits at the lowest point of the pan, with its grate at tile level.", es: "La coladera va en el punto más bajo de la base, con la rejilla al nivel de la loseta." },
    color: "#334155",
  },
  {
    id: "membrana", numero: 1,
    nombre: { en: "Shower pan liner", es: "Membrana para base (cuero de marrano)" },
    que: { en: "Waterproof membrane under the final mortar bed. It turns up the walls and sends leaking water to the drain. Flood-test it before covering.", es: "Membrana impermeable bajo la cama final de mortero. Sube por la pared y manda el agua filtrada a la coladera. Pruébala con agua antes de cubrirla." },
    color: "#1d4ed8",
  },
  {
    id: "mortero-final", numero: 4,
    nombre: { en: "Final mortar bed", es: "Cama final de mortero" },
    que: { en: "The sloped mortar bed on the liner. It sets the final shape of the pan.", es: "La cama de mortero con pendiente sobre la membrana. Da la forma final de la base." },
    color: "#f59e0b",
  },
  {
    id: "tablero", numero: 2,
    nombre: { en: "Backerboard", es: "Panel de cemento" },
    que: { en: "Cement board screwed to the studs. It is the substrate the waterproofing and tile go on.", es: "Panel de cemento atornillado a los postes. Es la base sobre la que van la impermeabilización y la loseta." },
    color: "#f97316",
  },
  {
    id: "tornillos", numero: 3,
    nombre: { en: "Screws", es: "Tornillos" },
    que: { en: "Fasten the backerboard to the studs, spaced over every panel.", es: "Fijan el panel de cemento a los postes, repartidos en cada panel." },
    color: "#dc2626",
  },
  {
    id: "malla", numero: 5,
    nombre: { en: "Joint mesh tape", es: "Malla para juntas" },
    que: { en: "Covers the seams between board panels so they do not crack.", es: "Cubre las juntas entre paneles para que no se agrieten." },
    color: "#7c3aed",
  },
  {
    id: "impermeable", numero: 6,
    nombre: { en: "Waterproofing", es: "Impermeabilizante" },
    que: { en: "Liquid waterproofing over the board and the floor bed. Keeps water out of the wall.", es: "Impermeabilizante líquido sobre el panel y la cama del piso. Evita que el agua llegue a la pared." },
    color: "#0891b2",
  },
  {
    id: "adhesivo", numero: 7,
    nombre: { en: "Thin-set mortar", es: "Mortero adhesivo" },
    que: { en: "Tile adhesive, troweled with ridges so the tile bonds fully.", es: "Pegamento para loseta, aplicado con peine para que la loseta agarre completa." },
    color: "#15803d",
  },
  {
    id: "loseta-piso", numero: 8,
    nombre: { en: "Shower floor tile", es: "Loseta para piso de ducha" },
    que: { en: "The floor tile of the pan. Usually a small mosaic so it grips and slopes well.", es: "La loseta del piso de la ducha. Suele ser mosaico chico para que agarre y siga la pendiente." },
    color: "#3b82f6",
  },
  {
    id: "niveladores", numero: 12,
    nombre: { en: "Clips and wedges", es: "Niveladores y cuñas" },
    que: { en: "Keep the tile level while the thin-set cures. Removed before grouting.", es: "Mantienen la loseta a nivel mientras fragua el pegamento. Se quitan antes de la boquilla." },
    color: "#e11d48",
  },
  {
    id: "loseta-pared", numero: 9,
    nombre: { en: "Wall tile", es: "Azulejo de pared" },
    que: { en: "The wall tile the customer chooses.", es: "El azulejo de pared que escoge el cliente." },
    color: "#ec4899",
  },
  {
    id: "salpicadero", numero: 10,
    nombre: { en: "Backsplash", es: "Salpicadero" },
    que: { en: "A decorative strip of tile, usually at counter or niche height.", es: "Una franja decorativa de loseta, normalmente a la altura de la cubierta o del nicho." },
    color: "#0f766e",
  },
  {
    id: "perfiles", numero: 11,
    nombre: { en: "Tile trims", es: "Perfiles o tiras" },
    que: { en: "Finish the exposed tile edges that have no tile beside them.", es: "Terminan los bordes de loseta expuestos que no tienen otra loseta al lado." },
    color: "#92400e",
  },
  {
    id: "boquilla", numero: 13,
    nombre: { en: "Grout", es: "Boquilla o junta" },
    que: { en: "Fills the joints between tiles. Choose the color and the joint width.", es: "Llena las juntas entre losetas. Escoge el color y el ancho de junta." },
    color: "#64748b",
  },
  {
    id: "silicon", numero: 14,
    nombre: { en: "Silicone sealant", es: "Sellador de silicón" },
    que: { en: "Flexible seal at the corners and where the tile meets the pan and the glass. Last step.", es: "Sello flexible en las esquinas y donde la loseta se junta con la base y el vidrio. Es el último paso." },
    color: "#4338ca",
  },
];

/** Los ids en orden de instalación. */
export const ORDEN_DE_INSTALACION: readonly IdCapa[] = CAPAS.map((c) => c.id);

export function capaDe(id: IdCapa): CapaDef {
  const c = CAPAS.find((x) => x.id === id);
  if (!c) throw new Error(`capa desconocida: ${id}`);
  return c;
}

/** Las capas que ya están puestas cuando el paso es `paso` (0 = nada; `CAPAS.length` = todo). */
export function capasHastaPaso(paso: number): IdCapa[] {
  const n = Math.max(0, Math.min(CAPAS.length, Math.floor(paso)));
  return ORDEN_DE_INSTALACION.slice(0, n);
}
