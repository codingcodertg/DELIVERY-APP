"use client";

// Tablas dinámicas del Panel (D-1127): filas × columnas × valor, con celdas sombreadas (más oscuro = más, un solo color)
// y totales. Arriba, las que un gerente mira siempre, ya armadas; abajo, una para armar la propia. Cada una es la tabla
// estándar: se ordena por cualquier columna. La lógica, en `@/lib/pivote`.
import { useMemo, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { stageLabel, STAGES } from "@/lib/constants";
import { TablaEstandar, type ColumnaEstandar } from "@/components/TablaEstandar";
import { dineroCorto } from "@/lib/panel-resumen";
import { DIMENSIONES, MEDIDAS, pivotea, SIN_DATO, VISTAS_RAPIDAS, type Dimension, type Medida } from "@/lib/pivote";
import type { Delivery, Profile, Stage } from "@/lib/types";

const MESES_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MESES_ES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
type Usuarios = readonly Pick<Profile, "id" | "full_name">[];

/** Una tabla dinámica ya decidida (qué va en filas, en columnas y qué se suma). */
function VistaPivote({ ordenes, usuarios, filas, columnas, medida, id, tope }: {
  ordenes: readonly Delivery[]; usuarios: Usuarios; filas: Dimension; columnas: Dimension; medida: Medida;
  /** Único: con él se guarda la vista de la tabla de cada persona. */
  id: string;
  /** Solo las primeras N filas (las de más total); el total sigue siendo el de todas. */
  tope?: number;
}) {
  const { lang, t } = usePrefs();
  const nombres = useMemo(() => new Map(usuarios.map((u) => [u.id, u.full_name])), [usuarios]);
  const p = useMemo(
    () => pivotea(ordenes, filas, columnas, medida, (uid) => (uid ? nombres.get(uid) ?? null : null), STAGES.map((s) => s.key)),
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
  const filasVistas = tope ? p.filas.slice(0, tope) : p.filas;

  // Una columna por valor de la dimensión elegida. La clave lleva el valor: el orden y los anchos de cada cruce se
  // guardan aparte (el `id` de la tabla también cambia con el cruce).
  const cols: ColumnaEstandar<string>[] = [
    { key: "fila", en: rotulo(filas)?.en ?? "", es: rotulo(filas)?.es ?? "", ancho: filas === "account" ? 230 : 160, fija: true,
      valor: (f) => etiqueta(filas, f), celda: (f) => <strong>{etiqueta(filas, f)}</strong> },
    ...(sinColumnas ? [] : p.columnas.map((c): ColumnaEstandar<string> => ({
      key: "c:" + c, en: etiqueta(columnas, c), es: etiqueta(columnas, c), ancho: 112, numerico: true,
      valor: (f) => p.celda(f, c),
      celda: (f) => { const n = p.celda(f, c); return <span className="panel-calor" style={{ background: sombra(n) }}>{n ? fmt(n) : "·"}</span>; },
    }))),
    { key: "total", en: "Total", es: "Total", ancho: 100, numerico: true, fija: true, valor: (f) => p.totalFila(f), celda: (f) => <strong>{fmt(p.totalFila(f))}</strong> },
  ];
  const totales = Object.fromEntries([
    ["fila", tope && p.filas.length > tope ? t(`Total (all ${p.filas.length})`, `Total (las ${p.filas.length})`) : t("Total", "Total")],
    ...(sinColumnas ? [] : p.columnas.map((c) => ["c:" + c, <strong key={c}>{fmt(p.totalColumna(c))}</strong>] as const)),
    ["total", <strong key="t">{fmt(p.total)}</strong>],
  ]);

  if (!ordenes.length) return <div className="empty">{t("No orders in this range.", "Sin órdenes en este rango.")}</div>;
  return (
    <>
      <TablaEstandar id={id} key={id} sinCaja data-tabla="dash-pivote" filas={filasVistas} claveDe={(f) => f} columnas={cols} totales={totales} />
      {!sinColumnas && <div className="panel-escala"><span>{t("Less", "Menos")}</span><span className="rampa" aria-hidden /><span>{t("More", "Más")}</span></div>}
    </>
  );
}

/** Las tablas dinámicas del Panel: las ya armadas y la que cada quien arma. */
export function TablaDinamica({ ordenes, clientes, usuarios }: {
  /** Las órdenes del periodo (ya acotadas a las tiendas de quien mira). */
  ordenes: readonly Delivery[];
  /** Solo las entregas a clientes: en un traslado la «cuenta» es otra tienda. */
  clientes: readonly Delivery[];
  usuarios: Usuarios;
}) {
  const { t } = usePrefs();
  const [filas, setFilas] = useState<Dimension>("store");
  const [columnas, setColumnas] = useState<Dimension>("week");
  const [medida, setMedida] = useState<Medida>("delivered");

  const selector = (valor: string, onCambio: (v: string) => void, opciones: { key: string; en: string; es: string }[], conNinguna = false) => (
    <select value={valor} onChange={(e) => onCambio(e.target.value)}>
      {conNinguna && <option value="none">{t("— nothing —", "— nada —")}</option>}
      {opciones.map((o) => <option key={o.key} value={o.key}>{t(o.en, o.es)}</option>)}
    </select>
  );
  const etiquetaDe = { margin: 0, textTransform: "none", letterSpacing: 0, display: "flex", alignItems: "center", gap: 6 } as const;

  return (
    <div data-tablas-dinamicas>
      {VISTAS_RAPIDAS.map((v) => (
        <div className="card" key={v.key} data-tabla-dinamica={v.key}>
          <h3 style={{ margin: "0 0 10px" }}>{t(v.en, v.es)}</h3>
          <VistaPivote ordenes={v.filas === "account" ? clientes : ordenes} usuarios={usuarios} filas={v.filas} columnas={v.columnas} medida={v.medida}
            id={"dash-pivote-" + v.key} tope={v.filas === "account" ? 10 : undefined} />
        </div>
      ))}

      <div className="card" data-tabla-dinamica="propia">
        <h3 style={{ margin: "0 0 6px" }}>{t("Build your own", "Arme la suya")}</h3>
        <p className="hint" style={{ margin: "0 0 12px" }}>{t("Pick what goes in the rows, in the columns, and what to add up.", "Elija qué va en las filas, qué en las columnas y qué se suma.")}</p>
        <div className="panel-filtros">
          <label style={etiquetaDe}>{t("Rows", "Filas")} {selector(filas, (v) => { setFilas(v as Dimension); if (v === columnas) setColumnas("none"); }, DIMENSIONES)}</label>
          <label style={etiquetaDe}>{t("Columns", "Columnas")} {selector(columnas, (v) => setColumnas(v as Dimension), DIMENSIONES.filter((d) => d.key !== filas), true)}</label>
          <label style={etiquetaDe}>{t("Value", "Valor")} {selector(medida, (v) => setMedida(v as Medida), MEDIDAS)}</label>
        </div>
        <VistaPivote ordenes={ordenes} usuarios={usuarios} filas={filas} columnas={columnas} medida={medida} id={`dash-pivote-${filas}-${columnas}`} />
      </div>
    </div>
  );
}
