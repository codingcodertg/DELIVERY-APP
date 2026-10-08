import { vistaDelPlan, type ParadaGuardada, type ParadaVista } from "./vista";

/**
 * Las paradas del chofer en el plan publicado (D-324), de lo que devuelve `my_published_stops` (134) a lo que
 * pinta «Mi ruta».
 *
 * Reusa `vistaDelPlan` para que «con cuántos pallets llega» se decida en UN sitio (hasta D-443, también «qué viaje es»:
 * ya no hay viajes). Lo que la
 * función de la base no devuelve a propósito —minutos tarde, espera, tramo— aquí vale cero y NO se enseña: las
 * horas del plan son una estimación que nadie ha contrastado todavía con la realidad.
 */

export interface ParadaMia {
  plan_version: number; published_at: string | null; seq: number; kind: "P" | "D"; delivery_id: string | null; order_ref: string; label: string;
  place: string | null; window_start: number | null; window_end: number | null; is_hard: boolean; eta: number; etd: number; load_after: number | string;
}

export type MiParada = Pick<ParadaVista, "seq" | "kind" | "delivery_id" | "order_ref" | "label" | "place" | "window_start" | "window_end" | "is_hard" | "eta" | "etd" | "load_after" | "aBordoAlLlegar">;

export interface MiPlan { version: number; publishedAt: string | null; paradas: MiParada[]; entregas: number; inicio: number; fin: number }

/**
 * Las paradas de OTRO chofer en el plan publicado, para la pestaña «Chofer» del admin (D-502), que pinta «Mi ruta» de un
 * chofer elegido. `/api/route-plan/mine` no sirve: filtra por quien llama (134) y al admin le daría cero filas.
 *
 * Sale de lo que ya lee quien despacha (`GET /api/route-plan?status=published`, RLS de la 133: admin y logística) y pasa
 * por el MISMO `misParadas` que la ruta del chofer, con las mismas columnas que devuelve `my_published_stops` (el orden por
 * `seq` lo pone `vistaDelPlan` dentro, como para el chofer). Así lo que ve el admin es lo que ve el chofer, decidido en un
 * solo sitio, y no una lectura parecida.
 */
export function planDeOtroChofer(
  respuesta: { ok?: boolean; plan?: { version: number; published_at: string | null; rutas?: readonly { choferId: string; paradas: readonly ParadaGuardada[] }[] } | null } | null | undefined,
  choferId: string,
): MiPlan | null {
  const plan = respuesta?.ok ? respuesta.plan : null;
  const ruta = plan?.rutas?.find((r) => r.choferId === choferId);
  if (!plan || !ruta) return null;
  return misParadas(ruta.paradas.map((p): ParadaMia => ({
    plan_version: plan.version, published_at: plan.published_at, seq: p.seq, kind: p.kind, delivery_id: p.delivery_id,
    order_ref: p.order_ref, label: p.label, place: p.place, window_start: p.window_start, window_end: p.window_end,
    is_hard: p.is_hard, eta: p.eta, etd: p.etd, load_after: p.load_after,
  })));
}

/** De dónde lee «Mi ruta» su plan publicado: el chofer, `/mine`; mirando la de otro (`deOtro`, D-502), el publicado entero. */
export function urlDelPlanPublicado(date: string, deOtro: string | null): string {
  const d = encodeURIComponent(date);
  return deOtro ? `/api/route-plan?date=${d}&status=published` : `/api/route-plan/mine?date=${d}`;
}

/** Y qué saca de la respuesta: el plan tal cual llega de `/mine`, o las paradas de ese chofer en el publicado entero. */
export function planDeLaRespuesta(b: unknown, deOtro: string | null): MiPlan | null {
  if (deOtro) return planDeOtroChofer(b as Parameters<typeof planDeOtroChofer>[0], deOtro);
  const r = b as { ok?: boolean; plan?: MiPlan | null } | null | undefined;
  return r?.ok && r.plan ? r.plan : null;
}

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
      window_end: p.window_end, is_hard: p.is_hard, eta: p.eta, etd: p.etd, load_after: p.load_after, aBordoAlLlegar: p.aBordoAlLlegar,
    })),
    entregas: ruta.totales.entregas, inicio: ruta.totales.inicio, fin: ruta.totales.fin,
  };
}
