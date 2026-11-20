"use client";

import { useMemo, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { TablaEstandar, type ColumnaEstandar } from "@/components/TablaEstandar";
import { armarKit, costoDeKit, costoPromedio, disponible, enMano, maximoArmable, r2 } from "@/lib/app-draft/qbd/inventario";
import type { Kit } from "@/lib/app-draft/qbd/tipos";
import { dinero, nuevoId } from "../quickbooks-online/comun";
import { useError, useN, useQbd } from "./comun";

/** Kits armados: un kit de regadera (loseta + thinset + boquilla + moldura) se arma con sus componentes. */
export function Kits() {
  const { t } = usePrefs();
  const { e } = useQbd();
  const n = useN();
  const [sitioId, setSitio] = useState("s-mca");
  const armados = useMemo(() => e.armados.map((a) => ({ ...a, kit: n.articulo(a.kitId), sitio: n.sitio(a.sitioId), total: r2(a.cantidad * a.costoUnitario) })), [e.armados, n]);
  const columnas = useMemo<ColumnaEstandar<(typeof armados)[number]>[]>(() => [
    { key: "fecha", en: "Date", es: "Fecha", ancho: 100, fija: true, valor: (a) => a.fecha },
    { key: "kit", en: "Kit", es: "Kit", ancho: 240, valor: (a) => a.kit },
    { key: "sitio", en: "Site", es: "Sitio", ancho: 160, valor: (a) => a.sitio },
    { key: "cantidad", en: "Built", es: "Armados", ancho: 80, numerico: true, valor: (a) => a.cantidad },
    { key: "costoUnitario", en: "Cost each", es: "Costo c/u", ancho: 100, numerico: true, valor: (a) => a.costoUnitario, celda: (a) => dinero(a.costoUnitario) },
    { key: "total", en: "Total cost", es: "Costo total", ancho: 110, numerico: true, valor: (a) => a.total, celda: (a) => dinero(a.total) },
  ], []);
  return (
    <section className="qbo-seccion">
      <p className="qbo-explica">{t("A kit is sold as one product but built from others. Building kits takes the components out of stock and adds finished kits; the kit's cost is the sum of what went into it.",
        "Un kit se vende como un solo producto pero se arma con otros. Armar kits saca los componentes de la existencia y suma kits terminados; el costo del kit es la suma de lo que lleva.")}</p>
      <div className="qbo-barra">
        <select value={sitioId} aria-label={t("Site", "Sitio")} onChange={(ev) => setSitio(ev.target.value)} style={{ maxWidth: 260 }}>{e.sitios.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}</select>
      </div>
      <div className="qbo-dos">
        {e.kits.map((k) => <TarjetaKit key={k.id} kit={k} sitioId={sitioId} />)}
      </div>
      <h2 style={{ fontSize: 16, margin: 0 }}>{t("Builds", "Armados")}</h2>
      <TablaEstandar id="app-draft-qbd-armados" filas={armados} claveDe={(a) => a.id} columnas={columnas} ordenInicial={{ clave: "fecha", direccion: "desc" }}
        vacio={t("No kits built yet.", "Todavía no se han armado kits.")} />
    </section>
  );
}

function TarjetaKit({ kit, sitioId }: { kit: Kit; sitioId: string }) {
  const { t } = usePrefs();
  const { e, d, hoy } = useQbd();
  const n = useN();
  const msg = useError();
  const [cantidad, setCantidad] = useState(1);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const costoDe = (id: string) => costoPromedio(e.existencias.filter((x) => x.sitioId === sitioId), id, costoPromedio(e.existencias, id, 0));
  const costo = costoDeKit(kit, costoDe);
  const max = maximoArmable(e, kit, sitioId, hoy);
  const margen = kit.precio > 0 ? Math.round(((kit.precio - costo) / kit.precio) * 100) : 0;
  const armar = () => {
    const p = { id: nuevoId("bld"), kitId: kit.id, sitioId, cantidad, fecha: hoy };
    const r = armarKit(e, p, hoy);
    if (!r.ok) return setAviso({ ok: false, texto: msg(r.error) });
    d({ tipo: "armar", hoy, p });
    setAviso({ ok: true, texto: t(`Built ${cantidad}. Components taken out of stock.`, `Se armaron ${cantidad}. Componentes descontados.`) });
  };
  return (
    <div className="qbo-caja" data-kit={kit.sku}>
      <h2>{kit.nombre} <span className="qbo-gris">· {kit.sku}</span></h2>
      <div className="qbo-lista">
        {kit.componentes.map((c) => {
          const hay = disponible(e, c.articuloId, sitioId, hoy);
          return (
            <div key={c.articuloId} className="qbo-renglon">
              <span>{c.cantidad} × {n.articulo(c.articuloId)} <span className={hay < c.cantidad ? "qbd-poco" : "qbo-gris"}>({t("free", "libre")} {hay})</span></span>
              <span className="qbo-num">{dinero(c.cantidad * costoDe(c.articuloId))}</span>
            </div>
          );
        })}
        <div className="qbo-renglon qbo-renglon-total"><span>{t("Kit cost (rolled up)", "Costo del kit (suma)")}</span><span className="qbo-num" data-costo-kit>{dinero(costo)}</span></div>
        <div className="qbo-renglon"><span>{t("Sells for", "Se vende en")} · {t("margin", "margen")} {margen}%</span><span className="qbo-num">{dinero(kit.precio)}</span></div>
        <div className="qbo-renglon"><span>{t("Kits on hand here", "Kits en existencia aquí")}</span><span className="qbo-num" data-kits-mano>{enMano(e.existencias, kit.id, sitioId)}</span></div>
      </div>
      <div className="qbo-barra" style={{ marginTop: 10 }}>
        <input type="number" min={1} max={Math.max(1, max)} value={cantidad || ""} aria-label={t("How many to build", "Cuántos armar")} data-campo="armar-cantidad" style={{ maxWidth: 90 }} onChange={(ev) => setCantidad(Math.max(0, Math.floor(Number(ev.target.value) || 0)))} />
        <button type="button" className="btn btn-primary btn-sm" data-accion="armar" disabled={max < 1 || cantidad < 1} onClick={armar}>{t("Build kits", "Armar kits")}</button>
        <span className="qbo-explica">{t(`Up to ${max} with stock here`, `Hasta ${max} con la existencia de aquí`)}</span>
      </div>
      {aviso && <p className={aviso.ok ? "qbo-ok" : "qbo-error"} role="status">{aviso.texto}</p>}
    </div>
  );
}
