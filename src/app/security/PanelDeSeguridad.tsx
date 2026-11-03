"use client";

import { useMemo, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { nombrePorAgente, type EstadoDeDispositivo, type TipoDeDispositivo } from "@/lib/security/reglas";
import { borraDispositivo, cambiaEstadoDeDispositivo, cambiaPolitica, renombraDispositivo } from "./actions";

export interface DispositivoFila {
  id: string; label: string | null; kind: string; status: string; user_agent: string | null;
  first_seen_at: string; last_seen_at: string; first_user_id: string | null; last_user_id: string | null;
  approved_at: string | null; revoked_at: string | null; notes: string | null;
  bound: boolean; requested_at: string | null; requested_by: string | null; request_note: string | null;
  primero: string; ultimo: string; personas: number; solicitante: string;
}
export interface UsoFila {
  device_id: string; user_id: string; first_seen_at: string; last_seen_at: string; seen_count: number;
  persona: string; rol: string; tienda: string | null;
  dispositivo: { id: string; label: string | null; kind: string; status: string; user_agent: string | null } | null;
}

/** «Activo» = visto en la última hora: lo que el dueño llama «cuántos users están activos». */
const ACTIVO_MS = 60 * 60 * 1000;

const TIPO: Record<string, { en: string; es: string; icono: string }> = {
  desktop: { en: "RTG Hub app", es: "App RTG Hub", icono: "🖥️" },
  phone: { en: "Phone", es: "Teléfono", icono: "📱" },
  browser: { en: "Browser", es: "Navegador", icono: "🌐" },
};
const ESTADO: Record<string, { en: string; es: string; color: string }> = {
  pending: { en: "Pending", es: "Pendiente", color: "var(--amber)" },
  approved: { en: "Approved", es: "Aprobado", color: "var(--green)" },
  revoked: { en: "Revoked", es: "Revocado", color: "var(--red)" },
};

const nombreDe = (d: { label: string | null; user_agent: string | null } | null) => d ? (d.label || nombrePorAgente(d.user_agent)) : "—";

export function PanelDeSeguridad({ enforced, cambiadaEn, dispositivos, uso, esteDispositivo, error }: {
  enforced: boolean; cambiadaEn: string | null; dispositivos: DispositivoFila[]; uso: UsoFila[]; esteDispositivo: string | null; error: string | null;
}) {
  const { t, lang } = usePrefs();
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<"todos" | EstadoDeDispositivo>("todos");
  const [editando, setEditando] = useState<string | null>(null);
  const [confirmaInterruptor, setConfirmaInterruptor] = useState(false);
  const fecha = (s: string | null) => s ? new Date(s).toLocaleString(lang === "es" ? "es-MX" : "en-US", { dateStyle: "short", timeStyle: "short" }) : "—";
  const ahora = Date.now();

  const corre = async (f: () => Promise<{ ok: boolean; message?: string }>) => {
    setOcupado(true); setAviso(null);
    const r = await f();
    if (!r.ok) setAviso(r.message ?? "Error");
    setOcupado(false);
  };

  const lista = useMemo(() => dispositivos.filter((d) => filtro === "todos" || d.status === filtro), [dispositivos, filtro]);
  const cuenta = (s: string) => dispositivos.filter((d) => d.status === s).length;
  const activos = uso.filter((u) => ahora - Date.parse(u.last_seen_at) < ACTIVO_MS);
  const activosPorPersona = new Map<string, UsoFila>();
  for (const u of activos) if (!activosPorPersona.has(u.user_id)) activosPorPersona.set(u.user_id, u);

  return (
    <div className="container" style={{ padding: "16px 20px", maxWidth: 1200 }}>
      <h1 style={{ margin: "0 0 4px" }}>🔐 {t("Security", "Seguridad")}</h1>
      <p className="hint" style={{ marginTop: 0 }}>
        {t("Registered devices, who signs in from where, and the device rule switch.", "Dispositivos registrados, quién entra desde dónde, y el interruptor de la regla por dispositivo.")}
      </p>
      {error && <div className="card" style={{ borderColor: "var(--red)" }}>{t("Could not read the security tables (is migration 229 applied?):", "No se pudieron leer las tablas de seguridad (¿está aplicada la 229?):")} {error}</div>}
      {aviso && <div className="card" style={{ borderColor: "var(--red)" }}>{aviso}</div>}

      {/* El interruptor */}
      <div className="card" data-bloque="politica" style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", borderColor: enforced ? "var(--green)" : "var(--line)" }}>
        <span className="badge" data-politica={enforced ? "on" : "off"} style={{ background: enforced ? "var(--tint-green)" : "var(--tint-amber, #fff4d6)", color: enforced ? "var(--green)" : "var(--amber)" }}>
          {enforced ? t("RULE ON", "REGLA ENCENDIDA") : t("RULE OFF", "REGLA APAGADA")}
        </span>
        <span style={{ flex: 1, minWidth: 260 }}>
          {enforced
            ? t("Managers, sales, office and logistics only get in from approved devices. Admin, warehouse and drivers are not limited.", "Managers, ventas, oficina y logística solo entran desde dispositivos aprobados. Admin, almacén y choferes no tienen límite.")
            : t("Nothing is blocked yet. Devices are being registered so the list is ready when you turn it on.", "Todavía no se bloquea nada. Los dispositivos se van registrando para que la lista esté lista cuando la enciendas.")}
          {cambiadaEn && <span className="hint" style={{ marginLeft: 6 }}>({t("changed", "cambiada")} {fecha(cambiadaEn)})</span>}
        </span>
        {!confirmaInterruptor ? (
          <button className={enforced ? "btn btn-danger" : "btn btn-green"} disabled={ocupado || !!error} data-accion="interruptor" onClick={() => setConfirmaInterruptor(true)}>
            {enforced ? t("Turn off", "Apagar") : t("Turn on", "Encender")}
          </button>
        ) : (
          <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <b>{enforced ? t("Turn the rule off?", "¿Apagar la regla?") : t("Turn the rule on for everyone now?", "¿Encender la regla para todos ahora?")}</b>
            <button className="btn btn-sm btn-green" disabled={ocupado} data-accion="interruptor-confirma" onClick={() => { void corre(() => cambiaPolitica(!enforced)); setConfirmaInterruptor(false); }}>{t("Yes", "Sí")}</button>
            <button className="btn btn-sm btn-ghost" onClick={() => setConfirmaInterruptor(false)}>{t("No", "No")}</button>
          </span>
        )}
      </div>

      {/* Solicitudes: quien se quedó fuera y pidió entrar */}
      {dispositivos.some((d) => d.requested_at && d.status !== "approved") && (
        <div className="card" data-bloque="solicitudes" style={{ borderColor: "var(--amber)", marginTop: 12 }}>
          <b>🔔 {t("Authorization requests", "Solicitudes de autorización")}</b>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {dispositivos.filter((d) => d.requested_at && d.status !== "approved").map((d) => (
              <li key={d.id} data-solicitud={d.id} style={{ marginBottom: 4 }}>
                <b>{d.solicitante}</b> · {TIPO[d.kind]?.icono} {nombreDe(d)} · {fecha(d.requested_at)}
                {d.request_note && <> — <i>«{d.request_note}»</i></>}
                <button className="btn btn-sm btn-green" style={{ marginLeft: 8 }} disabled={ocupado} data-accion="aprobar-solicitud"
                  onClick={() => void corre(() => cambiaEstadoDeDispositivo(d.id, "approved"))}>✓ {t("Approve", "Aprobar")}</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Activos ahora */}
      <h2 style={{ margin: "18px 0 6px" }}>{t("Active in the last hour", "Activos en la última hora")} <span className="cnt">{activosPorPersona.size}</span></h2>
      <div style={{ overflowX: "auto" }}>
        <table className="tabla" data-tabla="activos">
          <thead><tr><th>{t("Person", "Persona")}</th><th>{t("Role", "Rol")}</th><th>{t("Store", "Tienda")}</th><th>{t("Device", "Dispositivo")}</th><th>{t("Status", "Estado")}</th><th>{t("Last seen", "Última vez")}</th></tr></thead>
          <tbody>
            {activosPorPersona.size === 0 && <tr><td colSpan={6} className="hint">{t("Nobody in the last hour.", "Nadie en la última hora.")}</td></tr>}
            {[...activosPorPersona.values()].map((u) => (
              <tr key={u.user_id}>
                <td><b>{u.persona}</b></td><td>{u.rol}</td><td>{u.tienda ?? "—"}</td>
                <td>{u.dispositivo ? `${TIPO[u.dispositivo.kind]?.icono ?? ""} ${nombreDe(u.dispositivo)}` : "—"}</td>
                <td>{u.dispositivo ? <span style={{ color: ESTADO[u.dispositivo.status]?.color }}>{t(ESTADO[u.dispositivo.status]?.en ?? "", ESTADO[u.dispositivo.status]?.es ?? "")}</span> : "—"}</td>
                <td>{fecha(u.last_seen_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Dispositivos */}
      <h2 style={{ margin: "18px 0 6px" }}>{t("Devices", "Dispositivos")}</h2>
      <div className="ld-vistas" role="group" style={{ marginBottom: 8 }}>
        {(["todos", "pending", "approved", "revoked"] as const).map((k) => (
          <button key={k} type="button" className={`chip${filtro === k ? " on" : ""}`} data-filtro-estado={k} onClick={() => setFiltro(k)}>
            {k === "todos" ? t("All", "Todos") : t(ESTADO[k].en, ESTADO[k].es)} <span className="cnt">{k === "todos" ? dispositivos.length : cuenta(k)}</span>
          </button>
        ))}
      </div>
      <div style={{ overflowX: "auto" }}>
        <table className="tabla" data-tabla="dispositivos">
          <thead><tr>
            <th>{t("Name", "Nombre")}</th><th>{t("Type", "Tipo")}</th><th>{t("Status", "Estado")}</th><th>{t("First seen", "Primera vez")}</th><th>{t("Last seen", "Última vez")}</th><th>{t("Last user", "Último usuario")}</th><th>{t("People", "Personas")}</th><th>{t("Code", "Código")}</th><th></th>
          </tr></thead>
          <tbody>
            {lista.length === 0 && <tr><td colSpan={9} className="hint">{t("No devices here.", "No hay dispositivos aquí.")}</td></tr>}
            {lista.map((d) => (
              <FilaDeDispositivo key={d.id} d={d} esEste={d.id === esteDispositivo} editando={editando === d.id} ocupado={ocupado} fecha={fecha}
                abre={() => setEditando(editando === d.id ? null : d.id)} corre={corre} />
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">
        {t("A device is registered the first time someone opens the hub from it; it starts as pending. The code is what a blocked person sees on their screen.",
          "Un dispositivo se registra la primera vez que alguien abre el hub desde él; nace pendiente. El código es lo que ve en su pantalla una persona bloqueada.")}
      </p>
    </div>
  );
}

function FilaDeDispositivo({ d, esEste, editando, ocupado, fecha, abre, corre }: {
  d: DispositivoFila; esEste: boolean; editando: boolean; ocupado: boolean; fecha: (s: string | null) => string; abre: () => void;
  corre: (f: () => Promise<{ ok: boolean; message?: string }>) => Promise<void>;
}) {
  const { t } = usePrefs();
  const [label, setLabel] = useState(d.label ?? "");
  const [kind, setKind] = useState<TipoDeDispositivo>((d.kind as TipoDeDispositivo) || "browser");
  const [notes, setNotes] = useState(d.notes ?? "");
  const tipo = TIPO[d.kind] ?? TIPO.browser;
  const estado = ESTADO[d.status] ?? ESTADO.pending;
  return (
    <>
      <tr data-dispositivo={d.id} data-estado={d.status} style={esEste ? { outline: "2px solid var(--amber)", outlineOffset: -2 } : undefined}>
        <td title={d.user_agent ?? undefined}><b>{nombreDe(d)}</b>{esEste && <span className="hint" style={{ margin: 0 }}> · {t("this one", "este")}</span>}</td>
        <td>{tipo.icono} {t(tipo.en, tipo.es)}{d.bound && <span className="hint" style={{ margin: 0 }} title={t("Machine-bound id from the desktop app: cannot be copied", "Id ligado a la máquina por la app de escritorio: no se copia")}> 🔗</span>}</td>
        <td><span className="sema" style={{ background: estado.color, color: "#fff" }}>{t(estado.en, estado.es)}</span></td>
        <td>{fecha(d.first_seen_at)}<div className="hint" style={{ margin: 0 }}>{d.primero}</div></td>
        <td>{fecha(d.last_seen_at)}</td>
        <td>{d.ultimo}</td>
        <td>{d.personas}</td>
        <td style={{ fontFamily: "monospace" }}>{d.id.slice(0, 8).toUpperCase()}</td>
        <td style={{ whiteSpace: "nowrap", display: "flex", gap: 4 }}>
          {d.status !== "approved" && (
            <button className="btn btn-sm btn-green" disabled={ocupado} data-accion="aprobar" onClick={() => void corre(() => cambiaEstadoDeDispositivo(d.id, "approved", label || undefined))}>✓ {t("Approve", "Aprobar")}</button>
          )}
          {d.status === "approved" && (
            <button className="btn btn-sm btn-danger" disabled={ocupado} data-accion="revocar" onClick={() => void corre(() => cambiaEstadoDeDispositivo(d.id, "revoked"))}>✕ {t("Revoke", "Revocar")}</button>
          )}
          <button className="btn btn-sm btn-ghost" data-accion="editar" onClick={abre}>✏️</button>
          {d.status !== "approved" && (
            <button className="btn btn-sm btn-ghost" disabled={ocupado} data-accion="borrar" title={t("Delete (never approved)", "Borrar (nunca aprobado)")} onClick={() => void corre(() => borraDispositivo(d.id))}>🗑</button>
          )}
        </td>
      </tr>
      {editando && (
        <tr data-edicion={d.id}>
          <td colSpan={9}>
            <div style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
              <label className="field" style={{ minWidth: 220 }}>
                <span>{t("Name", "Nombre")}</span>
                <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t("e.g. Sales McAllen 1", "p. ej. Sales McAllen 1")} />
              </label>
              <label className="field">
                <span>{t("Type", "Tipo")}</span>
                <select value={kind} onChange={(e) => setKind(e.target.value as TipoDeDispositivo)}>
                  {(["desktop", "phone", "browser"] as const).map((k) => <option key={k} value={k}>{TIPO[k].icono} {t(TIPO[k].en, TIPO[k].es)}</option>)}
                </select>
              </label>
              <label className="field" style={{ minWidth: 260, flex: 1 }}>
                <span>{t("Notes", "Notas")}</span>
                <input value={notes} onChange={(e) => setNotes(e.target.value)} />
              </label>
              <button className="btn btn-sm" disabled={ocupado} data-accion="guardar" onClick={() => { void corre(() => renombraDispositivo(d.id, label, kind, notes)); abre(); }}>{t("Save", "Guardar")}</button>
            </div>
            <div className="hint" style={{ marginTop: 6 }}>
              {t("A phone only opens Time Tracker (and Quote Builder during a customer visit). A computer opens everything.", "Un teléfono solo abre Time Tracker (y Quote Builder durante una visita a cliente). Una computadora abre todo.")}
              {d.user_agent && <> · <span style={{ wordBreak: "break-all" }}>{d.user_agent}</span></>}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
