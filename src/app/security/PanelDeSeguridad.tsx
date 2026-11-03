"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { usePrefs } from "@/lib/prefs";
import { createClient } from "@/lib/supabase/client";
import { nombrePorAgente, type EstadoDeDispositivo, type TipoDeDispositivo } from "@/lib/security/reglas";
import { versionDeApp } from "@/lib/security/version-de-app";
import { useOrdenYFiltro } from "@/lib/use-orden-y-filtro";
import type { ValorDeCelda } from "@/lib/orden-y-filtro";
import { CabeceraConMenu, FiltrosPuestos, MenuDeColumnaAbierto, type ColumnaConMenu } from "@/components/CabeceraConMenu";
import { anchoDeTabla, useColWidthMap } from "@/lib/use-col-widths";
import { BuscadorConBorrar } from "@/components/BuscadorConBorrar";
import { borraDispositivo, cambiaEstadoDeDispositivo, cambiaPolitica, cambiaPoliticaWeb, renombraDispositivo } from "./actions";

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
/** D-818: a quién se le cerró la web (232). */
export interface BloqueoFila {
  id: number; user_id: string; device_id: string | null; user_agent: string | null; path: string | null; at: string;
  persona: string; rol: string; tienda: string | null;
  dispositivo: { id: string; label: string | null; kind: string; status: string; user_agent: string | null } | null;
}

/** D-820: las tablas que, al cambiar, refrescan el panel. Están en la publicación de tiempo real desde la 233. */
export const TABLAS_EN_VIVO = ["security_devices", "security_device_users", "security_policy", "security_web_blocks"] as const;
/** Por si la suscripción se cae sin avisar: un refresco de fondo cada minuto, como red de seguridad. */
const REFRESCO_DE_FONDO_MS = 60 * 1000;

/**
 * D-820: el panel en tiempo real. Se suscribe a las cuatro tablas y, con cualquier cambio, pide al servidor la página
 * otra vez (`router.refresh()`, que vuelve a correr `page.tsx` con la sesión del admin). Se agrupan los cambios de un
 * mismo segundo en un solo refresco. Devuelve si la suscripción está viva, para el puntito.
 */
function useEnVivo(): boolean {
  const router = useRouter();
  const [vivo, setVivo] = useState(false);
  const pendiente = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const supabase = createClient();
    const refresca = () => {
      if (pendiente.current) return;
      pendiente.current = setTimeout(() => { pendiente.current = null; router.refresh(); }, 800);
    };
    let canal = supabase.channel("security-en-vivo");
    for (const table of TABLAS_EN_VIVO) canal = canal.on("postgres_changes", { event: "*", schema: "public", table }, refresca);
    canal.subscribe((estado) => setVivo(estado === "SUBSCRIBED"));
    const fondo = setInterval(() => router.refresh(), REFRESCO_DE_FONDO_MS);
    return () => {
      clearInterval(fondo);
      if (pendiente.current) clearTimeout(pendiente.current);
      void supabase.removeChannel(canal);
    };
  }, [router]);
  return vivo;
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

/** D-815: «RTG Hub 1.1.1 → 1.2.1» en rojo si toca actualizar, «Time Tracker v6 ✓», «Chrome 130». */
function Version({ ua }: { ua: string | null }) {
  const { t } = usePrefs();
  const v = versionDeApp(ua);
  if (v.actualizar) {
    return <span data-version={v.version ?? ""} data-actualizar="si" style={{ color: "var(--red)", fontWeight: 700, whiteSpace: "nowrap" }} title={t(`Needs to update to ${v.minima}`, `Tiene que actualizar a ${v.minima}`)}>⚠️ {v.texto} → {v.minima}</span>;
  }
  return <span data-version={v.version ?? ""} data-actualizar="no" style={{ whiteSpace: "nowrap" }}>{v.app === "browser" ? v.texto : <>{v.texto} <span style={{ color: "var(--green)" }}>✓</span></>}</span>;
}
/** El texto plano de la versión, para ordenar y filtrar por esa columna. */
const textoDeVersion = (ua: string | null) => { const v = versionDeApp(ua); return v.actualizar ? `⚠️ ${v.texto}` : v.texto; };

type Columna = ColumnaConMenu & { ancho: number };
type T = (en: string, es: string) => string;
const ES_FECHA = /^\d{4}-\d{2}-\d{2}T/;

