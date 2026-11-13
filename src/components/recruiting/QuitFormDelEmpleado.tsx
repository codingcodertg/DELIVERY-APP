"use client";

import { mensajeDeError } from "@/lib/mensaje-de-error";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { AVISO_DEMO, MODO_DEMO } from "@/lib/recruiting/modo-demo";
import { useData } from "@/lib/recruiting-data-provider";
import { getQuitForms, saveQuitForm, type QuitForm } from "@/app/recruiting/actions/quit-form";
import { signDocUrl, uploadDocFile } from "@/app/recruiting/actions/hr";
import { MOTIVOS_RENUNCIA, etiquetaMotivoRenuncia } from "@/lib/recruiting/quit-form";

/**
 * Formulario de renuncia (quit form) dentro del expediente (D-935, migración 276). Roberto: quien renuncia firma un
 * formato con el motivo, para protegerse de reclamos de desempleo. Aquí se captura (motivo, nota, quién firma, fecha y una
 * foto opcional del formato ya firmado) y se ven los anteriores. La foto usa el mismo patrón que los documentos (hr-docs).
 */
export function QuitFormDelEmpleado({ employeeId }: { employeeId: string }) {
  const { t, lang } = usePrefs();
  const { notify } = useData();
  const [rows, setRows] = useState<QuitForm[] | null>(null);
  const [sinTabla, setSinTabla] = useState(false);
  const [busy, setBusy] = useState(false);
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [nota, setNota] = useState("");
  const [firma, setFirma] = useState("");
  const [fecha, setFecha] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const cargar = useCallback(async () => {
    if (MODO_DEMO) { setRows([]); return; }
    const r = await getQuitForms(employeeId);
    if (!r.ok) { setSinTabla(r.sinTabla); setRows([]); return; }
    setSinTabla(false);
    setRows(r.rows);
  }, [employeeId]);
  useEffect(() => { void cargar(); }, [cargar]);

  async function abre(path: string) {
    const url = await signDocUrl(path);
    if (url) window.open(url, "_blank", "noopener");
  }

  async function guarda() {
    if (MODO_DEMO) { notify(t(AVISO_DEMO.en, AVISO_DEMO.es)); return; }
    setBusy(true);
    let fotoPath: string | null = null;
    const f = fileRef.current?.files?.[0];
    if (f) {
      const fd = new FormData();
      fd.set("file", f); fd.set("employeeId", employeeId); fd.set("kind", "quit_form");
      const up = await uploadDocFile(fd);
      if (!up.ok) { setBusy(false); notify(mensajeDeError(up.message)); return; }
      fotoPath = up.path ?? null;
    }
    const r = await saveQuitForm(employeeId, { motivo, nota, firmaNombre: firma, firmaFecha: fecha, fotoPath });
    setBusy(false);
    if (!r.ok) { notify(mensajeDeError(r.message)); return; }
    setMotivo(""); setNota(""); setFirma(""); setFecha(""); if (fileRef.current) fileRef.current.value = "";
    setAbierto(false);
    await cargar();
  }

  return (
    <div data-bloque="quit-form">
      {rows === null ? (
        <div className="hint">{t("Loading…", "Cargando…")}</div>
      ) : sinTabla ? (
        <div className="hint" data-aviso="276">{t("Migration 276 is not applied yet.", "Falta aplicar la migración 276.")}</div>
      ) : (
        <>
          {rows.length > 0 && (
            <table className="cmp-tbl"><tbody>
              {rows.map((q) => (
                <tr key={q.id} data-quit-form={q.id}>
                  <td style={{ fontWeight: 600 }}>{etiquetaMotivoRenuncia(q.reason, lang)}</td>
                  <td>{q.signed_name}{q.signed_at ? ` · ${q.signed_at}` : ""}</td>
                  <td className="hint" style={{ marginTop: 0 }}>{q.note ?? ""}</td>
                  <td>{q.photo_path && (
                    <button className="btn btn-ghost btn-sm" data-accion="ver-foto" onClick={() => void abre(q.photo_path!)}>📷 {t("View", "Ver")}</button>
                  )}</td>
                </tr>
              ))}
            </tbody></table>
          )}
          {!abierto ? (
            <button className="btn btn-secondary btn-sm" data-accion="nuevo-quit-form" onClick={() => setAbierto(true)} style={{ marginTop: 8 }}>
              + {t("New quit form", "Nuevo formulario de renuncia")}
            </button>
          ) : (
            <div className="card" data-editor="quit-form" style={{ marginTop: 8 }}>
              <div className="field">
                <label>{t("Reason", "Motivo")}</label>
                <select value={motivo} onChange={(e) => setMotivo(e.target.value)} data-campo="motivo">
                  <option value="">{t("— choose —", "— elige —")}</option>
                  {MOTIVOS_RENUNCIA.map((m) => <option key={m.key} value={m.key}>{etiquetaMotivoRenuncia(m.key, "es")} / {etiquetaMotivoRenuncia(m.key, "en")}</option>)}
                </select>
              </div>
              <div className="field">
                <label>{t("Note", "Nota")}</label>
                <textarea value={nota} onChange={(e) => setNota(e.target.value)} rows={2} data-campo="nota" />
              </div>
              <div className="field">
                <label>{t("Signed by", "Firma (nombre)")}</label>
                <input value={firma} onChange={(e) => setFirma(e.target.value)} data-campo="firma" />
              </div>
              <div className="field">
                <label>{t("Date", "Fecha")}</label>
                <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} data-campo="fecha" />
              </div>
              <div className="field">
                <label>{t("Photo of the signed form (optional)", "Foto del formato firmado (opcional)")}</label>
                <input type="file" accept="application/pdf,image/*" ref={fileRef} data-campo="foto" />
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button className="btn btn-primary btn-sm" data-accion="guardar-quit-form" disabled={busy} onClick={() => void guarda()}>
                  {t("Save", "Guardar")}
                </button>
                <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setAbierto(false)}>{t("Cancel", "Cancelar")}</button>
              </div>
            </div>
          )}
          <p className="hint">
            {t("The form a resigning employee signs with the reason, to protect against unemployment claims.",
               "El formato que firma quien renuncia con el motivo, para protegerse de reclamos de desempleo.")}
          </p>
        </>
      )}
    </div>
  );
}
