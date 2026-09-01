"use client";

import { useCallback, useEffect, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { useData } from "@/lib/recruiting-data-provider";
import {
  listEmployeeFiles, getEmployeeDocs, saveEmployeeFile, saveEmployeeDoc, deleteEmployeeDoc, signDocUrl,
  type EmployeeDoc, type EmployeeFile,
} from "@/app/recruiting/actions/hr";
import { DOC_KINDS, REQUIRED_FORMS } from "@/lib/recruiting/hr";

/**
 * El expediente de RR. HH. (D-145).
 *
 * Tres bloques, como se pidieron: **INFO**, **HR** y **FORMS**. Pero no se pintan como tres
 * columnas de una tabla, y esa es la única decisión de forma que importa aquí: dieciocho
 * columnas por treinta personas es un mural que no se lee y que nadie rellena.
 *
 * La lista enseña solo lo que se mira de un vistazo —quién es y **qué papeles le faltan**— y el
 * expediente entero se abre por persona. Porque la pregunta de RR. HH. no es "enséñamelo todo",
 * es *"¿a quién le falta algo?"*.
 */

type Fila = EmployeeFile & { docKinds: string[] };

export default function EmployeeFilesPage() {
  const { t, lang } = usePrefs();
  const [rows, setRows] = useState<Fila[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [buscar, setBuscar] = useState("");
  const [soloFaltan, setSoloFaltan] = useState(false);

  const load = useCallback(async () => {
    const r = await listEmployeeFiles();
    if (!r.ok) setErr(r.message);
    else { setErr(null); setRows(r.rows); }
    setCargando(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const faltan = (r: { docKinds: string[] }) => REQUIRED_FORMS.filter((f) => !r.docKinds.includes(f.key));

  const visibles = rows
    .filter((r) => !buscar || r.full_name.toLowerCase().includes(buscar.toLowerCase()))
    .filter((r) => !soloFaltan || faltan(r).length > 0);

  const abiertaFila = rows.find((r) => r.id === abierto) ?? null;

  return (
    <>
      <div className="card">
        <div className="sec-head" style={{ marginTop: 0 }}>
          <span className="sec-title">👤 {t("Employee files", "Expedientes")}</span>
          <span className="sec-sub">
            {t("Everyone in the company, their details and their paperwork.",
               "Toda la plantilla, sus datos y sus papeles.")}
          </span>
        </div>

        <div className="filters">
          <input
            value={buscar}
            onChange={(e) => setBuscar(e.target.value)}
            placeholder={t("Search a person…", "Buscar una persona…")}
            style={{ width: "auto", minWidth: 220 }}
          />
          <button className={"chip" + (soloFaltan ? " on" : "")} onClick={() => setSoloFaltan(!soloFaltan)}>
            {t("Only missing paperwork", "Solo con papeles pendientes")}
          </button>
        </div>

        {err && <div className="hint" style={{ color: "var(--red)" }}>{err}</div>}

        {cargando ? (
          <div className="hint">{t("Loading…", "Cargando…")}</div>
        ) : visibles.length === 0 ? (
          <div className="empty">
            {soloFaltan
              ? t("Nobody has paperwork pending.", "No hay papeles pendientes de nadie.")
              : t("Nobody matches.", "Nadie coincide.")}
          </div>
        ) : (
          <table className="cmp-tbl">
            <thead>
              <tr>
                <th>{t("Name", "Nombre")}</th>
                <th>ID</th>
                <th>{t("Hired", "Contratado")}</th>
                <th>{t("Phone", "Teléfono")}</th>
                <th>{t("Paperwork", "Papeles")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visibles.map((r) => {
                const pend = faltan(r);
                return (
                  <tr key={r.id}>
                    <td style={{ fontWeight: 700 }}>{r.full_name}</td>
                    <td>{r.employee_code || "—"}</td>
                    <td>{r.date_hired || "—"}</td>
                    <td>{r.phone || "—"}</td>
                    <td>
                      {/* Lo que FALTA, no lo que hay: un expediente completo no hace falta
                          mirarlo, y listar los cinco papeles presentes escondería el que no
                          está, que es lo único que se venía a buscar. */}
                      {pend.length === 0 ? (
                        <span className="badge" style={{ background: "var(--tint-green)", color: "var(--green)" }}>
                          {t("complete", "completo")}
                        </span>
                      ) : (
                        <span
                          className="badge"
                          style={{ background: "var(--tint-red-strong)", color: "var(--red)" }}
                          title={pend.map((p) => (lang === "es" ? p.label_es : p.label)).join(", ")}
                        >
                          {pend.length} {t("missing", "faltan")}
                        </span>
                      )}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => setAbierto(abierto === r.id ? null : r.id)}
                      >
                        {abierto === r.id ? t("Close", "Cerrar") : t("Open file", "Abrir ficha")}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {abiertaFila && <Ficha key={abiertaFila.id} persona={abiertaFila} onSaved={load} onClose={() => setAbierto(null)} />}
    </>
  );
}

/** El expediente de una persona: INFO arriba, y debajo HR y FORMS. */
function Ficha({ persona, onSaved, onClose }: { persona: EmployeeFile; onSaved: () => void; onClose: () => void }) {
  const { t } = usePrefs();
  const { notify } = useData();
  const [info, setInfo] = useState({
    employee_code: persona.employee_code ?? "",
    birthday: persona.birthday ?? "",
    date_hired: persona.date_hired ?? "",
    phone: persona.phone ?? "",
    address: persona.address ?? "",
    days_off: persona.days_off != null ? String(persona.days_off) : "",
    notes: persona.notes ?? "",
  });
  const [docs, setDocs] = useState<EmployeeDoc[] | null>(null);
  const [busy, setBusy] = useState(false);

  const cargaDocs = useCallback(async () => {
    const r = await getEmployeeDocs(persona.id);
    // Si falla se deja la lista VACÍA, no en null: null significa "cargando", y dejarlo
    // ahí pinta un "Cargando…" eterno que se lee como que la pantalla está rota. El
    // error se dice aparte, con su motivo.
    setDocs(r.ok ? r.docs : []);
    if (!r.ok) notify("Error: " + r.message);
  }, [persona.id, notify]);

  useEffect(() => { void cargaDocs(); }, [cargaDocs]);

  async function guardaInfo() {
    setBusy(true);
    const r = await saveEmployeeFile(persona.id, {
      ...info,
      days_off: info.days_off === "" ? null : Number(info.days_off),
    });
    setBusy(false);
    notify(r.ok ? t("Saved ✓", "Guardado ✓") : "Error: " + (r.message ?? ""));
    if (r.ok) onSaved();
  }

  const campo = (k: keyof typeof info, label: string, tipo = "text") => (
    <div>
      <label>{label}</label>
      <input type={tipo} value={info[k]} onChange={(e) => setInfo({ ...info, [k]: e.target.value })} />
    </div>
  );

  return (
    /* En ventana, no como panel al final de la página (D-149).
       ---------------------------------------------------------------------
       Se dibujaba DEBAJO de la tabla entera: con la plantilla completa en
       pantalla, "Abrir ficha" abría algo a treinta filas de distancia y desde
       arriba no se veía pasar nada. Parecía que el botón no hacía nada.
       Es además como abre todo lo demás en este módulo (ModalHost). */
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 760 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <h3 style={{ margin: 0, flex: 1 }}>{persona.full_name}</h3>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>

      <div className="sec-head">
        <span className="sec-title">INFO</span>
      </div>
      <div className="grid g3">
        {campo("employee_code", "ID")}
        {campo("birthday", t("Birthday", "Cumpleaños"), "date")}
        {campo("date_hired", t("Date hired", "Fecha de contratación"), "date")}
        {campo("phone", t("Phone", "Teléfono"))}
        {campo("days_off", t("Attendance — days off", "Asistencia — días libres"), "number")}
      </div>
      <div style={{ marginTop: 12 }}>
        <label>{t("Address", "Dirección")}</label>
        <input value={info.address} onChange={(e) => setInfo({ ...info, address: e.target.value })} />
      </div>
      <div style={{ marginTop: 12 }}>
        <label>{t("Notes", "Notas")}</label>
        <textarea rows={2} value={info.notes} onChange={(e) => setInfo({ ...info, notes: e.target.value })} />
      </div>
      <button className="btn btn-primary" style={{ marginTop: 12 }} disabled={busy} onClick={guardaInfo}>
        {t("Save info", "Guardar datos")}
      </button>

      <Bloque grupo="hr" titulo="HR" docs={docs} employeeId={persona.id}
        onChange={() => { void cargaDocs(); onSaved(); }} />
      <Bloque grupo="forms" titulo="FORMS" docs={docs} employeeId={persona.id}
        onChange={() => { void cargaDocs(); onSaved(); }} />

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
          <button className="btn btn-ghost" onClick={onClose}>{t("Close", "Cerrar")}</button>
        </div>
      </div>
    </div>
  );
}

/** Un grupo de documentos (HR o FORMS), una línea por tipo. */
function Bloque({
  grupo, titulo, docs, employeeId, onChange,
}: {
  grupo: "hr" | "forms";
  titulo: string;
  docs: EmployeeDoc[] | null;
  employeeId: string;
  onChange: () => void;
}) {
  const { t, lang } = usePrefs();
  const { notify } = useData();
  const [busy, setBusy] = useState(false);
  const [nuevo, setNuevo] = useState<string | null>(null);
  const [fecha, setFecha] = useState("");
  const [vence, setVence] = useState("");
  const [nota, setNota] = useState("");
  const tipos = DOC_KINDS.filter((d) => d.group === grupo);

  async function corre(fn: () => Promise<{ ok: boolean; message?: string }>) {
    setBusy(true);
    const r = await fn();
    setBusy(false);
    if (!r.ok) { notify("Error: " + (r.message ?? "")); return false; }
    onChange();
    return true;
  }

  async function abre(path: string) {
    const url = await signDocUrl(path);
    if (url) window.open(url, "_blank", "noopener");
  }

  return (
    <>
      <div className="sec-head">
        <span className="sec-title">{titulo}</span>
      </div>
      {docs === null ? (
        <div className="hint">{t("Loading…", "Cargando…")}</div>
      ) : (
        <table className="cmp-tbl">
          <tbody>
            {tipos.map((k) => {
              const suyos = docs.filter((d) => d.kind === k.key);
              const uno = suyos[0];
              return (
                <tr key={k.key}>
                  <td className="rowh">{lang === "es" ? k.label_es : k.label}</td>
                  <td>
                    {/* Los de lista se enumeran; los únicos llevan su fecha editable ahí mismo,
                        porque marcar "firmado el día X" ES la acción de esta pantalla. */}
                    {k.many ? (
                      suyos.length === 0 ? (
                        <span className="hint" style={{ marginTop: 0 }}>{t("none", "ninguno")}</span>
                      ) : (
                        suyos.map((d) => (
                          <div key={d.id} className="mini-row" style={{ marginBottom: 6 }}>
                            <span>
                              {d.signed_at || t("no date", "sin fecha")}
                              {d.expires_at ? ` · ${t("expires", "vence")} ${d.expires_at}` : ""}
                              {d.note ? ` · ${d.note}` : ""}
                            </span>
                            <span>
                              {d.file_path && (
                                <button className="btn btn-ghost btn-sm" onClick={() => abre(d.file_path!)}>
                                  {t("View", "Ver")}
                                </button>
                              )}
                              <button className="btn btn-danger btn-sm" style={{ marginLeft: 6 }} disabled={busy}
                                onClick={() => corre(() => deleteEmployeeDoc(d.id))}>
                                {t("Delete", "Borrar")}
                              </button>
                            </span>
                          </div>
                        ))
                      )
                    ) : (
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <input
                          type="date"
                          value={uno?.signed_at ?? ""}
                          disabled={busy}
                          style={{ width: "auto" }}
                          onChange={(e) =>
                            corre(() => saveEmployeeDoc({
                              id: uno?.id, employeeId, kind: k.key, signedAt: e.target.value || null,
                              expiresAt: uno?.expires_at ?? null, filePath: uno?.file_path ?? null,
                            }))
                          }
                        />
                        {k.expires && (
                          <input
                            type="date"
                            value={uno?.expires_at ?? ""}
                            disabled={busy || !uno}
                            title={t("Expires", "Vence")}
                            style={{ width: "auto" }}
                            onChange={(e) =>
                              corre(() => saveEmployeeDoc({
                                id: uno?.id, employeeId, kind: k.key, signedAt: uno?.signed_at ?? null,
                                expiresAt: e.target.value || null, filePath: uno?.file_path ?? null,
                              }))
                            }
                          />
                        )}
                        {uno?.file_path && (
                          <button className="btn btn-ghost btn-sm" onClick={() => abre(uno.file_path!)}>
                            {t("View", "Ver")}
                          </button>
                        )}
                        {uno && (
                          <button className="btn btn-danger btn-sm" disabled={busy}
                            onClick={() => corre(() => deleteEmployeeDoc(uno.id))}>
                            {t("Clear", "Quitar")}
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    {k.many && (nuevo === k.key ? (
                      <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                        <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} style={{ width: "auto" }} />
                        {k.expires && (
                          <input type="date" value={vence} onChange={(e) => setVence(e.target.value)}
                            title={t("Expires", "Vence")} style={{ width: "auto" }} />
                        )}
                        <input value={nota} onChange={(e) => setNota(e.target.value)}
                          placeholder={t("Note", "Nota")} style={{ width: "auto", minWidth: 120 }} />
                        <button className="btn btn-primary btn-sm" disabled={busy}
                          onClick={async () => {
                            const ok = await corre(() => saveEmployeeDoc({
                              employeeId, kind: k.key, signedAt: fecha || null,
                              expiresAt: vence || null, note: nota || null,
                            }));
                            if (ok) { setNuevo(null); setFecha(""); setVence(""); setNota(""); }
                          }}>
                          {t("Add", "Añadir")}
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => setNuevo(null)}>
                          {t("Cancel", "Cancelar")}
                        </button>
                      </span>
                    ) : (
                      <button className="btn btn-ghost btn-sm"
                        onClick={() => { setNuevo(k.key); setFecha(""); setVence(""); setNota(""); }}>
                        + {t("Add", "Añadir")}
                      </button>
                    ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}
