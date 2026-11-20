"use client";

import { usePrefs } from "@/lib/prefs";
import { convertir, libreDe, mezclaDeLotes, precioPara, r2 } from "@/lib/app-draft/compfloor/logica";
import type { Articulo, Tienda, TipoCliente, Unidad } from "@/lib/app-draft/compfloor/tipos";
import { dinero } from "../quickbooks-online/comun";
import { Equivalencias, SelectorArticulo, SelectorLote, useCf, useTextos } from "./comun";

/** Una línea mientras se escribe: el vendedor habla en la unidad que quiera; el sistema la pasa a cajas enteras. */
export interface Borrador {
  articuloId: string;
  cantidad: number;
  unidad: Unidad;
  existenciaId: string | null;
  especial: boolean;
}

export const borradorVacio = (): Borrador => ({ articuloId: "", cantidad: 0, unidad: "sqft", existenciaId: null, especial: false });

export interface LineaCalculada { b: Borrador; a: Articulo | undefined; cajas: number; precio: number; regla: string; importe: number; libre: number | null; falta: number }

/** Calcula cajas, precio aplicado (nivel del cliente + remanente) e importe de cada línea. */
export function useCalculaLineas(lineas: readonly Borrador[], tipo: TipoCliente | null): LineaCalculada[] {
  const { e, reservado } = useCf();
  return lineas.map((b) => {
    const a = e.articulos.find((x) => x.id === b.articuloId);
    const x = b.existenciaId ? e.existencias.find((y) => y.id === b.existenciaId) : undefined;
    const cajas = a ? convertir(a, b.cantidad, b.unidad).cajas : 0;
    const p = a ? precioPara(a, tipo, e.niveles, x) : { precio: 0, regla: "list" as const, remanente: false };
    const libre = x ? libreDe(x, reservado) : null;
    return { b, a, cajas, precio: p.precio, regla: p.regla + (p.remanente ? "+remnant" : ""), importe: r2(cajas * p.precio), libre, falta: libre == null ? 0 : Math.max(0, cajas - libre) };
  });
}

export function EntradaCantidad({ a, cantidad, unidad, onCambia }: { a: Articulo | undefined; cantidad: number; unidad: Unidad; onCambia: (c: number, u: Unidad) => void }) {
  const { t } = usePrefs();
  const x = useTextos();
  const unidades: Unidad[] = a ? (["sqft", "box", "pc"] as Unidad[]).filter((u) => (u === "sqft" ? a.sqftPorCaja > 0 : u === "pc" ? a.piezasPorCaja > 1 : true)) : ["sqft", "box", "pc"];
  return (
    <span className="cf-cantidad">
      <input type="number" min={0} step="any" inputMode="decimal" aria-label={t("Quantity", "Cantidad")} value={cantidad || ""} onChange={(ev) => onCambia(Number(ev.target.value) || 0, unidad)} />
      <select aria-label={t("Unit", "Unidad")} value={unidades.includes(unidad) ? unidad : unidades[0]} onChange={(ev) => onCambia(cantidad, ev.target.value as Unidad)}>
        {unidades.map((u) => <option key={u} value={u}>{x.unidad(u)}</option>)}
      </select>
    </span>
  );
}

const REGLA: Record<string, [string, string]> = {
  list: ["list price", "precio de lista"],
  level: ["customer-type price", "precio por tipo de cliente"],
  fixed: ["fixed price for this customer type", "precio fijo para este tipo de cliente"],
};

/**
 * Las líneas de una cotización, pedido o venta de mostrador: producto, cantidad en cualquier unidad, lote. Todo lo
 * demás (cajas, pies², precio por nivel, importe, avisos de lote) lo pone el sistema.
 */
