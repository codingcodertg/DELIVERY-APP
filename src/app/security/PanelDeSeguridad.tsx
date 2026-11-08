"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { usePrefs } from "@/lib/prefs";
import { createClient } from "@/lib/supabase/client";
import { nombrePorAgente, type EstadoDeDispositivo, type TipoDeDispositivo } from "@/lib/security/reglas";
import { versionDeApp } from "@/lib/security/version-de-app";
import { entradasDesdeSitioNuevo } from "@/lib/security/lugar";
import { useOrdenYFiltro } from "@/lib/use-orden-y-filtro";
import type { ValorDeCelda } from "@/lib/orden-y-filtro";
import { CabeceraConMenu, FiltrosPuestos, MenuDeColumnaAbierto, type ColumnaConMenu } from "@/components/CabeceraConMenu";
import { anchoDeTabla, useColWidthMap } from "@/lib/use-col-widths";
import { BuscadorConBorrar } from "@/components/BuscadorConBorrar";
import { borraDispositivo, cambiaEstadoDeDispositivo, cambiaExcepcionesWeb, cambiaPolitica, cambiaPoliticaWeb, cierraSesionesDe, renombraDispositivo } from "./actions";
import { ROLES_SOLO_ESCRITORIO } from "@/lib/security/reglas";
import { APP_VERSIONS } from "@/lib/app-versions";
import { ESCRITORIO_MINIMO } from "@/lib/desktop-version";

export interface DispositivoFila {
  id: string; label: string | null; kind: string; status: string; user_agent: string | null;
  first_seen_at: string; last_seen_at: string; first_user_id: string | null; last_user_id: string | null;
  approved_at: string | null; revoked_at: string | null; notes: string | null;
  bound: boolean; requested_at: string | null; requested_by: string | null; request_note: string | null;
  last_ip?: string | null; last_place?: string | null;
  primero: string; ultimo: string; personas: number; solicitante: string;
}
export interface UsoFila {
  device_id: string; user_id: string; first_seen_at: string; last_seen_at: string; seen_count: number;
  last_ip?: string | null; last_place?: string | null;
  persona: string; rol: string; tienda: string | null;
  dispositivo: { id: string; label: string | null; kind: string; status: string; user_agent: string | null } | null;
}
/** D-818: a quién se le cerró la web (232). */
export interface BloqueoFila {
  id: number; user_id: string; device_id: string | null; user_agent: string | null; path: string | null; at: string;
  ip?: string | null; place?: string | null;
  persona: string; rol: string; tienda: string | null;
  dispositivo: { id: string; label: string | null; kind: string; status: string; user_agent: string | null } | null;
}

/** D-822: cada usuario creado, con su último dispositivo (o ninguno). */
export interface UsuarioFila {
  id: string; persona: string; usuario: string | null; rol: string; tienda: string | null; dispositivos: number; ultimo: UsoFila | null;
  /** D-824: el mejor equipado de sus dispositivos (la app nueva antes que un navegador visto después). */
  mejor?: UsoFila | null;
}

/** D-820: las tablas que, al cambiar, refrescan el panel. Están en la publicación de tiempo real desde la 233. */
export const TABLAS_EN_VIVO = ["security_devices", "security_device_users", "security_policy", "security_web_blocks"] as const;
/** Por si la suscripción se cae sin avisar: un refresco de fondo cada minuto, como red de seguridad. */
const REFRESCO_DE_FONDO_MS = 60 * 1000;
/** En el demo (D-NEXT) no hay base que escuchar: el puntito queda apagado y no se abre ningún canal. */
const LOCAL_MODE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";

/**
 * D-820: el panel en tiempo real. Se suscribe a las cuatro tablas y, con cualquier cambio, pide al servidor la página
 * otra vez (`router.refresh()`, que vuelve a correr `page.tsx` con la sesión del admin). Se agrupan los cambios de un
 * mismo segundo en un solo refresco. Devuelve si la suscripción está viva, para el puntito.
 */
