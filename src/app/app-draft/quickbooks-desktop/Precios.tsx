"use client";

import { useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { TablaEstandar, type ColumnaEstandar } from "@/components/TablaEstandar";
import { factorDe, nombreDeTipo, precioBaseDe, precioDeLinea, aBase } from "@/lib/app-draft/qbd/inventario";
import type { Categoria, ReglaDePrecio } from "@/lib/app-draft/qbd/tipos";
import type { TipoDeCliente } from "@/lib/app-draft/qbo/tipos";
import { Ventana, dinero, nuevoId } from "../quickbooks-online/comun";
import { Campo } from "../quickbooks-online/piezas";
import { useN, useQbd } from "./comun";

const CATEGORIAS: Record<Categoria, [string, string]> = { tile: ["Tile", "Loseta"], setting: ["Setting materials", "Materiales de instalación"], trim: ["Trim", "Molduras"], kit: ["Kits", "Kits"] };
const TIPOS: TipoDeCliente[] = ["contractor", "designer", "homeowner"];

/** Niveles de precio por tipo de cliente y reglas (categoría, fechas, cantidad); cada renglón dice qué regla ganó. */
export function Precios() {
  const { t } = usePrefs();
  const { e, d } = useQbd();
  const [abierta, setAbierta] = useState<ReglaDePrecio | "nueva" | null>(null);
  const cat = (c: Categoria | null) => (c ? t(CATEGORIAS[c][0], CATEGORIAS[c][1]) : t("Any", "Cualquiera"));
  const columnas: ColumnaEstandar<ReglaDePrecio>[] = [
    { key: "nombre", en: "Rule", es: "Regla", ancho: 240, fija: true, valor: (r) => r.nombre },
    { key: "porcentaje", en: "Change", es: "Cambio", ancho: 90, numerico: true, valor: (r) => r.porcentaje, celda: (r) => `${r.porcentaje > 0 ? "+" : ""}${r.porcentaje}%` },
    { key: "categoria", en: "Products", es: "Productos", ancho: 150, valor: (r) => cat(r.categoria) },
    { key: "tipo", en: "Customers", es: "Clientes", ancho: 130, valor: (r) => (r.tipoCliente ? nombreDeTipo(r.tipoCliente, t) : t("Any", "Cualquiera")) },
    { key: "fechas", en: "Dates", es: "Fechas", ancho: 190, valor: (r) => (r.desde || r.hasta ? `${r.desde ?? "…"} → ${r.hasta ?? "…"}` : t("Always", "Siempre")) },
    { key: "minimo", en: "Min. qty", es: "Mín.", ancho: 80, numerico: true, valor: (r) => r.minimo },
    { key: "activa", en: "On", es: "Activa", ancho: 70, valor: (r) => (r.activa ? t("Yes", "Sí") : t("No", "No")) },
  ];
  return (
    <section className="qbo-seccion">
      <p className="qbo-explica">{t("Each customer type has a price level (for example, contractors 10% off list). Rules add sales by product group, dates or quantity. On every order line the lowest price wins, and the line shows which one won.",
        "Cada tipo de cliente tiene un nivel de precio (por ejemplo, contratistas 10% menos que lista). Las reglas agregan ofertas por grupo de productos, fechas o cantidad. En cada renglón gana el precio más bajo, y el renglón dice cuál ganó.")}</p>
      <div className="qbo-caja">
        <h2>{t("Price levels by customer type", "Niveles por tipo de cliente")}</h2>
        <div className="qbo-campos">
          {TIPOS.map((tp) => (
            <Campo key={tp} etiqueta={`${nombreDeTipo(tp, t)} (% ${t("vs. list", "sobre lista")})`}>
              <input type="number" step="1" data-nivel={tp} value={e.niveles.find((x) => x.tipo === tp)?.porcentaje ?? 0} onChange={(ev) => d({ tipo: "nivel", tipoCliente: tp, porcentaje: Number(ev.target.value) || 0 })} />
            </Campo>
          ))}
        </div>
      </div>
      <div className="qbo-barra">
        <h2 style={{ fontSize: 16, margin: 0 }}>{t("Price rules", "Reglas de precio")}</h2>
        <button type="button" className="btn btn-primary btn-sm" data-accion="nueva-regla" onClick={() => setAbierta("nueva")}>+ {t("New rule", "Nueva regla")}</button>
      </div>
      <TablaEstandar id="app-draft-qbd-reglas" filas={e.reglas} claveDe={(r) => r.id} columnas={columnas} onFila={(r) => setAbierta(r)} vacio={t("No price rules. Levels still apply.", "No hay reglas. Los niveles siguen aplicando.")} />
      <Probador />
      {abierta && <FormRegla regla={abierta === "nueva" ? null : abierta} onCerrar={() => setAbierta(null)} />}
    </section>
  );
}

function FormRegla({ regla, onCerrar }: { regla: ReglaDePrecio | null; onCerrar: () => void }) {
  const { t } = usePrefs();
  const { d } = useQbd();
  const [r, setR] = useState<ReglaDePrecio>(regla ?? { id: nuevoId("rule"), nombre: "", categoria: null, tipoCliente: null, desde: null, hasta: null, minimo: 0, porcentaje: -5, activa: true });
  const [error, setError] = useState("");
  const pon = (c: Partial<ReglaDePrecio>) => setR({ ...r, ...c });
  const guardar = () => {
    if (!r.nombre.trim()) return setError(t("Give the rule a name.", "Ponle nombre a la regla."));
    if (r.desde && r.hasta && r.hasta < r.desde) return setError(t("The end date is before the start date.", "La fecha final es antes de la inicial."));
    d({ tipo: "guardarRegla", regla: { ...r, nombre: r.nombre.trim() } });
    onCerrar();
  };
  return (
    <Ventana titulo={regla ? t("Edit price rule", "Editar regla") : t("New price rule", "Nueva regla de precio")} onCerrar={onCerrar} ancho={640} pie={<>
      {regla && <button type="button" className="btn btn-ghost" onClick={() => { d({ tipo: "borrarRegla", id: r.id }); onCerrar(); }}>{t("Delete", "Borrar")}</button>}
      <button type="button" className="btn btn-primary" data-accion="guardar-regla" onClick={guardar}>{t("Save rule", "Guardar regla")}</button>
    </>}>
      <div className="qbo-form">
        <Campo etiqueta={t("Name", "Nombre")}><input value={r.nombre} data-campo="regla-nombre" onChange={(ev) => pon({ nombre: ev.target.value })} /></Campo>
        <div className="qbo-campos">
          <Campo etiqueta={t("% vs. list (negative = discount)", "% sobre lista (negativo = descuento)")}><input type="number" data-campo="regla-pct" value={r.porcentaje} onChange={(ev) => pon({ porcentaje: Number(ev.target.value) || 0 })} /></Campo>
          <Campo etiqueta={t("Products", "Productos")}>
            <select value={r.categoria ?? ""} data-campo="regla-categoria" onChange={(ev) => pon({ categoria: (ev.target.value || null) as Categoria | null })}>
              <option value="">{t("Any", "Cualquiera")}</option>
              {(["tile", "setting", "trim"] as const).map((c) => <option key={c} value={c}>{t(CATEGORIAS[c][0], CATEGORIAS[c][1])}</option>)}
            </select>
          </Campo>
          <Campo etiqueta={t("Customers", "Clientes")}>
            <select value={r.tipoCliente ?? ""} onChange={(ev) => pon({ tipoCliente: (ev.target.value || null) as TipoDeCliente | null })}>
              <option value="">{t("Any", "Cualquiera")}</option>
              {TIPOS.map((tp) => <option key={tp} value={tp}>{nombreDeTipo(tp, t)}</option>)}
            </select>
          </Campo>
          <Campo etiqueta={t("Minimum qty (base units)", "Cantidad mínima (unidad base)")}><input type="number" min={0} data-campo="regla-minimo" value={r.minimo || ""} onChange={(ev) => pon({ minimo: Math.max(0, Number(ev.target.value) || 0) })} /></Campo>
          <Campo etiqueta={t("From", "Desde")}><input type="date" value={r.desde ?? ""} onChange={(ev) => pon({ desde: ev.target.value || null })} /></Campo>
          <Campo etiqueta={t("Until", "Hasta")}><input type="date" value={r.hasta ?? ""} onChange={(ev) => pon({ hasta: ev.target.value || null })} /></Campo>
        </div>
        <label className="qbo-explica"><input type="checkbox" checked={r.activa} style={{ width: "auto" }} onChange={(ev) => pon({ activa: ev.target.checked })} /> {t("Rule is on", "Regla activa")}</label>
        {error && <p className="qbo-error" role="alert">{error}</p>}
      </div>
    </Ventana>
  );
}

/** Probador: cliente + producto + cantidad → todos los precios que compiten y cuál gana. */
function Probador() {
  const { t } = usePrefs();
  const { e, hoy } = useQbd();
  const n = useN();
  const [clienteId, setCliente] = useState(e.clientes[0]?.id ?? "");
  const [articuloId, setArticulo] = useState("i02");
  const [cantidad, setCantidad] = useState(100);
  const [fecha, setFecha] = useState(hoy);
  const a = e.articulos.find((x) => x.id === articuloId);
  const f = n.ficha(articuloId);
  const c = e.clientes.find((x) => x.id === clienteId);
  const j = n.juego(articuloId);
  const u = j?.venta ?? "";
  const res = a && f && c ? precioDeLinea({ lista: precioBaseDe(a.precio, a.unidad, j), categoria: f.categoria, tipoCliente: c.tipo, cantidad: aBase(cantidad, u, j), fecha, niveles: e.niveles, reglas: e.reglas }) : null;
  return (
    <div className="qbo-caja" data-caja="probador-precio">
      <h2>{t("Try a price", "Prueba un precio")}</h2>
      <div className="qbo-campos">
        <Campo etiqueta={t("Customer", "Cliente")}>
          <select value={clienteId} data-campo="probar-cliente" onChange={(ev) => setCliente(ev.target.value)}>{e.clientes.map((x) => <option key={x.id} value={x.id}>{n.cliente(x.id)} · {nombreDeTipo(x.tipo, t)}</option>)}</select>
        </Campo>
        <Campo etiqueta={t("Product", "Producto")}>
          <select value={articuloId} data-campo="probar-producto" onChange={(ev) => setArticulo(ev.target.value)}>{n.inventariables.map((id) => <option key={id} value={id}>{n.articulo(id)}</option>)}</select>
        </Campo>
        <Campo etiqueta={`${t("Quantity", "Cantidad")} (${n.unidad(u)})`}>
          <input type="number" min={0} data-campo="probar-cantidad" value={cantidad || ""} onChange={(ev) => setCantidad(Number(ev.target.value) || 0)} />
        </Campo>
        <Campo etiqueta={t("Order date", "Fecha de la orden")}><input type="date" value={fecha} onChange={(ev) => setFecha(ev.target.value || hoy)} /></Campo>
      </div>
      {res && (
        <div className="qbo-lista" data-lista="candidatos">
          {res.candidatos.map((k) => {
            const gana = k.clave === res.ganador.clave;
            return (
              <div key={k.clave} className={`qbo-renglon${gana ? " qbo-renglon-total" : ""}`} data-candidato={k.clave} data-gana={gana || undefined}>
                <span className={gana ? undefined : "qbd-tachado"}>{gana ? "✓ " : ""}{t(k.etiqueta_en, k.etiqueta_es)} {k.porcentaje ? `(${k.porcentaje}%)` : ""}</span>
                <span className="qbo-num">{dinero(k.precio * factorDe(j, u))}/{n.unidad(u, 1)}</span>
              </div>
            );
          })}
          <p className="qbo-explica">{t("Rules that don't apply (wrong dates, customer type, product group or too few) aren't listed.", "Las reglas que no aplican (otras fechas, tipo de cliente, grupo de productos o poca cantidad) no aparecen.")}</p>
        </div>
      )}
    </div>
  );
}
