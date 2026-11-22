// ============================================================
// Warehouse · Llegadas (D-1125). La pantalla nueva de almacén: qué chofer pasa por la tienda, cuándo, qué DEJA y qué
// SE LLEVA, sacado de la ruta PUBLICADA del día (route_plan_stops). El dueño, 2026-11-21: «que los de warehouse elijan
// qué driver llegó y automáticamente el app les diga: en esta ruta el driver viene a dejar esta carga, márcala como
// recibida, y estas órdenes se va a llevar, dales ready».
//
// Reglas que salieron de la revisión con el dueño (todas aquí, puras, para poder probarlas):
//  · Una TIENDA toca a un chofer si recoge ahí (parada P en esa tienda) o le trae una intertienda (parada D cuyo destino
//    es esa tienda). Paradas seguidas en el tiempo (≤ 10 min) son UNA pasada.
//  · El dueño de una orden es su `assigned_driver` actual, no el del plan: si almacén la quita, deja de contar para ese
//    chofer (y su pasada se encoge o desaparece).
//  · Estado de cada chofer: «En la tienda» (dentro de una pasada + 15 min), «Viene para acá» (su siguiente parada es
//    esta tienda), «N paradas antes» o «Ya pasó».
//  · Asignar solo si el chofer está en la tienda ahora; quitar, siempre. La capacidad (10 pallets) solo avisa.
// ============================================================

import { formateadorDeFecha } from "./formateador";

export interface ParadaDeAlmacen {
  /** id de la orden (deliveries.id). */
  id: string;
  /** Chofer en el plan publicado. */
  dr: string;
  seq: number;
  k: "P" | "D";
  /** Tienda de la parada P (place); vacío en las D. */
  place: string;
  /** Minutos desde la medianoche. */
  eta: number;
  code: string;
  no: number;
  inv: string;
  type: string;
  from: string;
  to: string;
  pal: number;
  stage: string;
  win: string;
  city: string;
}

export type Dueno = (p: ParadaDeAlmacen) => string | null;

export const VENTANA_EN_TIENDA_MIN = 15;
export const JUNTAS_MIN = 10;

export const toca = (p: ParadaDeAlmacen, tienda: string) =>
  (p.k === "P" && p.place === tienda) || (p.k === "D" && p.type === "Intertienda" && p.to === tienda);

/** Paradas seguidas (≤ JUNTAS_MIN entre una y otra) = una pasada. Entra ordenado por hora. */
export function pasadas(hits: readonly ParadaDeAlmacen[]): ParadaDeAlmacen[][] {
  const g: ParadaDeAlmacen[][] = [];
  let last: ParadaDeAlmacen | null = null;
  for (const h of hits) {
    if (!last || h.eta - last.eta > JUNTAS_MIN) g.push([]);
    g[g.length - 1].push(h);
    last = h;
  }
  return g;
}

export interface ChoferEnTienda {
  dr: string;
  /** Todas sus paradas del día (de lo que hoy es suyo), por hora. */
  mias: ParadaDeAlmacen[];
  /** Las que tocan esta tienda. */
  aqui: ParadaDeAlmacen[];
  pasadas: ParadaDeAlmacen[][];
}

export function choferesDeLaTienda(paradas: readonly ParadaDeAlmacen[], tienda: string, dueno: Dueno): ChoferEnTienda[] {
  const nombres = Array.from(new Set(paradas.map((p) => p.dr)));
  const out: ChoferEnTienda[] = [];
  for (const dr of nombres) {
    const mias = paradas.filter((p) => dueno(p) === dr).sort((a, b) => a.eta - b.eta || a.seq - b.seq);
    const aqui = mias.filter((p) => toca(p, tienda));
    if (!aqui.length) continue;
    out.push({ dr, mias, aqui, pasadas: pasadas(aqui) });
  }
  return out;
}

export type EstadoDelChofer =
  | { tipo: "aqui"; rank: 0 }
  | { tipo: "viene"; rank: 1; min: number; llega: number }
  | { tipo: "antes"; rank: 2; paradas: number; llega: number }
  | { tipo: "paso"; rank: 3 };

export function estadoDelChofer(c: ChoferEnTienda, tienda: string, ahora: number): EstadoDelChofer {
  if (c.aqui.some((h) => ahora >= h.eta && ahora <= h.eta + VENTANA_EN_TIENDA_MIN)) return { tipo: "aqui", rank: 0 };
  const sig = c.aqui.find((h) => h.eta > ahora);
  if (!sig) return { tipo: "paso", rank: 3 };
  const antes = c.mias.filter((x) => x.eta > ahora && x.eta < sig.eta && !toca(x, tienda)).length;
  return antes === 0 ? { tipo: "viene", rank: 1, min: sig.eta - ahora, llega: sig.eta } : { tipo: "antes", rank: 2, paradas: antes, llega: sig.eta };
}

/** Los choferes en el orden de la lista: primero el que está aquí, luego el que viene, luego por hora. */
export function ordenaChoferes(cs: readonly ChoferEnTienda[], tienda: string, ahora: number) {
  return cs.map((c) => ({ c, e: estadoDelChofer(c, tienda, ahora) }))
    .sort((a, b) => a.e.rank - b.e.rank || a.c.aqui[0].eta - b.c.aqui[0].eta);
}

/** La pasada más cercana a la hora actual (la que se abre por defecto). */
export function pasadaMasCercana(c: ChoferEnTienda, ahora: number): number | null {
  let best: { d: number; t: number } | null = null;
  for (const g of c.pasadas) {
    const d = Math.abs(g[0].eta - ahora);
    if (!best || d < best.d) best = { d, t: g[0].eta };
  }
  return best ? best.t : null;
}

/** Lo más cargado que va el camión en el día: suma al recoger, resta al entregar. `extra`: una orden más que se
 *  le asignaría (con sus dos paradas). */
export function picoDeCarga(paradas: readonly ParadaDeAlmacen[], dr: string, dueno: Dueno, extra?: string): number {
  const ev = paradas
    .filter((p) => dueno(p) === dr || p.id === extra)
    .map((p) => [p.eta, p.k === "P" ? p.pal : -p.pal, p.k === "P" ? 1 : 0] as const)
    .sort((a, b) => a[0] - b[0] || a[2] - b[2]);
  let cur = 0, max = 0;
  for (const e of ev) { cur += e[1]; max = Math.max(max, cur); }
  return Math.round(max * 10) / 10;
}

export const hhmm = (m: number) => {
  const h = Math.floor(m / 60);
  return (h > 12 ? h - 12 : h === 0 ? 12 : h) + ":" + String(m % 60).padStart(2, "0") + (h >= 12 ? " pm" : " am");
};

/** Minutos desde la medianoche de una fecha en la hora de las tiendas. */
export function minutosDeHoy(d: Date, tz = "America/Chicago"): number {
  const p = formateadorDeFecha("en-US", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
  const h = Number(p.find((x) => x.type === "hour")?.value ?? 0) % 24;
  const m = Number(p.find((x) => x.type === "minute")?.value ?? 0);
  return h * 60 + m;
}
