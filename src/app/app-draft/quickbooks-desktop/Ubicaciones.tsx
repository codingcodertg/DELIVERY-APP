"use client";

import { useMemo, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { TablaEstandar, type ColumnaEstandar } from "@/components/TablaEstandar";
import { acomodar, existenciasLibres } from "@/lib/app-draft/qbd/inventario";
import type { Existencia } from "@/lib/app-draft/qbd/tipos";
import { Ventana, nuevoId } from "../quickbooks-online/comun";
import { Campo } from "../quickbooks-online/piezas";
import { useError, useN, useQbd } from "./comun";

/** Ubicaciones dentro de cada sitio: qué hay en cada bin, acomodar lo que está en el andén y mover entre bins. */
export function Ubicaciones() {
  const { t } = usePrefs();
  const { e, d } = useQbd();
  const n = useN();
  const [sitioId, setSitio] = useState("s-mca");
  const [soloAnden, setSoloAnden] = useState(false);
  const [mover, setMover] = useState<Existencia | null>(null);
  const [codigo, setCodigo] = useState("");
  const libres = useMemo(() => new Map(existenciasLibres(e).map((x) => [x.id, x.cantidad])), [e]);
  const filas = useMemo(() => e.existencias
    .filter((x) => x.sitioId === sitioId && (!soloAnden || x.binId === null))
    .map((x) => ({ ...x, nombre: n.articulo(x.articuloId), binTxt: n.bin(x.binId), libre: libres.get(x.id) ?? 0 })), [e, sitioId, soloAnden, n, libres]);
  const columnas = useMemo<ColumnaEstandar<(typeof filas)[number]>[]>(() => [
    { key: "binTxt", en: "Bin", es: "Ubicación", ancho: 150, fija: true, valor: (x) => x.binTxt, celda: (x) => x.binId ? <b>{x.binTxt}</b> : <span className="qbd-chip">{x.binTxt}</span> },
    { key: "nombre", en: "Product", es: "Producto", ancho: 240, valor: (x) => x.nombre },
    { key: "lote", en: "Lot", es: "Lote", ancho: 130, valor: (x) => x.lote ?? "—" },
    { key: "caduca", en: "Expires", es: "Caduca", ancho: 105, valor: (x) => x.caduca ?? "—" },
    { key: "cantidad", en: "Qty", es: "Cant.", ancho: 150, numerico: true, valor: (x) => x.cantidad, celda: (x) => n.cant(x.articuloId, x.cantidad) },
  ], [n]);
  const binsDelSitio = e.bins.filter((b) => b.sitioId === sitioId);
  return (
    <section className="qbo-seccion">
      <p className="qbo-explica">{t("Each store has bins (aisle-rack-level). New stock lands on the dock; putting it away tells pickers exactly where to find it. Pick lists in Sales orders tell the picker which bin and lot to take.",
        "Cada tienda tiene ubicaciones (pasillo-rack-nivel). Lo que llega cae en el andén; acomodarlo le dice al surtidor dónde encontrarlo. Las listas de surtido de Órdenes de venta dicen de qué ubicación y lote tomar.")}</p>
      <div className="qbo-barra">
        <select value={sitioId} aria-label={t("Site", "Sitio")} data-campo="sitio-bins" onChange={(ev) => setSitio(ev.target.value)} style={{ maxWidth: 260 }}>
          {e.sitios.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </select>
        <label className="qbo-explica"><input type="checkbox" checked={soloAnden} onChange={(ev) => setSoloAnden(ev.target.checked)} style={{ width: "auto" }} /> {t("Only what's on the dock", "Solo lo que está en el andén")}</label>
      </div>
      <div className="qbo-barra">
        <span className="qbo-explica">{t("Bins here", "Ubicaciones aquí")}:</span>
        {binsDelSitio.map((b) => <span key={b.id} className="qbd-chip qbd-chip-gris">{b.codigo}</span>)}
        <input value={codigo} placeholder={t("New bin, e.g. B-03-2", "Nueva, p. ej. B-03-2")} aria-label={t("New bin code", "Código de ubicación nueva")} onChange={(ev) => setCodigo(ev.target.value)} style={{ maxWidth: 170 }} />
        <button type="button" className="btn btn-sm btn-ghost" disabled={!codigo.trim()} onClick={() => { d({ tipo: "nuevoBin", id: nuevoId("bin"), sitioId, codigo }); setCodigo(""); }}>+ {t("Add bin", "Agregar")}</button>
      </div>
      <TablaEstandar id="app-draft-qbd-bins" filas={filas} claveDe={(x) => x.id} columnas={columnas} onFila={(x) => setMover(x)} ordenInicial={{ clave: "binTxt", direccion: "asc" }}
        acciones={(x) => <button type="button" className="btn btn-sm btn-ghost" data-accion="acomodar" onClick={(ev) => { ev.stopPropagation(); setMover(x); }}>{x.binId ? t("Move", "Mover") : t("Put away", "Acomodar")}</button>} anchoDeAcciones={110}
        vacio={soloAnden ? t("Nothing waiting on the dock.", "No hay nada esperando en el andén.") : t("No stock at this site.", "No hay existencia en este sitio.")} />
      {mover && <FormAcomodar x={mover} libre={libres.get(mover.id) ?? 0} onCerrar={() => setMover(null)} />}
    </section>
  );
}

function FormAcomodar({ x, libre, onCerrar }: { x: Existencia; libre: number; onCerrar: () => void }) {
  const { t } = usePrefs();
  const { e, d } = useQbd();
  const n = useN();
  const msg = useError();
  const [binId, setBin] = useState("");
  const [cantidad, setCantidad] = useState(libre);
  const [error, setError] = useState("");
  const ok = () => {
    const id = nuevoId("x");
    const r = acomodar(e, x.id, binId, cantidad, id);
    if (!r.ok) return setError(msg(r.error));
    d({ tipo: "acomodar", existenciaId: x.id, binId, cantidad, nuevoId: id });
    onCerrar();
  };
  return (
    <Ventana titulo={x.binId ? t("Move to another bin", "Mover a otra ubicación") : t("Put away", "Acomodar")} onCerrar={onCerrar} ancho={520} pie={<>
      <button type="button" className="btn btn-ghost" onClick={onCerrar}>{t("Cancel", "Cancelar")}</button>
      <button type="button" className="btn btn-primary" data-accion="confirmar-acomodar" disabled={!binId} onClick={ok}>{t("Move", "Mover")}</button>
    </>}>
      <div className="qbo-form">
        <div className="qbo-explica">{n.articulo(x.articuloId)}{x.lote ? ` · ${t("lot", "lote")} ${x.lote}` : ""} · {t("now in", "ahora en")} {n.bin(x.binId)} · {t("free to move", "libre para mover")}: {n.cant(x.articuloId, libre)}</div>
        <div className="qbo-campos">
          <Campo etiqueta={t("To bin", "A la ubicación")}>
            <select value={binId} data-campo="bin-destino" onChange={(ev) => setBin(ev.target.value)}>
              <option value="">{t("Choose…", "Elige…")}</option>
              {e.bins.filter((b) => b.sitioId === x.sitioId && b.id !== x.binId).map((b) => <option key={b.id} value={b.id}>{b.codigo}</option>)}
            </select>
          </Campo>
          <Campo etiqueta={`${t("Quantity", "Cantidad")} (${n.unidad(n.base(x.articuloId))})`}>
            <input type="number" min={1} max={libre} value={cantidad || ""} onChange={(ev) => setCantidad(Math.floor(Number(ev.target.value) || 0))} />
          </Campo>
        </div>
        {libre < x.cantidad && <p className="qbo-explica">{t("Part of this is set aside for a pick list and can't be moved.", "Parte está apartada para una lista de surtido y no se puede mover.")}</p>}
        {error && <p className="qbo-error" role="alert">{error}</p>}
      </div>
    </Ventana>
  );
}
