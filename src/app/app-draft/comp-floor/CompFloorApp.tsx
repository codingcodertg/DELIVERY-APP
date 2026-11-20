"use client";

import Link from "next/link";
import { useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { ProveedorCf, useCf } from "./comun";
import { Existencias } from "./Existencias";
import { Unidades } from "./Unidades";
import { Pedidos } from "./Pedidos";
import { Mostrador } from "./Mostrador";
import { Especiales } from "./Especiales";
import { Precios } from "./Precios";
import { Almacen } from "./Almacen";
import { Remanentes } from "./Remanentes";
import { Etiquetas } from "./Etiquetas";

type Pestana = "stock" | "units" | "orders" | "counter" | "special" | "prices" | "bins" | "remnants" | "labels";

/**
 * App Draft · Comp Floor: prototipo, con datos de ejemplo en el navegador, de lo que un sistema para distribuidores de
 * piso hace y el hub no (lotes/tonos, unidades, pedidos con backorder, mostrador, especiales, niveles de precio, bins y
 * traslados, remanentes, etiquetas QR). Copia lo que las funciones HACEN, con muchos menos campos y clics.
 */
export function CompFloorApp() {
  return (
    <main className="adr">
      <ProveedorCf>
        <Contenido />
      </ProveedorCf>
    </main>
  );
}

function Contenido() {
  const { t } = usePrefs();
  const { e, d, hoy } = useCf();
  const [pestana, setPestana] = useState<Pestana>("stock");
  const sinLeer = e.alertas.filter((a) => !a.leida).length;
  const pestanas: { clave: Pestana; texto: string }[] = [
    { clave: "stock", texto: t("Stock by lot", "Stock por lote") },
    { clave: "units", texto: t("Boxes ↔ sq ft", "Cajas ↔ pies²") },
    { clave: "orders", texto: t("Quotes & orders", "Cotizaciones y pedidos") },
    { clave: "counter", texto: t("Counter sale", "Venta de mostrador") },
    { clave: "special", texto: t("Special orders", "Pedidos especiales") + (sinLeer ? ` (${sinLeer})` : "") },
    { clave: "prices", texto: t("Price levels", "Niveles de precio") },
    { clave: "bins", texto: t("Bins & transfers", "Bins y traslados") },
    { clave: "remnants", texto: t("Remnants", "Remanentes") },
    { clave: "labels", texto: t("Shelf labels", "Etiquetas") },
  ];
  return (
    <>
      <div className="qbo-cabeza">
        <h1>🧩 Comp Floor <span className="qbo-gris" style={{ fontSize: 14, fontWeight: 600 }}>· {t("draft", "borrador")}</span></h1>
        <div className="qbo-barra">
          <Link href="/app-draft" className="btn btn-sm btn-ghost">← {t("All drafts", "Todos los prototipos")}</Link>
          <button type="button" className="btn btn-sm btn-ghost" data-accion="reset" onClick={() => {
            if (window.confirm(t("Reset all sample data? Everything you created here is erased.", "¿Reiniciar los datos de ejemplo? Se borra todo lo que creaste aquí."))) d({ tipo: "reset", hoy });
          }}>↺ {t("Reset sample data", "Reiniciar datos de ejemplo")}</button>
        </div>
      </div>
      <p className="qbo-aviso">
        {t("Prototype with sample data — nothing here touches real data. Changes stay only in this browser.",
          "Prototipo con datos de ejemplo: nada aquí toca datos reales. Los cambios se quedan solo en este navegador.")}
      </p>
      <p className="qbo-nota" data-intro>
        {t("What a flooring-distributor system does that the hub doesn't yet: lots and shades, boxes ↔ sq ft, orders that wait for stock, counter sales on account, special orders, price levels, bins and transfers, remnants and QR labels. The point is the same power with far fewer menus and fields: a quote is a customer, a product and a quantity in any unit — the system works out boxes, the lot, the price for that customer and what has to wait.",
          "Lo que un sistema para distribuidores de piso hace y el hub todavía no: lotes y tonos, cajas ↔ pies², pedidos que esperan mercancía, ventas de mostrador a cuenta, pedidos especiales, niveles de precio, bins y traslados, remanentes y etiquetas QR. La idea es el mismo poder con muchos menos menús y campos: una cotización es un cliente, un producto y una cantidad en cualquier unidad; el sistema calcula las cajas, el lote, el precio de ese cliente y lo que tiene que esperar.")}
      </p>
      <div className="qbo-pestanas" role="tablist" aria-label={t("Sections", "Secciones")}>
        {pestanas.map((p) => (
          <button key={p.clave} type="button" role="tab" aria-selected={pestana === p.clave} data-pestana={p.clave} className="qbo-pestana" onClick={() => setPestana(p.clave)}>{p.texto}</button>
        ))}
      </div>
      {pestana === "stock" && <Existencias />}
      {pestana === "units" && <Unidades />}
      {pestana === "orders" && <Pedidos />}
      {pestana === "counter" && <Mostrador />}
      {pestana === "special" && <Especiales />}
      {pestana === "prices" && <Precios />}
      {pestana === "bins" && <Almacen />}
      {pestana === "remnants" && <Remanentes />}
      {pestana === "labels" && <Etiquetas />}
    </>
  );
}
