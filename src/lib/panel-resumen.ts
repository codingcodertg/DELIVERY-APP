// ============================================================
// El resumen del Panel (D-1127). Roberto (gerente): «no se puede ver fácil la info para los managers». El Panel abre
// con lo que un gerente necesita de un vistazo: cómo va HOY, los indicadores del periodo contra el periodo anterior,
// la tendencia, y la comparación entre tiendas. Todo puro, para probarlo; las pantallas están en `components/panel/`.
//
// Qué mide cada cosa (para que el número se pueda explicar):
//  · Entregadas: órdenes del periodo en etapa «entregada».
//  · A tiempo (en su ventana): de las entregadas, cuántas se entregaron antes del fin de su ventana prometida
//    (`promisedDue` / `deliveredAtMs`, los mismos de la tendencia y de los KPIs de chofer).
//  · El día prometido: lo mismo, pero contando hasta el fin del día.
//  · Ciclo: horas de la creación de la orden a su entrega, MEDIANA (una orden atorada no mueve el número).
//  · Canceladas: % de las órdenes del periodo que terminaron canceladas.
//  · Cobros: tarifas de entrega de las no canceladas. Pallets: reales, o estimados si no hay reales.
// ============================================================

import { deliveredAtMs, promisedDue } from "./analytics";
import { sumaPallets } from "./pallets";
import { sumaDinero, sumaMillas } from "./totales";
import type { Delivery } from "./types";

export interface ResumenDelPeriodo {
  ordenes: number;
  entregadas: number;
  abiertas: number;
  vencidas: number;
  canceladas: number;
  canceladasPct: number | null;
  aTiempoPct: number | null;
  aTiempoDiaPct: number | null;
  cicloHoras: number | null;
  pallets: number;
  cobros: number;
  millas: number;
  reentregas: number;
}

