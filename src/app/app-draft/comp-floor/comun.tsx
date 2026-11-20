"use client";

import { createContext, useContext, useEffect, useMemo, useReducer, useState, type ReactNode } from "react";
import { usePrefs } from "@/lib/prefs";
import { buscarLotes, convertir, hoyIso, reservadoPorExistencia } from "@/lib/app-draft/compfloor/logica";
import type { EstadoPedido } from "@/lib/app-draft/compfloor/logica";
import { guardar, leerGuardado, reductorCf, type AccionCf } from "@/lib/app-draft/compfloor/estado";
import { generarMuestra } from "@/lib/app-draft/compfloor/muestra";
import { NOMBRE_TIENDA, TIENDAS, type Articulo, type EstadoCf, type Existencia, type Tienda, type TipoCliente, type Unidad } from "@/lib/app-draft/compfloor/tipos";

interface CtxCf {
  e: EstadoCf;
  d: (a: AccionCf) => void;
  hoy: string;
  reservado: Record<string, number>;
}

const Ctx = createContext<CtxCf | null>(null);

export function useCf(): CtxCf {
  const c = useContext(Ctx);
  if (!c) throw new Error("useCf fuera de ProveedorCf");
  return c;
}

/** El estado del prototipo: nace de lo guardado en este navegador o de la muestra, y se guarda en cada cambio. */
export function ProveedorCf({ children }: { children: ReactNode }) {
  const hoy = useMemo(() => hoyIso(), []);
  const [e, d] = useReducer(reductorCf, null as unknown as EstadoCf);
  const [listo, setListo] = useState(false);
  useEffect(() => {
    d({ tipo: "cargar", estado: leerGuardado() ?? generarMuestra(hoy) });
    setListo(true);
  }, [hoy]);
  useEffect(() => { if (listo && e) guardar(e); }, [e, listo]);
  const reservado = useMemo(() => (e ? reservadoPorExistencia(e) : {}), [e]);
  if (!listo || !e) return <Cargando />;
  return <Ctx.Provider value={{ e, d, hoy, reservado }}>{children}</Ctx.Provider>;
}

function Cargando() {
  const { t } = usePrefs();
  return <p className="qbo-gris" role="status">{t("Loading sample data…", "Cargando datos de ejemplo…")}</p>;
}

export const tiendaNombre = (t: Tienda) => NOMBRE_TIENDA[t];

export function SelectorTienda({ valor, onCambia, todas }: { valor: Tienda | ""; onCambia: (t: Tienda | "") => void; todas?: boolean }) {
  const { t } = usePrefs();
  return (
    <select value={valor} aria-label={t("Store", "Tienda")} onChange={(ev) => onCambia(ev.target.value as Tienda | "")}>
      {todas && <option value="">{t("All stores", "Todas las tiendas")}</option>}
      {TIENDAS.map((s) => <option key={s} value={s}>{NOMBRE_TIENDA[s]}</option>)}
    </select>
  );
}

export function SelectorArticulo({ valor, onCambia, etiqueta }: { valor: string; onCambia: (id: string) => void; etiqueta?: string }) {
  const { t } = usePrefs();
  const { e } = useCf();
  return (
    <select value={valor} aria-label={etiqueta ?? t("Product", "Producto")} onChange={(ev) => onCambia(ev.target.value)}>
      <option value="">{t("Choose a product…", "Elige un producto…")}</option>
      {e.articulos.map((a) => <option key={a.id} value={a.id}>{a.sku} · {a.nombre}</option>)}
    </select>
  );
}

export function useTextos() {
  const { t } = usePrefs();
  return useMemo(() => ({
    unidad: (u: Unidad, n = 2) => (u === "box" ? (n === 1 ? t("box", "caja") : t("boxes", "cajas")) : u === "sqft" ? t("sq ft", "pies²") : n === 1 ? t("piece", "pieza") : t("pieces", "piezas")),
    tipo: (k: TipoCliente) => (k === "retail" ? t("Retail (walk-in)", "Menudeo (mostrador)") : k === "contractor" ? t("Contractor / tile setter", "Contratista / instalador") : t("Dealer", "Distribuidor")),
    estado: (s: EstadoPedido) => ({
      quote: t("Quote", "Cotización"),
      ready: t("Ready to ship", "Listo para enviar"),
      backorder: t("Waiting on stock", "Esperando mercancía"),
      partial: t("Part shipped", "Enviado en parte"),
      done: t("Done", "Terminado"),
    })[s],
  }), [t]);
}

const CLASE_ESTADO: Record<EstadoPedido, string> = { quote: "draft", ready: "open", backorder: "overdue", partial: "partial", done: "closed" };
export function EstadoPedidoBadge({ estado }: { estado: EstadoPedido }) {
  const x = useTextos();
  return <span className={`badge qbo-estado qbo-estado-${CLASE_ESTADO[estado]}`} data-estado={estado}>{x.estado(estado)}</span>;
}

/** «13 boxes = 201.5 sq ft = 104 pieces» para un artículo y un número de cajas. */
export function Equivalencias({ a, cajas }: { a: Articulo; cajas: number }) {
  const x = useTextos();
  const c = convertir(a, cajas, "box");
  return (
    <span className="qbo-explica" data-equivalencias>
      {c.cajas} {x.unidad("box", c.cajas)}
      {a.sqftPorCaja > 0 && <> = {c.sqft} {x.unidad("sqft")}</>}
      {a.piezasPorCaja > 1 && <> = {c.piezas} {x.unidad("pc", c.piezas)}</>}
    </span>
  );
}

/** Texto corto de un renglón de stock: «McAllen · lot L2405 / shade B · bin A-01». */
export function useDescribeLote() {
  const { t } = usePrefs();
  return (x: Existencia | undefined) => (x ? `${NOMBRE_TIENDA[x.tienda]} · ${t("lot", "lote")} ${x.lote} / ${t("shade", "tono")} ${x.tono} · bin ${x.bin}` : t("no lot yet", "sin lote aún"));
}

/** Selector de lote (renglón de stock) para un artículo: enseña lo libre y marca los que alcanzan. */
export function SelectorLote({ articuloId, cajas, tienda, valor, onCambia, permitirNinguno }: { articuloId: string; cajas: number; tienda?: Tienda | null; valor: string | null; onCambia: (id: string | null) => void; permitirNinguno?: boolean }) {
  const { t } = usePrefs();
  const { e } = useCf();
  const desc = useDescribeLote();
  const filas = useMemo(() => (articuloId ? buscarLotes(e, articuloId, cajas, tienda) : []), [e, articuloId, cajas, tienda]);
  return (
    <select value={valor ?? ""} aria-label={t("Lot", "Lote")} onChange={(ev) => onCambia(ev.target.value || null)} disabled={!articuloId}>
      <option value="">{permitirNinguno ? t("Best lot in this store (automatic)", "El mejor lote de la tienda (automático)") : t("Choose lot…", "Elige lote…")}</option>
      {filas.map((f) => (
        <option key={f.existencia.id} value={f.existencia.id}>
          {f.alcanza ? "✓ " : ""}{desc(f.existencia)} — {f.libre} {t("free", "libres")}{f.existencia.remanentePct ? ` · ${t("remnant", "remanente")} −${f.existencia.remanentePct}%` : ""}
        </option>
      ))}
    </select>
  );
}
