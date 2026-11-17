"use client";

import { useState, type ReactNode } from "react";
import { usePrefs } from "@/lib/prefs";
import { TablaEstandar, type ColumnaEstandar } from "@/components/TablaEstandar";
import { bloqueaIpDeAlerta, cierraSesionesDeAlerta, marcaAlerta, quitaBloqueoDeIp } from "./actions";

/** Monitoreo (320): las alertas, los bloqueos activos y el rastro de eventos. Va dentro del panel de Seguridad. */

export interface AlertaFila {
  id: number; creada_en: string; detector: string; severidad: number; usuario_id: string | null; ip: string | null;
  resumen: string; estado: "abierta" | "vista" | "cerrada"; cerrada_en: string | null; accion: Record<string, unknown> | null;
  /** Quién es, si hay usuario: nombre y rol, resueltos en el servidor. */
  persona: string; rol: string;
}
export interface BloqueoIpFila {
  id: number; alcance: string; valor: string; motivo: string | null; hasta: string; origen: "auto" | "admin"; creado_en: string;
}
export interface EventoFila {
  id: number; ts: string; categoria: string; severidad: number; usuario_id: string | null; persona: string; rol: string | null; ip: string | null;
  ip_pais: string | null; metodo: string | null; ruta: string | null; estado: number | null; objetivo_tipo: string | null; filas: number | null;
}

/** Nombres en español de los detectores (los que se guardan en la base son claves). */
const DETECTOR: Record<string, [string, string]> = {
  "login-fallido-identificador": ["Failed sign-ins on one account", "Fallos de entrada a una misma cuenta"],
  "login-fallido-ip": ["Failed sign-ins from one IP", "Fallos de entrada desde una misma IP"],
  "pais-nuevo": ["Sign-in from a new country", "Entrada desde un país nuevo"],
  "exportacion-volumen": ["Large export", "Exportación grande"],
  "exportacion-frecuencia": ["Many exports", "Muchas exportaciones"],
  "admin-nuevo": ["New admin granted", "Nuevo admin"],
  "impersonacion-horario": ["Sign-in as someone outside hours", "Entrar como otra persona fuera de horario"],
  "api-denegada": ["Many denied requests", "Muchas peticiones denegadas"],
  "ratelimit-ip": ["Rate limit hits from one IP", "Límite de peticiones desde una IP"],
  "latido-cron": ["Time Tracker cron stopped", "El cron del Time Tracker se detuvo"],
  "login-fallido-ip-agrupado": ["Failed sign-ins from one IP (grouped)", "Fallos desde una IP (agrupados)"],
  "resumen-horario": ["Hourly summary", "Resumen de la hora"],
};

const CATEGORIA: Record<string, [string, string]> = {
  auth: ["Sign-in", "Entrada"], api_denied: ["Denied request", "Petición denegada"], export: ["Export", "Exportación"],
  admin: ["Admin change", "Cambio de admin"], device: ["Device", "Dispositivo"], ratelimit: ["Rate limit", "Límite"],
  upload: ["Upload", "Subida"], cron: ["Cron", "Cron"], impersonation: ["Sign in as", "Entrar como"],
};

const COLOR_SEV = (s: number) => (s >= 4 ? "var(--red)" : s === 3 ? "var(--amber)" : "var(--gray)");

