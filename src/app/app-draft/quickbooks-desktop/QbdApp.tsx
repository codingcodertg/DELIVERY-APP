"use client";

import Link from "next/link";
import { useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { ProveedorQbd, useQbd } from "./comun";
import { Sitios } from "./Sitios";
import { Ubicaciones } from "./Ubicaciones";
import { Lotes } from "./Lotes";
import { Unidades } from "./Unidades";
import { Ventas } from "./Ventas";
import { Kits } from "./Kits";
import { Precios } from "./Precios";
import { Importacion } from "./Importacion";
import { Alternos } from "./Alternos";
import "./qbd.css";

type Pestana = "sites" | "bins" | "lots" | "units" | "sales" | "kits" | "pricing" | "landed" | "vendors";

/**
 * App Draft · QuickBooks Desktop: SOLO lo que el escritorio hace y el prototipo de QuickBooks Online no (inventario
 * avanzado y surtido). Facturas, cobros, proveedores, banco e informes ya están en el otro prototipo y se enlazan allá.
 */
export function QbdApp() {
  return (
    <main className="adr">
      <ProveedorQbd>
        <Contenido />
      </ProveedorQbd>
    </main>
  );
}

function Contenido() {
  const { t } = usePrefs();
  const { d, hoy } = useQbd();
  const [pestana, setPestana] = useState<Pestana>("sites");
  const pestanas: { clave: Pestana; texto: string }[] = [
    { clave: "sites", texto: t("Stores & transfers", "Tiendas y traspasos") },
    { clave: "bins", texto: t("Bins", "Ubicaciones") },
    { clave: "lots", texto: t("Lots & expiration", "Lotes y caducidad") },
    { clave: "units", texto: t("Units of measure", "Unidades de medida") },
    { clave: "sales", texto: t("Sales orders & shipping", "Órdenes de venta y envíos") },
    { clave: "kits", texto: t("Kits", "Kits") },
    { clave: "pricing", texto: t("Price levels & rules", "Niveles y reglas de precio") },
    { clave: "landed", texto: t("Freight & duties", "Flete y aranceles") },
    { clave: "vendors", texto: t("Alternate vendors", "Proveedores alternos") },
  ];
  return (
    <>
      <div className="qbo-cabeza">
        <h1>🖥️ QuickBooks Desktop <span className="qbo-gris qbd-borrador">· {t("draft", "borrador")}</span></h1>
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
      <p className="qbo-nota">
        {t("This draft shows only what the desktop edition adds: inventory across stores, bins, lots, units, sales orders and shipping. Invoices, payments, bills, banking and reports are in the ",
          "Este prototipo enseña solo lo que agrega la versión de escritorio: inventario entre tiendas, ubicaciones, lotes, unidades, órdenes de venta y envíos. Facturas, cobros, proveedores, banco e informes están en el prototipo de ")}
        <Link href="/app-draft/quickbooks-online">QuickBooks Online</Link>{t(" draft.", ".")}
      </p>
      <div className="qbo-pestanas" role="tablist" aria-label={t("Sections", "Secciones")}>
        {pestanas.map((p) => (
          <button key={p.clave} type="button" role="tab" aria-selected={pestana === p.clave} data-pestana={p.clave} className="qbo-pestana" onClick={() => setPestana(p.clave)}>{p.texto}</button>
        ))}
      </div>
      {pestana === "sites" && <Sitios />}
      {pestana === "bins" && <Ubicaciones />}
      {pestana === "lots" && <Lotes />}
      {pestana === "units" && <Unidades />}
      {pestana === "sales" && <Ventas />}
      {pestana === "kits" && <Kits />}
      {pestana === "pricing" && <Precios />}
      {pestana === "landed" && <Importacion />}
      {pestana === "vendors" && <Alternos />}
    </>
  );
}
