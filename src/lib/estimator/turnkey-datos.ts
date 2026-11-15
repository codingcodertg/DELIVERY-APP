/**
 * Los precios y los planes de la plantilla Turnkey del dueño (el Excel), tal como están en la hoja.
 *
 * **Confidencial: costos, márgenes y tasas de descuento.** Este archivo no lo importa ningún componente del cliente.
 * Lo lee `app/estimator/turnkey-actions.ts`, que solo se lo entrega a una sesión con rol `admin`. Si algo de aquí
 * aparece en el navegador de un vendedor, es una fuga: no importar este archivo desde código de cliente.
 *
 * Los precios que en la hoja son una fórmula (`=23.29/350`) se escriben como la fórmula, para que se vea de dónde salen.
 */
import type { ArticuloMaterial, ConceptoDeMano, DatosTurnkey, Entradas, PlanFinanciero } from "./turnkey";

// ---- MATERIAL (sheet1) -------------------------------------------------------------------------------------------------

export const MATERIALES: ArticuloMaterial[] = [
  { id: "espaciadores", grupo: "preparacion", en: "Spacers + wedges", es: "Separadores + cuñas", precio: 0.3 },
  { id: "lechada-sin-arena", grupo: "preparacion", en: "Grout, unsanded", es: "Lechada sin arena", precio: 23.29 / 350 },
  { id: "lechada-con-arena", grupo: "preparacion", en: "Grout, sanded", es: "Lechada con arena", precio: 21.49 / 250 },
  { id: "cemento", grupo: "preparacion", en: "Cement", es: "Cemento", precio: 9.99 / 40 },
  { id: "charola-regadera", grupo: "preparacion", en: "Shower pan", es: "Charola de regadera", precio: 7.99 },
  { id: "backer-board", grupo: "preparacion", en: "Backer board", es: "Backer board", precio: 17.5 / 15, nota: "Price = 17.50 / 15" },
  { id: "madera-flotante", grupo: "preparacion", en: "Wood float", es: "Madera flotante", precio: 0 },
  {
    id: "cola-madera", grupo: "preparacion", en: "Wood glue", es: "Cola de madera", precio: 400, fijo: true,
    nota: "Typed as a fixed amount in the sheet (D10), not price × qty",
  },
  { id: "escalon-madera", grupo: "preparacion", en: "Wood / laminate step", es: "Escalón de madera / laminado", precio: 0 },
  { id: "plg-ceramica", grupo: "losa", en: "PLG ceramic", es: "PLG cerámica", precio: 1.39 },
  { id: "ker-ceramica", grupo: "losa", en: "KER ceramic", es: "KER cerámica", precio: 1.79 },
  { id: "plg-porcelana", grupo: "losa", en: "PLG porcelain", es: "PLG porcelana", precio: 1.79 },
  { id: "ker-porcelana", grupo: "losa", en: "KER porcelain", es: "KER porcelana", precio: 2.89 },
  { id: "laminado", grupo: "otros", en: "Laminate", es: "Laminado", precio: 2.09 },
  { id: "vinilo", grupo: "otros", en: "Vinyl", es: "Vinilo", precio: 2 },
  { id: "alfombra", grupo: "otros", en: "Carpet", es: "Alfombra", precio: 1 },
  { id: "piedra-natural", grupo: "otros", en: "Natural stone", es: "Piedra natural", precio: 0 },
  { id: "deco", grupo: "otros", en: "Deco", es: "Deco", precio: 15 },
];

// ---- LABOR (sheet2) ----------------------------------------------------------------------------------------------------

/** Removal (A4:A10). La fila «Demo Shower» no entra en el total de la hoja (D2 = SUM(D4:D9)). */
export const REMOCION: ConceptoDeMano[] = [
  { id: "rem-alfombra-pegada", seccion: "removal", en: "Carpet glue-down removal", es: "Quitar alfombra pegada", pago: 0.1 },
  { id: "rem-vinilo", seccion: "removal", en: "Sheet vinyl removal", es: "Quitar vinilo en rollo", pago: 0.11 },
  { id: "rem-azulejo", seccion: "removal", en: "Tile removal", es: "Quitar azulejo", pago: 1 },
  { id: "rem-azulejo-madera", seccion: "removal", en: "Tile removal over wood", es: "Quitar azulejo sobre madera", pago: 1.5 },
  { id: "rem-madera", seccion: "removal", en: "Wood removal", es: "Quitar madera", pago: 1 },
  { id: "rem-laminado", seccion: "removal", en: "Laminate removal", es: "Quitar laminado", pago: 0.5 },
  {
    id: "demo-regadera", seccion: "removal", en: "Demo shower / no plumbing", es: "Demoler regadera / sin plomería", pago: 100,
    nota: "Demolition", fueraDelTotal: true,
  },
];

