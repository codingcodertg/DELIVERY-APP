/**
 * KPIs de almacén (vista «KPIs de almacén» / «Warehouse KPIs»): todo el cálculo, puro. Sin React, sin base, sin reloj
 * (el «hoy» entra como parámetro). Lo usan la ruta del servidor (`/api/almacen-ops/kpi-almacen`), la pantalla y las
 * pruebas. La regla de cada número va al lado de su función.
 *
 * 1. Listas a tiempo (entregas). Una orden cuenta BUENA si el almacén la marcó «lista» antes de que el chofer la
 *    recogiera (la misma regla que `kpi-entregas.ts`: último `ready` estrictamente antes del primer `picked_up`). Si
 *    no está lista (marcada tarde o nunca), cuenta MALA, SALVO la excepción: si la orden se creó a menos de 4 horas
 *    antes de su recogida, la falta NO cuenta contra el almacén y sale del denominador. Órdenes nunca recogidas: no
 *    cuentan (igual que en el KPI de entregas). Un solo porcentaje: buenas / (buenas + malas).
 *
 * 2. Merma. Valor de la merma del mes a precio de VENTA (`warehouse_reports.total_loss`, que ya se congela con
 *    `erp.products.price`, migración 272) como % de las ventas netas del mes de esa tienda (`erp.sales_history`).
 *    Meta: menos de 0.5 %. Sin ventas para esa tienda y mes → «sin datos de ventas», nunca un número inventado.
 *
 * 3. Tiempo (turnos de fichaje del personal de almacén de la tienda). Métrica: % de turnos fichados bien = turnos del
 *    mes con salida fichada por la propia persona (no automática, no corregida a mano) / todos los turnos del mes.
 *    También se muestran las horas trabajadas del mes (ya cerradas, menos la comida).
 *
 * 4. Bono. Puntaje general = promedio de los KPI que tengan dato, cada uno en 0–100: listas a tiempo = su %;
 *    tiempo = su %; merma = 100 si cumple la meta, 0 si no. Tramos: 100 → completo; ≥ 95 → medio; ≥ 90 → cuarto;
 *    menos de 90 → ninguno. Sin ningún KPI con dato, sin puntaje ni bono.
 */
import { evaluarOrdenes, type EntregaDelKpi, type EventoDeOrden } from "./kpi-entregas";

/** Una orden creada a menos de esto antes de su recogida no cuenta contra el almacén. */
export const UMBRAL_DE_EXCEPCION_MS = 4 * 3_600_000;
/** Meta de merma: % de las ventas netas del mes. Se cumple con MENOS de esto (0.5 exacto no cumple). */
export const META_DE_MERMA_PCT = 0.5;

// ---------------------------------------------------------------------------------------------------------------------
// Meses y fechas
// ---------------------------------------------------------------------------------------------------------------------

const ES_MES = (s: string) => /^\d{4}-\d{2}$/.test(s);
const ES_DIA = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Del mes `YYYY-MM` a su primer y último día (`YYYY-MM-DD`). Null si el mes no es válido. */
export function rangoDelMes(mes: string): { desde: string; hasta: string } | null {
  if (!ES_MES(mes)) return null;
  const [a, m] = mes.split("-").map(Number);
  if (m < 1 || m > 12) return null;
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return { desde: `${mes}-01`, hasta: `${mes}-${String(ultimo).padStart(2, "0")}` };
}

