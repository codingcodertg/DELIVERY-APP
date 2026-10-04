"use client";

import type { HTMLAttributes, ReactNode } from "react";
import { numeroDePallets } from "@/lib/lista-unica";
import type { InfoDeRuta } from "@/lib/usa-medida-de-rutas";

/**
 * El panel «Choferes y rutas»: cada ruta del día con su casilla, su color, sus órdenes, horas y millas, y la barra de
 * carga. Lo pintan el Gestor de Rutas y «Ruta de hoy» (D-467) — el mismo componente, para que las dos digan lo mismo.
 *
 * Estaba escrito dentro de `routes/page.tsx`. Lo que es solo del Gestor entra por fuera: los botones de la cabecera
 * («Unir», «＋ Ruta»), lo que acompaña al nombre (🔒, ✏, ✕, «ruta») y el destino de arrastre de cada fila. «Ruta de hoy» no
 * pasa nada de eso: allí el panel solo se lee y se marca para resaltar.
 */
export interface FilaDelPanel {
  /** `key` de React. */
  id: string;
  /** La clave de la ruta: el nombre del chofer o de la ruta temporal. */
  clave: string;
  etiqueta: string;
  color: string;
  /** 📦 paradas pendientes. */
  paradas: number;
  /** ⏱ y ⇥: solo cuando la ruta ya se midió. */
  info?: InfoDeRuta;
  /** La carga máxima de la lista y la capacidad del camión (`cargaDelPanel`). */
  carga: { pallets: number; cap: number; pct: number; over: boolean };
  marcada: boolean;
  enVivo: boolean;
}

export function PanelDeChoferes(props: {
  filas: readonly FilaDelPanel[];
  t: (en: string, es: string) => string;
  /** Pulsar la fila: resaltar solo esa ruta. */
  onEnfoca: (clave: string) => void;
  /** La casilla: marcar o desmarcar la ruta. */
  onAlterna: (clave: string) => void;
  /** Hay rutas marcadas: sale «Mostrar todos». */
  hayMarcadas: boolean;
  onMuestraTodos: () => void;
  /** «EN VIVO»: dónde está ese chofer ahora. Sin esto, la etiqueta no se pinta. */
  onUbica?: (clave: string) => void;
  /** Botones de la cabecera, delante de «Mostrar todos» (solo el Gestor). */
  acciones?: ReactNode;
  /** Lo que acompaña al nombre de una ruta (solo el Gestor). */
  extrasDe?: (clave: string) => ReactNode;
  /** Atributos de la fila: el destino de arrastre del Gestor. */
  atributosDe?: (clave: string) => HTMLAttributes<HTMLDivElement> & Record<`data-${string}`, string | undefined>;
  /** Lo que se dice cuando no hay ninguna ruta. */
  vacio: ReactNode;
  /** Sin rutas en absoluto (antes del filtro). */
  sinRutas: boolean;
}) {
  const { t } = props;
  return (
    <div className="card" data-panel-de-choferes style={{ flex: "1 1 250px", maxWidth: 340, margin: 0, padding: 0, overflow: "hidden", display: "flex", flexDirection: "column", maxHeight: "min(60vh, 520px)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderBottom: "1px solid var(--line)" }}>
        <b style={{ flex: 1 }}>🚚 {t("Drivers & routes", "Choferes y rutas")}</b>
        {props.acciones}
        {props.hayMarcadas && <button className="notif-clear" onClick={props.onMuestraTodos}>{t("Show all", "Mostrar todos")}</button>}
      </div>
      {props.sinRutas ? (
        <div className="empty">{props.vacio}</div>
      ) : (
        <div style={{ maxHeight: 470, overflowY: "auto" }}>
          {props.filas.map((u) => {
            const { pallets, cap, pct, over } = u.carga;
            const { style: estiloExtra, ...atributos } = props.atributosDe?.(u.clave) ?? {};
            return (
              <div
                key={u.id}
                data-ruta-del-panel={u.clave}
                onClick={() => props.onEnfoca(u.clave)}
                {...atributos}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderTop: "1px solid var(--line)", cursor: "pointer", background: u.marcada ? "var(--accent-soft)" : undefined, ...estiloExtra }}
              >
                <input type="checkbox" checked={u.marcada} onClick={(e) => e.stopPropagation()} onChange={() => props.onAlterna(u.clave)} style={{ width: 15, height: 15, flex: "0 0 auto" }} />
                <span style={{ width: 12, height: 12, borderRadius: "50%", background: u.color, flex: "0 0 auto", border: "2px solid var(--card)", boxShadow: "0 0 0 1px var(--line)" }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
                    {u.etiqueta}
                    {/* Clocked in AND reporting right now. Driven by the
                        realtime location feed, so it appears and clears on
                        its own — no refresh. */}
                    {u.enVivo && props.onUbica && (
                      <button
                        className="sema live-tag"
                        // Tapping the NAME shows their route; tapping this
                        // answers the other question — where are they now.
                        onClick={(e) => { e.stopPropagation(); props.onUbica!(u.clave); }}
                        title={t("Show where this driver is right now", "Ver dónde está este chofer ahora")}
                      >
                        {t("LIVE", "EN VIVO")}
                      </button>
                    )}
                    {props.extrasDe?.(u.clave)}
                  </div>
                  <div className="hint" style={{ marginTop: 2, display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <span data-paradas-del-panel>📦 {u.paradas}</span>
                    {/* Travel time & miles only appear once a route has been calculated. */}
                    {u.info && <span data-horas-del-panel>⏱ {u.info.duration_text}</span>}
                    {u.info && <span data-millas-del-panel>⇥ {u.info.miles} mi</span>}
                  </div>
                  {/* Capacity meter: the peak load of the list vs the truck's capacity (D-443). */}
                  <div style={{ marginTop: 5, display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{ flex: 1, height: 6, borderRadius: 999, background: "var(--line)", overflow: "hidden" }}>
                      <div style={{ width: `${pct}%`, height: "100%", background: over ? "var(--red)" : "var(--green)" }} />
                    </div>
                    <span className="hint" data-carga-maxima style={{ fontSize: 11, fontWeight: 700, color: over ? "var(--red)" : undefined }}
                      title={t("Peak load on the route vs the truck's capacity", "Carga máxima de la ruta contra la capacidad del camión")}>
                      {numeroDePallets(pallets)}/{cap}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
