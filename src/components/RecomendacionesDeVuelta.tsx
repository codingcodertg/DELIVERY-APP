"use client";

import { useEffect, useMemo, useState } from "react";
import { claveDeRecomendacion, guardaDejadaAsi, leeDejadasAsi, notaDeLaRecomendacion, recomendacionesDelDia } from "@/lib/recomienda-reprogramar";
import { puedeReprogramar } from "@/lib/reprogramar-orden";
import { fmtDateShort, orderLabel, todayISO } from "@/lib/utils";
import type { RecomendacionDeVuelta } from "@/lib/route-engine";
import type { Delivery, Profile, Settings } from "@/lib/types";

/** Lee del navegador; si lo niega, lanza, y quien lo usa (`leeDejadasAsi`) lo toma como «nada dejado». */
const leer = (k: string) => window.localStorage.getItem(k);

/**
 * La tarjeta «Recomendaciones» del Gestor de Rutas (D-NEXT), justo encima del panel de «Armar rutas»: las cargas chicas con
 * la tienda lejana que no compensan la vuelta, con el porqué y dos botones. Sin recomendaciones no se pinta NADA: el dueño,
 * 2026-10-22, «si no hay cargas así, todo normal».
 *
 * No mueve nada sola: «Reprogramar a …» guarda por el mismo camino que el 📅 de cada fila (`reprogramarOrden`, la función
 * `reprogramar_orden` de la 173, que deja la nota en el historial; la 172 la saca de la ruta de su chofer), y solo sale si
 * quien mira puede reprogramar TODAS esas órdenes (`puedeReprogramar`). «Dejar así» la esconde ese día, en este navegador.
 */
export function RecomendacionesDeVuelta({ deliveries, fecha, settings, me, reprogramarOrden, notify, lang, t }: {
  /** Todas las órdenes que tiene la pantalla: las del día y las de los días siguientes, también las que ya salieron. */
  deliveries: readonly Delivery[];
  fecha: string;
  settings: Pick<Settings, "stores" | "order_type_rules" | "route_weights" | "route_hard_windows">;
  me: Pick<Profile, "id" | "role"> | null;
  reprogramarOrden: (id: string, fecha: string, nota: string, lang: "en" | "es") => Promise<boolean>;
  notify: (msg: string) => void;
  lang: "en" | "es";
  t: (en: string, es: string) => string;
}) {
  const hoy = todayISO();
  const recomendaciones = useMemo(() => recomendacionesDelDia(deliveries, fecha, settings, hoy), [deliveries, fecha, settings, hoy]);
  const [dejadas, setDejadas] = useState<Set<string>>(new Set());
  useEffect(() => { if (me?.id) setDejadas(leeDejadasAsi(leer, me.id)); }, [me?.id]);
  const [moviendo, setMoviendo] = useState<string | null>(null);

  const visibles = recomendaciones.filter((r) => !dejadas.has(claveDeRecomendacion(r)));
  if (visibles.length === 0) return null;

  const porId = new Map(deliveries.map((d) => [d.id, d]));
  const etiqueta = (id: string) => { const d = porId.get(id); return d ? d.invoice_num || `#${orderLabel(d)}` : id.slice(0, 6); };
  const sePuede = (r: RecomendacionDeVuelta) => r.ids.every((id) => puedeReprogramar(me?.role, porId.get(id)?.stage));

  const dejarAsi = (r: RecomendacionDeVuelta) => {
    const k = claveDeRecomendacion(r);
    if (!me?.id) { setDejadas((s) => new Set([...s, k])); return; }
    setDejadas(guardaDejadaAsi(leer, (c, v) => window.localStorage.setItem(c, v), me.id, k, hoy));
  };
  const reprogramar = async (r: RecomendacionDeVuelta) => {
    const k = claveDeRecomendacion(r);
    if (moviendo) return;
    setMoviendo(k);
    let movidas = 0;
    // Una por una, por el mismo camino que el 📅: si una falla, `reprogramarOrden` ya avisó por qué, y las demás siguen.
    for (const id of r.ids) if (await reprogramarOrden(id, r.fechaSugerida, notaDeLaRecomendacion(r, lang), lang)) movidas++;
    setMoviendo(null);
    const dia = fmtDateShort(r.fechaSugerida, lang);
    notify(movidas === r.ids.length
      ? t(`Rescheduled to ${dia}: ${movidas} order(s)`, `Reprogramadas al ${dia}: ${movidas} orden(es)`)
      : t(`${movidas} of ${r.ids.length} rescheduled to ${dia}`, `${movidas} de ${r.ids.length} reprogramadas al ${dia}`));
  };

  return (
    <div className="card" data-recomendaciones style={{ marginBottom: 14, background: "var(--amber-soft)", borderColor: "var(--amber)" }}>
      <b style={{ color: "var(--amber-text)" }}>💡 {t("Recommendations", "Recomendaciones")}</b>
      {visibles.map((r) => {
        const k = claveDeRecomendacion(r);
        return (
          <div key={k} data-recomendacion={r.tienda} style={{ marginTop: 8 }}>
            <div>
              <b>{t(`Very few pallets for the trip to ${r.tienda}`, `Muy poco pallet para la vuelta a ${r.tienda}`)}</b>
              {" · "}{r.ids.map(etiqueta).join(", ")}
            </div>
            <div className="hint" style={{ marginTop: 2 }}>{lang === "es" ? r.motivo.es : r.motivo.en}</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
              {sePuede(r) && (
                <button type="button" className="btn btn-primary btn-sm" data-reprogramar-recomendacion disabled={moviendo != null}
                  onClick={() => void reprogramar(r)}>
                  {moviendo === k ? t("Saving…", "Guardando…") : `📅 ${t("Reschedule to", "Reprogramar a")} ${fmtDateShort(r.fechaSugerida, lang)}`}
                </button>
              )}
              <button type="button" className="btn btn-ghost btn-sm" data-dejar-asi disabled={moviendo === k} onClick={() => dejarAsi(r)}
                title={t("Hide this recommendation for this day", "Esconder esta recomendación este día")}>
                {t("Leave as is", "Dejar así")}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