/** Instalación (G4:J31): tile, laminado, vinilo, alfombra y otros. Los SF de todas las filas suman la base (N2). */
export const INSTALACION: ConceptoDeMano[] = [
  { id: "ins-piso-azulejo", seccion: "tile", en: "Tile install, floor", es: "Instalar azulejo, piso", pago: 2 },
  { id: "ins-patron", seccion: "tile", en: "Tile install, pattern", es: "Instalar azulejo, patrón", pago: 2.25 },
  { id: "ins-patron-esquinas", seccion: "tile", en: "Tile pattern / clipped corners", es: "Patrón / esquinas cortadas", pago: 2.5 },
  { id: "ins-alfombras-azulejo", seccion: "tile", en: "Tile rugs, per running foot", es: "Alfombras de azulejo, por pie lineal", pago: 1.5, nota: "Why cheaper?" },
  { id: "ins-zoclo-azulejo", seccion: "tile", en: "Tile base, per foot", es: "Zoclo de azulejo, por pie", pago: 1, nota: "N/A on our projects" },
  { id: "ins-pared-azulejo", seccion: "tile", en: "Tile install, wall", es: "Instalar azulejo, pared", pago: 5 },
  { id: "ins-laminado", seccion: "laminate", en: "Laminate install, 1.20 + .20 float", es: "Instalar laminado, flotante 1.20 + .20", pago: 1.4, dias: true },
  {
    id: "ins-coretec", seccion: "laminate", en: "Coretec / Floorte install, .20 + .20 float", es: "Instalar Coretec / Floorte, flotante .20 + .20", pago: 1.2,
    nota: "$1.40 depending on installer (falls under rigid core vi…",
  },
  { id: "ins-escalon-laminado", seccion: "laminate", en: "Wood / laminate step", es: "Escalón de madera / laminado", pago: 35 },
  { id: "ins-vinilo-flotante", seccion: "vinyl", en: "Sheet vinyl install, .7 + .2 float", es: "Instalar vinilo en rollo, flotante .7 + .2", pago: 1.1 },
  { id: "ins-lv-sin-lechada", seccion: "vinyl", en: "LV, no grout", es: "LV sin lechada", pago: 1.1 },
  { id: "ins-lv-sin-lechada-800", seccion: "vinyl", en: "LV, no grout, over 800 ft", es: "LV sin lechada, más de 800 ft", pago: 1 },
  { id: "ins-lv-lechada", seccion: "vinyl", en: "LV, grout", es: "LV con lechada", pago: 1.25 },
  { id: "ins-alfombra", seccion: "carpet", en: "Carpet install", es: "Instalar alfombra", pago: 0.35 },
  { id: "ins-alfombra-patron", seccion: "carpet", en: "Carpet pattern / woven", es: "Alfombra con patrón / tejida", pago: 0.35 },
  { id: "ins-escalon-alfombra", seccion: "carpet", en: "Carpet step, BN", es: "Escalón de alfombra, BN", pago: 2 },
  { id: "ins-escalon-alfombra-uph", seccion: "carpet", en: "Carpet step, upholstered", es: "Escalón de alfombra, tapizado", pago: 5 },
  { id: "ins-backer", seccion: "otros", en: "Install backer board", es: "Instalar backer board", pago: 0.5 },
  { id: "ins-charola", seccion: "otros", en: "Shower pan install, per SF", es: "Instalar charola, por SF", pago: 25 },
  { id: "ins-nicho", seccion: "otros", en: "Recessit install, incl. tile", es: "Instalar Recessit, con azulejo", pago: 50, nota: "Shower niche" },
  { id: "ins-piedra", seccion: "otros", en: "Natural stone", es: "Piedra natural", pago: 2.5 },
  { id: "ins-ledge", seccion: "otros", en: "Ledge labor", es: "Mano de obra de repisa", pago: 1, nota: "Stone" },
  { id: "ins-cola-madera", seccion: "otros", en: "Wood glue down install, 1.60 + .20 float", es: "Instalar madera pegada, 1.60 + .20", pago: 1.8 },
  { id: "ins-madera-flotante", seccion: "otros", en: "Wood floating install, 1.20 + .20 float", es: "Instalar madera flotante, 1.20 + .20", pago: 1.6 },
];

