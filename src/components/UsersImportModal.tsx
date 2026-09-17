"use client";

import { useMemo, useRef, useState } from "react";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { roleLabel } from "@/lib/constants";
import type { UserRole } from "@/lib/types";

// ============================================================
// Bulk user import (admin). Paste rows straight from the onboarding sheet
// (EMAIL, ROLE, STORE, NAME — extra columns ignored), preview the mapped role
// and store, then create every account at once. Role/store codes are mapped to
// the app's real values; existing emails are reported as skipped, not failed.
// Nothing is created until the admin reviews the preview and confirms.
// ============================================================

// Sheet role code (or an app role name) → app role.
const ROLE_MAP: Record<string, UserRole> = {
  asst: "accounting", acct: "accounting", accounting: "accounting",
  key: "admin", admin: "admin",
  other: "logistics", logistics: "logistics",
  mgr: "manager", manager: "manager", office: "manager",
  sales: "sales",
  wh: "warehouse", warehouse: "warehouse",
  driver: "driver",
};

// Sheet store code → app store name. GROUP / blank = no store (all).
const STORE_MAP: Record<string, string | null> = {
  mca: "RDZ McAllen", phr: "RDZ Pharr", edg: "RDZ Edinburg",
  bro: "RDZ Brownsville", wes: "RDZ Weslaco", mis: "RDZ Mission",
  group: null, "": null,
};

interface ParsedRow {
  email: string;
  name: string;
  role: UserRole | null;
  roleRaw: string;
  store: string | null;
  storeRaw: string;
  valid: boolean;
}

