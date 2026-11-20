"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { precioPara, r2 } from "@/lib/app-draft/compfloor/logica";
import type { Articulo, Tienda } from "@/lib/app-draft/compfloor/tipos";
import { dinero } from "../quickbooks-online/comun";
import { SelectorTienda, useCf, useTextos } from "./comun";

/**
 * Etiquetas de estante con QR (librería `qrcode` del repo, en el navegador). El QR lleva al producto; en real abriría
 * una página con el precio y el stock vivos, así que cambiar un precio no obliga a reimprimir.
 */
export function Etiquetas() {
  const { t } = usePrefs();
  const { e } = useCf();
  const [tienda, setTienda] = useState<Tienda>("mca");
  const arts = e.articulos.filter((a) => e.existencias.some((x) => x.articuloId === a.id && x.tienda === tienda && x.cajas > 0));
  return (
    <section className="qbo-seccion">
      <div className="qbo-barra qbo-no-imprimir">
        <SelectorTienda valor={tienda} onCambia={(s) => setTienda((s || "mca") as Tienda)} />
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => window.print()}>🖨 {t("Print labels", "Imprimir etiquetas")}</button>
      </div>
      <p className="qbo-nota qbo-no-imprimir">{t("The QR points to the product, not to a printed price: in the real version, scanning it shows today's price and stock by lot, so a price change doesn't need new labels.", "El QR apunta al producto, no a un precio impreso: en la versión real, al escanearlo se ve el precio y stock de hoy por lote, así que un cambio de precio no requiere etiquetas nuevas.")}</p>
      {arts.length === 0 ? <p className="qbo-gris">{t("No products in stock at this store.", "No hay productos en stock en esta tienda.")}</p> : (
        <div className="cf-etiquetas">{arts.map((a) => <Etiqueta key={a.id} a={a} />)}</div>
      )}
    </section>
  );
}

function Etiqueta({ a }: { a: Articulo }) {
  const { t } = usePrefs();
  const { e } = useCf();
  const x = useTextos();
  const [qr, setQr] = useState("");
  useEffect(() => {
    let vivo = true;
    QRCode.toDataURL(`RTG-ITEM:${a.sku}`, { width: 240, margin: 1, errorCorrectionLevel: "M" })
      .then((u) => { if (vivo) setQr(u); })
      .catch(() => { if (vivo) setQr(""); });
    return () => { vivo = false; };
  }, [a.sku]);
  const precio = precioPara(a, "retail", e.niveles).precio;
  return (
    <div className="cf-etiqueta" data-etiqueta={a.sku}>
      <div className="cf-etiqueta-texto">
        <b>{a.nombre}</b>
        <span className="qbo-gris">{a.sku}</span>
        {a.sqftPorCaja > 0
          ? <span className="cf-etiqueta-precio">{dinero(r2(precio / a.sqftPorCaja))}<small>/{x.unidad("sqft")}</small></span>
          : <span className="cf-etiqueta-precio">{dinero(precio)}<small>/{x.unidad("box", 1)}</small></span>}
        <span className="qbo-explica">{a.sqftPorCaja > 0 ? `${dinero(precio)}/${x.unidad("box", 1)} · ${a.sqftPorCaja} ${x.unidad("sqft")}/${x.unidad("box", 1)}` : ""}</span>
      </div>
      {qr ? <img src={qr} alt={t(`QR code for ${a.sku}`, `Código QR de ${a.sku}`)} width={96} height={96} /> : <span className="cf-qr-vacio" aria-hidden>QR</span>}
    </div>
  );
}