/** Extras (D15:D31): aparatos, entrega (gas, entrega, escaleras) y limpieza. Todos entran en D14. */
export const EXTRAS: ConceptoDeMano[] = [
  { id: "ap-taza-quitar", seccion: "aparatos", en: "Toilet pull, replace", es: "Quitar inodoro para reemplazo", pago: 30 },
  { id: "ap-taza-nueva", seccion: "aparatos", en: "Toilet install, new", es: "Instalar inodoro nuevo", pago: 45 },
  { id: "ap-electro", seccion: "aparatos", en: "Appliances", es: "Electrodomésticos", pago: 15 },
  { id: "ap-billar", seccion: "aparatos", en: "Pool table / piano", es: "Mesa de billar / piano", pago: 35 },
  { id: "ap-120", seccion: "aparatos", en: "Over 120 round trip + per M", es: "Más de 120 ida y vuelta + por M", pago: 1 },
  { id: "ap-triplay", seccion: "aparatos", en: "Install plywood on floor", es: "Instalar triplay en el piso", pago: 0.5 },
  { id: "ap-puertas", seccion: "aparatos", en: "Doors", es: "Puertas", pago: 25 },
  {
    id: "ent-gas", seccion: "entrega", en: "Round-trip gas to site if 45+ min", es: "Gas ida y vuelta si son 45+ min", pago: 0.5, formula: "gas",
    nota: "Quantity = 80 × laminate install days (C24)",
  },
  { id: "ent-entrega", seccion: "entrega", en: "Delivery", es: "Entrega", pago: 80, nota: "Depends on city and closest store" },
  { id: "ent-entrega-800", seccion: "entrega", en: "Delivery over 800 ft", es: "Entrega más de 800 ft", pago: 160, nota: "Depends on city and closest store" },
  {
    id: "escaleras", seccion: "entrega", en: "Each flight of stairs, −2 × SF", es: "Cada tramo de escaleras, −2 × SF", pago: 0.1, formula: "escaleras",
    nota: "Qty = steps. Sheet marks this formula **fix",
  },
  { id: "lim-recoleccion", seccion: "limpieza", en: "Trash collection", es: "Recolección de basura", pago: 0, nota: "Normally included in the job. Pay cell is blank in the sheet" },
  { id: "lim-tiro", seccion: "limpieza", en: "Trash dump", es: "Tiro de basura", pago: 0, nota: "Normally included in the job. Pay cell is blank in the sheet" },
  { id: "lim-cuadrilla", seccion: "limpieza", en: "Cleaning crew", es: "Cuadrilla de limpieza", pago: 0.3, nota: "Normally the customer does it or hires their own" },
];

// ---- FIN (sheet3, filas 3–37) ------------------------------------------------------------------------------------------

