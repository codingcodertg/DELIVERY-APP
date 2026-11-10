"use client";

import { useCallback, useEffect, useState } from "react";
import { listarBorradores, guardarBorrador, cargarBorrador, borrarBorrador, type BorradorFila } from "./borradores-actions";

/**
 * Borradores de ruta (D-NEXT): guardar varias versiones nombradas (Opción 1/2/3) de las rutas de un día y cargar la que
 * se quiera. Solo admin y logística (el padre ya lo monta solo para ellos; la acción del servidor lo recomprueba). Al
 * cargar, la base cambia `deliveries` y el Gestor se actualiza solo por tiempo real.
 */
export function BorradoresDeRuta({ day, t }: { day: string; t: (en: string, es: string) => string }) {
  const [abierto, setAbierto] = useState(false);
  const [lista, setLista] = useState<BorradorFila[]>([]);
  const [nombre, setNombre] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const recarga = useCallback(async () => {
    const r = await listarBorradores(day);
    if (r.ok) { setLista(r.borradores); setAviso(null); } else { setLista([]); setAviso(r.message); }
  }, [day]);

  useEffect(() => { if (abierto) void recarga(); }, [abierto, recarga]);

  const corre = async (f: () => Promise<{ ok: boolean; message?: string }>) => {
    setOcupado(true); setAviso(null);
    const r = await f();
    if (!r.ok && r.message) setAviso(r.message);
    setOcupado(false);
    return r.ok;
  };

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 0 }}>
      <button className={"btn btn-sm " + (abierto ? "btn-primary" : "btn-ghost")} data-borradores aria-expanded={abierto}
        onClick={() => setAbierto((v) => !v)} title={t("Save and load named versions of this day's routes", "Guardar y cargar versiones nombradas de las rutas del día")}>
        🗂 {t("Drafts", "Borradores")} {abierto ? "▾" : "▸"}
      </button>
      {abierto && (
        <div className="card" data-panel-borradores style={{ position: "absolute", zIndex: 20, marginTop: 34, minWidth: 320, maxWidth: 420, boxShadow: "0 8px 24px rgba(0,0,0,.15)" }}>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <input value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={60} placeholder={t("Name (e.g. Option 1)", "Nombre (ej. Opción 1)")}
              style={{ flex: 1, minWidth: 0, fontSize: 13, padding: "7px 9px", borderRadius: 8, border: "1px solid var(--line)" }} />
            <button className="btn btn-sm btn-green" disabled={ocupado || !nombre.trim()} data-guarda-borrador
              onClick={() => void corre(async () => { const r = await guardarBorrador(day, nombre); if (r.ok) { setNombre(""); await recarga(); } return r; })}>
              💾 {t("Save current", "Guardar actual")}
            </button>
          </div>
          <p className="hint" style={{ margin: "6px 0 2px" }}>{t("Saves which driver and stop order each order has now.", "Guarda a qué chofer y en qué orden va cada parada ahora.")}</p>
          {aviso && <div className="hint" style={{ color: "var(--amber-text, var(--amber))", margin: "4px 0" }}>{aviso}</div>}
          <ul style={{ listStyle: "none", margin: "6px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 4, maxHeight: 260, overflow: "auto" }}>
            {lista.length === 0 && !aviso && <li className="hint" style={{ margin: 0 }}>{t("No drafts for this day yet.", "No hay borradores de este día todavía.")}</li>}
            {lista.map((b) => (
              <li key={b.id} data-borrador={b.id} style={{ display: "flex", gap: 6, alignItems: "center", borderTop: "1px solid var(--line)", paddingTop: 4 }}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <b style={{ fontSize: 13 }}>{b.name}</b>
                  <span className="hint" style={{ margin: 0, display: "block", fontSize: 11 }}>{b.n} {t("stops", "paradas")}{b.created_by_name ? ` · ${b.created_by_name}` : ""}</span>
                </span>
                <button className="btn btn-sm btn-primary" disabled={ocupado} data-carga-borrador={b.id}
                  onClick={() => void corre(async () => { const r = await cargarBorrador(b.id); if (r.ok) setAviso(t(`Loaded (${r.n} orders). The map updates in a moment.`, `Cargado (${r.n} órdenes). El mapa se actualiza en un momento.`)); return r; })}>
                  {t("Load", "Cargar")}
                </button>
                <button className="btn btn-sm btn-ghost" disabled={ocupado} data-borra-borrador={b.id} title={t("Delete", "Borrar")}
                  onClick={() => { if (window.confirm(t(`Delete the draft "${b.name}"?`, `¿Borrar el borrador «${b.name}»?`))) void corre(async () => { const r = await borrarBorrador(b.id); if (r.ok) await recarga(); return r; }); }}>🗑</button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </span>
  );
}
