"use client";

import { useMemo, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { TablaEstandar, type ColumnaEstandar } from "@/components/TablaEstandar";
import { aBase, mejorProveedor, porReordenar, r2, sumaDias } from "@/lib/app-draft/qbd/inventario";
import { dinero, nuevoId } from "../quickbooks-online/comun";
import { useN, useQbd } from "./comun";

/** Proveedores alternos por artículo (costo y días de entrega) y la reorden eligiendo a quién pedir. */
export function Alternos() {
  const { t } = usePrefs();
  const { e } = useQbd();
  const n = useN();
  const [criterio, setCriterio] = useState<"cost" | "speed">("cost");
  const filas = useMemo(() => porReordenar(e).map((x) => ({ ...x, nombre: n.articulo(x.articuloId) })), [e, n]);
  const reordenes = useMemo(() => e.reordenes.map((r) => ({ ...r, nombre: n.articulo(r.articuloId), prov: n.proveedor(r.proveedorId), total: r2(r.cantidad * r.costo) })), [e.reordenes, n]);
  const colRe = useMemo<ColumnaEstandar<(typeof reordenes)[number]>[]>(() => [
    { key: "fecha", en: "Date", es: "Fecha", ancho: 100, fija: true, valor: (r) => r.fecha },
    { key: "nombre", en: "Product", es: "Producto", ancho: 230, valor: (r) => r.nombre },
    { key: "prov", en: "Vendor", es: "Proveedor", ancho: 210, valor: (r) => r.prov },
    { key: "cantidad", en: "Qty", es: "Cant.", ancho: 110, numerico: true, valor: (r) => r.cantidad, celda: (r) => n.cant(r.articuloId, r.cantidad) },
    { key: "total", en: "Cost", es: "Costo", ancho: 100, numerico: true, valor: (r) => r.total, celda: (r) => dinero(r.total) },
    { key: "llega", en: "Arrives", es: "Llega", ancho: 100, valor: (r) => r.llega },
  ], [n]);
  return (
    <section className="qbo-seccion">
      <p className="qbo-explica">{t("The same tile is often available from more than one supplier. Each product keeps its vendors with their cost and lead time; when it runs low, choose who to order from.",
        "La misma loseta muchas veces la tiene más de un proveedor. Cada producto guarda sus proveedores con su costo y días de entrega; cuando se acaba, eliges a quién pedirle.")}</p>
      <div className="qbo-barra">
        <span className="qbo-explica">{t("Suggest the vendor that is", "Sugerir el proveedor")}</span>
        <div className="qbo-sub" role="group">
          <button type="button" aria-pressed={criterio === "cost"} onClick={() => setCriterio("cost")}>{t("Cheapest", "Más barato")}</button>
          <button type="button" aria-pressed={criterio === "speed"} onClick={() => setCriterio("speed")}>{t("Fastest", "Más rápido")}</button>
        </div>
      </div>
      <h2 style={{ fontSize: 16, margin: 0 }}>{t("Running low", "Por acabarse")}</h2>
      {filas.length ? (
        <div className="qbo-dos">{filas.map((f) => <Reordenar key={f.articuloId} fila={f} criterio={criterio} />)}</div>
      ) : <p className="qbo-gris">{t("Nothing below its reorder point.", "Nada está bajo su punto de reorden.")}</p>}
      <h2 style={{ fontSize: 16, margin: 0 }}>{t("Reorders placed", "Reórdenes hechas")}</h2>
      <TablaEstandar id="app-draft-qbd-reordenes" filas={reordenes} claveDe={(r) => r.id} columnas={colRe} ordenInicial={{ clave: "fecha", direccion: "desc" }} vacio={t("No reorders yet.", "Todavía no hay reórdenes.")} />
    </section>
  );
}

function Reordenar({ fila, criterio }: { fila: ReturnType<typeof porReordenar>[number] & { nombre: string }; criterio: "cost" | "speed" }) {
  const { t } = usePrefs();
  const { e, d, hoy } = useQbd();
  const n = useN();
  const opciones = e.alternos.filter((a) => a.articuloId === fila.articuloId);
  const sugerido = mejorProveedor(e.alternos, fila.articuloId, criterio);
  const [elegido, setElegido] = useState<string | null>(null);
  const proveedorId = elegido ?? sugerido?.proveedorId ?? "";
  const j = n.juego(fila.articuloId);
  const u = j?.compra ?? n.base(fila.articuloId);
  const [cantidad, setCantidad] = useState(Math.max(1, Math.ceil(fila.sugerido / (j?.unidades.find((x) => x.u === u)?.factor ?? 1))));
  const op = opciones.find((o) => o.proveedorId === proveedorId);
  const base = aBase(cantidad, u, j);
  return (
    <div className="qbo-caja" data-reorden={n.sku(fila.articuloId)}>
      <h2>{fila.nombre}</h2>
      <p className="qbo-explica">{t("On hand", "En mano")}: {n.cant(fila.articuloId, fila.mano)} · {t("reorder point", "punto de reorden")}: {fila.punto}{fila.pedido ? ` · ${t("on order", "pedido")}: ${fila.pedido}` : ""}</p>
      <div className="qbo-lista" role="radiogroup" aria-label={t("Vendor", "Proveedor")}>
        {opciones.map((o) => (
          <label key={o.proveedorId} className="qbo-renglon" style={{ cursor: "pointer" }}>
            <span><input type="radio" name={`prov-${fila.articuloId}`} checked={o.proveedorId === proveedorId} onChange={() => setElegido(o.proveedorId)} style={{ width: "auto" }} /> {n.proveedor(o.proveedorId)}{o.proveedorId === sugerido?.proveedorId && <> <span className="qbd-chip">{t("suggested", "sugerido")}</span></>}</span>
            <span className="qbo-num">{dinero(o.costo)}/{n.unidad(n.base(fila.articuloId), 1)} · {o.dias} {t("days", "días")}</span>
          </label>
        ))}
      </div>
      <div className="qbo-barra" style={{ marginTop: 8 }}>
        <input type="number" min={1} value={cantidad || ""} aria-label={t("Quantity", "Cantidad")} style={{ maxWidth: 80 }} onChange={(ev) => setCantidad(Math.max(0, Math.floor(Number(ev.target.value) || 0)))} />
        <span className="qbo-explica">{n.unidad(u)} = {base} {n.unidad(n.base(fila.articuloId))} · {op ? dinero(base * op.costo) : ""}</span>
        <button type="button" className="btn btn-primary btn-sm" data-accion="reordenar" disabled={!op || base < 1} onClick={() => op && d({ tipo: "reorden", reorden: { id: nuevoId("ro"), articuloId: fila.articuloId, proveedorId: op.proveedorId, cantidad: base, costo: op.costo, fecha: hoy, llega: sumaDias(hoy, op.dias) } })}>
          {t("Reorder", "Pedir")}
        </button>
      </div>
    </div>
  );
}