/** Las 35 filas de FIN: contado, tarjeta y 33 planes. `plazo: null` = fijo (la hoja calcula 1 / factor). */
export const PLANES: PlanFinanciero[] = [
  { plan: "Cash", fila: 3, forma: "All Upfront", calculo: "contado", descripcion: "", apr: 0, plazo: 0, factor: 0, descuento: 0 },
  { plan: "Credit Card", fila: 4, forma: "All Upfront", calculo: "tarjeta", descripcion: "Credit card, +4%", apr: 0, plazo: 0, factor: 0, descuento: 0 },
  { plan: "Plan 965", fila: 5, forma: "Reduced (Fixed Pmt)", calculo: "plan", descripcion: "11.99% APR Until Paid in Full", apr: 0.1199, plazo: null, factor: 0.0175, descuento: 0.045, restricciones: "ASK" },
  { plan: "Plan 964", fila: 6, forma: "Reduced (Fixed Pmt)", calculo: "plan", descripcion: "10.99% APR Until Paid in Full", apr: 0.1099, plazo: null, factor: 0.0175, descuento: 0.0565 },
  { plan: "Plan 920", fila: 7, forma: "Deferred (W/ Pmt)", calculo: "plan", descripcion: "No Monthly Interest if Paid in Full within 6 Months", apr: 0, plazo: 6, factor: 0.025, descuento: 0.06, restricciones: "Pre-selected promotions cannot have restrictions." },
  { plan: "Plan 992", fila: 8, forma: "Reduced (Fixed Pmt)", calculo: "plan", descripcion: "9.99% APR Until Paid in Full", apr: 0.0999, plazo: null, factor: 0.04, descuento: 0.0685 },
  { plan: "Plan 982", fila: 9, forma: "Reduced (Fixed Pmt)", calculo: "plan", descripcion: "9.99% APR Until Paid in Full", apr: 0.0999, plazo: null, factor: 0.03, descuento: 0.079 },
  { plan: "Plan 921", fila: 10, forma: "Deferred (W/ Pmt)", calculo: "plan", descripcion: "No Monthly Interest if Paid in Full within 9 Months", apr: 0, plazo: 9, factor: 0.025, descuento: 0.08 },
  { plan: "Plan 991", fila: 11, forma: "Reduced (Fixed Pmt)", calculo: "plan", descripcion: "7.99% APR Until Paid in Full", apr: 0.0799, plazo: null, factor: 0.04, descuento: 0.085 },
  { plan: "Plan 972", fila: 12, forma: "Reduced (Fixed Pmt)", calculo: "plan", descripcion: "9.99% APR Until Paid in Full", apr: 0.0999, plazo: null, factor: 0.02, descuento: 0.0855 },
  { plan: "Plan 922", fila: 13, forma: "Deferred (W/ Pmt)", calculo: "plan", descripcion: "No Monthly Interest if Paid in Full within 12 Months", apr: 0, plazo: 12, factor: 0.025, descuento: 0.0875, restricciones: "ASK" },
  { plan: "Plan 990", fila: 14, forma: "Reduced (Fixed Pmt)", calculo: "plan", descripcion: "5.99% APR Until Paid in Full", apr: 0.0599, plazo: null, factor: 0.04, descuento: 0.0875 },
  { plan: "Plan 981", fila: 15, forma: "Reduced (Fixed Pmt)", calculo: "plan", descripcion: "7.99% APR Until Paid in Full", apr: 0.0799, plazo: null, factor: 0.03, descuento: 0.0875 },
  { plan: "Plan 963", fila: 16, forma: "Reduced (Fixed Pmt)", calculo: "plan", descripcion: "9.99% APR Until Paid in Full", apr: 0.0999, plazo: null, factor: 0.0175, descuento: 0.0875 },
  { plan: "Plan 952", fila: 17, forma: "Reduced (Fixed Pmt)", calculo: "plan", descripcion: "9.99% APR Until Paid in Full", apr: 0.0999, plazo: null, factor: 0.015, descuento: 0.0915 },
  { plan: "Plan 923", fila: 18, forma: "Deferred (W/ Pmt)", calculo: "plan", descripcion: "No Monthly Interest if Paid in Full within 15 Months", apr: 0, plazo: 15, factor: 0.025, descuento: 0.092 },
  { plan: "Plan 924", fila: 19, forma: "Deferred (W/ Pmt)", calculo: "plan", descripcion: "No Monthly Interest if Paid in Full within 18 Months", apr: 0, plazo: 18, factor: 0.025, descuento: 0.095 },
  { plan: "Plan 971", fila: 20, forma: "Reduced (Fixed Pmt)", calculo: "plan", descripcion: "7.99% APR Until Paid in Full", apr: 0.0799, plazo: null, factor: 0.02, descuento: 0.095 },
  { plan: "Plan 980", fila: 21, forma: "Reduced (Fixed Pmt)", calculo: "plan", descripcion: "5.99% APR Until Paid in Full", apr: 0.0599, plazo: null, factor: 0.03, descuento: 0.095 },
  { plan: "Plan 943", fila: 22, forma: "Reduced (Fixed Pmt)", calculo: "plan", descripcion: "9.99% APR Until Paid in Full", apr: 0.0999, plazo: null, factor: 0.0125, descuento: 0.095 },
  { plan: "Plan 962", fila: 23, forma: "Reduced (Fixed Pmt)", calculo: "plan", descripcion: "7.99% APR Until Paid in Full", apr: 0.0799, plazo: null, factor: 0.0175, descuento: 0.1065 },
  { plan: "Plan 951", fila: 24, forma: "Reduced (Fixed Pmt)", calculo: "plan", descripcion: "7.99% APR Until Paid in Full", apr: 0.0799, plazo: null, factor: 0.015, descuento: 0.1175 },
  { plan: "Plan 925", fila: 25, forma: "Deferred (W/ Pmt)", calculo: "plan", descripcion: "No Monthly Interest if Paid in Full within 24 Months", apr: 0, plazo: 24, factor: 0.025, descuento: 0.1265, restricciones: "ASK" },
  { plan: "Plan 930", fila: 26, forma: "Equal (No Int)", calculo: "plan", descripcion: "25 Months No Monthly Interest Until Paid in Full", apr: 0, plazo: 25, factor: 0.04, descuento: 0.1265 },
  { plan: "Plan 970", fila: 27, forma: "Reduced (Fixed Pmt)", calculo: "plan", descripcion: "5.99% APR Until Paid in Full", apr: 0.0599, plazo: null, factor: 0.02, descuento: 0.1265 },
  { plan: "Plan 942", fila: 28, forma: "Reduced (Fixed Pmt)", calculo: "plan", descripcion: "7.99% APR Until Paid in Full", apr: 0.0799, plazo: null, factor: 0.0125, descuento: 0.1265 },
  { plan: "Plan 961", fila: 29, forma: "Reduced (Fixed Pmt)", calculo: "plan", descripcion: "5.99% APR Until Paid in Full", apr: 0.0599, plazo: null, factor: 0.0175, descuento: 0.144 },
  { plan: "Plan 950", fila: 30, forma: "Reduced (Fixed Pmt)", calculo: "plan", descripcion: "5.99% APR Until Paid in Full", apr: 0.0599, plazo: null, factor: 0.015, descuento: 0.1615 },
  { plan: "Plan 960", fila: 31, forma: "Reduced (Fixed Pmt)", calculo: "plan", descripcion: "3.99% APR Until Paid in Full", apr: 0.0399, plazo: null, factor: 0.0175, descuento: 0.1715 },
  { plan: "Plan 931", fila: 32, forma: "Equal (No Int)", calculo: "plan", descripcion: "36 Months No Monthly Interest Until Paid in Full", apr: 0, plazo: 36, factor: 0.0278, descuento: 0.175 },
  { plan: "Plan 941", fila: 33, forma: "Reduced (Fixed Pmt)", calculo: "plan", descripcion: "5.99% APR Until Paid in Full", apr: 0.0599, plazo: null, factor: 0.0125, descuento: 0.175 },
  { plan: "Plan 932", fila: 34, forma: "Equal (No Int)", calculo: "plan", descripcion: "48 Months No Monthly Interest Until Paid in Full", apr: 0, plazo: 48, factor: 0.0208, descuento: 0.1925 },
  { plan: "Plan 933", fila: 35, forma: "Equal (No Int)", calculo: "plan", descripcion: "60 Months No Monthly Interest Until Paid in Full", apr: 0, plazo: 60, factor: 0.0167, descuento: 0.2175 },
  { plan: "Plan 940", fila: 36, forma: "Reduced (Fixed Pmt)", calculo: "plan", descripcion: "3.99% APR Until Paid in Full", apr: 0.0399, plazo: null, factor: 0.0125, descuento: 0.2365 },
  { plan: "Plan 934", fila: 37, forma: "Equal (No Int)", calculo: "plan", descripcion: "72 Months No Monthly Interest Until Paid in Full", apr: 0, plazo: 72, factor: 0.0139, descuento: 0.2525 },
];

// ---- la plantilla del dueño ----------------------------------------------------------------------------------------------

/**
 * Las entradas de la plantilla que dan los valores guardados de la hoja: laminado 1700 SF de material, quitar azulejo
 * 1600, instalar laminado 1600, quitar inodoro 1, plan 922 en el desglose.
 */
export const PLANTILLA: Entradas = {
  cantidades: {
    laminado: 1700,
    "rem-azulejo": 1600,
    "ins-laminado": 1600,
    "ap-taza-quitar": 1,
  },
  precios: {},
  planDesglose: "Plan 922",
};

export function datosTurnkey(): DatosTurnkey {
  return {
    materiales: MATERIALES,
    removal: REMOCION,
    instalacion: INSTALACION,
    extras: EXTRAS,
    planes: PLANES,
    plantilla: PLANTILLA,
  };
}
