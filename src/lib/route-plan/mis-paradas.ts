import { vistaDelPlan, type ParadaGuardada, type ParadaVista } from "./vista";

/**
 * Las paradas del chofer en el plan publicado (D-324), de lo que devuelve `my_published_stops` (134) a lo que
 * pinta «Mi ruta».
 *
 * Reusa `vistaDelPlan` para que «qué viaje es» y «con cuántos pallets llega» se decidan en UN sitio. Lo que la
 * función de la base no devuelve a propósito —minutos tarde, espera, tramo— aquí vale cero y NO se enseña: las
 * horas del plan son una estimación que nadie ha contrastado todavía con la realidad.
 */

export interface ParadaMia {
  plan_version: number; published_at: string | null; seq: number; kind: "P" | "D"; delivery_id: string | null; order_ref: string; label: string;
  place: string | null; window_start: number | null; window_end: number | null; is_hard: boolean; eta: number; etd: number; load_after: number | string;
}

export type MiParada = Pick<ParadaVista, "seq" | "kind" | "delivery_id" | "order_ref" | "label" | "place" | "window_start" | "window_end" | "is_hard" | "eta" | "etd" | "load_after" | "aBordoAlLlegar" | "viaje">;

export interface MiPlan { version: number; publishedAt: string | null; paradas: MiParada[]; entregas: number; viajes: number; inicio: number; fin: number }

export function misParadas(filas: readonly ParadaMia[]): MiPlan | null {
  if (!filas.length) return null;
  const guardadas = filas.map((f): ParadaGuardada => ({
    driver_id: "yo", driver_name: "", seq: f.seq, kind: f.kind, delivery_id: f.delivery_id ?? "", order_ref: f.order_ref, label: f.label, place: f.place,
    window_start: f.window_start, window_end: f.window_end, is_hard: f.is_hard, eta: f.eta, etd: f.etd, load_after: f.load_after as number,      // si llega como texto, `vistaDelPlan` lo convierte
    wait_min: 0, service_min: 0, late_min: 0, leg_minutes: 0, leg_miles: 0, pinned: false,
  }));
  const [ruta] = vistaDelPlan(guardadas, [], {});
  return {
    version: filas[0].plan_version, publishedAt: filas[0].published_at,
    paradas: ruta.paradas.map((p): MiParada => ({
      seq: p.seq, kind: p.kind, delivery_id: p.delivery_id, order_ref: p.order_ref, label: p.label, place: p.place, window_start: p.window_start,
      window_end: p.window_end, is_hard: p.is_hard, eta: p.eta, etd: p.etd, load_after: p.load_after, aBordoAlLlegar: p.aBordoAlLlegar, viaje: p.viaje,
    })),
    entregas: ruta.totales.entregas, viajes: ruta.totales.viajes, inicio: ruta.totales.inicio, fin: ruta.totales.fin,
  };
}
