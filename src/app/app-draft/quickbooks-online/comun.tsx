"use client";

import { createContext, useContext, useEffect, useMemo, useReducer, useState, type ReactNode } from "react";
import { usePrefs } from "@/lib/prefs";
import { exportaTablaExcel } from "@/lib/export-tabla";
import type { ValorDeCelda } from "@/lib/orden-y-filtro";
import { hoyIso, libroMayor } from "@/lib/app-draft/qbo/contabilidad";
import { guardar, leerGuardado, reductorQbo, type AccionQbo } from "@/lib/app-draft/qbo/estado";
import { generarMuestra } from "@/lib/app-draft/qbo/muestra";
import type { EstadoQbo, RenglonDeLibro } from "@/lib/app-draft/qbo/tipos";

interface CtxQbo {
  e: EstadoQbo;
  d: (a: AccionQbo) => void;
  hoy: string;
  libro: RenglonDeLibro[];
}

const Ctx = createContext<CtxQbo | null>(null);

export function useQbo(): CtxQbo {
  const c = useContext(Ctx);
  if (!c) throw new Error("useQbo fuera de ProveedorQbo");
  return c;
}

/** El estado del prototipo: nace de lo guardado en este navegador o de la muestra, y se guarda en cada cambio. */
export function ProveedorQbo({ children }: { children: ReactNode }) {
  const hoy = useMemo(() => hoyIso(), []);
  const [e, d] = useReducer(reductorQbo, null as unknown as EstadoQbo);
  const [listo, setListo] = useState(false);
  useEffect(() => {
    d({ tipo: "cargar", estado: leerGuardado() ?? generarMuestra(hoy) });
    setListo(true);
  }, [hoy]);
  useEffect(() => { if (listo && e) guardar(e); }, [e, listo]);
  const libro = useMemo(() => (e ? libroMayor(e) : []), [e]);
  if (!listo || !e) return <Cargando />;
  return <Ctx.Provider value={{ e, d, hoy, libro }}>{children}</Ctx.Provider>;
}

function Cargando() {
  const { t } = usePrefs();
  return <p className="qbo-gris" role="status">{t("Loading sample data…", "Cargando datos de ejemplo…")}</p>;
}

export function nuevoId(prefijo: string): string {
  return `${prefijo}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

const FMT = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
export function dinero(v: number): string {
  return FMT.format(v || 0);
}

/** Una ventana sobre la pantalla (las clases `.overlay`/`.modal` del hub): Escape o clic fuera cierra. */
export function Ventana({ titulo, onCerrar, children, ancho = 760, pie }: { titulo: string; onCerrar: () => void; children: ReactNode; ancho?: number; pie?: ReactNode }) {
  const { t } = usePrefs();
  useEffect(() => {
    const k = (ev: KeyboardEvent) => { if (ev.key === "Escape") onCerrar(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onCerrar]);
  return (
    <div className="overlay" onClick={onCerrar}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={titulo} style={{ maxWidth: ancho }} onClick={(ev) => ev.stopPropagation()}>
        <div className="between" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <h3 style={{ margin: 0 }}>{titulo}</h3>
          <button type="button" className="btn btn-sm btn-ghost" aria-label={t("Close", "Cerrar")} onClick={onCerrar}>✕</button>
        </div>
        {children}
        {pie ? <div className="modal-actions">{pie}</div> : null}
      </div>
    </div>
  );
}

const ESTADOS: Record<string, [string, string]> = {
  draft: ["Draft", "Borrador"],
  sent: ["Sent", "Enviada"],
  open: ["Open", "Abierta"],
  partial: ["Partially paid", "Pagada en parte"],
  paid: ["Paid", "Pagada"],
  overdue: ["Overdue", "Vencida"],
  received: ["Received, not billed", "Recibida, sin facturar"],
  closed: ["Closed", "Cerrada"],
  new: ["To review", "Por revisar"],
  categorized: ["Categorized", "Categorizado"],
  matched: ["Matched", "Emparejado"],
  excluded: ["Excluded", "Excluido"],
};
const ESTADO_ORDEN_PARCIAL: [string, string] = ["Partially received", "Recibida en parte"];

export function etiquetaDeEstado(estado: string, t: (en: string, es: string) => string, deOrden = false): string {
  const par = deOrden && estado === "partial" ? ESTADO_ORDEN_PARCIAL : ESTADOS[estado];
  return par ? t(par[0], par[1]) : estado;
}

export function Estado({ estado, deOrden }: { estado: string; deOrden?: boolean }) {
  const { t } = usePrefs();
  return <span className={`badge qbo-estado qbo-estado-${estado}`}>{etiquetaDeEstado(estado, t, deOrden)}</span>;
}

/** Exporta una tabla con el ayudante del hub (`exportaTablaExcel`). */
export function BotonExportar({ archivo, hoja, cabeceras, filas }: { archivo: string; hoja: string; cabeceras: string[]; filas: () => ValorDeCelda[][] }) {
  const { t } = usePrefs();
  const [ocupado, setOcupado] = useState(false);
  return (
    <button type="button" className="btn btn-sm btn-ghost" disabled={ocupado} onClick={async () => {
      setOcupado(true);
      try { await exportaTablaExcel(archivo, hoja, cabeceras, filas()); } finally { setOcupado(false); }
    }}>
      ⬇ {t("Export to Excel", "Exportar a Excel")}
    </button>
  );
}

/** Botones de sub-sección (dentro de una pestaña). */
export function SubSecciones<K extends string>({ opciones, valor, onCambia }: { opciones: { clave: K; texto: string }[]; valor: K; onCambia: (k: K) => void }) {
  return (
    <div className="qbo-sub" role="group">
      {opciones.map((o) => (
        <button key={o.clave} type="button" aria-pressed={valor === o.clave} data-sub={o.clave} onClick={() => onCambia(o.clave)}>{o.texto}</button>
      ))}
    </div>
  );
}

export function useNombres() {
  const { e } = useQbo();
  const { lang } = usePrefs();
  return useMemo(() => ({
    cliente: (id: string) => e.clientes.find((c) => c.id === id)?.nombre ?? "—",
    proveedor: (id: string) => e.proveedores.find((p) => p.id === id)?.nombre ?? "—",
    articulo: (id: string) => e.articulos.find((a) => a.id === id)?.nombre ?? "—",
    cuenta: (id: string) => {
      const c = e.cuentas.find((x) => x.id === id);
      return c ? `${c.numero} · ${lang === "es" ? c.nombre_es : c.nombre_en}` : "—";
    },
  }), [e, lang]);
}

export function SelectorDeCuenta({ valor, onCambia, tipos, etiqueta }: { valor: string; onCambia: (v: string) => void; tipos?: string[]; etiqueta?: string }) {
  const { e } = useQbo();
  const { t } = usePrefs();
  const n = useNombres();
  return (
    <select value={valor} aria-label={etiqueta ?? t("Account", "Cuenta")} onChange={(ev) => onCambia(ev.target.value)}>
      <option value="">{t("Choose an account…", "Elige una cuenta…")}</option>
      {e.cuentas.filter((c) => !tipos || tipos.includes(c.tipo)).map((c) => <option key={c.id} value={c.id}>{n.cuenta(c.id)}</option>)}
    </select>
  );
}
