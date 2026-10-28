"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { useData } from "@/lib/recruiting-data-provider";
import { assignAsset, deleteAsset, listAssets, releaseAsset, saveAsset } from "@/app/recruiting/actions/activos";
import {
  ESTADOS, TIPOS_DE_TELEFONO, cuentaPorEstado, etiquetaDeEstado, etiquetaDeTipoDeTelefono, libres, porPersona, textoDeTelefono,
  type Activo, type EstadoDeActivo, type TipoDeActivo, type TipoDeTelefono,
} from "@/lib/recruiting/activos";
import { useOrdenYFiltro } from "@/lib/use-orden-y-filtro";
import { CabeceraConMenu, FiltrosPuestos, MenuDeColumnaAbierto } from "@/components/CabeceraConMenu";
import { anchoDeTabla, useColWidthMap } from "@/lib/use-col-widths";
import { BuscadorConBorrar } from "@/components/BuscadorConBorrar";
import { downloadCSV, toCSV } from "@/lib/utils";
import type { ValorDeCelda } from "@/lib/orden-y-filtro";

/**
 * «Company assets» (D-730, migración 211): los correos y números de teléfono que paga la empresa, con su estado y quién
 * los tiene. El dueño, 2026-10-28: «I need to control which ones are in use and which are free». Dos listas (correos,
 * números) con la tabla de Órdenes (CLAUDE.md: toda tabla es la de Entregas), chips por estado con su cuenta, y la vista
 * «por persona»: quién tiene correo y teléfono y quién no.
 */
type Vista = "email" | "phone" | "personas";

const COLUMNAS = [
  { key: "value", en: "Email / number", es: "Correo / número", ancho: 230 },
  { key: "ext", en: "Ext.", es: "Ext.", ancho: 70 },
  { key: "phone_type", en: "Type", es: "Tipo", ancho: 150 },
  { key: "status", en: "Status", es: "Estado", ancho: 150 },
  { key: "employee", en: "Assigned to", es: "Asignado a", ancho: 200 },
  { key: "plan", en: "Plan", es: "Plan", ancho: 220 },
  { key: "cost_year", en: "Cost / year", es: "Costo al año", ancho: 110 },
  { key: "note", en: "Note", es: "Nota", ancho: 180 },
] as const;

