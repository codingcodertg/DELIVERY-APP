"use client";

// «Hoy» del Panel (D-1127): cómo va el día de un vistazo —entregadas de cuántas, y en qué etapa está el resto— y lo
// que alguien tiene que mover (vencidas, sin chofer, por aprobar). No depende del rango de fechas elegido.
import { useMemo, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { stageInfo, stageLabel } from "@/lib/constants";
import { orderLabel, todayISO } from "@/lib/utils";
import { hoyDelPanel } from "@/lib/panel-resumen";
import { palletsDeLaOrden } from "@/lib/pallets";
import { TablaEstandar } from "@/components/TablaEstandar";
import type { Delivery } from "@/lib/types";

type Lista = "vencidas" | "sinChofer" | "porAprobar";

export function HoyDelPanel({ ordenes, onAbrir }: { ordenes: readonly Delivery[]; onAbrir: (d: Delivery) => void }) {
  const { lang, t } = usePrefs();
  const hoy = todayISO();
  const h = useMemo(() => hoyDelPanel(ordenes, hoy), [ordenes, hoy]);
  const [lista, setLista] = useState<Lista | null>(null);

  const fecha = new Date(hoy + "T12:00:00").toLocaleDateString(lang === "es" ? "es-MX" : "en-US", { weekday: "long", day: "numeric", month: "long" });
  const partes = h.porEtapa.filter((p) => p.n > 0);
  const resumenDeEtapas = h.porEtapa.map((p) => `${stageLabel(p.etapa, lang)}: ${p.n}`).join(", ");

  const listas: { key: Lista; n: number; rotulo: string; clase: string; titulo: string }[] = [
    { key: "vencidas", n: h.vencidas.length, rotulo: t("Past their date", "Vencidas"), clase: "chip-late", titulo: t("Orders whose delivery date already passed and are still not delivered.", "Órdenes cuya fecha de entrega ya pasó y siguen sin entregarse.") },
    { key: "sinChofer", n: h.sinChofer.length, rotulo: t("No driver", "Sin chofer"), clase: "chip-pend", titulo: t("Orders for today or later with no driver assigned.", "Órdenes de hoy en adelante que no tienen chofer asignado.") },
    { key: "porAprobar", n: h.porAprobar.length, rotulo: t("Waiting for approval", "Por aprobar"), clase: "chip-pend", titulo: t("Orders waiting for someone to approve them.", "Órdenes que esperan que alguien las apruebe.") },
  ];
  const filas = lista ? h[lista] : [];
  const fechaCorta = (iso: string) => new Date(iso.slice(0, 10) + "T12:00:00").toLocaleDateString(lang === "es" ? "es-MX" : "en-US", { day: "numeric", month: "short" });
  /** Días naturales desde su fecha de entrega (solo las que ya pasaron). */
  const atraso = (d: Delivery) => (d.delivery_date && d.delivery_date.slice(0, 10) < hoy ? Math.round((Date.parse(hoy + "T12:00:00Z") - Date.parse(d.delivery_date.slice(0, 10) + "T12:00:00Z")) / 86_400_000) : null);

  return (
    <div className="card" data-panel-hoy>
      <div className="panel-hoy">
        <div className="panel-hoy-cifra">
          <span className="rotulo">{t("Today", "Hoy")} · {fecha}</span>
          <span className="cifra">{h.entregadas} <small>{t("of", "de")} {h.total}</small></span>
          <span className="pie">{t("delivered", "entregadas")} · {h.palletsDeHoy} pallets {t("for today", "para hoy")}</span>
        </div>
        <div className="panel-hoy-etapas">
          {h.total === 0 ? (
            <div className="hint" style={{ margin: 0 }}>{t("Nothing scheduled for delivery today.", "No hay nada programado para entregar hoy.")}</div>
          ) : (
            <>
              <div className="panel-barra-etapas" role="img" aria-label={t(`Today's orders by stage. ${resumenDeEtapas}`, `Órdenes de hoy por etapa. ${resumenDeEtapas}`)}>
                {partes.map((p) => (
                  <span key={p.etapa} title={`${stageLabel(p.etapa, lang)}: ${p.n}`} style={{ flex: `${p.n} 1 0`, background: stageInfo(p.etapa).color, color: "var(--on-color, #fff)" }}>
                    {p.n / h.total >= 0.07 ? p.n : ""}
                  </span>
                ))}
              </div>
              <div className="panel-leyenda">
                {h.porEtapa.map((p) => (
                  <span key={p.etapa}><i className="muestra" style={{ background: stageInfo(p.etapa).color }} />{stageLabel(p.etapa, lang)} <b>{p.n}</b></span>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="panel-accion">
        <span className="rotulo">{t("Stuck orders", "Órdenes atoradas")}:</span>
        {listas.map((l) => (
          <button key={l.key} className={"chip " + (l.n ? l.clase : "en-cero")} title={l.titulo} disabled={!l.n} aria-pressed={lista === l.key}
            onClick={() => setLista(lista === l.key ? null : l.key)}>
            {l.n ? "" : "✓ "}{l.rotulo} <span className="cnt">{l.n}</span>
          </button>
        ))}
      </div>

      {lista && filas.length > 0 && (
        <div style={{ marginTop: 12, maxHeight: 380, overflowY: "auto" }}>
          <TablaEstandar id={"dash-hoy-" + lista} sinCaja data-tabla={"dash-hoy-" + lista} filas={filas} claveDe={(d) => d.id} onFila={onAbrir}
            columnas={[
              { key: "orden", en: "Order", es: "Orden", ancho: 120, fija: true, valor: (d) => orderLabel(d), celda: (d) => <b>#{orderLabel(d)}</b> },
              { key: "cuenta", en: "Account", es: "Cuenta", ancho: 200, valor: (d) => d.account || d.delivery_name || null },
              { key: "tienda", en: "Store", es: "Tienda", ancho: 140, valor: (d) => d.store || null },
              { key: "fecha", en: "Delivery date", es: "Fecha de entrega", ancho: 130, valor: (d) => d.delivery_date || null, celda: (d) => (d.delivery_date ? fechaCorta(d.delivery_date) : "—"), etiqueta: (v) => (v ? fechaCorta(String(v)) : "—") },
              { key: "atraso", en: "Days late", es: "Días de atraso", ancho: 120, numerico: true, valor: (d) => atraso(d), celda: (d) => { const n = atraso(d); return n ? <span className="panel-bajo">{n}</span> : "—"; } },
              { key: "etapa", en: "Stage", es: "Etapa", ancho: 150, clase: "td-pastillas", valor: (d) => stageLabel(d.stage, lang),
                celda: (d) => <span className="sema" style={{ background: stageInfo(d.stage).color, color: "var(--on-color, #fff)" }}>{stageLabel(d.stage, lang)}</span> },
              { key: "chofer", en: "Driver", es: "Chofer", ancho: 150, valor: (d) => d.assigned_driver || null },
              { key: "pallets", en: "Pallets", es: "Pallets", ancho: 90, numerico: true, valor: (d) => palletsDeLaOrden(d) },
            ]} />
        </div>
      )}
    </div>
  );
}
