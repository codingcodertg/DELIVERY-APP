"use client";

import { KIND_TOMADA_POR_CHOFER } from "@/lib/tomar-orden";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useData } from "@/lib/data-provider";
import { stageInfo } from "@/lib/constants";
import { ASSIGNED_KIND, AYUDA_ATENDIDA_KIND } from "@/lib/notifications";
import type { AppNotification } from "@/lib/notifications";
import { AYUDA_MENSAJE_KIND, AYUDA_RESPUESTA_KIND } from "@/lib/help-thread";
import { AVISO_SOLICITUD_APROBADA, AVISO_SOLICITUD_NUEVA, AVISO_SOLICITUD_RECHAZADA } from "@/lib/solicitud-de-asignacion";
import { AVISO_CLIENTE_APROBADA, AVISO_CLIENTE_NUEVA, AVISO_CLIENTE_RECHAZADA, AVISO_CLIENTE_REVISAR, mensajeDelAviso } from "@/lib/customers/avisos-de-solicitud";
import { usePrefs } from "@/lib/prefs";
import { cuentaPorClase, type ClaseDelAviso } from "@/lib/clase-del-aviso";
import {
  accionDelAviso, appsConAvisos, avisosDeLaClase, filtrarPorApp, sinLeerPorApp, unificarAvisos,
  type AppAviso, type AvisoRrhh, type AvisoUnificado, type FiltroDeApp,
} from "@/lib/notificaciones-todas";
import { getMyNotifications } from "@/app/timetracker/clock-in/actions/myday";
import { markReadByIds } from "@/app/timetracker/clock-in/actions/notifications";

// Compact "3m", "2h", "4d" relative time for the notification list.
function ago(iso: string, t: (en: string, es: string) => string): string {
  const then = new Date(iso).getTime();
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return t("just now", "ahora");
  const mins = Math.round(secs / 60);
  if (mins < 60) return t(`${mins}m ago`, `hace ${mins} min`);
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return t(`${hrs}h ago`, `hace ${hrs} h`);
  const dias = Math.round(hrs / 24);
  return t(`${dias}d ago`, `hace ${dias} d`);
}

// El punto de cada aviso: el color de su tipo. Un `kind` que no es etapa se pinta con uno explícito (`stageInfo` cae a
// la primera etapa sin avisar).
function colorDelAviso(kind: string): string {
  return kind === ASSIGNED_KIND ? "var(--accent)"
    : kind === AYUDA_ATENDIDA_KIND ? "var(--green)"
    : kind === AYUDA_RESPUESTA_KIND || kind === AYUDA_MENSAJE_KIND ? "var(--amber)"
    : kind === AVISO_SOLICITUD_NUEVA ? "var(--amber)"
    : kind === AVISO_SOLICITUD_APROBADA ? "var(--green)"
    : kind === AVISO_SOLICITUD_RECHAZADA ? "var(--red)"
    : kind === KIND_TOMADA_POR_CHOFER ? "var(--amber)"
    : kind === AVISO_CLIENTE_NUEVA || kind === AVISO_CLIENTE_REVISAR ? "var(--amber)"
    : kind === AVISO_CLIENTE_APROBADA ? "var(--green)"
    : kind === AVISO_CLIENTE_RECHAZADA ? "var(--red)"
    : stageInfo(kind).color;
}

// El color de la etiqueta de cada app en la vista «Todas».
const COLOR_DE_APP: Record<AppAviso, string> = { entregas: "var(--accent)", clientes: "var(--amber)", rrhh: "var(--green)" };

/** Los avisos de RRHH (fichaje) para la vista «Todas». Los pide la campana al abrirse; sin sesión de HR, no hay ninguno. */
export async function cargarAvisosRrhh(): Promise<AvisoRrhh[]> {
  if (process.env.NEXT_PUBLIC_LOCAL_MODE === "true") return [];
  const r = await getMyNotifications();
  return r.ok ? r.items.map(({ id, message, read, created_at }) => ({ id, message, read, created_at })) : [];
}