type Result = { email: string; status: "created" | "skipped" | "failed"; password?: string; reason?: string };

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function UsersImportModal({ onClose }: { onClose: () => void }) {
  const { addUser, settings } = useData();
  const { lang, t } = usePrefs();
  const [raw, setRaw] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<Result[] | null>(null);
  const overlayDownRef = useRef(false);

  const storeNames = useMemo(() => settings.stores.map((s) => s.name), [settings.stores]);

  const rows = useMemo<ParsedRow[]>(() => {
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => (line.includes("\t") ? line.split("\t") : line.split(",")).map((c) => c.trim()))
      .filter((cells) => (cells[0] || "").toLowerCase() !== "email") // drop header
      .map((cells) => {
        const [email = "", roleRaw = "", storeRaw = "", name = ""] = cells;
        const role = ROLE_MAP[roleRaw.toLowerCase()] ?? null;
        // Accept a raw store code, or a full store name already matching a store.
        const byName = storeNames.find((s) => s.toLowerCase() === storeRaw.toLowerCase());
        const store = byName ?? (storeRaw.toLowerCase() in STORE_MAP ? STORE_MAP[storeRaw.toLowerCase()] : null);
        const valid = EMAIL_RE.test(email) && !!role && !!(name || email);
        return { email: email.toLowerCase(), name: name || email.split("@")[0], role, roleRaw, store, storeRaw, valid };
      });
  }, [raw, storeNames]);

  const validRows = rows.filter((r) => r.valid);
  const invalidRows = rows.filter((r) => !r.valid);

  const run = async () => {
    if (!validRows.length) return;
    setBusy(true);
    setProgress(0);
    const out: Result[] = [];
    for (const r of validRows) {
      const res = await addUser({
        email: r.email,
        full_name: r.name,
        role: r.role!,
        store: r.store,
        password: password.trim() || undefined,
        quiet: true,
      });
      if (res.ok) out.push({ email: r.email, status: "created", password: res.password });
      else if (/already/i.test(res.error || "")) out.push({ email: r.email, status: "skipped", reason: t("Already exists", "Ya existe") });
      else out.push({ email: r.email, status: "failed", reason: res.error });
      setProgress((p) => p + 1);
    }
    setBusy(false);
    setResults(out);
  };

  const created = results?.filter((r) => r.status === "created") ?? [];
  const copyCreds = () => {
    const text = created.map((r) => `${r.email}\t${r.password}`).join("\n");
    navigator.clipboard?.writeText(text);
  };

  return (
    <div className="overlay"
      onMouseDown={(e) => { overlayDownRef.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (e.target === e.currentTarget && overlayDownRef.current && !busy) onClose(); }}>
      <div className="modal" style={{ maxWidth: 820 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>⬆ {t("Bulk import users", "Importar usuarios en lote")}</h3>
          <button className="btn btn-sm" onClick={() => !busy && onClose()}>✕</button>
        </div>

        {!results ? (
          <>
            <p className="hint" style={{ marginTop: 0 }}>
              {t(
                "Paste rows from your sheet in this column order: EMAIL, ROLE, STORE, NAME (extra columns are ignored). Role codes ASST→Office, KEY→Admin, OTHER→Logistics, MGR→Office Manager, SALES, WH→Warehouse. Store codes MCA/PHR/EDG/BRO/WES/MIS, GROUP = all.",
                "Pega filas de tu hoja en este orden de columnas: EMAIL, ROL, TIENDA, NOMBRE (las columnas extra se ignoran). Códigos de rol ASST→Oficina, KEY→Admin, OTHER→Logística, MGR→Gerente, SALES→Ventas, WH→Almacén. Códigos de tienda MCA/PHR/EDG/BRO/WES/MIS, GROUP = todas.",
              )}
            </p>

            <div className="field">
              <label>{t("Rows (paste from the sheet)", "Filas (pega de la hoja)")}</label>
              <textarea
                rows={7}
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
                placeholder={"acctmca2@rdztilegroup.net\tASST\tMCA\tClaudia Orozco\nsalesrtg@rdztilegroup.net\tSALES\tEDG\tHector Vega"}
                style={{ fontFamily: "monospace", fontSize: 12.5 }}
              />
            </div>

            <div className="field" style={{ maxWidth: 320 }}>
              <label>{t("Password for everyone", "Contraseña para todos")}</label>
              <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t("blank = auto-generate each", "vacío = generar una por usuario")} />
              <div className="hint">{t("Min 6 characters. They can change it after signing in.", "Mínimo 6 caracteres. Pueden cambiarla al iniciar sesión.")}</div>
            </div>

            {rows.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
                  <div className="kpi"><b>{validRows.length}</b><span>{t("Ready to create", "Listos para crear")}</span></div>
                  <div className="kpi"><b style={{ color: invalidRows.length ? "var(--amber)" : "var(--green)" }}>{invalidRows.length}</b><span>{t("Skipped (bad row)", "Omitidos (fila inválida)")}</span></div>
                </div>

                <div className="tbl-scroll" style={{ marginTop: 10, maxHeight: 320 }}>
                  <table className="orders">
                    <thead>
                      <tr>
                        <th>{t("Name", "Nombre")}</th>
                        <th>{t("Email", "Correo")}</th>
                        <th>{t("Role", "Rol")}</th>
                        <th>{t("Store", "Tienda")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={i} style={r.valid ? undefined : { background: "#fff7ec" }}>
                          <td>{r.name || "—"}</td>
                          <td style={{ fontFamily: "monospace", fontSize: 12 }}>{r.email || "—"}</td>
                          <td>{r.role ? roleLabel(r.role, lang) : <span style={{ color: "var(--red)" }}>? {r.roleRaw || "—"}</span>}</td>
                          <td>{r.store ?? (r.storeRaw ? `${r.storeRaw} → ${t("all", "todas")}` : t("all", "todas"))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {invalidRows.length > 0 && (
                  <div className="hint" style={{ marginTop: 6, color: "var(--amber)" }}>
                    {t("Highlighted rows are skipped — check the email and role code.", "Las filas resaltadas se omiten — revisa el correo y el código de rol.")}
                  </div>
                )}
              </div>
            )}

            <div className="modal-actions" style={{ marginTop: 16 }}>
              <button className="btn" onClick={() => !busy && onClose()} disabled={busy}>{t("Cancel", "Cancelar")}</button>
              <button className="btn btn-primary" onClick={run} disabled={busy || validRows.length === 0}>
                {busy ? `${progress}/${validRows.length}…` : t(`Create ${validRows.length} user(s)`, `Crear ${validRows.length} usuario(s)`)}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
              <div className="kpi"><b style={{ color: "var(--green)" }}>{created.length}</b><span>{t("Created", "Creados")}</span></div>
              <div className="kpi"><b>{results.filter((r) => r.status === "skipped").length}</b><span>{t("Skipped", "Omitidos")}</span></div>
              <div className="kpi"><b style={{ color: results.some((r) => r.status === "failed") ? "var(--red)" : undefined }}>{results.filter((r) => r.status === "failed").length}</b><span>{t("Failed", "Fallidos")}</span></div>
            </div>

            <div className="tbl-scroll" style={{ marginTop: 12, maxHeight: 340 }}>
              <table className="orders">
                <thead>
                  <tr>
                    <th>{t("Email", "Correo")}</th>
                    <th>{t("Password", "Contraseña")}</th>
                    <th>{t("Status", "Estado")}</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r, i) => (
                    <tr key={i}>
                      <td style={{ fontFamily: "monospace", fontSize: 12 }}>{r.email}</td>
                      <td style={{ fontFamily: "monospace", fontSize: 12 }}>{r.password ?? "—"}</td>
                      <td>
                        {r.status === "created" && <span className="sema" style={{ background: "var(--green)", color: "#fff" }}>{t("Created", "Creado")}</span>}
                        {r.status === "skipped" && <span className="sema" style={{ background: "var(--gray)", color: "#fff" }}>{r.reason}</span>}
                        {r.status === "failed" && <span className="sema" style={{ background: "var(--red)", color: "#fff" }} title={r.reason}>{t("Failed", "Falló")}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="modal-actions" style={{ marginTop: 16 }}>
              {created.length > 0 && (
                <button className="btn btn-ghost" onClick={copyCreds}>📋 {t("Copy credentials", "Copiar credenciales")}</button>
              )}
              <button className="btn btn-primary" onClick={onClose}>{t("Done", "Listo")}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
