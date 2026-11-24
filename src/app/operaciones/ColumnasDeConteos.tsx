import { fmtDateTime, fmtMoney } from "@/lib/utils";
import type { ColumnaEstandar } from "@/components/TablaEstandar";
import { INFO_DE_ALCANCE } from "@/lib/almacen-ops/conteos";
import type { FilaDeConteo } from "@/lib/almacen-ops/conteos-filas";
import { ChipDeEtapaDeConteo } from "./EtapasDeConteo";

/**
 * Las columnas de los conteos (23 nov): la lista «Seguir» de Conteos y «Conteos del mes» del informe son LA MISMA tabla.
 * Comparten `ID_TABLA_DE_CONTEOS`, así que una columna que se oculta o se mueve en una aplica en la otra (la elección se
 * guarda por persona, en la clave de esa tabla). Por eso las dos usan este mismo conjunto de columnas.
 */
export const ID_TABLA_DE_CONTEOS = "conteos-lista";

export const COLUMNAS_DE_CONTEOS: ColumnaEstandar<FilaDeConteo>[] = [
  { key: "conteo", en: "Count", es: "Conteo", valor: (f) => f.c.title, celda: (f) => (
    <span className="ops-conteo-nombre-abre" data-col-nombre>{INFO_DE_ALCANCE[f.c.scope_kind].emoji} {f.c.title}</span>), envuelve: true },
  { key: "tienda", en: "Store", es: "Tienda", valor: (f) => f.c.store },
  { key: "etapa", en: "Stage", es: "Etapa", valor: (f) => f.c.stage, celda: (f) => (
    <>
      <ChipDeEtapaDeConteo e={f.c.stage} />
      {f.c.stage === "sign_off" && f.c.signed_at && <span className="ops-insignia ops-insignia-ok"> ✍️</span>}
      {f.lineas.some((l) => l.recount_requested) && <span className="ops-insignia ops-insignia-sin-foto"> ↩</span>}
    </>) },
  { key: "progreso", en: "Progress", es: "Avance", numerico: true, valor: (f) => f.hechas, celda: (f) => `${f.hechas}/${f.total}` },
  { key: "lineas", en: "Lines", es: "Líneas", numerico: true, valor: (f) => f.lineasN },
  { key: "ordenes", en: "Pending orders", es: "Órdenes pendientes", numerico: true, valor: (f) => f.ordenes, oculta: true },
  { key: "cajasFaltan", en: "Missing boxes", es: "Cajas que faltan", numerico: true, valor: (f) => f.faltanCajas, celda: (f) => <span className={f.faltanCajas > 0 ? "ops-kpi-rojo" : ""}>{f.faltanCajas}</span> },
  { key: "cajasSobran", en: "Over boxes", es: "Cajas que sobran", numerico: true, valor: (f) => f.sobranCajas, oculta: true },
  { key: "neto", en: "Net $", es: "Neto $", numerico: true, valor: (f) => f.neto, celda: (f) => `${f.neto > 0 ? "+" : ""}${fmtMoney(f.neto)}` },
  { key: "exactitud", en: "Accuracy", es: "Exactitud", numerico: true, valor: (f) => f.exactitud, celda: (f) => (f.exactitud === null ? "—" : `${f.exactitud}%`) },
  { key: "creado", en: "Opened", es: "Abierto", valor: (f) => f.c.created_at, celda: (f) => fmtDateTime(f.c.created_at), oculta: true },
  { key: "ajustado", en: "Adjusted", es: "Ajustado", valor: (f) => f.c.adjusted_at, celda: (f) => (f.c.adjusted_at ? fmtDateTime(f.c.adjusted_at) : "—") },
];
