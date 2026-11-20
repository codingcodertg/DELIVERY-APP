"use client";

import { usePrefs } from "@/lib/prefs";
import {
  CTA, estadoDeResultados, facturasConSaldo, facturasProvConSaldo, inicioDeMes, saldoDeCuenta, saldoSegunBanco, sumaDias,
} from "@/lib/app-draft/qbo/contabilidad";
import { dinero, useQbo } from "./comun";
import type { Pestana } from "./QboApp";

/** Resumen: lo que hay por cobrar, lo vencido, lo que hay que pagar, banco contra libros y el mes en una mirada. */
export function Resumen({ ir }: { ir: (p: Pestana) => void }) {
  const { t, lang } = usePrefs();
  const { e, hoy, libro } = useQbo();
  const fs = facturasConSaldo(e, hoy).filter((x) => !x.factura.borrador && x.saldo > 0.005);
  const abiertas = fs.reduce((a, x) => a + x.saldo, 0);
  const vencidas = fs.filter((x) => x.estado === "overdue");
  const bs = facturasProvConSaldo(e, hoy).filter((x) => x.saldo > 0.005);
  const en7 = sumaDias(hoy, 7);
  const porPagar7 = bs.filter((x) => x.factura.vence <= en7).reduce((a, x) => a + x.saldo, 0);
  const porPagar = bs.reduce((a, x) => a + x.saldo, 0);
  const banco = e.bancos[0];
  const segunBanco = banco ? saldoSegunBanco(e, banco.id) : 0;
  const enLibros = saldoDeCuenta(e.cuentas.find((c) => c.id === CTA.banco)!, libro);
  const porRevisar = e.movimientos.filter((m) => m.estado === "new").length;
  const mes = estadoDeResultados(e, libro, inicioDeMes(hoy), hoy);
  const nombre = (x: { nombre_en: string; nombre_es: string }) => (lang === "es" ? x.nombre_es : x.nombre_en);

  return (
    <section className="qbo-seccion">
      <div className="qbo-kpis">
        <button type="button" className="qbo-kpi" style={{ textAlign: "left" }} onClick={() => ir("ar")}>
          <span>{t("Open invoices (customers owe us)", "Facturas abiertas (nos deben)")}</span>
          <b data-kpi="abiertas">{dinero(abiertas)}</b>
          <small>{fs.length} {t("invoices", "facturas")}</small>
        </button>
        <button type="button" className={`qbo-kpi${vencidas.length ? " qbo-kpi-alerta" : ""}`} style={{ textAlign: "left" }} onClick={() => ir("ar")}>
          <span>{t("Overdue (past the due date)", "Vencidas (pasó la fecha de pago)")}</span>
          <b data-kpi="vencidas">{dinero(vencidas.reduce((a, x) => a + x.saldo, 0))}</b>
          <small>{vencidas.length} {t("invoices", "facturas")}</small>
        </button>
        <button type="button" className="qbo-kpi" style={{ textAlign: "left" }} onClick={() => ir("ap")}>
          <span>{t("Bills to pay (we owe vendors)", "Facturas por pagar (debemos)")}</span>
          <b data-kpi="por-pagar">{dinero(porPagar)}</b>
          <small>{dinero(porPagar7)} {t("due in the next 7 days", "vencen en 7 días")}</small>
        </button>
        <button type="button" className={`qbo-kpi${porRevisar ? " qbo-kpi-alerta" : ""}`} style={{ textAlign: "left" }} onClick={() => ir("banking")}>
          <span>{t("Bank vs. our books", "Banco contra nuestros libros")}</span>
          <b data-kpi="banco">{dinero(segunBanco)}</b>
          <small>{t("In our books", "En libros")}: {dinero(enLibros)} · {porRevisar} {t("to review", "por revisar")}</small>
        </button>
      </div>
      <div className="qbo-dos">
        <div className="qbo-caja">
          <h2>{t("This month: profit and loss", "Este mes: ganancias y pérdidas")}</h2>
          <p className="qbo-explica">{t("Sales minus what the tile cost us minus expenses, from the 1st to today.", "Ventas menos lo que nos costó la loseta menos los gastos, del día 1 a hoy.")}</p>
          <div className="qbo-renglon"><span>{t("Sales", "Ventas")}</span><span className="qbo-num">{dinero(mes.totalIngresos)}</span></div>
          <div className="qbo-renglon"><span>{t("Cost of tile sold", "Costo de lo vendido")}</span><span className="qbo-num">−{dinero(mes.totalCosto)}</span></div>
          <div className="qbo-renglon"><span>{t("Gross profit", "Utilidad bruta")}</span><span className="qbo-num">{dinero(mes.bruta)}</span></div>
          {mes.gastos.map((g) => <div key={g.cuentaId} className="qbo-renglon qbo-renglon-sangria"><span>{nombre(g)}</span><span className="qbo-num">−{dinero(g.monto)}</span></div>)}
          <div className="qbo-renglon qbo-renglon-total"><span>{t("Net profit", "Utilidad neta")}</span><span className={`qbo-num ${mes.neta < 0 ? "qbo-rojo" : "qbo-verde"}`} data-kpi="neta-mes">{dinero(mes.neta)}</span></div>
        </div>
        <div className="qbo-caja">
          <h2>{t("Oldest overdue invoices", "Facturas vencidas más viejas")}</h2>
          {vencidas.length === 0 ? <p className="qbo-gris">{t("Nothing overdue. 🎉", "Nada vencido. 🎉")}</p> :
            [...vencidas].sort((a, b) => a.factura.vence.localeCompare(b.factura.vence)).slice(0, 6).map((x) => (
              <div key={x.factura.id} className="qbo-renglon">
                <span>#{x.factura.numero} · {e.clientes.find((c) => c.id === x.factura.clienteId)?.nombre}<br /><small className="qbo-gris">{t("due", "vence")} {x.factura.vence}</small></span>
                <span className="qbo-num qbo-rojo">{dinero(x.saldo)}</span>
              </div>
            ))}
        </div>
      </div>
    </section>
  );
}
