/**
 * El paso b de un relevo NUNCA antes de que llegue el paso a (D-994).
 *
 * Roberto, 2026-11-09 (Gestor de Rutas → Rutas, con «Repartir órdenes» abierto): «Will undo relays, need to make sure that it
 * doesnt put B before A. Maybe for safety have an hour gap between them to make sure A arrives before». En su captura, el paso
 * b (Tr-149025-b) se recogía en RDZ Weslaco a las 14:44 mientras el paso a llegaba a Weslaco más tarde: ni el motor ni
 * Optimizar sabían que la carga del paso b no está en la tienda de relevo hasta que el paso a la deja.
 *
 * La regla: la recogida del paso b empieza, como pronto, a la hora estimada en que el paso a llega a la tienda de relevo MÁS
 * `MARGEN_DEL_RELEVO_MIN` (una hora, la que pidió). Si el paso a ya se entregó, no hay espera. Si el paso a no tiene hora
 * (no está en ninguna ruta medida), no se inventa una: la pantalla avisa.
 *
 * Esto es la regla sin pantalla: la usan Optimizar, «Repartir órdenes» y el aviso de la tarjeta.
 */
import { esPasoDeRelevo } from "./relevo-etiqueta";

/** Lo que se deja, como mínimo, entre que el paso a llega a la tienda de relevo y que el paso b empieza a recogerse. */
export const MARGEN_DEL_RELEVO_MIN = 60;

export interface PasoParaElRelevo {
  id: string;
  order_no: number | string | null;
  relay_step?: number | null;
  is_training?: boolean | null;
  stage?: string | null;
}

const YA_ENTREGADO = new Set(["delivered"]);
const YA_RECOGIDO = new Set(["picked_up", "delivered", "canceled"]);

/** Para cada paso b (o c…) aún sin recoger, su paso anterior. Solo dentro de lo que se pasa (las órdenes del día). */
export function pasoAnteriorPorId<T extends PasoParaElRelevo>(ordenes: readonly T[]): Map<string, T> {
  const porFamilia = new Map<string, T[]>();
  for (const d of ordenes) {
    if (!esPasoDeRelevo(d) || d.order_no == null) continue;
    const k = `${d.is_training ? "t" : "r"}:${d.order_no}`;
    const l = porFamilia.get(k);
    if (l) l.push(d); else porFamilia.set(k, [d]);
  }
  const out = new Map<string, T>();
  for (const pasos of porFamilia.values()) {
    for (const d of pasos) {
      const n = d.relay_step ?? 0;
      if (n <= 1 || YA_RECOGIDO.has(d.stage ?? "")) continue;
      const a = pasos.find((x) => (x.relay_step ?? 0) === n - 1);
      if (a) out.set(d.id, a);
    }
  }
  return out;
}

/**
 * Desde qué minuto se puede empezar a recoger cada paso b: la llegada estimada del paso a + el margen. `etaDeEntrega(id)`
 * da la llegada del paso a en minutos desde la medianoche (o `null` si no tiene hora). Un paso a ya entregado no pone espera.
 */
export function recogidaDesdeDelRelevo<T extends PasoParaElRelevo>(
  ordenes: readonly T[], etaDeEntrega: (id: string) => number | null, margen: number = MARGEN_DEL_RELEVO_MIN,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const [b, a] of pasoAnteriorPorId(ordenes)) {
    if (YA_ENTREGADO.has(a.stage ?? "")) continue;
    const eta = etaDeEntrega(a.id);
    if (eta != null && Number.isFinite(eta)) out.set(b, eta + margen);
  }
  return out;
}

export interface RelevoAntesDeTiempo {
  /** El paso b, que se recoge demasiado pronto (o sin saber cuándo llega el a). */
  paso: string;
  /** El paso a. */
  anterior: string;
  /** Minutos: cuándo se recoge el b, cuándo llega el a (`null`: el a no tiene hora en ninguna ruta). */
  recogida: number;
  llegadaDelAnterior: number | null;
}

/**
 * Los pasos b cuya recogida estimada cae ANTES de que llegue su paso a + el margen, o cuyo paso a no tiene hora. Para el
 * aviso rojo de la tarjeta de la ruta. `etaDeRecogida(id)`: la hora estimada de la recogida del b, o `null` si no tiene.
 */
export function relevosAntesDeTiempo<T extends PasoParaElRelevo>(
  ordenes: readonly T[], etaDeRecogida: (id: string) => number | null, etaDeEntrega: (id: string) => number | null,
  margen: number = MARGEN_DEL_RELEVO_MIN,
): RelevoAntesDeTiempo[] {
  const out: RelevoAntesDeTiempo[] = [];
  for (const [b, a] of pasoAnteriorPorId(ordenes)) {
    if (YA_ENTREGADO.has(a.stage ?? "")) continue;
    const recogida = etaDeRecogida(b);
    if (recogida == null) continue;
    const llegada = etaDeEntrega(a.id);
    if (llegada == null || recogida < llegada + margen) out.push({ paso: b, anterior: a.id, recogida, llegadaDelAnterior: llegada });
  }
  return out;
}

/** «HH:MM» → minutos desde la medianoche, o `null`. */
export function minutosDeHora(hhmm: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec((hhmm ?? "").trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Las horas estimadas de todas las rutas del Gestor: `etas[ruta][clave]` = «HH:MM». La clave de una entrega es su id; la de
 *  una recogida, «P:» + las órdenes de esa visita (`claveDeRecogida`). */
export type EtasDelGestor = Readonly<Record<string, Readonly<Record<string, string>> | undefined>>;

/** La llegada estimada de la ENTREGA de `id`, en la ruta que la lleve. */
export function etaDeEntregaEn(etas: EtasDelGestor, id: string): number | null {
  for (const r of Object.values(etas)) {
    const v = r?.[id];
    if (v) return minutosDeHora(v);
  }
  return null;
}

/** La hora estimada de la RECOGIDA de `id`: la de la visita a la tienda que la incluye. */
export function etaDeRecogidaEn(etas: EtasDelGestor, id: string): number | null {
  for (const r of Object.values(etas)) {
    if (!r) continue;
    for (const [clave, v] of Object.entries(r)) {
      if (clave.startsWith("P:") && clave.slice(2).split(",").includes(id)) return minutosDeHora(v);
    }
  }
  return null;
}

/** Las órdenes del motor con la espera del relevo puesta (`recogidaDesde`), sin tocar las demás. */
export function conRecogidaDesde<O extends { id: string; recogidaDesde?: number | null }>(ordenes: readonly O[], desde: ReadonlyMap<string, number>): O[] {
  return ordenes.map((o) => (desde.has(o.id) ? { ...o, recogidaDesde: Math.max(o.recogidaDesde ?? -Infinity, desde.get(o.id)!) } : o));
}

/** La primera llegada de cada ENTREGA de un plan del motor, por orden (las partes «id#a» cuentan para su orden). */
export function llegadasDelPlan(rutas: readonly { paradas: readonly { orden: string; tipo: "P" | "D"; llegada: number }[] }[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rutas) for (const p of r.paradas) {
    if (p.tipo !== "D") continue;
    const id = p.orden.split("#")[0];
    const v = out.get(id);
    if (v == null || p.llegada < v) out.set(id, p.llegada);
  }
  return out;
}