export function EditorDeVenta({ lineas, onCambia, tienda, tipo, modo }: { lineas: Borrador[]; onCambia: (l: Borrador[]) => void; tienda: Tienda; tipo: TipoCliente | null; modo: "order" | "counter" }) {
  const { t } = usePrefs();
  const { e } = useCf();
  const calc = useCalculaLineas(lineas, tipo);
  const pon = (i: number, c: Partial<Borrador>) => onCambia(lineas.map((l, k) => (k === i ? { ...l, ...c } : l)));
  const mezcla = mezclaDeLotes(lineas, e.existencias);
  const total = r2(calc.reduce((s, c) => s + c.importe, 0));
  return (
    <div className="qbo-lineas">
      {calc.map((c, i) => {
        const hayStock = c.a ? e.existencias.some((x) => x.articuloId === c.a!.id && x.cajas > 0 && !x.apartadoPara) : true;
        const r = REGLA[c.regla.replace("+remnant", "")];
        return (
          <div key={i} className="cf-linea" data-linea={i}>
            <SelectorArticulo valor={c.b.articuloId} onCambia={(id) => {
              const a = e.articulos.find((x) => x.id === id);
              pon(i, { articuloId: id, existenciaId: null, especial: false, unidad: a?.unidadVenta ?? "sqft" });
            }} />
            <EntradaCantidad a={c.a} cantidad={c.b.cantidad} unidad={c.b.unidad} onCambia={(cantidad, unidad) => pon(i, { cantidad, unidad })} />
            {c.b.especial
              ? <span className="qbo-explica">{t("Ordered from the vendor for this customer", "Se pide al proveedor para este cliente")}</span>
              : <SelectorLote articuloId={c.b.articuloId} cajas={c.cajas} tienda={tienda} valor={c.b.existenciaId} onCambia={(id) => pon(i, { existenciaId: id })} permitirNinguno={modo === "order"} />}
            <span className="qbo-num"><b>{dinero(c.importe)}</b></span>
            <button type="button" className="btn btn-sm btn-ghost" aria-label={t("Remove line", "Quitar línea")} onClick={() => onCambia(lineas.filter((_, k) => k !== i))}>✕</button>
            {c.a && c.cajas > 0 && (
              <div className="cf-linea-info">
                <Equivalencias a={c.a} cajas={c.cajas} />
                <span className="qbo-explica"> · {dinero(c.precio)}/{t("box", "caja")} ({t(r[0], r[1])}{c.regla.includes("remnant") ? t(", remnant discount", ", descuento de remanente") : ""})</span>
                {c.falta > 0 && modo === "order" && <span className="cf-aviso" data-backorder>⏳ {t(`${c.falta} boxes not in this lot yet: they will wait as a backorder.`, `${c.falta} cajas aún no están en este lote: quedan pendientes (backorder).`)}</span>}
                {c.falta > 0 && modo === "counter" && <span className="cf-aviso qbo-rojo">{t(`Only ${c.libre} boxes free in this lot.`, `Solo hay ${c.libre} cajas libres en este lote.`)}</span>}
                {!hayStock && modo === "order" && (
                  <label className="cf-check"><input type="checkbox" checked={c.b.especial} onChange={(ev) => pon(i, { especial: ev.target.checked, existenciaId: null })} /> {t("Not in stock anywhere — special order it from the vendor", "No hay en ninguna tienda — pedirlo al proveedor (pedido especial)")}</label>
                )}
              </div>
            )}
          </div>
        );
      })}
      {mezcla.length > 0 && (
        <p className="cf-aviso qbo-rojo" role="alert" data-mezcla>
          ⚠ {t("Mixed lots: ", "Lotes mezclados: ")}{mezcla.map((id) => e.articulos.find((a) => a.id === id)?.nombre).join(", ")}
          {t(" come from different lots. Different lots don't match in color — use one lot per job.", " vienen de lotes distintos. Lotes distintos no combinan de color: usa un solo lote por trabajo.")}
        </p>
      )}
      <div className="qbo-barra" style={{ justifyContent: "space-between" }}>
        <button type="button" className="btn btn-sm btn-ghost" data-accion="agregar-linea" onClick={() => onCambia([...lineas, borradorVacio()])}>+ {t("Add product", "Agregar producto")}</button>
        <b className="qbo-num" data-total>{t("Total", "Total")}: {dinero(total)}</b>
      </div>
    </div>
  );
}
