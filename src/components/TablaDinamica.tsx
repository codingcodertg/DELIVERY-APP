"use client";

// Tabla dinámica del Panel (D-1127): filas × columnas × valor, con vistas rápidas para el gerente y celdas sombreadas
// (más oscuro = más, un solo color). Es la tabla estándar: se ordena por cualquier columna. La lógica, en `@/lib/pivote`.
import { useMemo, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { stageLabel, STAGES } from "@/lib/constants";
import { TablaEstandar, type ColumnaEstandar } from "@/components/TablaEstandar";
import { dineroCorto } from "@/lib/panel-resumen";
import { DIMENSIONES, MEDIDAS, pivotea, SIN_DATO, VISTAS_RAPIDAS, type Dimension, type Medida } from "@/lib/pivote";
import type { Delivery, Profile, Stage } from "@/lib/types";

const MESES_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MESES_ES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

export function TablaDinamica({ ordenes, usuarios }: { ordenes: readonly Delivery[]; usuarios: readonly Pick<Profile, "id" | "full_name">[] }) {
  const { lang, t } = usePrefs();
  const [filas, setFilas] = useState<Dimension>("store");
  const [columnas, setColumnas] = useState<Dimension>("stage");
  const [medida, setMedida] = useState<Medida>("orders");
  const nombres = useMemo(() => new Map(usuarios.map((u) => [u.id, u.full_name])), [usuarios]);
  const p = useMemo(
    () => pivotea(ordenes, filas, columnas, medida, (id) => (id ? nombres.get(id) ?? null : null), STAGES.map((s) => s.key)),
    [ordenes, filas, columnas, medida, nombres],
  );

  const meses = lang === "es" ? MESES_ES : MESES_EN;
  const etiqueta = (dim: Dimension, k: string) => {
    if (k === SIN_DATO) return t("(none)", "(sin dato)");
    if (dim === "stage") return stageLabel(k as Stage, lang);
    if (dim === "month") { const [y, m] = k.split("-"); return `${meses[Number(m) - 1]} ${y}`; }
    if (dim === "week") { const [, m, d] = k.split("-"); return t(`Wk of ${meses[Number(m) - 1]} ${Number(d)}`, `Sem. ${Number(d)} ${meses[Number(m) - 1]}`); }
    if (dim === "day") { const [, m, d] = k.split("-"); return `${Number(d)} ${meses[Number(m) - 1]}`; }
    if (dim === "store") return k.replace(/^RDZ /, "");
    return k;
  };
  const fmt = (n: number) => (medida === "fees" ? dineroCorto(n, lang) : n.toLocaleString(lang === "es" ? "es-MX" : "en-US", { maximumFractionDigits: medida === "pallets" || medida === "miles" ? 1 : 0 }));
  const sombra = (n: number) => (n && p.max ? `color-mix(in srgb, var(--viz-1) ${Math.round(8 + (n / p.max) * 52)}%, var(--card))` : undefined);
  const sinColumnas = columnas === "none";
  const rotulo = (d: Dimension) => DIMENSIONES.find((x) => x.key === d);

  // Una columna por valor de la dimensión elegida. La clave lleva el valor, así el orden y los anchos de cada cruce
  // se guardan aparte (el `id` de la tabla también cambia con el cruce).
  const cols: ColumnaEstandar<string>[] = [
    { key: "fila", en: rotulo(filas)?.en ?? "", es: rotulo(filas)?.es ?? "", ancho: filas === "account" ? 240 : 170, fija: true,
      valor: (f) => etiqueta(filas, f), celda: (f) => <strong>{etiqueta(filas, f)}</strong> },
    ...(sinColumnas ? [] : p.columnas.map((c): ColumnaEstandar<string> => ({
      key: "c:" + c, en: etiqueta(columnas, c), es: etiqueta(columnas, c), ancho: 118, numerico: true,
      valor: (f) => p.celda(f, c),
      celda: (f) => { const n = p.celda(f, c); return <span className="panel-calor" style={{ background: sombra(n) }}>{n ? fmt(n) : "·"}</span>; },
    }))),
    { key: "total", en: "Total", es: "Total", ancho: 110, numerico: true, fija: true, valor: (f) => p.totalFila(f), celda: (f) => <strong>{fmt(p.totalFila(f))}</strong> },
  ];
  const totales = Object.fromEntries([
    ["fila", t("Total", "Total")],
    ...(sinColumnas ? [] : p.columnas.map((c) => ["c:" + c, <strong key={c}>{fmt(p.totalColumna(c))}</strong>] as const)),
    ["total", <strong key="t">{fmt(p.total)}</strong>],
  ]);

  const selector = (valor: string, onCambio: (v: string) => void, opciones: { key: string; en: string; es: string }[], conNinguna = false) => (
    <select value={valor} onChange={(e) => onCambio(e.target.value)}>
      {conNinguna && <option value="none">{t("— nothing —", "— nada —")}</option>}
      {opciones.map((o) => <option key={o.key} value={o.key}>{t(o.en, o.es)}</option>)}
    </select>
  );
  const etiquetaDe = { margin: 0, textTransform: "none", letterSpacing: 0, display: "flex", alignItems: "center", gap: 6 } as const;

  return (
    <div className="card" data-tabla-dinamica>
      <h3 style={{ margin: "0 0 6px" }}>{t("Pivot table", "Tabla dinámica")}</h3>
      <p className="hint" style={{ margin: "0 0 12px" }}>{t("Cross the period's orders any way you need. Start with a ready-made view or pick your own rows, columns and value.", "Cruce las órdenes del periodo como lo necesite. Empiece con una vista lista o elija sus filas, columnas y valor.")}</p>
      <div className="filters" style={{ marginBottom: 10 }}>
        {VISTAS_RAPIDAS.map((v) => {
          const on = v.filas === filas && v.columnas === columnas && v.medida === medida;
          return <button key={v.key} className={"chip" + (on ? " on" : "")} aria-pressed={on} onClick={() => { setFilas(v.filas); setColumnas(v.columnas); setMedida(v.medida); }}>{t(v.en, v.es)}</button>;
        })}
      </div>
      <div className="panel-filtros">
        <label style={etiquetaDe}>{t("Rows", "Filas")} {selector(filas, (v) => { setFilas(v as Dimension); if (v === columnas) setColumnas("none"); }, DIMENSIONES)}</label>
        <label style={etiquetaDe}>{t("Columns", "Columnas")} {selector(columnas, (v) => setColumnas(v as Dimension), DIMENSIONES.filter((d) => d.key !== filas), true)}</label>
        <label style={etiquetaDe}>{t("Value", "Valor")} {selector(medida, (v) => setMedida(v as Medida), MEDIDAS)}</label>
      </div>

      {!ordenes.length ? <div className="empty">{t("No orders in this range.", "Sin órdenes en este rango.")}</div> : (
        <>
          <TablaEstandar id={`dash-pivote-${filas}-${columnas}`} key={`${filas}-${columnas}`} sinCaja data-tabla="dash-pivote" filas={p.filas} claveDe={(f) => f} columnas={cols} totales={totales} />
          {!sinColumnas && <div className="panel-escala"><span>{t("Less", "Menos")}</span><span className="rampa" aria-hidden /><span>{t("More", "Más")}</span></div>}
        </>
      )}
    </div>
  );
}
