"use client";

// Los indicadores del periodo (D-1127): cada uno con su valor, su cambio contra el periodo anterior (la misma duración,
// justo antes) y su tendencia dentro del rango. Verde o rojo según si el cambio es bueno o malo PARA ESE indicador:
// que bajen las canceladas es bueno; que bajen las entregas, no.
import { usePrefs } from "@/lib/prefs";
import { Sparkline } from "@/components/Sparkline";
import { cambio, dineroCorto, enTrozos, type Cubeta, type ResumenDelPeriodo } from "@/lib/panel-resumen";
import type { ReactNode } from "react";

/** `sube`: subir es bueno · `baja`: bajar es bueno · `neutro`: ni lo uno ni lo otro (millas). */
type Sentido = "sube" | "baja" | "neutro";

export function IndicadoresDelPanel({ actual, anterior, cubetas, rangoAnterior }: {
  actual: ResumenDelPeriodo;
  anterior: ResumenDelPeriodo;
  cubetas: readonly Cubeta[];
  /** Cómo se dice el periodo anterior («1–31 oct»), para el título del cambio. */
  rangoAnterior: string;
}) {
  const { lang, t } = usePrefs();
  const num = (n: number, dec = 0) => n.toLocaleString(lang === "es" ? "es-MX" : "en-US", { minimumFractionDigits: 0, maximumFractionDigits: dec });
  const horas = (h: number | null) => (h == null ? "—" : h >= 48 ? `${num(h / 24, 1)} ${t("days", "días")}` : `${num(h, 1)} h`);
  const pct = (v: number | null) => (v == null ? "—" : `${v}%`);

  const tile = (o: {
    clave: string; rotulo: string; valor: string; pie?: ReactNode; ayuda: string;
    ahora: number | null; antes: number | null; puntos?: boolean; sentido: Sentido; antesTexto: string;
    serie?: (number | null)[]; sinCambio?: boolean;
  }) => {
    const c = cambio(o.ahora, o.antes, o.puntos);
    const clase = !c || o.sentido === "neutro" ? "neutro" : (c.sube === (o.sentido === "sube") ? "bien" : "mal");
    return (
      <div className="panel-tile" key={o.clave} data-indicador={o.clave} title={o.ayuda}>
        <span className="rotulo">{o.rotulo}</span>
        <div className="fila">
          <span className="valor">{o.valor}</span>
          {o.serie && o.serie.length > 1 && <Sparkline values={o.serie} width={84} height={30} color="var(--gray)" />}
        </div>
        {o.sinCambio ? null : <span className={"panel-cambio " + clase} title={t(`Previous period (${rangoAnterior}): ${o.antesTexto}`, `Periodo anterior (${rangoAnterior}): ${o.antesTexto}`)}>
          {c ? <>{c.sube ? "▲" : "▼"} {c.texto} <span className="contra">{t("vs previous period", "vs. periodo anterior")}</span></>
            : <span className="contra">{o.antes == null ? t("No previous data to compare", "Sin datos anteriores para comparar") : t("Same as previous period", "Igual que el periodo anterior")}</span>}
        </span>}
        <span className="pie">{o.pie}</span>
      </div>
    );
  };

  return (
    <div className="panel-tiles" data-panel-indicadores>
      {tile({ clave: "entregadas", rotulo: t("Delivered", "Entregadas"), valor: num(actual.entregadas), sentido: "sube",
        ahora: actual.entregadas, antes: anterior.ordenes ? anterior.entregadas : null, antesTexto: num(anterior.entregadas),
        pie: t(`${num(actual.ordenes)} orders in the period`, `${num(actual.ordenes)} órdenes en el periodo`),
        ayuda: t("Orders of the period that are delivered.", "Órdenes del periodo que ya están entregadas."),
        serie: enTrozos(cubetas.map((c) => c.entregadas), 12, "suma") })}
      {tile({ clave: "a-tiempo", rotulo: t("On time (within its window)", "A tiempo (en su ventana)"), valor: pct(actual.aTiempoPct), sentido: "sube", puntos: true,
        ahora: actual.aTiempoPct, antes: anterior.aTiempoPct, antesTexto: pct(anterior.aTiempoPct),
        pie: t(`On the promised day: ${pct(actual.aTiempoDiaPct)}`, `El día prometido: ${pct(actual.aTiempoDiaPct)}`),
        ayuda: t("Of the delivered orders, how many were delivered before the end of their promised window.", "De las entregadas, cuántas se entregaron antes de que terminara su ventana prometida."),
        serie: enTrozos(cubetas.map((c) => c.aTiempoPct), 12, "media") })}
      {tile({ clave: "ciclo", rotulo: t("From order to delivery", "De la orden a la entrega"), valor: horas(actual.cicloHoras), sentido: "baja",
        ahora: actual.cicloHoras, antes: anterior.cicloHoras, antesTexto: horas(anterior.cicloHoras),
        pie: t("Median time", "Tiempo mediano"),
        ayuda: t("Time from when the order was created until it was delivered. Median: half of the orders take less.", "Tiempo desde que se creó la orden hasta que se entregó. Mediana: la mitad de las órdenes tarda menos."),
        serie: enTrozos(cubetas.map((c) => c.cicloHoras), 12, "media") })}
      {tile({ clave: "canceladas", rotulo: t("Canceled", "Canceladas"), valor: pct(actual.canceladasPct), sentido: "baja", puntos: true,
        ahora: actual.canceladasPct, antes: anterior.canceladasPct, antesTexto: pct(anterior.canceladasPct),
        pie: t(`${num(actual.canceladas)} of ${num(actual.ordenes)} orders`, `${num(actual.canceladas)} de ${num(actual.ordenes)} órdenes`),
        ayuda: t("Share of the period's orders that ended up canceled.", "Parte de las órdenes del periodo que terminaron canceladas."),
        serie: enTrozos(cubetas.map((c) => c.canceladas), 12, "suma") })}
      {tile({ clave: "pallets", rotulo: t("Pallets", "Pallets"), valor: num(actual.pallets, 1), sentido: "sube",
        ahora: actual.pallets, antes: anterior.ordenes ? anterior.pallets : null, antesTexto: num(anterior.pallets, 1),
        pie: actual.entregadas ? t(`${num(actual.pallets / Math.max(1, actual.ordenes - actual.canceladas), 1)} per order`, `${num(actual.pallets / Math.max(1, actual.ordenes - actual.canceladas), 1)} por orden`) : "",
        ayuda: t("Pallets of the period's orders (actual, or estimated when there is no actual). Canceled orders don't count.", "Pallets de las órdenes del periodo (reales, o estimados si no hay reales). Las canceladas no cuentan."),
        serie: enTrozos(cubetas.map((c) => c.pallets), 12, "suma") })}
      {tile({ clave: "cobros", rotulo: t("Delivery fees", "Cobros de entrega"), valor: dineroCorto(actual.cobros, lang), sentido: "sube",
        ahora: actual.cobros, antes: anterior.ordenes ? anterior.cobros : null, antesTexto: dineroCorto(anterior.cobros, lang),
        pie: actual.millas ? t(`${dineroCorto(Math.round((actual.cobros / actual.millas) * 100) / 100, lang)} per mile`, `${dineroCorto(Math.round((actual.cobros / actual.millas) * 100) / 100, lang)} por milla`) : "",
        ayuda: t("Delivery fees charged on the period's orders. Canceled orders don't count.", "Tarifas de entrega cobradas en las órdenes del periodo. Las canceladas no cuentan."),
        serie: enTrozos(cubetas.map((c) => c.cobros), 12, "suma") })}
      {tile({ clave: "millas", rotulo: t("Route miles", "Millas de ruta"), valor: num(actual.millas, 1), sentido: "neutro",
        ahora: actual.millas, antes: anterior.ordenes ? anterior.millas : null, antesTexto: num(anterior.millas, 1),
        pie: actual.entregadas ? t(`${num(actual.millas / Math.max(1, actual.ordenes - actual.canceladas), 1)} per order`, `${num(actual.millas / Math.max(1, actual.ordenes - actual.canceladas), 1)} por orden`) : "",
        ayuda: t("Store → destination miles of the period's orders.", "Millas tienda → destino de las órdenes del periodo."),
        serie: enTrozos(cubetas.map((c) => c.millas), 12, "suma") })}
      {tile({ clave: "abiertas", rotulo: t("Still open", "Sin terminar"), valor: num(actual.abiertas), sentido: "baja",
        ahora: null, antes: null, antesTexto: "—", sinCambio: true,
        pie: actual.vencidas ? <span className="panel-bajo">{t(`${num(actual.vencidas)} past their date`, `${num(actual.vencidas)} ya vencidas`)}</span> : t("None past its date", "Ninguna vencida"),
        ayuda: t("Orders of the period that are neither delivered nor canceled.", "Órdenes del periodo que no están entregadas ni canceladas.") })}
    </div>
  );
}