/**
 * D-821: la tabla de Deliveries (Órdenes, D-275) con todo lo suyo, para las tres listas de Security: buscador,
 * menú por columna para ordenar y filtrar (`CabeceraConMenu`), los filtros puestos como chips, anchos ajustables que
 * se recuerdan (`useColWidthMap`), y las mismas clases (`orders`, `tbl-scroll tbl-caja`). Lo que cambia por tabla:
 * las columnas, cómo se saca el valor de cada celda y cómo se pinta.
 */
function TablaDeSecurity<F>({ id, filas, columnas, valorDe, textoDe, claveDe, celda, extra, acciones, anchoDeAcciones = 0, vacio, chips, lang, t }: {
  id: string; filas: readonly F[]; columnas: readonly Columna[];
  valorDe: (clave: string, fila: F) => ValorDeCelda;
  /** Lo que el buscador mira de cada fila. */
  textoDe: (fila: F) => string;
  claveDe: (fila: F) => string;
  celda: (clave: string, fila: F) => ReactNode;
  /** Una fila extra debajo (la edición de un dispositivo). */
  extra?: (fila: F) => ReactNode;
  acciones?: (fila: F) => ReactNode;
  anchoDeAcciones?: number;
  vacio: string;
  /** Lo que va junto al buscador (los chips de estado). */
  chips?: ReactNode;
  lang: "en" | "es"; t: T;
}) {
  const [buscar, setBuscar] = useState("");
  const q = buscar.trim().toLowerCase();
  const buscadas = useMemo(() => q ? filas.filter((f) => textoDe(f).toLowerCase().includes(q)) : filas, [filas, q, textoDe]);
  const orden = useOrdenYFiltro(buscadas, valorDe);
  const colw = useColWidthMap(`security-${id}-anchos`, 140, { minimo: 60 });
  const ancho = (c: Columna) => colw.widthOf(c.key, c.ancho);
  const anchos = [...columnas.map(ancho), ...(acciones ? [anchoDeAcciones] : [])];
  return (
    <>
      <div className="filters" style={{ alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <BuscadorConBorrar maxWidth={260} valor={buscar} onValor={setBuscar} placeholder={t("Search…", "Buscar…")} />
        {chips}
        <span className="hint" style={{ margin: 0 }}>{orden.visibles.length} / {filas.length}</span>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", margin: "6px 0" }}>
        <FiltrosPuestos estado={orden} columnas={columnas} lang={lang} t={t} />
      </div>
      <div className="tbl-scroll tbl-fit tbl-caja">
        <table className="orders tbl-resize" style={anchoDeTabla(anchos)} data-tabla={id}>
          <colgroup>
            {columnas.map((c) => <col key={c.key} style={{ width: ancho(c) }} />)}
            {acciones && <col style={{ width: anchoDeAcciones }} />}
          </colgroup>
          <thead>
            <tr>
              {columnas.map((c) => (
                <th key={c.key}>
                  <CabeceraConMenu estado={orden} col={c} lang={lang} t={t} />
                  <span className="col-resizer" onMouseDown={colw.startResize(c.key, c.ancho)} onDoubleClick={() => colw.resetCol(c.key)} data-asa-de={c.key} />
                </th>
              ))}
              {acciones && <th />}
            </tr>
          </thead>
          <tbody>
            {orden.visibles.length === 0 && <tr><td colSpan={columnas.length + (acciones ? 1 : 0)} className="hint">{vacio}</td></tr>}
            {orden.visibles.map((f) => {
              const ex = extra?.(f);
              const fila = f as F & { id?: string | number; status?: string };
              return (
                <FilaDoble key={claveDe(f)} clave={claveDe(f)} estado={fila.status} celdas={columnas.map((c) => <td key={c.key}>{celda(c.key, f)}</td>)}
                  acciones={acciones ? <td style={{ whiteSpace: "nowrap" }}>{acciones(f)}</td> : null} extra={ex} ancho={columnas.length + (acciones ? 1 : 0)} />
              );
            })}
          </tbody>
        </table>
      </div>
      <MenuDeColumnaAbierto estado={orden} columnas={columnas} lang={lang} t={t} />
    </>
  );
}

function FilaDoble({ clave, estado, celdas, acciones, extra, ancho }: { clave: string; estado?: string; celdas: ReactNode; acciones: ReactNode; extra: ReactNode; ancho: number }) {
  return (
    <>
      <tr data-fila={clave} data-estado={estado}>{celdas}{acciones}</tr>
      {extra && <tr data-edicion={clave}><td colSpan={ancho}>{extra}</td></tr>}
    </>
  );
}

export function PanelDeSeguridad({ enforced, webBloqueada, cambiadaEn, dispositivos, uso, bloqueados = [], esteDispositivo, error }: {
  enforced: boolean; webBloqueada: boolean; cambiadaEn: string | null; dispositivos: DispositivoFila[]; uso: UsoFila[]; bloqueados?: BloqueoFila[]; esteDispositivo: string | null; error: string | null;
}) {
  const { t, lang } = usePrefs();
  const vivo = useEnVivo();
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<"todos" | "actualizar" | EstadoDeDispositivo>("todos");
  const [editando, setEditando] = useState<string | null>(null);
  const [confirmaInterruptor, setConfirmaInterruptor] = useState(false);
  const [confirmaWeb, setConfirmaWeb] = useState(false);
  const fecha = useCallback((s: string | null) => s ? new Date(s).toLocaleString(lang === "es" ? "es-MX" : "en-US", { dateStyle: "short", timeStyle: "short" }) : "—", [lang]);
  const fechaOTexto = useCallback((v: ValorDeCelda) => typeof v === "string" && ES_FECHA.test(v) ? fecha(v) : String(v ?? "—"), [fecha]);
  const ahora = Date.now();
  const tipoTexto = useCallback((kind: string) => { const x = TIPO[kind] ?? TIPO.browser; return `${x.icono} ${t(x.en, x.es)}`; }, [t]);
  const estadoTexto = useCallback((status: string) => { const x = ESTADO[status] ?? ESTADO.pending; return t(x.en, x.es); }, [t]);

  const corre = async (f: () => Promise<{ ok: boolean; message?: string }>) => {
    setOcupado(true); setAviso(null);
    const r = await f();
    if (!r.ok) setAviso(r.message ?? "Error");
    setOcupado(false);
  };

  // --- Dispositivos -------------------------------------------------------------------------------------------------
  const porActualizar = useMemo(() => dispositivos.filter((d) => versionDeApp(d.user_agent).actualizar), [dispositivos]);
  const lista = useMemo(() => dispositivos.filter((d) => filtro === "todos" || (filtro === "actualizar" ? versionDeApp(d.user_agent).actualizar : d.status === filtro)), [dispositivos, filtro]);
  const cuenta = (s: string) => dispositivos.filter((d) => d.status === s).length;
  const colsDispositivos: Columna[] = useMemo(() => [
    { key: "nombre", en: "Name", es: "Nombre", ancho: 200 },
    { key: "tipo", en: "Type", es: "Tipo", ancho: 130 },
    { key: "version", en: "App / version", es: "App / versión", ancho: 170 },
    { key: "estado", en: "Status", es: "Estado", ancho: 110 },
    { key: "primera", en: "First seen", es: "Primera vez", ancho: 150, etiqueta: fechaOTexto },
    { key: "ultima", en: "Last seen", es: "Última vez", ancho: 150, etiqueta: fechaOTexto },
    { key: "ultimo", en: "Last user", es: "Último usuario", ancho: 160 },
    { key: "personas", en: "People", es: "Personas", ancho: 90 },
    { key: "codigo", en: "Code", es: "Código", ancho: 100 },
  ], [fechaOTexto]);
  const valorDispositivo = useCallback((clave: string, d: DispositivoFila): ValorDeCelda => {
    switch (clave) {
      case "nombre": return nombreDe(d);
      case "tipo": return tipoTexto(d.kind);
      case "version": return textoDeVersion(d.user_agent);
      case "estado": return estadoTexto(d.status);
      case "primera": return d.first_seen_at;
      case "ultima": return d.last_seen_at;
      case "ultimo": return d.ultimo;
      case "personas": return d.personas;
      case "codigo": return d.id.slice(0, 8).toUpperCase();
      default: return null;
    }
  }, [tipoTexto, estadoTexto]);
  const textoDispositivo = useCallback((d: DispositivoFila) => [nombreDe(d), d.kind, d.status, d.primero, d.ultimo, d.id, d.user_agent ?? "", d.notes ?? ""].join(" "), []);
  const celdaDispositivo = (clave: string, d: DispositivoFila): ReactNode => {
    const esEste = d.id === esteDispositivo;
    switch (clave) {
      case "nombre": return <span title={d.user_agent ?? undefined}><b>{nombreDe(d)}</b>{esEste && <span className="badge" style={{ marginLeft: 6, background: "var(--tint-amber, #fff4d6)", color: "var(--amber)" }}>{t("this one", "este")}</span>}</span>;
      case "tipo": return <>{tipoTexto(d.kind)}{d.bound && <span className="hint" style={{ margin: 0 }} title={t("Machine-bound id from the desktop app: cannot be copied", "Id ligado a la máquina por la app de escritorio: no se copia")}> 🔗</span>}</>;
      case "version": return <Version ua={d.user_agent} />;
      case "estado": { const e = ESTADO[d.status] ?? ESTADO.pending; return <span className="sema" style={{ background: e.color, color: "#fff" }}>{t(e.en, e.es)}</span>; }
      case "primera": return <>{fecha(d.first_seen_at)}<div className="hint" style={{ margin: 0 }}>{d.primero}</div></>;
      case "ultima": return fecha(d.last_seen_at);
      case "ultimo": return d.ultimo;
      case "personas": return d.personas;
      case "codigo": return <span style={{ fontFamily: "monospace" }}>{d.id.slice(0, 8).toUpperCase()}</span>;
      default: return null;
    }
  };

  // --- Dentro ahora --------------------------------------------------------------------------------------------------
  const dentro = useMemo(() => {
    const porPersona = new Map<string, UsoFila>();
    for (const u of uso) if (ahora - Date.parse(u.last_seen_at) < ACTIVO_MS && !porPersona.has(u.user_id)) porPersona.set(u.user_id, u);
    return [...porPersona.values()];
  }, [uso, ahora]);
  const colsDentro: Columna[] = useMemo(() => [
    { key: "persona", en: "Person", es: "Persona", ancho: 180 },
    { key: "rol", en: "Role", es: "Rol", ancho: 110 },
    { key: "tienda", en: "Store", es: "Tienda", ancho: 120 },
    { key: "dispositivo", en: "Device", es: "Dispositivo", ancho: 200 },
    { key: "version", en: "App / version", es: "App / versión", ancho: 170 },
    { key: "estado", en: "Status", es: "Estado", ancho: 110 },
    { key: "ultima", en: "Last seen", es: "Última vez", ancho: 150, etiqueta: fechaOTexto },
  ], [fechaOTexto]);
  const valorDentro = useCallback((clave: string, u: UsoFila): ValorDeCelda => {
    switch (clave) {
      case "persona": return u.persona;
      case "rol": return u.rol;
      case "tienda": return u.tienda;
      case "dispositivo": return u.dispositivo ? `${TIPO[u.dispositivo.kind]?.icono ?? ""} ${nombreDe(u.dispositivo)}` : null;
      case "version": return u.dispositivo ? textoDeVersion(u.dispositivo.user_agent) : null;
      case "estado": return u.dispositivo ? estadoTexto(u.dispositivo.status) : null;
      case "ultima": return u.last_seen_at;
      default: return null;
    }
  }, [estadoTexto]);
  const textoDentro = useCallback((u: UsoFila) => [u.persona, u.rol, u.tienda ?? "", u.dispositivo ? nombreDe(u.dispositivo) : "", u.dispositivo?.user_agent ?? ""].join(" "), []);
  const celdaDentro = (clave: string, u: UsoFila): ReactNode => {
    switch (clave) {
      case "persona": return <b>{u.persona}</b>;
      case "version": return u.dispositivo ? <Version ua={u.dispositivo.user_agent} /> : "—";
      case "estado": return u.dispositivo ? <span style={{ color: ESTADO[u.dispositivo.status]?.color, fontWeight: 600 }}>{estadoTexto(u.dispositivo.status)}</span> : "—";
      case "ultima": return fecha(u.last_seen_at);
      default: return valorDentro(clave, u) ?? "—";
    }
  };

  // --- Bloqueados en la web --------------------------------------------------------------------------------------------
  type BloqueoConVeces = BloqueoFila & { veces: number };
  const bloqueadosPorPersona = useMemo(() => {
    const m = new Map<string, BloqueoConVeces>();
    for (const b of bloqueados) { const p = m.get(b.user_id); if (p) p.veces++; else m.set(b.user_id, { ...b, veces: 1 }); }
    return [...m.values()];
  }, [bloqueados]);
  const colsBloqueados: Columna[] = useMemo(() => [
    { key: "persona", en: "Person", es: "Persona", ancho: 180 },
    { key: "rol", en: "Role", es: "Rol", ancho: 110 },
    { key: "tienda", en: "Store", es: "Tienda", ancho: 120 },
    { key: "navegador", en: "Browser", es: "Navegador", ancho: 220 },
    { key: "iba", en: "Was going to", es: "Iba a", ancho: 160 },
    { key: "ultima", en: "Last time", es: "Última vez", ancho: 150, etiqueta: fechaOTexto },
    { key: "veces", en: "Times", es: "Veces", ancho: 80 },
  ], [fechaOTexto]);
  const valorBloqueado = useCallback((clave: string, b: BloqueoConVeces): ValorDeCelda => {
    switch (clave) {
      case "persona": return b.persona;
      case "rol": return b.rol;
      case "tienda": return b.tienda;
      case "navegador": return `${b.dispositivo ? nombreDe(b.dispositivo) : nombrePorAgente(b.user_agent)} · ${textoDeVersion(b.user_agent)}`;
      case "iba": return b.path || null;
      case "ultima": return b.at;
      case "veces": return b.veces;
      default: return null;
    }
  }, []);
  const textoBloqueado = useCallback((b: BloqueoConVeces) => [b.persona, b.rol, b.tienda ?? "", b.user_agent ?? "", b.path ?? ""].join(" "), []);
  const celdaBloqueado = (clave: string, b: BloqueoConVeces): ReactNode => {
    switch (clave) {
      case "persona": return <b>{b.persona}</b>;
      case "navegador": return <span title={b.user_agent ?? undefined}>{b.dispositivo ? nombreDe(b.dispositivo) : nombrePorAgente(b.user_agent)} · <Version ua={b.user_agent} /></span>;
      case "iba": return <span style={{ fontFamily: "monospace" }}>{b.path || "—"}</span>;
      case "ultima": return fecha(b.at);
      default: return valorBloqueado(clave, b) ?? "—";
    }
  };

  return (
    <div className="container" style={{ padding: "16px 20px", maxWidth: 1400 }}>
      <h1 style={{ margin: "0 0 4px" }}>
        🔐 {t("Security", "Seguridad")}{" "}
        <span className="hint" data-en-vivo={vivo ? "si" : "no"} title={vivo ? t("Updates by itself when anything changes", "Se actualiza solo cuando algo cambia") : t("Connecting… refreshes every minute meanwhile", "Conectando… mientras tanto se refresca cada minuto")}
          style={{ fontSize: 13, fontWeight: 400, color: vivo ? "var(--green)" : "var(--amber)" }}>
          ● {vivo ? t("live", "en vivo") : t("connecting…", "conectando…")}
        </span>
      </h1>
      <p className="hint" style={{ marginTop: 0 }}>
        {t("Registered devices, who signs in from where, and the device rule switch.", "Dispositivos registrados, quién entra desde dónde, y el interruptor de la regla por dispositivo.")}
      </p>
      {error && <div className="card" style={{ borderColor: "var(--red)" }}>{t("Could not read the security tables (is migration 229 applied?):", "No se pudieron leer las tablas de seguridad (¿está aplicada la 229?):")} {error}</div>}
      {aviso && <div className="card" style={{ borderColor: "var(--red)" }}>{aviso}</div>}

      {/* Los dos interruptores, lado a lado */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))", gap: 12 }}>
        <div className="card" data-bloque="politica" style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", margin: 0, borderColor: enforced ? "var(--green)" : "var(--line)" }}>
          <span className="badge" data-politica={enforced ? "on" : "off"} style={{ background: enforced ? "var(--tint-green)" : "var(--tint-amber, #fff4d6)", color: enforced ? "var(--green)" : "var(--amber)" }}>
            {enforced ? t("RULE ON", "REGLA ENCENDIDA") : t("RULE OFF", "REGLA APAGADA")}
          </span>
          <span style={{ flex: 1, minWidth: 220 }}>
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

        {/* D-816: la web bloqueada para manager, sales, logistics y accounting */}
        <div className="card" data-bloque="web" style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", margin: 0, borderColor: webBloqueada ? "var(--green)" : "var(--line)" }}>
          <span className="badge" data-web={webBloqueada ? "bloqueada" : "abierta"} style={{ background: webBloqueada ? "var(--tint-green)" : "var(--tint-amber, #fff4d6)", color: webBloqueada ? "var(--green)" : "var(--amber)" }}>
            {webBloqueada ? t("WEB BLOCKED", "WEB BLOQUEADA") : t("WEB OPEN", "WEB ABIERTA")}
          </span>
          <span style={{ flex: 1, minWidth: 220 }}>
            {webBloqueada
              ? t("Managers, sales, logistics and accounting only get in from the RTG Hub desktop app (and from a phone, Time Tracker only). In a browser they see «The web app is no longer available».", "Managers, ventas, logística y contabilidad solo entran desde la app de escritorio RTG Hub (y desde el teléfono, solo Time Tracker). En un navegador ven «La web app ya no está disponible».")
              : t("Managers, sales, logistics and accounting can still use the hub from any browser.", "Managers, ventas, logística y contabilidad todavía pueden usar el hub desde cualquier navegador.")}
          </span>
          {!confirmaWeb ? (
            <button className={webBloqueada ? "btn btn-danger" : "btn btn-green"} disabled={ocupado || !!error} data-accion="web" onClick={() => setConfirmaWeb(true)}>
              {webBloqueada ? t("Open the web", "Abrir la web") : t("Block the web", "Bloquear la web")}
            </button>
          ) : (
            <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <b>{webBloqueada ? t("Open the web app again for everyone?", "¿Abrir la web otra vez para todos?") : t("Block the web for managers, sales, logistics and accounting now?", "¿Bloquear la web para managers, ventas, logística y contabilidad ahora?")}</b>
              <button className="btn btn-sm btn-green" disabled={ocupado} data-accion="web-confirma" onClick={() => { void corre(() => cambiaPoliticaWeb(!webBloqueada)); setConfirmaWeb(false); }}>{t("Yes", "Sí")}</button>
              <button className="btn btn-sm btn-ghost" onClick={() => setConfirmaWeb(false)}>{t("No", "No")}</button>
            </span>
          )}
        </div>
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

      {/* D-815: quién va con una app vieja */}
      {porActualizar.length > 0 && (
        <div className="card" data-bloque="por-actualizar" style={{ borderColor: "var(--red)", marginTop: 12 }}>
          <b>⚠️ {t(`${porActualizar.length} device(s) with an old app`, `${porActualizar.length} dispositivo(s) con app vieja`)}</b>
          <span className="hint" style={{ marginLeft: 6 }}>
            {t("They see a full-screen «Update now» and cannot work until they do. Last seen:", "Ven «Actualizar ahora» a pantalla completa y no pueden trabajar hasta hacerlo. Última vez:")}
          </span>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {porActualizar.slice(0, 20).map((d) => (
              <li key={d.id} data-por-actualizar={d.id}>{TIPO[d.kind]?.icono} <b>{nombreDe(d)}</b> · <Version ua={d.user_agent} /> · {d.ultimo} · {fecha(d.last_seen_at)}</li>
            ))}
            {porActualizar.length > 20 && <li className="hint">… {porActualizar.length - 20} {t("more", "más")}</li>}
          </ul>
        </div>
      )}

      {/* Dentro ahora: visto en la última hora */}
      <h2 style={{ margin: "18px 0 6px" }}>{t("Signed in now (seen in the last hour)", "Dentro ahora (vistos en la última hora)")} <span className="cnt">{dentro.length}</span></h2>
      <TablaDeSecurity id="activos" filas={dentro} columnas={colsDentro} valorDe={valorDentro} textoDe={textoDentro} claveDe={(u) => u.user_id}
        celda={celdaDentro} vacio={t("Nobody in the last hour.", "Nadie en la última hora.")} lang={lang} t={t} />

      {/* D-818: a quién se le cerró la web, últimos 7 días */}
      {(webBloqueada || bloqueados.length > 0) && (
        <>
          <h2 style={{ margin: "18px 0 6px" }}>🚫 {t("Blocked on the web (last 7 days)", "Bloqueados en la web (últimos 7 días)")} <span className="cnt">{bloqueadosPorPersona.length}</span></h2>
          <TablaDeSecurity id="bloqueados-web" filas={bloqueadosPorPersona} columnas={colsBloqueados} valorDe={valorBloqueado} textoDe={textoBloqueado} claveDe={(b) => b.user_id}
            celda={celdaBloqueado} vacio={t("Nobody has been blocked yet.", "Todavía no se le cerró la web a nadie.")} lang={lang} t={t} />
        </>
      )}

      {/* Dispositivos */}
      <h2 style={{ margin: "18px 0 6px" }}>{t("Devices", "Dispositivos")} <span className="cnt">{dispositivos.length}</span></h2>
      <TablaDeSecurity id="dispositivos" filas={lista} columnas={colsDispositivos} valorDe={valorDispositivo} textoDe={textoDispositivo} claveDe={(d) => d.id}
        celda={celdaDispositivo} vacio={t("No devices here.", "No hay dispositivos aquí.")} lang={lang} t={t} anchoDeAcciones={190}
        chips={
          <div className="ld-vistas" role="group" style={{ margin: 0 }}>
            {(["todos", "pending", "approved", "revoked", "actualizar"] as const).map((k) => (
              <button key={k} type="button" className={`chip${filtro === k ? " on" : ""}`} data-filtro-estado={k} onClick={() => setFiltro(k)}>
                {k === "todos" ? t("All", "Todos") : k === "actualizar" ? `⚠️ ${t("Need to update", "Por actualizar")}` : t(ESTADO[k].en, ESTADO[k].es)}{" "}
                <span className="cnt">{k === "todos" ? dispositivos.length : k === "actualizar" ? porActualizar.length : cuenta(k)}</span>
              </button>
            ))}
          </div>
        }
        acciones={(d) => (
          <span style={{ display: "inline-flex", gap: 4 }}>
            {d.status !== "approved" && (
              <button className="btn btn-sm btn-green" disabled={ocupado} data-accion="aprobar" onClick={() => void corre(() => cambiaEstadoDeDispositivo(d.id, "approved"))}>✓ {t("Approve", "Aprobar")}</button>
            )}
            {d.status === "approved" && (
              <button className="btn btn-sm btn-danger" disabled={ocupado} data-accion="revocar" onClick={() => void corre(() => cambiaEstadoDeDispositivo(d.id, "revoked"))}>✕ {t("Revoke", "Revocar")}</button>
            )}
            <button className="btn btn-sm btn-ghost" data-accion="editar" onClick={() => setEditando(editando === d.id ? null : d.id)}>✏️</button>
            {d.status !== "approved" && (
              <button className="btn btn-sm btn-ghost" disabled={ocupado} data-accion="borrar" title={t("Delete (never approved)", "Borrar (nunca aprobado)")} onClick={() => void corre(() => borraDispositivo(d.id))}>🗑</button>
            )}
          </span>
        )}
        extra={(d) => editando === d.id ? <EdicionDeDispositivo d={d} ocupado={ocupado} corre={corre} cierra={() => setEditando(null)} /> : null}
      />
      <p className="hint">
        {t("A device is registered the first time someone opens the hub from it; it starts as pending. The code is what a blocked person sees on their screen.",
          "Un dispositivo se registra la primera vez que alguien abre el hub desde él; nace pendiente. El código es lo que ve en su pantalla una persona bloqueada.")}
      </p>
    </div>
  );
}

function EdicionDeDispositivo({ d, ocupado, corre, cierra }: {
  d: DispositivoFila; ocupado: boolean; corre: (f: () => Promise<{ ok: boolean; message?: string }>) => Promise<void>; cierra: () => void;
}) {
  const { t } = usePrefs();
  const [label, setLabel] = useState(d.label ?? "");
  const [kind, setKind] = useState<TipoDeDispositivo>((d.kind as TipoDeDispositivo) || "browser");
  const [notes, setNotes] = useState(d.notes ?? "");
  return (
    <>
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
        <button className="btn btn-sm" disabled={ocupado} data-accion="guardar" onClick={() => { void corre(() => renombraDispositivo(d.id, label, kind, notes)); cierra(); }}>{t("Save", "Guardar")}</button>
        <button className="btn btn-sm btn-ghost" onClick={cierra}>{t("Cancel", "Cancelar")}</button>
      </div>
      <div className="hint" style={{ marginTop: 6 }}>
        {t("A phone only opens Time Tracker (and Quote Builder during a customer visit). A computer opens everything.", "Un teléfono solo abre Time Tracker (y Quote Builder durante una visita a cliente). Una computadora abre todo.")}
        {d.user_agent && <> · <span style={{ wordBreak: "break-all" }}>{d.user_agent}</span></>}
      </div>
    </>
  );
}