/** Marca como leídos avisos de RRHH por id, desde la campana. */
export function marcarRrhhLeidos(ids: string[]): void {
  if (process.env.NEXT_PUBLIC_LOCAL_MODE === "true" || !ids.length) return;
  void markReadByIds(ids);
}

/** Bell with an unread badge + dropdown of the current user's workflow alerts. */
export function NotificationBell() {
  const { notifications, markNotifRead } = useData();
  return (
    <CampanaDeAvisos
      notifications={notifications}
      markNotifRead={markNotifRead}
      appActual="entregas"
      cargarRrhh={cargarAvisosRrhh}
      marcaRrhhLeidos={marcarRrhhLeidos}
    />
  );
}

/** La vista del panel: «Todas» (las apps juntas, con filtro por app) o una sección de la tabla común (D-880). */
type Vista = "todas" | ClaseDelAviso;

/**
 * La campana en sí, sin saber de dónde salen los avisos (D-867): Entregas se los da desde su `DataProvider`; Clientes,
 * desde `useAvisosPropios` (`CampanaDeClientes`). La misma tabla (`public.notifications`), el mismo aspecto.
 *
 * D-880: dos secciones. «Importantes» (Clientes; de Entregas, solo anulada, rechazada o reprogramada) llevan el número
 * rojo; «Secundarias» llegan igual, sin leer, pero sin número rojo ni ruido: solo un contador gris en su pestaña. La
 * regla está en `lib/clase-del-aviso.ts`. «Marcar todo leído» marca solo lo que se ve.
 *
 * «Todas» junta las tres apps (Entregas, Clientes y RRHH) con una etiqueta por aviso y un filtro por app. Lo de RRHH viene
 * de `cargarRrhh`, al abrir el panel. El número rojo sigue siendo solo los importantes de la tabla común.
 */
