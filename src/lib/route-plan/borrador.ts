import { VERSION_DEL_MOTOR, type Plan } from "@/lib/route-engine";
import { matrizBase, planificaConTrafico, type Dependencias, type InformeDeTiempos } from "@/lib/route-times/tiempos";
import type { NamedLocation } from "@/lib/types";
import { entradaDelDia, filasDeParadas, type DatosDelDia, type EntradaDelDia, type FilaDeParada } from "./entrada";
import { escriturasAlPublicar, type EscrituraDeOrden } from "./publicar";

/**
 * Planificar el día y dejarlo en BORRADOR (D-320): de las filas de la base a lo que se guarda en
 * `route_plans` y `route_plan_stops`. No toca ninguna orden ni avisa a nadie.
 *
 * Aquí no hay base ni red: los datos del día llegan leídos, y la caché y los proveedores de tiempos llegan
 * inyectados. La ruta de servidor solo lee, llama a esto, y guarda lo que devuelve.
 */

export interface FilaDePlan {
  plan_date: string;
  source: "engine";
  algorithm_version: string;
  params: Record<string, unknown>;
  /** La foto: con esto y las paradas guardadas, EVALUAR el plan da otra vez las mismas horas. `ordenes` es
   *  contra lo que se compara al publicar. */
  input: { ordenes: EntradaDelDia["fotos"]; entrada: EntradaDelDia["entrada"]; puntos: EntradaDelDia["puntos"] };
  result: { coste: Plan["coste"]; sinAsignar: Plan["sinAsignar"]; explicaciones: Plan["explicaciones"]; partes: Plan["partes"]; fuera: EntradaDelDia["fuera"]; choferesFuera: EntradaDelDia["choferesFuera"]; tiempos: InformeDeTiempos; vueltas: number; traficoSinResolver: boolean };
  writes: EscrituraDeOrden[];
  provider: string;
  traffic: boolean;
  converged: boolean;
  total_minutes: number;
  total_miles: number;
  late_minutes: number;
  unassigned_count: number;
}

export interface Borrador { plan: FilaDePlan; paradas: FilaDeParada[] }

const PEOR: Record<InformeDeTiempos["proveedor"], number> = { cache: 0, google: 1, osrm: 2, estimado: 3 };

export async function planificaElDia(datos: DatosDelDia, fechaISO: string, zona: string, deps: Dependencias): Promise<Borrador> {
  const dia = entradaDelDia(datos);
  const base = await matrizBase(dia.puntos, deps);
  const entrada = { ...dia.entrada, matriz: base.matriz };
  const r = await planificaConTrafico(entrada, dia.parametros, fechaISO, dia.puntos, zona, deps);

  // De los dos informes, el PEOR proveedor: si hubo que estimar la matriz, el plan es estimado aunque el
  // tráfico saliera de Google.
  const proveedor = PEOR[r.informe.proveedor] > PEOR[base.informe.proveedor] ? r.informe.proveedor : base.informe.proveedor;
  const tiempos: InformeDeTiempos = {
    deCache: base.informe.deCache + r.informe.deCache, pedidos: base.informe.pedidos + r.informe.pedidos, proveedor,
    presupuestoAgotado: base.informe.presupuestoAgotado || r.informe.presupuestoAgotado,
  };
  const tiendas: readonly NamedLocation[] = datos.settings.stores ?? [];
  const guardada = { ...entrada, porHora: r.porHora };
  return {
    plan: {
      plan_date: fechaISO, source: "engine", algorithm_version: VERSION_DEL_MOTOR,
      params: { ...dia.parametros, ventanasDuras: datos.settings.route_hard_windows ?? null },
      input: { ordenes: dia.fotos, entrada: guardada, puntos: dia.puntos },
      result: { coste: r.plan.coste, sinAsignar: r.plan.sinAsignar, explicaciones: r.plan.explicaciones, partes: r.plan.partes, fuera: dia.fuera, choferesFuera: dia.choferesFuera, tiempos, vueltas: r.vueltas, traficoSinResolver: r.sinResolver },
      writes: escriturasAlPublicar(r.plan, entrada.choferes),
      provider: proveedor, traffic: Object.keys(r.porHora).length > 0, converged: r.plan.convergio,
      total_minutes: r.plan.rutas.reduce((s, x) => s + x.duracionMin, 0),
      total_miles: Math.round(r.plan.coste.millas * 100) / 100,
      late_minutes: r.plan.coste.tardeMin, unassigned_count: r.plan.sinAsignar.length + dia.fuera.length,
    },
    paradas: filasDeParadas(r.plan, entrada, dia.puntos, tiendas),
  };
}

/** Lo que la pantalla necesita saber de un plan, recién hecho o leído de la base: es la MISMA forma. */
export function resumenDelPlan(plan: Pick<FilaDePlan, "writes" | "result" | "total_minutes" | "total_miles" | "late_minutes" | "provider" | "traffic" | "converged">, paradas: number) {
  return {
    paradas, ordenes: plan.writes.length, sinAsignar: plan.result.sinAsignar, fuera: plan.result.fuera, choferesFuera: plan.result.choferesFuera,
    partes: plan.result.partes, minutos: plan.total_minutes, millas: Number(plan.total_miles), tarde: plan.late_minutes,
    proveedor: plan.provider, trafico: plan.traffic, convergio: plan.converged, tiempos: plan.result.tiempos,
    traficoSinResolver: !!plan.result.traficoSinResolver,
  };
}

/** Las paradas guardadas de un plan, como las rutas que entiende `avisosAlPublicar`. */
export function rutasDeParadas(paradas: readonly Pick<FilaDeParada, "driver_id" | "seq" | "kind" | "order_ref" | "eta">[]): { rutas: { chofer: string; paradas: { tipo: "P" | "D"; orden: string; llegada: number }[] }[] } {
  const porChofer = new Map<string, typeof paradas[number][]>();
  for (const p of paradas) porChofer.set(p.driver_id, [...(porChofer.get(p.driver_id) ?? []), p]);
  return {
    rutas: [...porChofer].sort(([a], [b]) => (a < b ? -1 : 1)).map(([chofer, ps]) => ({
      chofer, paradas: [...ps].sort((a, b) => a.seq - b.seq).map((p) => ({ tipo: p.kind, orden: p.order_ref, llegada: p.eta })),
    })),
  };
}

/** Los errores de `publish_route_plan`, por su prefijo: qué le pasó, y con qué código HTTP se cuenta. */
export function errorDePublicar(mensaje: string): { codigo: string; status: number; detalle: unknown } {
  const m = /ROUTE_PLAN_([A-Z_]+)(?::\s*(.*))?/.exec(mensaje);
  if (!m) return { codigo: "ERROR", status: 500, detalle: mensaje };
  let detalle: unknown = m[2] ?? null;
  if (m[1] === "STALE" && typeof detalle === "string") { try { detalle = JSON.parse(detalle); } catch { /* se deja como texto */ } }
  const status = ({ FORBIDDEN: 403, NOT_FOUND: 404, NOT_DRAFT: 409, STALE: 409, UNSEEN: 409, BAD_NOTICE: 400 } as Record<string, number>)[m[1]] ?? 500;
  return { codigo: m[1], status, detalle };
}