/** Los últimos `n` meses (incluido el de `hoy`), del más reciente al más antiguo. `hoy` es un día `YYYY-MM-DD`. */
export function mesesHastaHoy(hoy: string, n = 12): string[] {
  if (!ES_DIA(hoy)) return [];
  const [a, m] = hoy.split("-").map(Number);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const f = new Date(Date.UTC(a, m - 1 - i, 1));
    out.push(`${f.getUTCFullYear()}-${String(f.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

/** Truncado (no redondeo) a `d` decimales: un 0.4996 % se muestra 0.49, nunca 0.50 en verde/rojo contradictorio. */
export function truncaDecimales(n: number, d: number): number {
  const f = 10 ** d;
  return Math.floor(n * f + 1e-9) / f;
}

// ---------------------------------------------------------------------------------------------------------------------
// 1. Listas a tiempo
// ---------------------------------------------------------------------------------------------------------------------

/** Una entrega con la hora en que se creó (`deliveries.created_at`), para la excepción de las 4 horas. */
export type EntregaParaListas = EntregaDelKpi & { created_at: string | null };

/**
 * ¿Aplica la excepción? Sí si la orden se creó a menos de 4 horas antes de su recogida (estrictamente menos: exactamente
 * 4 horas NO aplica). Sin fecha de creación no hay con qué medirla: no aplica. Una orden creada DESPUÉS de la recogida
 * también aplica (tampoco hubo tiempo).
 */
export function aplicaExcepcion(creadaEn: string | null | undefined, recogidaEn: string): boolean {
  if (!creadaEn) return false;
  const creada = Date.parse(creadaEn), recogida = Date.parse(recogidaEn);
  if (!Number.isFinite(creada) || !Number.isFinite(recogida)) return false;
  return recogida - creada < UMBRAL_DE_EXCEPCION_MS;
}

export interface ListasAntesDeRecoger {
  buenas: number;
  malas: number;
  /** No lista, pero por la excepción de las 4 horas: fuera del denominador. */
  excluidas: number;
  /** Órdenes recogidas en el mes (buenas + malas + excluidas). */
  recogidas: number;
  /** buenas / (buenas + malas) × 100, sin redondear. Null si no hay ninguna que medir. */
  pct: number | null;
}

/**
 * Evalúa las órdenes recogidas en el mes. Reusa la regla de `kpi-entregas` (último `ready` vs. primer `picked_up`) y
 * le agrega la excepción con la hora de creación de cada orden.
 */
export function listasAntesDeRecoger(
  entregas: readonly EntregaParaListas[],
  eventos: readonly EventoDeOrden[],
  mes: { desde: string; hasta: string },
): ListasAntesDeRecoger {
  const creadaDe = new Map(entregas.map((e) => [e.id, e.created_at]));
  const ordenes = evaluarOrdenes(entregas, eventos, mes);
  let buenas = 0, malas = 0, excluidas = 0;
  for (const o of ordenes) {
    if (o.aTiempo) buenas++;
    else if (aplicaExcepcion(creadaDe.get(o.id), o.recogidaEn)) excluidas++;
    else malas++;
  }
  const medidas = buenas + malas;
  return { buenas, malas, excluidas, recogidas: ordenes.length, pct: medidas > 0 ? (buenas / medidas) * 100 : null };
}

// ---------------------------------------------------------------------------------------------------------------------
// 2. Merma
// ---------------------------------------------------------------------------------------------------------------------

export interface ResultadoDeMerma {
  /** Valor de la merma del mes, a precio de venta. */
  valor: number;
  /** Ventas netas del mes de la tienda; null = sin datos de ventas. */
  ventas: number | null;
  /** valor / ventas × 100, sin redondear. Null sin ventas (o ventas en cero). */
  pct: number | null;
  /** pct < 0.5. Null sin pct. */
  cumple: boolean | null;
}

/** Merma del mes sobre ventas del mes. Sin ventas (null, NaN o cero) no hay porcentaje: nunca se inventa. */
export function resultadoDeMerma(valor: number, ventas: number | null | undefined): ResultadoDeMerma {
  const v = typeof valor === "number" && Number.isFinite(valor) ? valor : 0;
  if (ventas === null || ventas === undefined || !Number.isFinite(ventas) || ventas <= 0) {
    return { valor: v, ventas: null, pct: null, cumple: null };
  }
  const pct = (v / ventas) * 100;
  return { valor: v, ventas, pct, cumple: pct < META_DE_MERMA_PCT };
}

// ---------------------------------------------------------------------------------------------------------------------
// 3. Tiempo (fichaje)
// ---------------------------------------------------------------------------------------------------------------------

export interface ResultadoDeTiempo {
  turnos: number;
  /** Fichados bien: salida fichada por la persona (no automática, no corregida a mano). */
  bien: number;
  /** bien / turnos × 100, sin redondear. Null sin turnos. */
  pct: number | null;
}

export function resultadoDeTiempo(turnos: number, bien: number): ResultadoDeTiempo {
  const t = Math.max(0, Math.trunc(turnos || 0));
  const b = Math.min(t, Math.max(0, Math.trunc(bien || 0)));
  return { turnos: t, bien: b, pct: t > 0 ? (b / t) * 100 : null };
}

// ---------------------------------------------------------------------------------------------------------------------
// 4. Puntaje y bono
// ---------------------------------------------------------------------------------------------------------------------

export interface PuntajesDelMes {
  /** % de listas a tiempo (0–100), o null sin dato. */
  listas: number | null;
  /** % de fichajes bien (0–100), o null sin dato. */
  tiempo: number | null;
  /** Cumple la meta de merma, o null sin ventas. */
  merma: boolean | null;
}

/** Puntaje general: promedio de los KPI con dato, cada uno en 0–100 (merma: 100 si cumple, 0 si no). Null sin ninguno. */
export function puntajeGeneral(p: PuntajesDelMes): number | null {
  const xs: number[] = [];
  if (p.listas !== null && Number.isFinite(p.listas)) xs.push(p.listas);
  if (p.tiempo !== null && Number.isFinite(p.tiempo)) xs.push(p.tiempo);
  if (p.merma !== null) xs.push(p.merma ? 100 : 0);
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export type NivelDeBono = "completo" | "medio" | "cuarto" | "ninguno";

/** Tramo del bono: 100 completo; ≥ 95 medio; ≥ 90 cuarto; menos de 90 ninguno. Sin puntaje, null (no hay tramo). */
export function nivelDeBono(puntaje: number | null): NivelDeBono | null {
  if (puntaje === null || !Number.isFinite(puntaje)) return null;
  if (puntaje >= 100) return "completo";
  if (puntaje >= 95) return "medio";
  if (puntaje >= 90) return "cuarto";
  return "ninguno";
}
