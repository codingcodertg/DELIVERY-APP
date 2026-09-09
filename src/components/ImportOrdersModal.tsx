"use client";

import { useRef, useState } from "react";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { parseCSV, mapRowsToDrafts, type ImportResult } from "@/lib/csv-import";

// ============================================================
// Bulk order import from a CSV (admin). Reads a file, previews what will be
// created (mapped columns + warnings), and on confirm creates each row as a
// DRAFT order — nothing is submitted or notified automatically, so the admin
// reviews the batch afterwards on the Orders page.
// ============================================================

export function ImportOrdersModal({ onClose }: { onClose: () => void }) {
  const { addDelivery, notify } = useData();
  const { t } = usePrefs();
  const [result, setResult] = useState<ImportResult | null>(null);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  // Only close on a backdrop click that also STARTED on the backdrop.
  const overlayDownRef = useRef(false);

  const onFile = async (file: File) => {
    setFileName(file.name);
    const text = await file.text();
    setResult(mapRowsToDrafts(parseCSV(text)));
  };

  const runImport = async () => {
    if (!result || !result.drafts.length) return;
    setBusy(true);
    let done = 0;
    for (const draft of result.drafts) {
      const row = await addDelivery(draft);
      if (row) done++;
      setProgress((p) => p + 1);
    }
    setBusy(false);
    notify(t(`Imported ${done} of ${result.drafts.length} order(s) as drafts`, `Importadas ${done} de ${result.drafts.length} orden(es) como borradores`));
    onClose();
  };

  return (
    <div className="overlay"
      onMouseDown={(e) => { overlayDownRef.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (e.target === e.currentTarget && overlayDownRef.current && !busy) onClose(); }}>
      <div className="modal" style={{ maxWidth: 720 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 12 }}>
          <h3>⬆ {t("Import orders from CSV", "Importar órdenes desde CSV")}</h3>
          <button className="btn btn-sm" onClick={() => !busy && onClose()}>✕</button>
        </div>
        <div>
          <p className="hint" style={{ marginTop: 0 }}>
            {t(
              "Upload a CSV whose header row matches the app's export columns (Account, Delivery Address, Delivery Date, Delivery Fee, Est. Pallets, Windows, PO #, Invoice #, Order Type, Store…). Unknown columns are ignored. Every row is created as a draft you can review and submit.",
              "Sube un CSV cuya fila de encabezados coincida con las columnas de exportación de la app (Cuenta, Dirección, Fecha, Costo, Pallets, Ventanas, PO #, Factura #, Tipo, Tienda…). Las columnas desconocidas se ignoran. Cada fila se crea como borrador que puedes revisar y enviar.",
            )}
          </p>

          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
          />
          <button className="btn btn-ghost" onClick={() => fileRef.current?.click()} disabled={busy}>
            📄 {fileName || t("Choose CSV file…", "Elegir archivo CSV…")}
          </button>

          {result && (
            <div style={{ marginTop: 14 }}>
              <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
                <div className="kpi"><b>{result.drafts.length}</b><span>{t("Orders to import", "Órdenes a importar")}</span></div>
                <div className="kpi"><b style={{ color: result.warnings.length ? "var(--amber)" : "var(--green)" }}>{result.warnings.length}</b><span>{t("Warnings", "Avisos")}</span></div>
              </div>

              <div className="hint" style={{ marginTop: 10 }}>
                <b>{t("Columns mapped", "Columnas mapeadas")}:</b> {result.mappedHeaders.join(", ") || "—"}
              </div>
              {result.ignoredHeaders.length > 0 && (
                <div className="hint" style={{ marginTop: 4 }}>
                  <b>{t("Ignored", "Ignoradas")}:</b> {result.ignoredHeaders.join(", ")}
                </div>
              )}

              {result.warnings.length > 0 && (
                <div className="card" style={{ marginTop: 10, background: "var(--amber-soft)", borderColor: "var(--amber)", maxHeight: 140, overflowY: "auto" }}>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.5 }}>
                    {result.warnings.slice(0, 40).map((w, i) => <li key={i}>{w}</li>)}
                    {result.warnings.length > 40 && <li>…{result.warnings.length - 40} {t("more", "más")}</li>}
                  </ul>
                </div>
              )}

              {result.drafts.length > 0 && (
                <div className="tbl-scroll" style={{ marginTop: 10 }}>
                  <table className="orders">
                    <thead>
                      <tr>
                        <th>{t("Account", "Cuenta")}</th>
                        <th>{t("Address", "Dirección")}</th>
                        <th>{t("Date", "Fecha")}</th>
                        <th>{t("Pallets", "Pallets")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.drafts.slice(0, 8).map((d, i) => (
                        <tr key={i}>
                          <td>{d.account || "—"}</td>
                          <td>{d.delivery_address || "—"}</td>
                          <td>{d.delivery_date || "—"}</td>
                          <td>{d.est_pallets ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {result.drafts.length > 8 && <div className="hint" style={{ marginTop: 4 }}>+{result.drafts.length - 8} {t("more rows", "filas más")}</div>}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="modal-actions" style={{ marginTop: 16 }}>
          <button className="btn" onClick={() => !busy && onClose()} disabled={busy}>{t("Cancel", "Cancelar")}</button>
          <button className="btn btn-primary" onClick={runImport} disabled={busy || !result || result.drafts.length === 0}>
            {busy ? `${progress}/${result?.drafts.length ?? 0}…` : t(`Import ${result?.drafts.length ?? 0} order(s)`, `Importar ${result?.drafts.length ?? 0} orden(es)`)}
          </button>
        </div>
      </div>
    </div>
  );
}