export default function AssetsPage() {
  const { t, lang } = usePrefs();
  const { notify } = useData();
  const [rows, setRows] = useState<Activo[]>([]);
  const [personas, setPersonas] = useState<{ id: string; full_name: string; date_left: string | null }[]>([]);
  const [estado, setEstado] = useState<"cargando" | "listo" | "sinTabla" | "error">("cargando");
  const [err, setErr] = useState<string | null>(null);
  const [vista, setVista] = useState<Vista>("email");
  const [filtroEstado, setFiltroEstado] = useState<EstadoDeActivo | "">("");
  const [buscar, setBuscar] = useState("");
  const [editando, setEditando] = useState<Partial<Activo> & { kind: TipoDeActivo } | null>(null);
  const [asignando, setAsignando] = useState<Activo | null>(null);
  const [busy, setBusy] = useState(false);

  const cargar = useCallback(async () => {
    const r = await listAssets();
    if (!r.ok) { setErr(r.message); setEstado(r.sinTabla ? "sinTabla" : "error"); return; }
    setRows(r.rows); setPersonas(r.personas); setErr(null); setEstado("listo");
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);

  const corre = async (fn: () => Promise<{ ok: boolean; message?: string }>) => {
    setBusy(true);
    const r = await fn();
    setBusy(false);
    if (!r.ok) { notify("Error: " + (r.message ?? "")); return false; }
    await cargar();
    return true;
  };

  const delTipo = useMemo(() => rows.filter((a) => vista !== "personas" && a.kind === vista), [rows, vista]);
  const cuenta = useMemo(() => cuentaPorEstado(delTipo), [delTipo]);
  const q = buscar.trim().toLowerCase();
  const visibles = useMemo(() => delTipo
    .filter((a) => !filtroEstado || a.status === filtroEstado)
    .filter((a) => !q || [a.value, a.ext, a.employee_name, a.plan, a.note].some((v) => (v ?? "").toLowerCase().includes(q))), [delTipo, filtroEstado, q]);

  const valorDe = useCallback((clave: string, a: Activo): ValorDeCelda => {
    switch (clave) {
      case "value": return a.value;
      case "ext": return a.ext;
      case "phone_type": return a.kind === "phone" ? etiquetaDeTipoDeTelefono(a.phone_type, lang) : null;
      case "status": return etiquetaDeEstado(a.status, lang);
      case "employee": return a.employee_name ?? null;
      case "plan": return a.plan;
      case "cost_year": return a.cost_year;
      case "note": return a.note;
      default: return null;
    }
  }, [lang]);
  const orden = useOrdenYFiltro(visibles, valorDe);
  const colw = useColWidthMap("rrhh-activos-anchos", 140, { minimo: 60 });
  const columnas = COLUMNAS.filter((c) => vista === "phone" ? c.key !== "plan" && c.key !== "cost_year" : c.key !== "ext" && c.key !== "phone_type");
  const ancho = (c: { key: string; ancho: number }) => colw.widthOf(c.key, c.ancho);
  const activas = personas.filter((p) => !p.date_left);
  const vistaPersonas = useMemo(() => porPersona(rows, activas), [rows, activas]);
  const borraEditando = async () => {
    const id = editando?.id;
    if (!id) return;
    if (!window.confirm(t("Delete this asset from the list?", "¿Borrar este activo de la lista?"))) return;
    if (await corre(() => deleteAsset(id))) setEditando(null);
  };
  const exporta = () => {
    const cab = columnas.map((c) => (lang === "es" ? c.es : c.en));
    downloadCSV(`company-assets-${vista}.csv`, toCSV(cab, orden.visibles.map((a) => columnas.map((c) => valorDe(c.key, a)))));
  };

  return (
    <>
      <div className="page-head" data-cabecera-de-activos>
        <h2>🧰 {t("Company assets", "Activos de la empresa")} <span className="count-tag">{vista === "personas" ? activas.length : orden.visibles.length}</span></h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <div className="viewtoggle">
            <button className={"vt " + (vista === "email" ? "on" : "")} data-vista="email" onClick={() => { setVista("email"); setFiltroEstado(""); }}>✉️ {t("Emails", "Correos")}</button>
            <button className={"vt " + (vista === "phone" ? "on" : "")} data-vista="phone" onClick={() => { setVista("phone"); setFiltroEstado(""); }}>📞 {t("Numbers", "Números")}</button>
            <button className={"vt " + (vista === "personas" ? "on" : "")} data-vista="personas" onClick={() => setVista("personas")}>👤 {t("By person", "Por persona")}</button>
          </div>
          {vista !== "personas" && <button className="btn btn-ghost" data-exporta="csv" disabled={!orden.visibles.length} onClick={exporta}>⬇ CSV</button>}
          {vista !== "personas" && (
            <button className="btn btn-primary" data-accion="agregar-activo" onClick={() => setEditando({ kind: vista, status: "available", phone_type: "app" })}>
              ＋ {vista === "email" ? t("Add email", "Agregar correo") : t("Add number", "Agregar número")}
            </button>
          )}
        </div>
      </div>

      <div className="card" data-tabla-a-todo-el-ancho>
        {estado === "sinTabla" && (
          <div className="hint" data-aviso="211" style={{ background: "var(--tint-warn)", border: "1px solid var(--tint-warn-line)", borderRadius: 8, padding: "8px 12px", marginBottom: 10 }}>
            {t("Migration 211 is not applied yet: the company assets table does not exist.", "Falta aplicar la migración 211: la tabla de activos no existe todavía.")}
          </div>
        )}
        {err && estado === "error" && <div className="hint" style={{ color: "var(--red)" }}>{err}</div>}
        {estado === "cargando" && <div className="hint">{t("Loading…", "Cargando…")}</div>}

        {estado === "listo" && vista !== "personas" && (
          <>
            <div className="filters">
              <BuscadorConBorrar maxWidth={260} valor={buscar} onValor={setBuscar} placeholder={t("Search…", "Buscar…")} />
            </div>
            <div className="filters filters-oneline">
              <button className={"chip" + (filtroEstado === "" ? " on" : "")} data-estado="" onClick={() => setFiltroEstado("")}>{t("All", "Todos")}<span className="cnt">{delTipo.length}</span></button>
              {ESTADOS.map((e) => (
                <button key={e.key} className={"chip" + (filtroEstado === e.key ? " on" : "") + (e.key === "pending_backup" ? " chip-pend" : "")} data-estado={e.key}
                  onClick={() => setFiltroEstado(filtroEstado === e.key ? "" : e.key)}>
                  {t(e.en, e.es)}<span className="cnt">{cuenta[e.key]}</span>
                </button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", margin: "6px 0" }}>
              <FiltrosPuestos estado={orden} columnas={columnas} lang={lang} t={t} />
            </div>
            <div className="tbl-scroll tbl-fit tbl-caja">
              <table className="orders tbl-resize" style={anchoDeTabla([...columnas.map(ancho), 230])} data-tabla-de-activos={vista}>
                <colgroup>
                  {columnas.map((c) => <col key={c.key} style={{ width: ancho(c) }} />)}
                  <col style={{ width: 230 }} />
                </colgroup>
                <thead>
                  <tr>
                    {columnas.map((c) => (
                      <th key={c.key}>
                        <CabeceraConMenu estado={orden} col={c} lang={lang} t={t} />
                        <span className="col-resizer" onMouseDown={colw.startResize(c.key, c.ancho)} onDoubleClick={() => colw.resetCol(c.key)} data-asa-de={c.key} />
                      </th>
                    ))}
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {orden.visibles.length === 0 && (
                    <tr><td colSpan={columnas.length + 1} className="hint">{t("Nothing here.", "Nada por aquí.")}</td></tr>
                  )}
                  {orden.visibles.map((a) => (
                    <tr key={a.id} data-activo={a.id}>
                      {columnas.map((c) => (
                        <td key={c.key} style={c.key === "value" ? { fontWeight: 700 } : undefined}>
                          {c.key === "status" ? <InsigniaDeEstado estado={a.status} lang={lang} />
                            : c.key === "cost_year" ? (a.cost_year != null ? `$${a.cost_year.toFixed(2)}` : "—")
                            : (valorDe(c.key, a) ?? "—")}
                        </td>
                      ))}
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        {a.status === "available" && (
                          <button className="btn btn-green btn-sm" data-accion="asignar" disabled={busy} onClick={() => setAsignando(a)}>{t("Assign", "Asignar")}</button>
                        )}
                        {a.status === "assigned" && (
                          <button className="btn btn-ghost btn-sm" data-accion="liberar" disabled={busy} onClick={() => void corre(() => releaseAsset(a.id))}>{t("Release", "Liberar")}</button>
                        )}
                        {a.status === "pending_backup" && (
                          <button className="btn btn-ghost btn-sm" data-accion="respaldado" disabled={busy} title={t("Mark as backed up: it becomes available", "Marcar respaldado: pasa a disponible")}
                            onClick={() => void corre(() => releaseAsset(a.id, "available"))}>✓ {t("Backed up", "Respaldado")}</button>
                        )}
                        <button className="btn btn-ghost btn-sm" data-accion="editar-activo" disabled={busy} onClick={() => setEditando(a)}>✏️</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <MenuDeColumnaAbierto estado={orden} columnas={columnas} lang={lang} t={t} />
          </>
        )}

        {estado === "listo" && vista === "personas" && (
          <>
            <p className="hint" style={{ marginTop: 0 }}>{t("Active employees: who has a company email and a phone number, and who does not.", "Empleados activos: quién tiene correo y número de la empresa, y quién no.")}</p>
            <div className="tbl-scroll tbl-fit tbl-caja">
              <table className="orders" data-tabla-por-persona>
                <thead><tr><th>{t("Employee", "Empleado")}</th><th>{t("Email", "Correo")}</th><th>{t("Line", "Línea")}</th></tr></thead>
                <tbody>
                  {vistaPersonas.map((p) => (
                    <tr key={p.id} data-persona={p.id}>
                      <td style={{ fontWeight: 700 }}>{p.full_name}</td>
                      <td>{p.email ? p.email.value : <span className="badge" style={{ background: "var(--tint-warn)", color: "var(--ink)", border: "1px solid var(--tint-warn-line)" }}>{t("none", "sin correo")}</span>}</td>
                      <td>{p.phone ? `${textoDeTelefono(p.phone)} · ${etiquetaDeTipoDeTelefono(p.phone.phone_type, lang)}` : <span className="badge" style={{ background: "var(--tint-warn)", color: "var(--ink)", border: "1px solid var(--tint-warn-line)" }}>{t("none", "sin número")}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {editando && (
        <EditarActivo activo={editando} busy={busy} onClose={() => setEditando(null)}
          onSave={async (input) => { if (await corre(async () => { const r = await saveAsset(input); return r.ok ? { ok: true } : r; })) setEditando(null); }}
          onDelete={editando.id ? borraEditando : undefined} />
      )}
      {asignando && (
        <AsignarActivo activo={asignando} personas={activas} busy={busy} onClose={() => setAsignando(null)}
          onAssign={async (employeeId) => { if (await corre(() => assignAsset(asignando.id, employeeId))) setAsignando(null); }} />
      )}
    </>
  );
}

export function InsigniaDeEstado({ estado, lang }: { estado: EstadoDeActivo; lang: "en" | "es" }) {
  const estilo: Record<EstadoDeActivo, React.CSSProperties> = {
    assigned: { background: "var(--tint-green)", color: "var(--green)" },
    available: { background: "var(--tint-blue)", color: "var(--blue)" },
    not_in_use: { background: "var(--paper)", color: "var(--gray)" },
    pending_backup: { background: "var(--tint-warn)", color: "var(--ink)", border: "1px solid var(--tint-warn-line)" },
  };
  return <span className="badge" data-estado-de-activo={estado} style={estilo[estado]}>{etiquetaDeEstado(estado, lang)}</span>;
}

function EditarActivo({ activo, busy, onClose, onSave, onDelete }: {
  activo: Partial<Activo> & { kind: TipoDeActivo }; busy: boolean; onClose: () => void;
  onSave: (input: Parameters<typeof saveAsset>[0]) => Promise<void>; onDelete?: () => Promise<void>;
}) {
  const { t } = usePrefs();
  const [f, setF] = useState({
    value: activo.value ?? "", ext: activo.ext ?? "", phone_type: (activo.phone_type ?? "app") as TipoDeTelefono,
    status: (activo.status ?? "available") as EstadoDeActivo, plan: activo.plan ?? "", cost_year: activo.cost_year != null ? String(activo.cost_year) : "", note: activo.note ?? "",
  });
  const esTel = activo.kind === "phone";
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()} data-dialogo="activo">
        <h3 style={{ margin: 0 }}>{activo.id ? "✏️" : "＋"} {esTel ? t("Line", "Línea") : t("Email", "Correo")}</h3>
        <div className="grid g2" style={{ marginTop: 12 }}>
          <div style={{ gridColumn: esTel ? undefined : "1 / -1" }}>
            <label>{esTel ? t("Line", "Línea") : t("Email", "Correo")}</label>
            <input value={f.value} autoFocus onChange={(e) => setF({ ...f, value: e.target.value })} placeholder={esTel ? "956-555-0123" : "name@rdztilegroup.net"} />
          </div>
          {esTel && <div><label>{t("Extension", "Extensión")}</label><input value={f.ext} inputMode="numeric" onChange={(e) => setF({ ...f, ext: e.target.value })} /></div>}
          {esTel && (
            <div>
              <label>{t("Type", "Tipo")}</label>
              <select value={f.phone_type} onChange={(e) => setF({ ...f, phone_type: e.target.value as TipoDeTelefono })}>
                {TIPOS_DE_TELEFONO.map((p) => <option key={p.key} value={p.key}>{t(p.en, p.es)}</option>)}
              </select>
            </div>
          )}
          <div>
            <label>{t("Status", "Estado")}</label>
            <select value={f.status} disabled={activo.status === "assigned"} title={activo.status === "assigned" ? t("Release it to change the status", "Libéralo para cambiar el estado") : undefined}
              onChange={(e) => setF({ ...f, status: e.target.value as EstadoDeActivo })}>
              {ESTADOS.filter((e) => e.key !== "assigned" || activo.status === "assigned").map((e) => <option key={e.key} value={e.key}>{t(e.en, e.es)}</option>)}
            </select>
          </div>
          {!esTel && <div><label>{t("Plan", "Plan")}</label><input value={f.plan} onChange={(e) => setF({ ...f, plan: e.target.value })} placeholder="Microsoft 365 …" /></div>}
          {!esTel && <div><label>{t("Cost / year (USD)", "Costo al año (USD)")}</label><input value={f.cost_year} inputMode="decimal" onChange={(e) => setF({ ...f, cost_year: e.target.value })} placeholder="259.80" /></div>}
          <div style={{ gridColumn: "1 / -1" }}><label>{t("Note", "Nota")}</label><input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></div>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 14, justifyContent: "flex-end", flexWrap: "wrap" }}>
          {onDelete && <button className="btn btn-danger btn-sm" disabled={busy} data-accion="borrar-activo" onClick={() => void onDelete()} style={{ marginRight: "auto" }}>{t("Delete", "Borrar")}</button>}
          <button className="btn btn-ghost" onClick={onClose}>{t("Cancel", "Cancelar")}</button>
          <button className="btn btn-primary" disabled={busy || !f.value.trim()} data-accion="guardar-activo"
            onClick={() => void onSave({ id: activo.id, kind: activo.kind, value: f.value, ext: f.ext, phone_type: f.phone_type, status: f.status, plan: f.plan,
              cost_year: f.cost_year.trim() === "" ? null : Number(f.cost_year.replace(/[$,\s]/g, "")), note: f.note })}>
            {t("Save", "Guardar")}
          </button>
        </div>
      </div>
    </div>
  );
}

function AsignarActivo({ activo, personas, busy, onClose, onAssign }: {
  activo: Activo; personas: { id: string; full_name: string }[]; busy: boolean; onClose: () => void; onAssign: (employeeId: string) => Promise<void>;
}) {
  const { t, lang } = usePrefs();
  const [quien, setQuien] = useState("");
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()} data-dialogo="asignar-activo">
        <h3 style={{ margin: 0 }}>{t("Assign", "Asignar")} {activo.kind === "phone" ? textoDeTelefono(activo) : activo.value}</h3>
        {activo.kind === "phone" && <p className="hint">{etiquetaDeTipoDeTelefono(activo.phone_type, lang)}</p>}
        <div style={{ marginTop: 12 }}>
          <label>{t("Employee", "Empleado")}</label>
          <select value={quien} autoFocus onChange={(e) => setQuien(e.target.value)} data-elige-persona>
            <option value="">{t("— choose —", "— elige —")}</option>
            {personas.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 14, justifyContent: "flex-end" }}>
          <button className="btn btn-ghost" onClick={onClose}>{t("Cancel", "Cancelar")}</button>
          <button className="btn btn-primary" disabled={busy || !quien} data-accion="confirmar-asignar" onClick={() => void onAssign(quien)}>{t("Assign", "Asignar")}</button>
        </div>
      </div>
    </div>
  );
}

/** Lo que la ficha del empleado usa para elegir entre los libres (D-730). */
export function opcionesLibres(activos: readonly Activo[], kind: TipoDeActivo) {
  return libres(activos, kind);
}
