"use client";

import { useEffect, useState } from "react";
import type { MiPlan } from "./mis-paradas";
import type { RutaVista } from "./vista";

/**
 * El plan PUBLICADO de una fecha, leído UNA vez por fecha (D-NEXT): lo que hace falta para que las etiquetas P/D de una ruta
 * sean las del plan mientras la ruta siga siendo la que el plan escribió (`./lectura-de-ruta`).
 *
 * Dos lecturas, las dos ya existentes y cada una con lo que su rol puede leer:
 *   · quien despacha: `GET /api/route-plan?date=&status=published` (RLS de la 133);
 *   · el chofer: `GET /api/route-plan/mine?date=` (la función de la 134: solo SUS paradas).
 * Si no contesta, o no hay plan, es `null`: las pantallas leen la ruta como en D-334 y nada más cambia.
 */
export function usePlanPublicadoDelGestor(date: string | null): RutaVista[] | null {
  const [rutas, setRutas] = useState<RutaVista[] | null>(null);
  useEffect(() => {
    setRutas(null);
    if (!date) return;
    let vivo = true;
    fetch(`/api/route-plan?date=${encodeURIComponent(date)}&status=published`)
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => { if (vivo) setRutas(b?.ok && b.plan ? (b.plan.rutas as RutaVista[]) : null); })
      .catch(() => undefined);
    return () => { vivo = false; };
  }, [date]);
  return rutas;
}

export function usePlanPublicadoDelChofer(date: string): MiPlan | null {
  const [plan, setPlan] = useState<MiPlan | null>(null);
  useEffect(() => {
    let vivo = true;
    setPlan(null);
    fetch(`/api/route-plan/mine?date=${encodeURIComponent(date)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => { if (vivo) setPlan(b?.ok && b.plan ? (b.plan as MiPlan) : null); })
      .catch(() => undefined);
    return () => { vivo = false; };
  }, [date]);
  return plan;
}
