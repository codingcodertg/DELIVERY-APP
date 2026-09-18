"use client";

import { useEffect, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { horaDeReloj } from "@/lib/route-plan/vista";
import type { MiPlan } from "@/lib/route-plan/mis-paradas";

/**
 * El orden del día del chofer según el plan publicado (D-324): recogidas y entregas en secuencia, con su
 * ventana y una hora ESTIMADA. Solo lectura, como todo «Mi ruta» (D-021).
 *
 * Las horas van con «≈» y la palabra «estimado», y aquí NO hay minutos tarde ni nada en rojo: son horas del
 * plan que nadie ha contrastado todavía con la realidad. Cuando el reporte de precisión diga cuánto se
 * equivocan, se decide si se enseñan de otra forma.
 *
 * Si no hay plan publicado —o la base aún no tiene la función— no pinta nada: «Mi ruta» sigue igual.
 */

export function MiPlanPublicado({ date, nombreDeOrden }: { date: string; nombreDeOrden: (deliveryId: string | null, ref: string) => string }) {
  const { t } = usePrefs();
  const [plan, setPlan] = useState<MiPlan | null>(null);
  const [abierto, setAbierto] = useState(false);

  useEffect(() => {
    let vivo = true;
    setPlan(null);
    fetch(`/api/route-plan/mine?date=${encodeURIComponent(date)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((b) => { if (vivo) setPlan(b?.ok && b.plan ? (b.plan as MiPlan) : null); })
      .catch(() => undefined);
    return () => { vivo = false; };
  }, [date]);

  if (!plan) return null;
  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <button type="button" className="btn btn-ghost btn-sm" style={{ width: "100%", justifyContent: "flex-start", gap: 8, flexWrap: "wrap" }} onClick={() => setAbierto((a) => !a)}>
        <span>{abierto ? "▾" : "▸"}</span>
        <b>{t("Planned order of the day", "Orden planeado del día")}</b>
        <span className="hint" style={{ margin: 0 }}>
          {plan.entregas} {t("deliveries", "entregas")}{plan.viajes > 1 && ` · ${plan.viajes} ${t("truckloads", "viajes")}`} · ≈ {horaDeReloj(plan.inicio)}–{horaDeReloj(plan.fin)} ({t("estimated", "estimado")})
        </span>
      </button>
      {abierto && (
        <>
          <ol style={{ margin: "8px 0 0", paddingLeft: 0, listStyle: "none", display: "grid", gap: 6 }}>
            {plan.paradas.map((p, k) => (
              <li key={p.seq} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "baseline", borderTop: k > 0 && plan.paradas[k - 1].viaje !== p.viaje ? "2px solid var(--amber)" : undefined, paddingTop: k > 0 && plan.paradas[k - 1].viaje !== p.viaje ? 6 : 0 }}>
                <b style={{ minWidth: 34 }}>{p.label}</b>
                <span>{p.kind === "P" ? t("Pick up", "Recoger") : t("Deliver", "Entregar")} {nombreDeOrden(p.delivery_id, p.order_ref)}{p.place ? ` · ${p.place}` : ""}</span>
                <span className="hint" style={{ margin: 0 }}>
                  ≈ {horaDeReloj(p.eta)}
                  {p.window_start != null && p.window_end != null && ` · ${t("window", "ventana")} ${horaDeReloj(p.window_start)}–${horaDeReloj(p.window_end)}${p.is_hard ? " 🔒" : ""}`}
                  {` · ${p.load_after} ${t("pallets on board after", "pallets a bordo después")}`}
                </span>
              </li>
            ))}
          </ol>
          <div className="hint" style={{ marginBottom: 0 }}>
            {t("Times are estimates from the plan, not promises. The stops below are what you act on.", "Las horas son estimaciones del plan, no promesas. Las paradas de abajo son sobre las que actúas.")}
          </div>
        </>
      )}
    </div>
  );
}
