"use client";

import { useRef, useState } from "react";
import type { OpcionDeConductor } from "@/lib/elige-conductor";
import {
  alcanceInicial,
  choferesIniciales,
  puedeRepartir,
  seMarca,
  todosLosChoferes,
  type AlcanceDelReparto,
} from "@/lib/auto-asignar";

// ============================================================
// El diálogo de «✨ Auto-asignar» del Gestor de Rutas (D-401): qué órdenes, a qué choferes y si se optimiza al
// terminar. Lo que decide (qué nace marcado, cuándo se enciende el botón) vive en `lib/auto-asignar.ts`; aquí solo se
// pinta. Cancelar (✕, «Cancelar» o un clic fuera) no toca nada.
// ============================================================

export interface EleccionDelReparto {
  alcance: AlcanceDelReparto;
  choferes: string[];
  optimizar: boolean;
}

export function AutoAsignarDialogo({
  opciones,
  delDia,
  marcadas,
  colorDe,
  t,
  onCancelar,
  onConfirmar,
}: {
  /** Los choferes de verdad (las rutas temporales no entran en el reparto), con sus números del panel (D-395). */
  opciones: readonly OpcionDeConductor[];
  /** Cuántas sin chofer hay en el día. */
  delDia: number;
  /** Cuántas hay marcadas en la tabla «Sin asignar». */
  marcadas: number;
  colorDe: (clave: string) => string;
  t: (en: string, es: string) => string;
  onCancelar: () => void;
  onConfirmar: (e: EleccionDelReparto) => void;
}) {
  const [alcance, setAlcance] = useState<AlcanceDelReparto>(() => alcanceInicial(marcadas));
  const [elegidos, setElegidos] = useState<Set<string>>(() => choferesIniciales(opciones));
  const [optimizar, setOptimizar] = useState(true);
  const abajoEnElFondo = useRef(false);

  const cuantas = alcance === "marcadas" ? marcadas : delDia;
  const puede = puedeRepartir(elegidos, cuantas);
  const alterna = (clave: string) =>
    setElegidos((s) => { const n = new Set(s); if (n.has(clave)) n.delete(clave); else n.add(clave); return n; });

  const radio = { display: "flex", alignItems: "center", gap: 8, margin: "0 0 6px", cursor: "pointer", fontSize: 14, fontWeight: 500, color: "var(--text)", textTransform: "none", letterSpacing: "normal" } as const;

  return (
    <div className="overlay" data-auto-asignar-dialogo
      onMouseDown={(e) => { abajoEnElFondo.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (e.target === e.currentTarget && abajoEnElFondo.current) onCancelar(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={t("Auto-assign", "Auto-asignar")} style={{ maxWidth: 520 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 8 }}>
          <h3>✨ {t("Auto-assign", "Auto-asignar")}</h3>
          <button className="btn btn-sm" data-cerrar-dialogo onClick={onCancelar} aria-label={t("Close", "Cerrar")}>✕</button>
        </div>

        <div className="section-label" style={{ marginTop: 8 }}>{t("Which orders", "Qué órdenes")}</div>
        <label style={radio}>
          <input type="radio" name="alcance-del-reparto" data-alcance="todas" checked={alcance === "todas"}
            onChange={() => setAlcance("todas")} style={{ width: 15, height: 15 }} />
          {t(`All unassigned for this day (${delDia})`, `Todas las sin asignar de este día (${delDia})`)}
        </label>
        {marcadas > 0 && (
          <label style={radio}>
            <input type="radio" name="alcance-del-reparto" data-alcance="marcadas" checked={alcance === "marcadas"}
              onChange={() => setAlcance("marcadas")} style={{ width: 15, height: 15 }} />
            {t(`Only the checked ones (${marcadas})`, `Solo las marcadas (${marcadas})`)}
          </label>
        )}

        <div className="section-label" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ flex: 1 }}>{t("To which drivers", "A qué conductores")} ({elegidos.size})</span>
          <button type="button" className="btn btn-ghost btn-sm" data-todos-los-choferes onClick={() => setElegidos(todosLosChoferes(opciones))}>{t("All", "Todos")}</button>
          <button type="button" className="btn btn-ghost btn-sm" data-ningun-chofer onClick={() => setElegidos(new Set())}>{t("None", "Ninguno")}</button>
        </div>
        {opciones.length === 0 ? (
          <div className="hint">{t("No drivers yet (give someone the Driver role).", "Aún no hay choferes (asigne el rol de Chofer).")}</div>
        ) : (
          <div style={{ maxHeight: 260, overflowY: "auto" }}>
            {opciones.map((o) => (
              <label key={o.clave} data-chofer-del-reparto={o.clave}
                style={{ ...radio, cursor: seMarca(o) ? "pointer" : "not-allowed", opacity: seMarca(o) ? 1 : 0.55, flexWrap: "wrap" }}>
                <input type="checkbox" checked={elegidos.has(o.clave)} disabled={!seMarca(o)}
                  onChange={() => alterna(o.clave)} style={{ width: 15, height: 15, flex: "0 0 auto" }} />
                <span style={{ width: 10, height: 10, borderRadius: "50%", background: colorDe(o.clave), flex: "0 0 auto", boxShadow: "0 0 0 1px var(--line)" }} />
                <span style={{ fontWeight: 600 }}>{o.etiqueta}</span>
                <span className="hint" data-carga-del-chofer>
                  ({o.paradas === 1 ? t("1 stop", "1 parada") : t(`${o.paradas} stops`, `${o.paradas} paradas`)} · {o.pallets}/{o.capacidad} {t("pallets", "pallets")})
                </span>
                {o.delFiltro && <span className="sema" style={{ fontSize: 10, background: "var(--card)", color: "var(--accent)", border: "1px solid var(--accent)" }}>{t("filter", "filtro")}</span>}
                {o.noDisponible && <span className="sema" style={{ fontSize: 10, background: "var(--red-chip-bg)", color: "var(--red-chip-text)" }}>{t("off today", "no disponible")}</span>}
              </label>
            ))}
          </div>
        )}

        <label style={{ ...radio, marginTop: 14 }}>
          <input type="checkbox" data-optimizar-al-terminar checked={optimizar} onChange={(e) => setOptimizar(e.target.checked)} style={{ width: 15, height: 15 }} />
          {t("Optimize the routes when done", "Optimizar las rutas al terminar")}
          <span className="hint">{t("(only the drivers who get orders)", "(solo los choferes que reciban órdenes)")}</span>
        </label>

        <div className="modal-actions">
          <button className="btn" data-cancelar-dialogo onClick={onCancelar}>{t("Cancel", "Cancelar")}</button>
          <button className="btn btn-primary" data-asignar-y-optimizar disabled={!puede}
            onClick={() => { if (puede) onConfirmar({ alcance, choferes: opciones.filter((o) => elegidos.has(o.clave)).map((o) => o.clave), optimizar }); }}>
            {optimizar
              ? t(`Assign and optimize (${cuantas})`, `Asignar y optimizar (${cuantas})`)
              : t(`Assign (${cuantas})`, `Asignar (${cuantas})`)}
          </button>
        </div>
      </div>
    </div>
  );
}
