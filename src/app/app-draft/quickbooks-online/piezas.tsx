"use client";

import { usePrefs } from "@/lib/prefs";
import { r2, repartePago } from "@/lib/app-draft/qbo/contabilidad";
import type { Aplicacion, Linea } from "@/lib/app-draft/qbo/tipos";
import { dinero, useQbo } from "./comun";

/** Las líneas de una factura o nota: artículo (pone descripción y precio), cantidad, precio. */
export function EditorDeLineas({ lineas, onCambia }: { lineas: Linea[]; onCambia: (l: Linea[]) => void }) {
  const { t } = usePrefs();
  const { e } = useQbo();
  const pon = (i: number, cambio: Partial<Linea>) => onCambia(lineas.map((l, k) => (k === i ? { ...l, ...cambio } : l)));
  return (
    <div className="qbo-lineas">
      <div className="qbo-linea qbo-linea-cabeza">
        <span>{t("Product or service", "Producto o servicio")}</span><span>{t("Qty", "Cant.")}</span><span>{t("Price", "Precio")}</span><span className="qbo-num">{t("Amount", "Importe")}</span><span />
      </div>
      {lineas.map((l, i) => (
        <div key={i} className="qbo-linea" data-linea={i}>
          <select aria-label={t("Product", "Producto")} value={l.articuloId} onChange={(ev) => {
            const a = e.articulos.find((x) => x.id === ev.target.value);
            pon(i, a ? { articuloId: a.id, descripcion: a.nombre, precio: a.precio } : { articuloId: "" });
          }}>
            <option value="">{t("Choose…", "Elige…")}</option>
            {e.articulos.map((a) => <option key={a.id} value={a.id}>{a.sku} · {a.nombre} ({dinero(a.precio)}/{a.unidad})</option>)}
          </select>
          <input type="number" min={0} step="any" inputMode="decimal" aria-label={t("Quantity", "Cantidad")} value={l.cantidad || ""} onChange={(ev) => pon(i, { cantidad: Number(ev.target.value) || 0 })} />
          <input type="number" min={0} step="0.01" inputMode="decimal" aria-label={t("Price", "Precio")} value={l.precio || ""} onChange={(ev) => pon(i, { precio: Number(ev.target.value) || 0 })} />
          <span className="qbo-num">{dinero(r2(l.cantidad * l.precio))}</span>
          <button type="button" className="btn btn-sm btn-ghost" aria-label={t("Remove line", "Quitar línea")} onClick={() => onCambia(lineas.filter((_, k) => k !== i))}>✕</button>
        </div>
      ))}
      <div><button type="button" className="btn btn-sm btn-ghost" data-accion="agregar-linea" onClick={() => onCambia([...lineas, { articuloId: "", descripcion: "", cantidad: 1, precio: 0 }])}>+ {t("Add line", "Agregar línea")}</button></div>
    </div>
  );
}

export interface DocAbierto { id: string; numero: string; fecha: string; vence: string; saldo: number }

/**
 * Aplicar un monto a uno o varios documentos abiertos (facturas de un cliente o de un proveedor). Marca la casilla para
 * aplicar el saldo entero (o lo que quede), o escribe el monto a mano.
 */
export function Aplicador({ abiertos, aplicado, onCambia, disponible }: { abiertos: DocAbierto[]; aplicado: Aplicacion[]; onCambia: (a: Aplicacion[]) => void; disponible: number | null }) {
  const { t } = usePrefs();
  const monto = (id: string) => aplicado.find((a) => a.facturaId === id)?.monto ?? 0;
  const pon = (id: string, m: number) => {
    const resto = aplicado.filter((a) => a.facturaId !== id);
    onCambia(m > 0 ? [...resto, { facturaId: id, monto: r2(m) }] : resto);
  };
  const usado = r2(aplicado.reduce((a, x) => a + x.monto, 0));
  if (!abiertos.length) return <p className="qbo-gris">{t("No open invoices.", "No hay facturas abiertas.")}</p>;
  return (
    <div className="qbo-lista">
      {disponible != null && (
        <div className="qbo-barra">
          <button type="button" className="btn btn-sm btn-ghost" data-accion="repartir" onClick={() => onCambia(repartePago(disponible, abiertos).aplicado)}>
            ⇣ {t("Apply to oldest first", "Aplicar a la más vieja primero")}
          </button>
          <span className="qbo-explica">{t("Applied", "Aplicado")}: {dinero(usado)} · {t("left over (stays as customer credit)", "sobra (queda como crédito)")}: {dinero(Math.max(0, r2(disponible - usado)))}</span>
        </div>
      )}
      {abiertos.map((d) => {
        const m = monto(d.id);
        return (
          <label key={d.id} className="qbo-aplica" data-aplica={d.numero}>
            <input type="checkbox" checked={m > 0} onChange={(ev) => {
              if (!ev.target.checked) return pon(d.id, 0);
              const libre = disponible == null ? d.saldo : Math.max(0, r2(disponible - usado));
              pon(d.id, Math.min(d.saldo, libre || d.saldo));
            }} />
            <span>#{d.numero} · <span className="qbo-gris">{t("due", "vence")} {d.vence}</span></span>
            <span className="qbo-num">{t("open", "abierto")} {dinero(d.saldo)}</span>
            <input type="number" min={0} step="0.01" max={d.saldo} inputMode="decimal" aria-label={t("Amount to apply", "Monto a aplicar")} value={m || ""} onChange={(ev) => pon(d.id, Math.min(d.saldo, Number(ev.target.value) || 0))} />
          </label>
        );
      })}
    </div>
  );
}

export function Campo({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return <label className="qbo-campo"><span>{etiqueta}</span>{children}</label>;
}