export function CampanaDeAvisos({ notifications, markNotifRead, markManyRead, appActual = "entregas", cargarRrhh, marcaRrhhLeidos }: {
  notifications: readonly AppNotification[];
  markNotifRead: (id: string) => unknown;
  /** Marca varios de golpe (Clientes, una sola escritura). Sin él, uno a uno con `markNotifRead`. */
  markManyRead?: (ids: string[]) => unknown;
  /** La app en la que está la campana. Un aviso de otra app no la deja: abre una tarjeta en el panel. */
  appActual?: AppAviso;
  /** Los avisos de RRHH para «Todas». Se piden al abrir el panel. Sin él, «Todas» solo tiene Entregas y Clientes. */
  cargarRrhh?: () => Promise<AvisoRrhh[]>;
  /** Marca como leídos avisos de RRHH por id. */
  marcaRrhhLeidos?: (ids: string[]) => unknown;
}) {
  const { t, lang } = usePrefs();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [vista, setVista] = useState<Vista>("todas");
  const [appFiltro, setAppFiltro] = useState<FiltroDeApp>("todas");
  const [rrhh, setRrhh] = useState<AvisoRrhh[]>([]);
  const [abierta, setAbierta] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Al abrir el panel, los avisos de RRHH (si la campana los tiene). Se piden de nuevo cada vez: son pocos.
  useEffect(() => {
    if (!open || !cargarRrhh) return;
    let vivo = true;
    void cargarRrhh().then((r) => { if (vivo) setRrhh(r); });
    return () => { vivo = false; };
  }, [open, cargarRrhh]);

  const todos = useMemo(() => unificarAvisos({ base: notifications, rrhh }), [notifications, rrhh]);

  const marcaRrhh = (ids: string[]) => {
    if (!ids.length) return;
    const set = new Set(ids);
    setRrhh((prev) => prev.map((n) => (set.has(n.id) ? { ...n, read: true } : n)));
    marcaRrhhLeidos?.(ids);
  };

  // Mark read, then: if the notification's target is in THIS app, go there (los de ayuda, a la conversación (D-311);
  // las solicitudes de asignación, a la bandeja o a su orden (D-560); los de Clientes, a su `link` (D-867); la regla
  // está en `lib/destino-del-aviso.ts`). If it belongs to another app, or has no target, a card opens in the panel.
  const onPick = (n: AvisoUnificado) => {
    if (!n.read) {
      if (n.base) markNotifRead(n.id);
      else marcaRrhh([n.id]);
    }
    const accion = accionDelAviso(n, appActual);
    if (accion.tipo === "ir") {
      setOpen(false);
      router.push(accion.href);
      return;
    }
    setAbierta((k) => (k === n.key ? null : n.key));
  };

  const cuenta = cuentaPorClase(notifications);
  // El número rojo: SOLO los importantes sin leer.
  const unread = cuenta.importante.sinLeer;
  const visibles = vista === "todas" ? filtrarPorApp(todos, appFiltro) : avisosDeLaClase(todos, vista);
  const sinLeerAqui = visibles.filter((n) => !n.read).length;
  const sinLeerTodas = todos.filter((n) => !n.read).length;
  const sinLeerDeApp = sinLeerPorApp(todos);
  const apps = appsConAvisos(todos);

  const marcaVisibles = () => {
    const base = visibles.filter((n) => !n.read && n.base).map((n) => n.id);
    const rr = visibles.filter((n) => !n.read && !n.base).map((n) => n.id);
    if (base.length) {
      if (markManyRead) markManyRead(base);
      else for (const id of base) markNotifRead(id);
    }
    marcaRrhh(rr);
  };

  const etiquetaApp = (app: AppAviso) => app === "entregas" ? t("Deliveries", "Entregas")
    : app === "clientes" ? t("Customers", "Clientes")
    : t("HR", "RRHH");

  const toggle = () => {
    if (!open && btnRef.current) setAnchor(btnRef.current.getBoundingClientRect());
    setOpen((v) => !v);
  };

  // The panel renders in a portal (see below) — a topbar with many admin
  // tabs wraps onto multiple lines, so the bell isn't reliably near the
  // right edge, and a plain right:0 popover could land mostly off-screen.
  // Reposition on scroll/resize while open, and close on an outside click
  // (checking both the button and the portaled panel, since they're no
  // longer DOM descendants of each other).
  useEffect(() => {
    if (!open) return;
    const reposition = () => {
      const r = btnRef.current?.getBoundingClientRect();
      if (!r) return;
      // ONLY when it actually moved.
      //
      // The scroll listener below is registered in the CAPTURE phase on
      // window, so it also catches scrolling inside the panel's own list —
      // which is where a driver scrolls. getBoundingClientRect() hands back a
      // new object every call, so setting it unconditionally re-rendered the
      // top bar, the portal and the whole notification list on every scroll
      // event. At 60 events a second that locked the app up on a phone.
      //
      // The button doesn't move when an inner list scrolls, so this drops
      // almost all of those renders.
      setAnchor((prev) =>
        prev && prev.top === r.top && prev.left === r.left && prev.right === r.right && prev.width === r.width
          ? prev
          : r);
    };
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    document.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  const PANEL_WIDTH = 320;

  return (
    <div className="notif-wrap">
      <button
        ref={btnRef}
        className="tab tab-icon notif-btn"
        style={{ background: "rgba(255,255,255,.1)" }}
        onClick={toggle}
        title={t("Notifications", "Avisos")}
        aria-label={t("Notifications", "Avisos")}
      >
        🔔
        {unread > 0 && <span className="notif-badge">{unread > 9 ? "9+" : unread}</span>}
      </button>

      {open && anchor && typeof document !== "undefined" && createPortal(
        <div
          ref={panelRef}
          className="notif-panel"
          style={{
            position: "fixed",
            right: "auto",
            top: anchor.bottom + 8,
            left: Math.max(8, Math.min(anchor.right - PANEL_WIDTH, window.innerWidth - PANEL_WIDTH - 8)),
          }}
        >
          <div className="notif-head">
            <b>{t("Notifications", "Avisos")}</b>
            {sinLeerAqui > 0 && (
              <button className="notif-clear" onClick={marcaVisibles}>
                {t("Mark all read", "Marcar todo leído")}
              </button>
            )}
          </div>

          <div className="notif-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={vista === "todas"} data-seccion-avisos="todas"
              className={"notif-tab" + (vista === "todas" ? " on" : "")} onClick={() => setVista("todas")}>
              {t("All", "Todas")}
              {sinLeerTodas > 0 && <span className="notif-tab-cnt">{sinLeerTodas}</span>}
            </button>
            <button type="button" role="tab" aria-selected={vista === "importante"} data-seccion-avisos="importante"
              className={"notif-tab" + (vista === "importante" ? " on" : "")} onClick={() => setVista("importante")}>
              {t("Important", "Importantes")}
              {cuenta.importante.sinLeer > 0 && <span className="notif-tab-cnt fuerte">{cuenta.importante.sinLeer}</span>}
            </button>
            <button type="button" role="tab" aria-selected={vista === "secundario"} data-seccion-avisos="secundario"
              className={"notif-tab" + (vista === "secundario" ? " on" : "")} onClick={() => setVista("secundario")}>
              {t("Other", "Secundarias")}
              {cuenta.secundario.sinLeer > 0 && <span className="notif-tab-cnt">{cuenta.secundario.sinLeer}</span>}
            </button>
          </div>

          {vista === "todas" && (
            <div className="notif-chips" role="group" aria-label={t("Filter by app", "Filtrar por app")}>
              <button type="button" data-app-filtro="todas" aria-pressed={appFiltro === "todas"}
                className={"notif-chip" + (appFiltro === "todas" ? " on" : "")} onClick={() => setAppFiltro("todas")}>
                {t("All", "Todas")}
              </button>
              {apps.map((a) => (
                <button key={a} type="button" data-app-filtro={a} aria-pressed={appFiltro === a}
                  className={"notif-chip" + (appFiltro === a ? " on" : "")} onClick={() => setAppFiltro(a)}>
                  {etiquetaApp(a)}
                  {sinLeerDeApp[a] > 0 && <span className="notif-tab-cnt">{sinLeerDeApp[a]}</span>}
                </button>
              ))}
            </div>
          )}

          {visibles.length === 0 ? (
            <div className="notif-empty">{t("You're all caught up 🎉", "Estás al día 🎉")}</div>
          ) : (
            <div className="notif-list">
              {visibles.map((n) => {
                const texto = n.base ? mensajeDelAviso(n.base, lang) : (n.message ?? "");
                const dotColor = n.base ? colorDelAviso(n.base.kind) : "var(--accent)";
                const accion = accionDelAviso(n, appActual);
                const expandida = accion.tipo === "tarjeta" && abierta === n.key;
                return (
                  <div key={n.key} className="notif-entrada">
                    <button
                      className={"notif-item" + (n.read ? "" : " unread")}
                      onClick={() => onPick(n)}
                      aria-expanded={accion.tipo === "tarjeta" ? expandida : undefined}
                    >
                      <span className="notif-dot" style={{ background: dotColor }} />
                      <span className="notif-body">
                        {vista === "todas" && (
                          <span className="notif-app" style={{ color: COLOR_DE_APP[n.app] }}>{etiquetaApp(n.app)}</span>
                        )}
                        <span className="notif-msg">{texto}</span>
                        <span className="notif-time">{ago(n.created_at, t)}</span>
                      </span>
                    </button>
                    {expandida && accion.tipo === "tarjeta" && (
                      <div className="notif-tarjeta">
                        <div className="notif-time">{new Date(n.created_at).toLocaleString(lang === "es" ? "es" : "en")}</div>
                        {accion.href && accion.app !== appActual && (
                          <a className="notif-abrir" href={accion.href}>
                            {t(`Open in ${etiquetaApp(accion.app)}`, `Abrir en ${etiquetaApp(accion.app)}`)}
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
