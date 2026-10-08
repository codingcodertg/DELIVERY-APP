"use client";

import { useEffect, useState } from "react";
import { planDeLaRespuesta, urlDelPlanPublicado, type MiPlan } from "./mis-paradas";
import type { RutaVista } from "./vista";

/**
 * El plan PUBLICADO de una fecha, leído UNA vez por fecha (D-335): lo que hace falta para que las etiquetas P/D de una ruta
 * sean las del plan mientras la ruta siga siendo la que el plan escribió (`./lectura-de-ruta`).
 *
 * Dos lecturas, las dos ya existentes y cada una con lo que su rol puede leer:
 *   · quien despacha: `GET /api/route-plan?date=&status=published` (RLS de la 133);
 *   · el chofer: `GET /api/route-plan/mine?date=` (la función de la 134: solo SUS paradas).
 * El Gestor relee también cuando «Plan del día» publica en la misma página (`publicaciones`): es justo cuando más se mira
 * la tabla. El chofer se entera al volver a entrar en «Mi ruta».
 * Si no contesta, o no hay plan, es `null`: las pantallas leen la ruta como en D-334 y nada más cambia.
 */
export function usePlanPublicadoDelGestor(date: string | null, publicaciones: number): RutaVista[] | null {
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
  }, [date, publicaciones]);
  return rutas;
}

/**
 * `deOtro` (D-502): el id del chofer cuya ruta se mira desde la pestaña «Chofer» del admin. Entonces no vale `/mine`
 * (devuelve las de quien llama: ninguna) y se lee el publicado entero, como el Gestor, y de ahí sus paradas
 * (`planDeOtroChofer`, que pasa por el mismo `misParadas`). Sin `deOtro` —el chofer en su teléfono— es lo de siempre.
 * Qué se pide y qué se saca lo deciden `urlDelPlanPublicado` y `planDeLaRespuesta` (`./mis-paradas`, con sus pruebas).
 */
export function usePlanPublicadoDelChofer(date: string, deOtro: string | null = null): MiPlan | null {
  const [plan, setPlan] = useState<MiPlan | null>(null);
  useEffect(() => {
    let vivo = true;
    setPlan(null);
    fetch(urlDelPlanPublicado(date, deOtro))
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => { if (vivo) setPlan(planDeLaRespuesta(b, deOtro)); })
      .catch(() => undefined);
    return () => { vivo = false; };
  }, [date, deOtro]);
  return plan;
}