const pct = (n: number, de: number) => (de ? Math.round((n / de) * 100) : null);
const mediana = (v: number[]) => {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const finDelDia = (iso: string) => new Date(iso + "T23:59:59").getTime();

export function resumenDelPeriodo(ordenes: readonly Delivery[], hoy: string): ResumenDelPeriodo {
  let entregadas = 0, canceladas = 0, abiertas = 0, vencidas = 0, reentregas = 0;
  let elegibles = 0, aTiempo = 0, aTiempoDia = 0;
  const ciclos: number[] = [];
  for (const d of ordenes) {
    if (d.redelivery_of) reentregas++;
    if (d.stage === "canceled") { canceladas++; continue; }
    if (d.stage !== "delivered") {
      if (d.stage !== "rejected") { abiertas++; if (d.delivery_date && d.delivery_date.slice(0, 10) < hoy) vencidas++; }
      continue;
    }
    entregadas++;
    const due = promisedDue(d), done = deliveredAtMs(d);
    if (due != null && done != null && d.delivery_date) {
      elegibles++;
      if (done <= due) aTiempo++;
      if (done <= finDelDia(d.delivery_date)) aTiempoDia++;
    }
    if (done != null && d.created_at) {
      const h = (done - new Date(d.created_at).getTime()) / 3_600_000;
      if (h >= 0) ciclos.push(h);
    }
  }
  const noCanceladas = ordenes.filter((d) => d.stage !== "canceled");
  const med = mediana(ciclos);
  return {
    ordenes: ordenes.length, entregadas, abiertas, vencidas, canceladas, reentregas,
    canceladasPct: pct(canceladas, ordenes.length),
    aTiempoPct: pct(aTiempo, elegibles),
    aTiempoDiaPct: pct(aTiempoDia, elegibles),
    cicloHoras: med == null ? null : Math.round(med * 10) / 10,
    pallets: sumaPallets(noCanceladas as Delivery[]),
    cobros: sumaDinero(noCanceladas, (d) => d.delivery_fee),
    millas: sumaMillas(noCanceladas, (d) => d.route_miles),
  };
}

/** Dinero para leer de un vistazo: sin centavos desde $1,000 y con separador de miles. */
export function dineroCorto(n: number, lang: string): string {
  const sinCentavos = Math.abs(n) >= 1000 || Number.isInteger(n);
  return "$" + n.toLocaleString(lang === "es" ? "es-MX" : "en-US", { minimumFractionDigits: sinCentavos ? 0 : 2, maximumFractionDigits: sinCentavos ? 0 : 2 });
}

/** Una serie larga, en a lo más `n` trozos (para los minigráficos): suma o promedio de cada trozo. */
export function enTrozos(valores: readonly (number | null)[], n: number, modo: "suma" | "media"): (number | null)[] {
  if (valores.length <= n) return [...valores];
  const tam = Math.ceil(valores.length / n);
  const out: (number | null)[] = [];
  for (let i = 0; i < valores.length; i += tam) {
    const v = valores.slice(i, i + tam).filter((x): x is number => x != null);
    out.push(!v.length ? null : modo === "suma" ? v.reduce((a, b) => a + b, 0) : v.reduce((a, b) => a + b, 0) / v.length);
  }
  return out;
}

// ---- Periodo anterior y comparación --------------------------------------------------------------------------------

const DIA = 86_400_000;
const aISO = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const deISO = (iso: string) => Date.parse(iso + "T12:00:00Z");

/**
 * El periodo contra el que se compara. Por defecto, la misma duración justo antes (30 días → los 30 previos).
 * `porMes` (el rango es «este mes» o un mes entero): los mismos días del mes anterior, que es como se compara un mes.
 */
export function periodoAnterior(from: string, to: string, porMes = false): { from: string; to: string } {
  if (porMes && from.slice(8, 10) === "01" && from.slice(0, 7) === to.slice(0, 7)) {
    const [y, m] = from.split("-").map(Number);
    const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1;
    const diasDelAnterior = new Date(Date.UTC(py, pm, 0)).getUTCDate();
    const finDeMes = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const dia = Number(to.slice(8, 10));
    const d = dia === finDeMes ? diasDelAnterior : Math.min(dia, diasDelAnterior);
    const p = (n: number) => String(n).padStart(2, "0");
    return { from: `${py}-${p(pm)}-01`, to: `${py}-${p(pm)}-${p(d)}` };
  }
  const dias = Math.round((deISO(to) - deISO(from)) / DIA) + 1;
  return { from: aISO(deISO(from) - dias * DIA), to: aISO(deISO(from) - DIA) };
}

export interface Cambio { valor: number; texto: string; sube: boolean }

/** Cambio contra el periodo anterior. `puntos`: la diferencia va en puntos (para porcentajes); si no, en %. */
export function cambio(actual: number | null, anterior: number | null, puntos = false): Cambio | null {
  if (actual == null || anterior == null) return null;
  if (puntos) {
    const v = Math.round((actual - anterior) * 10) / 10;
    return v === 0 ? null : { valor: v, texto: `${Math.abs(v)} ${Math.abs(v) === 1 ? "pt" : "pts"}`, sube: v > 0 };
  }
  if (anterior === 0) return null;
  const v = Math.round(((actual - anterior) / anterior) * 100);
  return v === 0 ? null : { valor: v, texto: `${Math.abs(v)}%`, sube: v > 0 };
}

// ---- La serie del periodo (para la gráfica y los minigráficos) ------------------------------------------------------

export type Grano = "dia" | "semana" | "mes";
export interface Cubeta {
  /** Primer día de la cubeta (YYYY-MM-DD). */
  inicio: string;
  clientes: number;
  traslados: number;
  entregadas: number;
  aTiempoPct: number | null;
  canceladas: number;
  ordenes: number;
  pallets: number;
  cobros: number;
  millas: number;
  cicloHoras: number | null;
}

export function granoDe(from: string, to: string): Grano {
  const dias = Math.round((deISO(to) - deISO(from)) / DIA) + 1;
  return dias <= 35 ? "dia" : dias <= 190 ? "semana" : "mes";
}
const lunes = (iso: string) => { const ms = deISO(iso); return aISO(ms - (((new Date(ms).getUTCDay() + 6) % 7) * DIA)); };
const inicioDe = (iso: string, g: Grano) => (g === "dia" ? iso : g === "semana" ? lunes(iso) : iso.slice(0, 7) + "-01");
const diaDe = (d: Delivery) => (d.delivery_date || d.input_date || d.created_at.slice(0, 10)).slice(0, 10);

export function seriePorPeriodo(
  ordenes: readonly Delivery[], from: string, to: string, esTraslado: (d: Delivery) => boolean, hoy: string,
): { grano: Grano; cubetas: Cubeta[] } {
  const grano = granoDe(from, to);
  const claves: string[] = [];
  for (let ms = deISO(from); ms <= deISO(to); ms += DIA) { const k = inicioDe(aISO(ms), grano); if (claves[claves.length - 1] !== k) claves.push(k); }
  const grupos = new Map<string, Delivery[]>(claves.map((k) => [k, []]));
  for (const d of ordenes) { const g = grupos.get(inicioDe(diaDe(d), grano)); if (g) g.push(d); }
  return {
    grano,
    cubetas: claves.map((inicio) => {
      const suyas = grupos.get(inicio) ?? [];
      const r = resumenDelPeriodo(suyas, hoy);
      const hechas = suyas.filter((d) => d.stage === "delivered");
      const traslados = hechas.filter(esTraslado).length;
      return { inicio, clientes: hechas.length - traslados, traslados, entregadas: r.entregadas, aTiempoPct: r.aTiempoPct, canceladas: r.canceladas,
        ordenes: r.ordenes, pallets: r.pallets, cobros: r.cobros, millas: r.millas, cicloHoras: r.cicloHoras };
    }),
  };
}

// ---- Hoy -----------------------------------------------------------------------------------------------------------

export const ETAPAS_DE_HOY = ["approved", "fulfilling", "ready", "picked_up", "delivered"] as const;
export interface HoyDelPanel {
  total: number;
  entregadas: number;
  porEtapa: { etapa: (typeof ETAPAS_DE_HOY)[number]; n: number }[];
  /** Lo que alguien tiene que mover: cada lista, con sus órdenes. */
  vencidas: Delivery[];
  sinChofer: Delivery[];
  porAprobar: Delivery[];
  palletsDeHoy: number;
}

const VIVAS = ["approved", "fulfilling", "ready", "picked_up"];

/** Cómo va el día, sin importar el rango elegido: lo de HOY por etapa y lo que está atorado (de cualquier fecha). */
export function hoyDelPanel(ordenes: readonly Delivery[], hoy: string): HoyDelPanel {
  const deHoy = ordenes.filter((d) => d.delivery_date?.slice(0, 10) === hoy && (ETAPAS_DE_HOY as readonly string[]).includes(d.stage));
  const porFecha = (a: Delivery, b: Delivery) => (a.delivery_date ?? "").localeCompare(b.delivery_date ?? "");
  return {
    total: deHoy.length,
    entregadas: deHoy.filter((d) => d.stage === "delivered").length,
    porEtapa: ETAPAS_DE_HOY.map((etapa) => ({ etapa, n: deHoy.filter((d) => d.stage === etapa).length })),
    vencidas: ordenes.filter((d) => VIVAS.includes(d.stage) && !!d.delivery_date && d.delivery_date.slice(0, 10) < hoy).sort(porFecha),
    sinChofer: ordenes.filter((d) => VIVAS.includes(d.stage) && !d.assigned_driver && !!d.delivery_date && d.delivery_date.slice(0, 10) >= hoy).sort(porFecha),
    porAprobar: ordenes.filter((d) => d.stage === "pending").sort(porFecha),
    palletsDeHoy: sumaPallets(deHoy as Delivery[]),
  };
}

// ---- Por tienda y por cuenta ---------------------------------------------------------------------------------------

export interface FilaDeGrupo extends ResumenDelPeriodo { clave: string }

export function resumenPor(ordenes: readonly Delivery[], claveDe: (d: Delivery) => string | null | undefined, hoy: string): FilaDeGrupo[] {
  const grupos = new Map<string, Delivery[]>();
  for (const d of ordenes) {
    const k = (claveDe(d) ?? "").trim() || "—";
    (grupos.get(k) ?? grupos.set(k, []).get(k)!).push(d);
  }
  return [...grupos].map(([clave, suyas]) => ({ clave, ...resumenDelPeriodo(suyas, hoy) }))
    .sort((a, b) => b.ordenes - a.ordenes || a.clave.localeCompare(b.clave));
}
