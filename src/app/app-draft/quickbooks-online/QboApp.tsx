"use client";

import Link from "next/link";
import { useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { ProveedorQbo, useQbo } from "./comun";
import { Resumen } from "./Resumen";
import { Clientes } from "./Clientes";
import { Proveedores } from "./Proveedores";
import { Compras } from "./Compras";
import { Banco } from "./Banco";
import { Cuentas } from "./Cuentas";
import { Informes } from "./Informes";

type Pestana = "overview" | "ar" | "ap" | "purchasing" | "banking" | "accounting" | "reports";

/**
 * App Draft · QuickBooks Online: prototipo, con datos de ejemplo en el navegador, de la contabilidad que el hub no
 * tiene (por cobrar, por pagar, notas de crédito, compras, conciliación bancaria). Copia lo que las funciones HACEN y
 * cómo se recorren, no la marca ni el diseño de nadie: usa el del hub.
 */
export function QboApp() {
  return (
    <main className="adr">
      <ProveedorQbo>
        <Contenido />
      </ProveedorQbo>
    </main>
  );
}

function Contenido() {
  const { t } = usePrefs();
  const { d, hoy } = useQbo();
  const [pestana, setPestana] = useState<Pestana>("overview");
  const pestanas: { clave: Pestana; texto: string }[] = [
    { clave: "overview", texto: t("Overview", "Resumen") },
    { clave: "ar", texto: t("Customers & money owed to us", "Clientes y cobros") },
    { clave: "ap", texto: t("Vendors & bills", "Proveedores y pagos") },
    { clave: "purchasing", texto: t("Purchasing", "Compras") },
    { clave: "banking", texto: t("Bank & reconcile", "Banco y conciliación") },
    { clave: "accounting", texto: t("Accounts & journal", "Cuentas y asientos") },
    { clave: "reports", texto: t("Reports", "Informes") },
  ];
  return (
    <>
      <div className="qbo-cabeza">
        <h1>📒 QuickBooks Online <span className="qbo-gris" style={{ fontSize: 14, fontWeight: 600 }}>· {t("draft", "borrador")}</span></h1>
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
      <div className="qbo-pestanas" role="tablist" aria-label={t("Sections", "Secciones")}>
        {pestanas.map((p) => (
          <button key={p.clave} type="button" role="tab" aria-selected={pestana === p.clave} data-pestana={p.clave} className="qbo-pestana" onClick={() => setPestana(p.clave)}>{p.texto}</button>
        ))}
      </div>
      {pestana === "overview" && <Resumen ir={(p) => setPestana(p)} />}
      {pestana === "ar" && <Clientes />}
      {pestana === "ap" && <Proveedores />}
      {pestana === "purchasing" && <Compras />}
      {pestana === "banking" && <Banco />}
      {pestana === "accounting" && <Cuentas />}
      {pestana === "reports" && <Informes />}
    </>
  );
}

export type { Pestana };
