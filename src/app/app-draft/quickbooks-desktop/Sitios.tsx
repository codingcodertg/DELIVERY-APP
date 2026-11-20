"use client";

import { useMemo, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { TablaEstandar, type ColumnaEstandar } from "@/components/TablaEstandar";
import { siguienteNumero } from "@/lib/app-draft/qbo/estado";
import { aBase, crearTraspaso, disponible, enCamino, enMano } from "@/lib/app-draft/qbd/inventario";
import { Ventana, nuevoId } from "../quickbooks-online/comun";
import { Campo } from "../quickbooks-online/piezas";
import { Insignia, etiqueta, useError, useN, useQbd } from "./comun";

/** Existencia por tienda/almacén y traspasos entre ellos (con su estado «en camino»). */
export function Sitios() {
  const { t } = usePrefs();
  const { e } = useQbd();
  const n = useN();
  const [abierto, setAbierto] = useState<string | "nuevo" | null>(null);
  const filas = useMemo(() => n.inventariables.map((id) => ({
    id, sku: n.sku(id), nombre: n.articulo(id), base: n.base(id),
    porSitio: Object.fromEntries(e.sitios.map((s) => [s.id, enMano(e.existencias, id, s.id)])),
    camino: Object.fromEntries(e.sitios.map((s) => [s.id, enCamino(e, id, s.id)])),
    total: enMano(e.existencias, id),
  })), [e, n]);
  const columnas = useMemo<ColumnaEstandar<(typeof filas)[number]>[]>(() => [
    { key: "nombre", en: "Product", es: "Producto", ancho: 230, fija: true, valor: (f) => f.nombre, celda: (f) => <span>{f.nombre} <span className="qbo-gris">· {f.sku}</span></span> },
    { key: "base", en: "Counted in", es: "Se cuenta en", ancho: 95, valor: (f) => n.unidad(f.base) },
    ...e.sitios.map<ColumnaEstandar<(typeof filas)[number]>>((s) => ({
      key: s.id, en: s.nombre.replace("RDZ ", ""), es: s.nombre.replace("RDZ ", "").replace("Central warehouse", "Almacén central"), ancho: 110, numerico: true,
      valor: (f) => f.porSitio[s.id],
      celda: (f) => <span className={f.porSitio[s.id] === 0 ? "qbd-cero" : undefined}>{f.porSitio[s.id]}{f.camino[s.id] > 0 && <span className="qbd-camino">+{f.camino[s.id]} {t("in transit", "en camino")}</span>}</span>,
    })),
    { key: "total", en: "All sites", es: "Todos", ancho: 90, numerico: true, valor: (f) => f.total },
  ], [e.sitios, n, t]);
  const traspasos = useMemo(() => e.traspasos.map((x) => ({
    ...x, origen: n.sitio(x.origenId), destino: n.sitio(x.destinoId), piezas: x.lineas.reduce((a, l) => a + l.cantidad, 0),
    productos: Array.from(new Set(x.lineas.map((l) => n.articulo(l.articuloId)))).join(", "),
  })), [e.traspasos, n]);
  const colTraspasos = useMemo<ColumnaEstandar<(typeof traspasos)[number]>[]>(() => [
    { key: "numero", en: "Transfer", es: "Traspaso", ancho: 100, fija: true, valor: (x) => x.numero },
    { key: "fecha", en: "Date", es: "Fecha", ancho: 100, valor: (x) => x.fecha },
    { key: "origen", en: "From", es: "De", ancho: 170, valor: (x) => x.origen },
    { key: "destino", en: "To", es: "A", ancho: 150, valor: (x) => x.destino },
    { key: "productos", en: "Products", es: "Productos", ancho: 240, valor: (x) => x.productos },
    { key: "estado", en: "Status", es: "Estado", ancho: 120, valor: (x) => x.estado, etiqueta: (v) => etiqueta(String(v), t), celda: (x) => <Insignia estado={x.estado} /> },
  ], [t]);
  return (
    <section className="qbo-seccion">
      <p className="qbo-explica">{t("How much of each product is in each store and the central warehouse, counted in its base unit. Moving stock between stores is a transfer: it leaves one site, shows as “in transit”, and counts at the other site only once received.",
        "Cuánto hay de cada producto en cada tienda y en el almacén central, contado en su unidad base. Mover mercancía entre tiendas es un traspaso: sale de un sitio, aparece «en camino» y cuenta en el otro solo al recibirlo.")}</p>
      <TablaEstandar id="app-draft-qbd-existencia" filas={filas} claveDe={(f) => f.id} columnas={columnas} vacio={t("No inventory items.", "No hay productos de inventario.")} />
      <div className="qbo-barra">
        <h2 style={{ fontSize: 16, margin: 0 }}>{t("Transfers between sites", "Traspasos entre sitios")}</h2>
        <button type="button" className="btn btn-primary btn-sm" data-accion="nuevo-traspaso" onClick={() => setAbierto("nuevo")}>+ {t("New transfer", "Nuevo traspaso")}</button>
      </div>
      <TablaEstandar id="app-draft-qbd-traspasos" filas={traspasos} claveDe={(x) => x.id} columnas={colTraspasos} onFila={(x) => setAbierto(x.id)} ordenInicial={{ clave: "fecha", direccion: "desc" }}
        vacio={t("No transfers yet. Use “New transfer” to send stock from one site to another.", "Todavía no hay traspasos. Usa «Nuevo traspaso» para mandar mercancía de un sitio a otro.")} />
      {abierto === "nuevo" && <FormTraspaso onCerrar={() => setAbierto(null)} />}
      {abierto && abierto !== "nuevo" && <FichaTraspaso id={abierto} onCerrar={() => setAbierto(null)} />}
    </section>
  );
}

function FormTraspaso({ onCerrar }: { onCerrar: () => void }) {
  const { t } = usePrefs();
  const { e, d, hoy } = useQbd();
  const n = useN();
  const msg = useError();
  const [origenId, setOrigen] = useState("s-cen");
  const [destinoId, setDestino] = useState("");
  const [lineas, setLineas] = useState<{ articuloId: string; cantidad: number }[]>([{ articuloId: "", cantidad: 0 }]);
  const [error, setError] = useState("");
  const pon = (i: number, c: Partial<(typeof lineas)[number]>) => setLineas(lineas.map((l, k) => (k === i ? { ...l, ...c } : l)));
  const enviar = () => {
    const base = lineas.map((l) => ({ articuloId: l.articuloId, cantidad: l.articuloId ? aBase(l.cantidad, n.juego(l.articuloId)?.envio ?? "", n.juego(l.articuloId)) : 0 }));
    const tr = { id: nuevoId("tr"), numero: siguienteNumero(e.traspasos.map((x) => x.numero), "TR-", 701), origenId, destinoId, fecha: hoy, lineas: base };
    const r = crearTraspaso(e, tr, hoy);
    if (!r.ok) return setError(msg(r.error));
    d({ tipo: "traspaso", hoy, t: tr });
    onCerrar();
  };
  return (
    <Ventana titulo={t("New transfer", "Nuevo traspaso")} onCerrar={onCerrar} ancho={760} pie={<>
      <button type="button" className="btn btn-ghost" onClick={onCerrar}>{t("Cancel", "Cancelar")}</button>
      <button type="button" className="btn btn-primary" data-accion="enviar-traspaso" onClick={enviar}>{t("Send (mark in transit)", "Mandar (queda en camino)")}</button>
    </>}>
      <div className="qbo-form">
        <div className="qbo-campos">
          <Campo etiqueta={t("From", "De")}>
            <select value={origenId} data-campo="origen" onChange={(ev) => setOrigen(ev.target.value)}>{e.sitios.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}</select>
          </Campo>
          <Campo etiqueta={t("To", "A")}>
            <select value={destinoId} data-campo="destino" onChange={(ev) => setDestino(ev.target.value)}>
              <option value="">{t("Choose…", "Elige…")}</option>
              {e.sitios.filter((s) => s.id !== origenId).map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </Campo>
        </div>
        <p className="qbo-explica">{t("Quantities in the shipping unit. Lots that expire first leave first.", "Cantidades en la unidad de envío. Salen primero los lotes que caducan antes.")}</p>
        {lineas.map((l, i) => {
          const j = l.articuloId ? n.juego(l.articuloId) : undefined;
          return (
            <div key={i} className="qbo-linea" style={{ gridTemplateColumns: "minmax(0,3fr) minmax(70px,1fr) minmax(110px,1.4fr) 32px" }}>
              <select aria-label={t("Product", "Producto")} data-campo="producto" value={l.articuloId} onChange={(ev) => pon(i, { articuloId: ev.target.value })}>
                <option value="">{t("Choose…", "Elige…")}</option>
                {n.inventariables.map((id) => <option key={id} value={id}>{n.sku(id)} · {n.articulo(id)}</option>)}
              </select>
              <input type="number" min={0} inputMode="decimal" aria-label={t("Quantity", "Cantidad")} data-campo="cantidad" value={l.cantidad || ""} onChange={(ev) => pon(i, { cantidad: Number(ev.target.value) || 0 })} />
              <span className="qbo-explica">{j ? `${n.unidad(j.envio)} · ${t("free", "libre")} ${disponible(e, l.articuloId, origenId, hoy)}` : ""}</span>
              <button type="button" className="btn btn-sm btn-ghost" aria-label={t("Remove line", "Quitar línea")} onClick={() => setLineas(lineas.filter((_, k) => k !== i))}>✕</button>
            </div>
          );
        })}
        <div><button type="button" className="btn btn-sm btn-ghost" onClick={() => setLineas([...lineas, { articuloId: "", cantidad: 0 }])}>+ {t("Add product", "Agregar producto")}</button></div>
        {error && <p className="qbo-error" role="alert">{error}</p>}
      </div>
    </Ventana>
  );
}

function FichaTraspaso({ id, onCerrar }: { id: string; onCerrar: () => void }) {
  const { t } = usePrefs();
  const { e, d, hoy } = useQbd();
  const n = useN();
  const x = e.traspasos.find((y) => y.id === id);
  if (!x) return null;
  return (
    <Ventana titulo={`${t("Transfer", "Traspaso")} ${x.numero}`} onCerrar={onCerrar} pie={x.estado === "in_transit"
      ? <button type="button" className="btn btn-green" data-accion="recibir-traspaso" onClick={() => d({ tipo: "recibirTraspaso", id: x.id, fecha: hoy })}>{t(`Received at ${n.sitio(x.destinoId)}`, `Recibido en ${n.sitio(x.destinoId)}`)}</button>
      : undefined}>
      <div className="qbo-form">
        <div className="qbo-explica">{n.sitio(x.origenId)} → {n.sitio(x.destinoId)} · {x.fecha} <Insignia estado={x.estado} />{x.recibidoEl && ` · ${t("received", "recibido")} ${x.recibidoEl}`}</div>
        <div className="qbo-lista">
          {x.lineas.map((l, i) => (
            <div key={i} className="qbo-renglon">
              <span>{n.articulo(l.articuloId)}{l.lote && <> · <span className="qbd-chip">{t("lot", "lote")} {l.lote}</span></>}{l.caduca && <span className="qbo-gris"> · {t("expires", "caduca")} {l.caduca}</span>}</span>
              <span className="qbo-num">{n.cant(l.articuloId, l.cantidad)}</span>
            </div>
          ))}
        </div>
        {x.estado === "received" && <p className="qbo-explica">{t("It arrived on the destination's dock. Put it away in the Bins tab.", "Llegó al andén del destino. Acomódalo en la pestaña Ubicaciones.")}</p>}
      </div>
    </Ventana>
  );
}