export function PanelDeAlertas({ alertas, bloqueos, eventos, eventosDisponibles = true }: {
  alertas: AlertaFila[]; bloqueos: BloqueoIpFila[]; eventos: EventoFila[]; eventosDisponibles?: boolean;
}) {
  const { t, lang } = usePrefs();
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [soloAbiertas, setSoloAbiertas] = useState(true);
  const [categoria, setCategoria] = useState<string>("todas");

  const fecha = (s: string | null) => (s ? new Date(s).toLocaleString(lang === "es" ? "es-MX" : "en-US", { dateStyle: "short", timeStyle: "short" }) : "—");
  const nombreDe = (k: string, i: 0 | 1) => (DETECTOR[k]?.[i] ?? k);
  const corre = async (f: () => Promise<{ ok: boolean; message?: string }>) => {
    setOcupado(true); setAviso(null);
    const r = await f();
    if (!r.ok) setAviso(r.message ?? t("Error", "Error"));
    setOcupado(false);
  };

  const abiertas = alertas.filter((a) => a.estado !== "cerrada");
  const lista = soloAbiertas ? abiertas : alertas;

  const columnasAlertas: ColumnaEstandar<AlertaFila>[] = [
    { key: "sev", en: "Severity", es: "Severidad", valor: (a) => a.severidad, ancho: 90,
      celda: (a) => <b style={{ color: COLOR_SEV(a.severidad) }} data-sev={a.severidad}>{a.severidad}/5</b> },
    { key: "cuando", en: "When", es: "Cuándo", valor: (a) => a.creada_en, celda: (a) => fecha(a.creada_en), ancho: 130 },
    { key: "detector", en: "Detector", es: "Detector", valor: (a) => nombreDe(a.detector, lang === "es" ? 1 : 0), ancho: 200 },
    { key: "quien", en: "Subject", es: "Asunto", valor: (a) => a.persona !== "—" ? `${a.persona} · ${a.rol}` : (a.ip ?? "—"), ancho: 180,
      celda: (a) => a.persona !== "—" ? `${a.persona} · ${a.rol}` : (a.ip ? `IP ${a.ip}` : "—") },
    { key: "resumen", en: "Summary", es: "Resumen", valor: (a) => a.resumen, envuelve: true, ancho: 340 },
    { key: "estado", en: "Status", es: "Estado", valor: (a) => a.estado,
      celda: (a) => ({ abierta: t("Open", "Abierta"), vista: t("Seen", "Vista"), cerrada: t("Closed", "Cerrada") })[a.estado] },
  ];

  const accionesAlerta = (a: AlertaFila): ReactNode => {
    const esAdmin = a.rol === "admin";
    return (
      <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
        {a.estado === "abierta" && (
          <button type="button" className="btn btn-sm btn-ghost" disabled={ocupado} data-accion="alerta-vista"
            onClick={() => void corre(() => marcaAlerta(a.id, "vista"))}>{t("Mark seen", "Marcar vista")}</button>
        )}
        {a.estado !== "cerrada" && (
          <button type="button" className="btn btn-sm btn-ghost" disabled={ocupado} data-accion="alerta-cerrar"
            onClick={() => void corre(() => marcaAlerta(a.id, "cerrada"))}>{t("Close", "Cerrar")}</button>
        )}
        {a.ip && (
          <button type="button" className="btn btn-sm btn-ghost" disabled={ocupado} data-accion="alerta-bloquea-ip"
            onClick={() => void corre(() => bloqueaIpDeAlerta(a.ip!, 24, `Desde alerta: ${nombreDe(a.detector, 0)}`))}>{t("Block IP 24 h", "Bloquear IP 24 h")}</button>
        )}
        {a.usuario_id && (
          <button type="button" className="btn btn-sm btn-ghost" disabled={ocupado || esAdmin} data-accion="alerta-cierra-sesiones"
            title={esAdmin ? t("Admin accounts are never signed out from an alert.", "Una cuenta admin nunca se cierra desde una alerta.") : undefined}
            onClick={() => void corre(() => cierraSesionesDeAlerta(a.usuario_id!))}>{t("Sign out their sessions", "Cerrar sus sesiones")}</button>
        )}
      </span>
    );
  };

  const columnasBloqueos: ColumnaEstandar<BloqueoIpFila>[] = [
    { key: "valor", en: "IP", es: "IP", valor: (b) => b.valor, ancho: 160 },
    { key: "motivo", en: "Reason", es: "Motivo", valor: (b) => b.motivo, envuelve: true, ancho: 320 },
    { key: "origen", en: "Origin", es: "Origen", valor: (b) => b.origen, celda: (b) => (b.origen === "auto" ? t("Automatic", "Automático") : t("Admin", "Admin")), ancho: 110 },
    { key: "hasta", en: "Until", es: "Hasta", valor: (b) => b.hasta, celda: (b) => fecha(b.hasta), ancho: 130 },
  ];

  const columnasEventos: ColumnaEstandar<EventoFila>[] = [
    { key: "ts", en: "When", es: "Cuándo", valor: (e) => e.ts, celda: (e) => fecha(e.ts), ancho: 130 },
    { key: "categoria", en: "Type", es: "Tipo", valor: (e) => e.categoria, celda: (e) => (CATEGORIA[e.categoria]?.[lang === "es" ? 1 : 0] ?? e.categoria), ancho: 140 },
    { key: "sev", en: "Sev.", es: "Sev.", valor: (e) => e.severidad, ancho: 60 },
    { key: "quien", en: "Who", es: "Quién", valor: (e) => e.persona, celda: (e) => (e.persona !== "—" ? `${e.persona}${e.rol ? ` · ${e.rol}` : ""}` : "—"), ancho: 180 },
    { key: "ip", en: "IP", es: "IP", valor: (e) => e.ip, celda: (e) => (e.ip ? `${e.ip}${e.ip_pais ? ` (${e.ip_pais})` : ""}` : "—"), ancho: 170 },
    { key: "accion", en: "Action", es: "Acción", valor: (e) => [e.metodo, e.ruta].filter(Boolean).join(" "), ancho: 240, envuelve: true },
    { key: "estado", en: "Status", es: "Código", valor: (e) => e.estado, ancho: 70 },
    { key: "filas", en: "Rows", es: "Filas", valor: (e) => e.filas, numerico: true, ancho: 70 },
  ];

  const eventosFiltrados = categoria === "todas" ? eventos : eventos.filter((e) => e.categoria === categoria);
  const categorias = Object.keys(CATEGORIA);

  return (
    <section id="sec-alertas" className="sec-sec" data-bloque="alertas">
      <div className="sec-sec-head">
        <h2>🚨 {t("Alerts", "Alertas")}</h2>
        <span className="cnt">{abiertas.length}</span>
        <span className="sec-sub">· {t("open", "abiertas")}</span>
        <div className="sec-acciones">
          <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 13 }}>
            <input type="checkbox" checked={soloAbiertas} onChange={(e) => setSoloAbiertas(e.target.checked)} />
            {t("Only open", "Solo abiertas")}
          </label>
        </div>
      </div>
      {aviso && <div className="card" style={{ borderColor: "var(--red)", margin: "0 0 8px" }}>{aviso}</div>}
      <TablaEstandar id="seguridad-alertas" data-tabla="seguridad-alertas" filas={lista} columnas={columnasAlertas} claveDe={(a) => String(a.id)}
        acciones={accionesAlerta} anchoDeAcciones={360}
        vacio={t("No alerts. Nothing unusual in the last hour.", "Sin alertas. Nada raro en la última hora.")} />

      <div className="sec-sec-head" style={{ marginTop: 16 }}>
        <h2>⛔ {t("Active blocks", "Bloqueos activos")}</h2>
        <span className="cnt">{bloqueos.length}</span>
      </div>
      <TablaEstandar id="seguridad-bloqueos-ip" data-tabla="seguridad-bloqueos-ip" filas={bloqueos} columnas={columnasBloqueos} claveDe={(b) => String(b.id)}
        acciones={(b) => (
          <button type="button" className="btn btn-sm btn-ghost" disabled={ocupado} data-accion="quita-bloqueo"
            onClick={() => void corre(() => quitaBloqueoDeIp(b.id))}>{t("Remove", "Quitar")}</button>
        )}
        anchoDeAcciones={110}
        vacio={t("No active blocks.", "No hay bloqueos activos.")} />

      <div className="sec-sec-head" style={{ marginTop: 16 }}>
        <h2>📜 {t("Events", "Eventos")}</h2>
        <span className="cnt">{eventosFiltrados.length}</span>
        <span className="sec-sub">· {t("last 200", "últimos 200")}</span>
        <div className="sec-acciones">
          <select value={categoria} onChange={(e) => setCategoria(e.target.value)} data-campo="categoria-evento" aria-label={t("Type", "Tipo")}>
            <option value="todas">{t("All types", "Todos los tipos")}</option>
            {categorias.map((c) => <option key={c} value={c}>{CATEGORIA[c][lang === "es" ? 1 : 0]}</option>)}
          </select>
        </div>
      </div>
      {!eventosDisponibles && <div className="card" style={{ margin: 0 }}>{t("The events table is not there yet (is migration 320 applied?).", "Aún no está la tabla de eventos (¿está aplicada la 320?).")}</div>}
      {eventosDisponibles && (
        <TablaEstandar id="seguridad-eventos" data-tabla="seguridad-eventos" filas={eventosFiltrados} columnas={columnasEventos} claveDe={(e) => String(e.id)}
          vacio={t("No events.", "No hay eventos.")} />
      )}
    </section>
  );
}
