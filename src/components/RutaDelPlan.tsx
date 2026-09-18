"use client";

import { useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { horaDeReloj, type ParadaVista, type RutaVista } from "@/lib/route-plan/vista";
import type { Movimiento } from "@/lib/route-plan/ajuste";

/**
 * La ruta de cada chofer, parada a parada (D-322): recogidas (P) y entregas (D) con su etiqueta, a qué hora
 * llega y sale, con cuántos pallets viaja el camión en cada tramo, y los totales del día.
 *
 * Solo PINTA. Las horas, la carga y los totales llegan calculados de `vistaDelPlan`, que a su vez no calcula
 * horas: son las que guardó el motor. Aquí no hay ni una suma.
 *
 * Con `ajuste` (solo en un borrador) cada parada lleva sus controles: subir, bajar, pasar la orden a otro
 * chofer, fijarla. Aquí tampoco se decide nada: se manda el movimiento y se pinta lo que el servidor contesta.
 */

export interface AjusteDeRuta { choferes: { id: string; nombre: string }[]; ocupado: boolean; mueve: (m: Movimiento) => void }

export function RutaDelPlan({ rutas, nombreDeOrden, ajuste }: { rutas: RutaVista[]; nombreDeOrden: (ref: string) => string; ajuste?: AjusteDeRuta }) {
  const { t } = usePrefs();
  const [cerradas, setCerradas] = useState<Record<string, boolean>>({});
  if (!rutas.length) return null;

  const duracion = (min: number) => `${Math.floor(min / 60)} h ${min % 60} min`;

  const fila = (p: ParadaVista, k: number, ruta: RutaVista) => {
    const otroViaje = k > 0 && ruta.paradas[k - 1].viaje !== p.viaje;
    return (
      <tr key={`${p.seq}`} style={otroViaje ? { borderTop: "2px solid var(--amber)" } : undefined}>
        <td><b>{p.label}</b>{p.pinned && <span title={t("Pinned", "Fijada")}> 📌</span>}</td>
        <td>
          {p.kind === "P" ? t("Pick up", "Recoger") : t("Deliver", "Entregar")} {nombreDeOrden(p.order_ref)}
          {p.carga && <span className="hint" style={{ margin: 0 }}> · {t(`load ${p.carga.numero} of ${p.carga.de}`, `carga ${p.carga.numero} de ${p.carga.de}`)}</span>}
          {p.builder && <span className="sema" style={{ border: "1px solid var(--amber)", color: "var(--amber-text)", marginLeft: 6 }}>{t("Builder", "Builder")}</span>}
          {p.place && <span className="hint" style={{ margin: 0 }}> · {p.place}</span>}
        </td>
        <td>
          {horaDeReloj(p.eta)}–{horaDeReloj(p.etd)}
          {p.wait_min > 0 && <span className="hint" style={{ margin: 0 }}> · {t(`waits ${p.wait_min} min`, `espera ${p.wait_min} min`)}</span>}
          {p.late_min > 0 && <span className="sema" style={{ border: "1px solid var(--red)", color: "var(--red)", marginLeft: 6 }}>{p.late_min} {t("min late", "min tarde")}</span>}
        </td>
        <td>
          {p.window_start != null && p.window_end != null ? `${horaDeReloj(p.window_start)}–${horaDeReloj(p.window_end)}` : "—"}
          {p.is_hard && <span title={t("Hard window", "Ventana dura")}> 🔒</span>}
        </td>
        <td>{k === 0 ? "—" : `${p.leg_minutes} min · ${p.leg_miles} mi`}</td>
        <td title={t("Pallets on board arriving → leaving", "Pallets a bordo al llegar → al salir")}>{p.aBordoAlLlegar} → {p.load_after}</td>
        {ajuste && (
          <td style={{ whiteSpace: "nowrap" }}>
            <button type="button" className="btn btn-ghost btn-sm" disabled={ajuste.ocupado || k === 0} title={t("Move up", "Subir")} onClick={() => ajuste.mueve({ tipo: "sube", chofer: ruta.choferId, indice: k })}>↑</button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={ajuste.ocupado || k === ruta.paradas.length - 1} title={t("Move down", "Bajar")} onClick={() => ajuste.mueve({ tipo: "baja", chofer: ruta.choferId, indice: k })}>↓</button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={ajuste.ocupado} title={p.pinned ? t("Unpin this order", "Soltar esta orden") : t("Pin this order where it is", "Fijar esta orden donde está")}
              onClick={() => ajuste.mueve({ tipo: p.pinned ? "suelta" : "fija", orden: p.order_ref })}>{p.pinned ? "📌" : "📍"}</button>
            {p.kind === "P" && ajuste.choferes.length > 1 && (
              <select style={{ width: "auto", display: "inline-block", padding: "4px 6px", fontSize: 12 }} disabled={ajuste.ocupado} value="" aria-label={t("Move order to another driver", "Pasar la orden a otro chofer")}
                onChange={(e) => { if (e.target.value) ajuste.mueve({ tipo: "a_chofer", orden: p.order_ref, chofer: e.target.value }); }}>
                <option value="">{t("Move to…", "Pasar a…")}</option>
                {ajuste.choferes.filter((c) => c.id !== ruta.choferId).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            )}
          </td>
        )}
      </tr>
    );
  };

  return (
    <div style={{ display: "grid", gap: 10, marginTop: 6 }}>
      {rutas.map((ruta) => {
        const x = ruta.totales;
        const cerrada = !!cerradas[ruta.choferId];
        return (
          <div key={ruta.choferId} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 10 }}>
            <button type="button" className="btn btn-ghost btn-sm" style={{ width: "100%", justifyContent: "flex-start", gap: 8, flexWrap: "wrap" }}
              onClick={() => setCerradas((c) => ({ ...c, [ruta.choferId]: !cerrada }))}>
              <span>{cerrada ? "▸" : "▾"}</span>
              <b>{ruta.chofer}</b>
              <span className="hint" style={{ margin: 0 }}>
                {horaDeReloj(x.inicio)}–{horaDeReloj(x.fin)} · {duracion(x.minutos)} · {x.entregas} {t("deliveries", "entregas")} · {x.paradas} {t("stops", "paradas")}
                {x.viajes > 1 && ` · ${x.viajes} ${t("trips", "viajes")}`} · {x.millas} mi · {t("driving", "manejo")} {duracion(x.manejoMin)} · {t("peak load", "carga máxima")} {x.palletsMax}
                {x.esperaMin > 0 && ` · ${t("waiting", "espera")} ${x.esperaMin} min`}
              </span>
              {x.tardeMin > 0 && <span className="sema" style={{ border: "1px solid var(--red)", color: "var(--red)" }}>{x.tardeMin} {t("min late", "min tarde")}</span>}
            </button>
            {!cerrada && (
              <div style={{ overflowX: "auto" }}>
                <table className="orders" style={{ minWidth: 720 }}>
                  <thead>
                    <tr>
                      <th>#</th><th>{t("Stop", "Parada")}</th><th>{t("Arrives–leaves", "Llega–sale")}</th><th>{t("Window", "Ventana")}</th>
                      <th>{t("Leg", "Tramo")}</th><th>{t("Pallets", "Pallets")}</th>{ajuste && <th>{t("Adjust", "Ajustar")}</th>}
                    </tr>
                  </thead>
                  <tbody>{ruta.paradas.map((p, k) => fila(p, k, ruta))}</tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
