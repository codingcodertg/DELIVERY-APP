"use client";

import type { HTMLAttributes, ReactNode } from "react";
import { numeroDePallets } from "@/lib/lista-unica";
import type { InfoDeRuta } from "@/lib/usa-medida-de-rutas";

/** D-1208: la duración corta, «4:36» (horas:minutos), para que pallets, horas y millas quepan en una línea. */
export function horasCortas(minutos: number): string {
  const m = Math.max(0, Math.round(minutos));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
}

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
  /** La casilla «Todos» de la cabecera (D-488): marcada si se ven todas; pulsarla las marca o desmarca de una vez. */
  todas: boolean;
  onAlternaTodas: () => void;
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
      {/* D-1204: con el panel más delgado, el título no se parte. D-1208: «Todos» va a la derecha, en la misma fila. */}
      <div data-cabecera-del-panel style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, padding: "10px 12px", borderBottom: "1px solid var(--line)" }}>
        <b style={{ flex: "1 0 auto", whiteSpace: "nowrap" }}>🚚 {t("Drivers & routes", "Choferes y rutas")}</b>
        {props.acciones}
        <label data-todos-los-choferes style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
          <input type="checkbox" checked={props.todas} onChange={props.onAlternaTodas} style={{ width: 15, height: 15 }} />
          {t("All", "Todos")}
        </label>
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
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 12px", borderTop: "1px solid var(--line)", cursor: "pointer", background: u.marcada ? "var(--accent-soft)" : undefined, ...estiloExtra }}
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
                    {/* D-1208: la carga (antes con su barra verde) va al final de la primera fila, solo el número. */}
                    <span className="hint" data-carga-maxima style={{ marginLeft: "auto", fontSize: 11, fontWeight: 700, color: over ? "var(--red)" : undefined }}
                      title={t(`Peak load on the route vs the truck's capacity (${pct}%)`, `Carga máxima de la ruta contra la capacidad del camión (${pct}%)`)}>
                      {numeroDePallets(pallets)}/{cap}
                    </span>
                  </div>
                  {/* D-1208 (el dueño: «todo en 2 rows, elimina la barra verde»): la segunda fila, en una sola línea. */}
                  <div className="hint" style={{ marginTop: 1, display: "flex", gap: 8, whiteSpace: "nowrap", overflow: "hidden" }}>
                    <span data-paradas-del-panel>📦 {u.paradas}</span>
                    {/* Travel time & miles only appear once a route has been calculated. */}
                    {u.info && <span data-horas-del-panel title={u.info.duration_text}>⏱ {horasCortas(u.info.minutes)}</span>}
                    {u.info && <span data-millas-del-panel>⇥ {u.info.miles} mi</span>}
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