function useEnVivo(): boolean {
  const router = useRouter();
  // En el demo no hay canal que esperar: el puntito nace encendido en vez de quedarse en «conectando…».
  const [vivo, setVivo] = useState(LOCAL_MODE);
  const pendiente = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (LOCAL_MODE) return;
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
/** D-822: «Brownsville, TX, US · 192.0.2.1»; sin nada, «—». */
const lugarTexto = (place: string | null | undefined, ip: string | null | undefined) => [place, ip].filter(Boolean).join(" · ") || "—";
/** D-822: tiene la app nueva / vieja / navegador / teléfono / nunca entró, como texto para ordenar y filtrar. */
function estadoDeApp(u: UsoFila | null, t: T): string {
  if (!u?.dispositivo) return t("Never signed in", "Nunca entró");
  const v = versionDeApp(u.dispositivo.user_agent);
  if (v.app === "desktop") return v.actualizar ? t("⚠️ Old app", "⚠️ App vieja") : t("✓ New app", "✓ App nueva");
  if (v.app === "android") return v.actualizar ? t("⚠️ Old Time Tracker", "⚠️ Time Tracker viejo") : t("✓ Time Tracker", "✓ Time Tracker");
  return u.dispositivo.kind === "phone" ? t("📱 Phone browser", "📱 Navegador del teléfono") : t("🌐 Browser (no app)", "🌐 Navegador (sin app)");
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

export function PanelDeSeguridad({ enforced, webBloqueada, exentos = [], cambiadaEn, dispositivos, uso, bloqueados = [], usuarios = [], esteDispositivo, error }: {
  enforced: boolean; webBloqueada: boolean; exentos?: string[]; cambiadaEn: string | null; dispositivos: DispositivoFila[]; uso: UsoFila[]; bloqueados?: BloqueoFila[]; usuarios?: UsuarioFila[]; esteDispositivo: string | null; error: string | null;
}) {
  const { t, lang } = usePrefs();
  const vivo = useEnVivo();
  const [ocupado, setOcupado] = useState(false);
  const [cerradas, setCerradas] = useState<{ id: string; n: number } | null>(null);
  // D-828: cerrar todas las sesiones de una persona, con confirmación (saca a esa persona de todo ahora mismo).
  const cierraSesiones = async (p: UsuarioFila) => {
    if (!window.confirm(t(`Sign ${p.persona} out of every device and app right now?`, `¿Cerrar todas las sesiones de ${p.persona} en todos sus dispositivos ahora mismo?`))) return;
    setOcupado(true); setAviso(null);
    const r = await cierraSesionesDe(p.id);
    if (!r.ok) setAviso(r.message); else setCerradas({ id: p.id, n: r.cerradas });
    setOcupado(false);
  };
  const [aviso, setAviso] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<"todos" | "actualizar" | EstadoDeDispositivo>("todos");
  const [editando, setEditando] = useState<string | null>(null);
  const [confirmaInterruptor, setConfirmaInterruptor] = useState(false);
  const [confirmaWeb, setConfirmaWeb] = useState(false);
  // D-826: a quién añadir a las excepciones de la web (solo roles bloqueados que aún no están).
  const [nuevoExento, setNuevoExento] = useState("");
  const exentosConNombre = exentos.map((id) => ({ id, persona: usuarios.find((u) => u.id === id)?.persona ?? id.slice(0, 8) }));
  const candidatosAExento = usuarios.filter((u) => (ROLES_SOLO_ESCRITORIO as readonly string[]).includes(u.rol) && !exentos.includes(u.id));
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
    { key: "lugar", en: "From where", es: "Desde dónde", ancho: 200 },
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
      case "lugar": return lugarTexto(d.last_place, d.last_ip);
      case "ultimo": return d.ultimo;
      case "personas": return d.personas;
      case "codigo": return d.id.slice(0, 8).toUpperCase();
      default: return null;
    }
  }, [tipoTexto, estadoTexto]);
  const textoDispositivo = useCallback((d: DispositivoFila) => [nombreDe(d), d.kind, d.status, d.primero, d.ultimo, d.id, d.user_agent ?? "", d.notes ?? "", d.last_place ?? "", d.last_ip ?? ""].join(" "), []);
  const celdaDispositivo = (clave: string, d: DispositivoFila): ReactNode => {
    const esEste = d.id === esteDispositivo;
    switch (clave) {
      case "nombre": return <span title={d.user_agent ?? undefined}><b>{nombreDe(d)}</b>{esEste && <span className="badge" style={{ marginLeft: 6, background: "var(--tint-amber, #fff4d6)", color: "var(--amber)" }}>{t("this one", "este")}</span>}</span>;
      case "tipo": return <>{tipoTexto(d.kind)}{d.bound && <span className="hint" style={{ margin: 0 }} title={t("Machine-bound id from the desktop app: cannot be copied", "Id ligado a la máquina por la app de escritorio: no se copia")}> 🔗</span>}</>;
      case "version": return <Version ua={d.user_agent} />;
      case "estado": { const e = ESTADO[d.status] ?? ESTADO.pending; return <span className="sema" style={{ background: e.color, color: "#fff" }}>{t(e.en, e.es)}</span>; }
      case "primera": return <>{fecha(d.first_seen_at)}<div className="hint" style={{ margin: 0 }}>{d.primero}</div></>;
      case "ultima": return fecha(d.last_seen_at);
      case "lugar": return <span title={d.last_ip ?? undefined}>{d.last_place ?? d.last_ip ?? "—"}</span>;
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
    { key: "lugar", en: "From where", es: "Desde dónde", ancho: 200 },
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
      case "lugar": return lugarTexto(u.last_place, u.last_ip);
      case "ultima": return u.last_seen_at;
      default: return null;
    }
  }, [estadoTexto]);
  const textoDentro = useCallback((u: UsoFila) => [u.persona, u.rol, u.tienda ?? "", u.dispositivo ? nombreDe(u.dispositivo) : "", u.dispositivo?.user_agent ?? "", u.last_place ?? "", u.last_ip ?? ""].join(" "), []);
  const celdaDentro = (clave: string, u: UsoFila): ReactNode => {
    switch (clave) {
      case "persona": return <b>{u.persona}</b>;
      case "version": return u.dispositivo ? <Version ua={u.dispositivo.user_agent} /> : "—";
      case "estado": return u.dispositivo ? <span style={{ color: ESTADO[u.dispositivo.status]?.color, fontWeight: 600 }}>{estadoTexto(u.dispositivo.status)}</span> : "—";
      case "lugar": return <span title={u.last_ip ?? undefined}>{u.last_place ?? u.last_ip ?? "—"}</span>;
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
    { key: "lugar", en: "From where", es: "Desde dónde", ancho: 200 },
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
      case "lugar": return lugarTexto(b.place, b.ip);
      case "iba": return b.path || null;
      case "ultima": return b.at;
      case "veces": return b.veces;
      default: return null;
    }
  }, []);
  const textoBloqueado = useCallback((b: BloqueoConVeces) => [b.persona, b.rol, b.tienda ?? "", b.user_agent ?? "", b.path ?? "", b.place ?? "", b.ip ?? ""].join(" "), []);
  const celdaBloqueado = (clave: string, b: BloqueoConVeces): ReactNode => {
    switch (clave) {
      case "persona": return <b>{b.persona}</b>;
      case "navegador": return <span title={b.user_agent ?? undefined}>{b.dispositivo ? nombreDe(b.dispositivo) : nombrePorAgente(b.user_agent)} · <Version ua={b.user_agent} /></span>;
      case "lugar": return <span title={b.ip ?? undefined}>{b.place ?? b.ip ?? "—"}</span>;
      case "iba": return <span style={{ fontFamily: "monospace" }}>{b.path || "—"}</span>;
      case "ultima": return fecha(b.at);
      default: return valorBloqueado(clave, b) ?? "—";
    }
  };

  // --- Usuarios (D-822) --------------------------------------------------------------------------------------------------
  const colsUsuarios: Columna[] = useMemo(() => [
    { key: "persona", en: "Person", es: "Persona", ancho: 180 },
    { key: "usuario", en: "Signs in as", es: "Entra con", ancho: 150 },
    { key: "rol", en: "Role", es: "Rol", ancho: 110 },
    { key: "tienda", en: "Store", es: "Tienda", ancho: 120 },
    { key: "app", en: "Has the new app?", es: "¿Tiene la app nueva?", ancho: 180 },
    { key: "version", en: "App / version", es: "App / versión", ancho: 170 },
    { key: "dispositivo", en: "Last device", es: "Último dispositivo", ancho: 200 },
    { key: "lugar", en: "From where", es: "Desde dónde", ancho: 200 },
    { key: "dispositivos", en: "Devices", es: "Dispositivos", ancho: 100 },
    { key: "ultima", en: "Last seen", es: "Última vez", ancho: 150, etiqueta: fechaOTexto },
  ], [fechaOTexto]);
  const valorUsuario = useCallback((clave: string, p: UsuarioFila): ValorDeCelda => {
    switch (clave) {
      case "persona": return p.persona;
      case "usuario": return p.usuario;
      case "rol": return p.rol;
      case "tienda": return p.tienda;
      case "app": return estadoDeApp(p.mejor ?? p.ultimo, t);
      case "version": { const m = p.mejor ?? p.ultimo; return m?.dispositivo ? textoDeVersion(m.dispositivo.user_agent) : null; }
      case "dispositivo": return p.ultimo?.dispositivo ? `${TIPO[p.ultimo.dispositivo.kind]?.icono ?? ""} ${nombreDe(p.ultimo.dispositivo)}` : null;
      case "lugar": return p.ultimo ? lugarTexto(p.ultimo.last_place, p.ultimo.last_ip) : null;
      case "dispositivos": return p.dispositivos;
      case "ultima": return p.ultimo?.last_seen_at ?? null;
      default: return null;
    }
  }, [t]);
  const textoUsuario = useCallback((p: UsuarioFila) => [p.persona, p.usuario ?? "", p.rol, p.tienda ?? "", p.ultimo?.dispositivo?.user_agent ?? "", p.ultimo?.last_place ?? ""].join(" "), []);
  const celdaUsuario = (clave: string, p: UsuarioFila): ReactNode => {
    switch (clave) {
      case "persona": return <b>{p.persona}</b>;
      case "app": { const s = estadoDeApp(p.mejor ?? p.ultimo, t); return <span style={{ fontWeight: 600, color: s.startsWith("✓") ? "var(--green)" : s.startsWith("⚠️") ? "var(--red)" : undefined }}>{s}</span>; }
      case "version": { const m = p.mejor ?? p.ultimo; return m?.dispositivo ? <Version ua={m.dispositivo.user_agent} /> : "—"; }
      case "lugar": return p.ultimo ? <span title={p.ultimo.last_ip ?? undefined}>{p.ultimo.last_place ?? p.ultimo.last_ip ?? "—"}</span> : "—";
      case "ultima": return p.ultimo ? fecha(p.ultimo.last_seen_at) : "—";
      default: return valorUsuario(clave, p) ?? "—";
    }
  };
  const conAppNueva = usuarios.filter((p) => estadoDeApp(p.mejor ?? p.ultimo, t).startsWith("✓")).length;

  // --- Entradas desde un sitio nuevo (D-822) --------------------------------------------------------------------------------
  const sitiosNuevos = useMemo(() => entradasDesdeSitioNuevo(uso, ahora), [uso, ahora]);

  // --- Salud del sistema (D-830): los números que el dueño quiere ver de un vistazo, sacados de lo que ya está en pantalla.
  const salud = useMemo(() => {
    const dia = ahora - 24 * 3600_000, semana = ahora - 7 * 24 * 3600_000;
    const escritorios = dispositivos.filter((d) => versionDeApp(d.user_agent).app === "desktop" && d.status !== "revoked");
    return {
      escritoriosAlDia: escritorios.filter((d) => !versionDeApp(d.user_agent).actualizar).length,
      escritoriosAtras: escritorios.filter((d) => versionDeApp(d.user_agent).actualizar).length,
      sinEntrar7d: usuarios.filter((p) => !p.ultimo || Date.parse(p.ultimo.last_seen_at) < semana).length,
      pendientes: dispositivos.filter((d) => d.status === "pending").length,
      bloqueos24h: bloqueados.filter((b) => Date.parse(b.at) > dia).length,
    };
  }, [dispositivos, usuarios, bloqueados, ahora]);

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
      {/* D-830: salud del sistema de un vistazo. Rojo = hay algo que hacer. */}
      <div className="kpi-grid" data-bloque="salud" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }}>
        <div className="kpi" data-kpi="version" title={Object.entries(APP_VERSIONS).map(([k, v]) => `${k} ${v}`).join(" · ")}>
          <b style={{ fontSize: 18 }}>{APP_VERSIONS.deliveries}</b><span>{t("Deliveries published", "Deliveries publicada")} · Security {APP_VERSIONS.security}</span>
        </div>
        <div className="kpi" data-kpi="escritorio" style={salud.escritoriosAtras ? { borderColor: "var(--red)" } : undefined}>
          <b style={salud.escritoriosAtras ? { color: "var(--red)" } : { color: "var(--green)" }}>{salud.escritoriosAlDia}<span style={{ fontSize: 14, color: "var(--gray)" }}> / {salud.escritoriosAlDia + salud.escritoriosAtras}</span></b>
          <span>{t(`Desktop apps on ${ESCRITORIO_MINIMO}`, `Apps de escritorio en ${ESCRITORIO_MINIMO}`)}{salud.escritoriosAtras ? ` · ${salud.escritoriosAtras} ${t("behind", "atrás")}` : ""}</span>
        </div>
        <div className="kpi" data-kpi="dentro"><b>{dentro.length}</b><span>{t("Signed in (last hour)", "Dentro (última hora)")}</span></div>
        <div className="kpi" data-kpi="sin-entrar" style={salud.sinEntrar7d ? { borderColor: "var(--amber)" } : undefined}>
          <b>{salud.sinEntrar7d}</b><span>{t("Users with no sign-in in 7 days", "Usuarios sin entrar en 7 días")}</span>
        </div>
        <div className="kpi" data-kpi="pendientes" style={salud.pendientes ? { borderColor: "var(--amber)" } : undefined}>
          <b>{salud.pendientes}</b><span>{t("Devices pending approval", "Dispositivos por aprobar")}</span>
        </div>
        <div className="kpi" data-kpi="bloqueos" style={salud.bloqueos24h ? { borderColor: "var(--red)" } : undefined}>
          <b>{salud.bloqueos24h}</b><span>{t("Web blocks (24 h)", "Bloqueos web (24 h)")}</span>
        </div>
        <div className="kpi" data-kpi="sitios-nuevos" style={sitiosNuevos.length ? { borderColor: "var(--red)" } : undefined}>
          <b style={sitiosNuevos.length ? { color: "var(--red)" } : undefined}>{sitiosNuevos.length}</b><span>{t("New-device sign-ins (7 d)", "Entradas desde sitio nuevo (7 d)")}</span>
        </div>
      </div>
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
          {/* D-826: las excepciones: personas que entran por la web aunque su rol esté bloqueado */}
          <div data-bloque="excepciones-web" style={{ flexBasis: "100%", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", borderTop: "1px solid var(--line)", paddingTop: 8 }}>
            <span className="hint" style={{ margin: 0 }}>{t("Exceptions (they can use the web):", "Excepciones (sí pueden usar la web):")}</span>
            {exentosConNombre.length === 0 && <span className="hint" style={{ margin: 0 }}>—</span>}
            {exentosConNombre.map((e) => (
              <span key={e.id} className="chip on" data-exento={e.id}>
                {e.persona}
                <button type="button" className="btn btn-sm btn-ghost" style={{ padding: "0 4px", marginLeft: 4 }} disabled={ocupado} title={t("Remove", "Quitar")} data-accion="quitar-exento"
                  onClick={() => void corre(() => cambiaExcepcionesWeb(exentos.filter((x) => x !== e.id)))}>✕</button>
              </span>
            ))}
            <select value={nuevoExento} onChange={(e) => setNuevoExento(e.target.value)} data-campo="nuevo-exento" style={{ maxWidth: 240 }}>
              <option value="">{t("Add person…", "Añadir persona…")}</option>
              {candidatosAExento.map((u) => <option key={u.id} value={u.id}>{u.persona} · {u.rol}</option>)}
            </select>
            <button type="button" className="btn btn-sm" disabled={ocupado || !nuevoExento} data-accion="anadir-exento"
              onClick={() => { void corre(() => cambiaExcepcionesWeb([...exentos, nuevoExento])); setNuevoExento(""); }}>+ {t("Add", "Añadir")}</button>
          </div>
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

      {/* D-822: «avísame si ellos quieren ingresar desde otro lado» */}
      {sitiosNuevos.length > 0 && (
        <div className="card" data-bloque="sitios-nuevos" style={{ borderColor: "var(--red)", marginTop: 12 }}>
          <b>🚨 {t(`${sitiosNuevos.length} sign-in(s) from a new device in the last 7 days`, `${sitiosNuevos.length} entrada(s) desde un dispositivo nuevo en los últimos 7 días`)}</b>
          <span className="hint" style={{ marginLeft: 6 }}>
            {t("People who already had a device and showed up on another one. Check the place: if it is not the store, revoke it.", "Gente que ya tenía un dispositivo y apareció en otro. Mira el lugar: si no es la tienda, revócalo.")}
          </span>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {sitiosNuevos.slice(0, 20).map((u) => (
              <li key={`${u.device_id}:${u.user_id}`} data-sitio-nuevo={u.user_id}>
                <b>{u.persona}</b> ({u.rol}{u.tienda ? ` · ${u.tienda}` : ""}) · {u.dispositivo ? `${TIPO[u.dispositivo.kind]?.icono ?? ""} ${nombreDe(u.dispositivo)}` : "—"}
                {u.dispositivo && <> · <Version ua={u.dispositivo.user_agent} /></>} · 📍 {u.last_place ?? u.last_ip ?? t("unknown place", "lugar desconocido")} · {fecha(u.first_seen_at)}
                {u.dispositivo && u.dispositivo.status === "approved" && (
                  <button className="btn btn-sm btn-danger" style={{ marginLeft: 8 }} disabled={ocupado} data-accion="revocar-sitio-nuevo" onClick={() => void corre(() => cambiaEstadoDeDispositivo(u.device_id, "revoked"))}>✕ {t("Revoke", "Revocar")}</button>
                )}
              </li>
            ))}
            {sitiosNuevos.length > 20 && <li className="hint">… {sitiosNuevos.length - 20} {t("more", "más")}</li>}
          </ul>
        </div>
      )}

      {/* D-822: todos los usuarios creados */}
      <h2 style={{ margin: "18px 0 6px" }}>👥 {t("Users", "Usuarios")} <span className="cnt">{usuarios.length}</span> <span className="hint" style={{ fontWeight: 400, fontSize: 13 }}>· {t(`${conAppNueva} with the new app`, `${conAppNueva} con la app nueva`)}</span></h2>
      <TablaDeSecurity id="usuarios" filas={usuarios} columnas={colsUsuarios} valorDe={valorUsuario} textoDe={textoUsuario} claveDe={(p) => p.id}
        celda={celdaUsuario} vacio={t("No users.", "No hay usuarios.")} lang={lang} t={t} anchoDeAcciones={150}
        acciones={(p) => (
          <button className="btn btn-sm btn-ghost" disabled={ocupado} data-accion="cerrar-sesiones" title={t("Signs them out of every device and app", "Lo saca de todos sus dispositivos y apps")}
            onClick={() => void cierraSesiones(p)}>
            {cerradas?.id === p.id ? t(`✓ ${cerradas.n} closed`, `✓ ${cerradas.n} cerradas`) : t("⏏ Sign out all", "⏏ Cerrar sesiones")}
          </button>
        )} />

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
