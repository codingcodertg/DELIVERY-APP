"use client";

import { useEffect, useState } from "react";
import { fmtMoney } from "@/lib/utils";
import { fmtDia } from "@/lib/almacen-ops/fecha-del-dano";
import { totalDeHoja, type FilaDeHoja } from "@/lib/almacen-ops/etapas";
import {
  COLUMNAS_DE_HOJA, alternaColumnaDeHoja, claveDeColumnasDeHoja, normalizaOcultasDeHoja, tramoDelTotal, type ClaveDeHoja,
} from "@/lib/almacen-ops/columnas-de-hoja";
import { SelectorDeColumnas } from "@/components/SelectorDeColumnas";
import type { Lang } from "@/lib/almacen-ops/etapas";

type T = (en: string, es: string) => string;

/**
 * Columnas de la hoja de aprobación a gusto (ayuda de Roberto, 12 nov). Las ocultas se guardan por persona en este
 * navegador y tampoco se imprimen. Lo usan el borrador, la hoja del grupo y la hoja imprimible.
 */
export function useColumnasDeHoja(uid: string) {
  const clave = claveDeColumnasDeHoja(uid);
  const [ocultas, setOcultasEstado] = useState<ClaveDeHoja[]>([]);
  useEffect(() => {
    try { const v = localStorage.getItem(clave); if (v) setOcultasEstado(normalizaOcultasDeHoja(JSON.parse(v))); } catch { /* sin almacenamiento */ }
  }, [clave]);
  const alterna = (k: ClaveDeHoja) => {
    const n = alternaColumnaDeHoja(ocultas, k);
    setOcultasEstado(n);
    try { localStorage.setItem(clave, JSON.stringify(n)); } catch { /* dura hasta recargar */ }
  };
  return { ocultas, ve: (k: ClaveDeHoja) => !ocultas.includes(k), alterna };
}

/** El botón «⚙ Columnas» de la barra de la hoja (no se imprime). */
export function SelectorDeColumnasDeHoja({ ocultas, alterna, lang, t }: { ocultas: readonly ClaveDeHoja[]; alterna: (k: ClaveDeHoja) => void; lang: Lang; t: T }) {
  return (
    <span className="no-imprimir" data-columnas-de-hoja>
      <SelectorDeColumnas
        columnas={COLUMNAS_DE_HOJA}
        elegidas={COLUMNAS_DE_HOJA.filter((c) => !ocultas.includes(c.key)).map((c) => c.key)}
        onAlterna={(k) => alterna(k as ClaveDeHoja)}
        rotulo={(c) => (lang === "es" ? c.es : c.en)}
        titulo={t("Columns on this sheet", "Columnas de esta hoja")}
        nota={t("Hidden columns are not printed either. Saved in this browser.", "Las columnas ocultas tampoco se imprimen. Se guarda en este navegador.")}
        t={t}
      />
    </span>
  );
}

/** La tabla de la hoja (borrador e imprimible): «#» siempre, y las columnas que se vean. */
export function TablaDeHoja({ filas, ve, ocultas, lang, t, vacio }: {
  filas: readonly FilaDeHoja[]; ve: (k: ClaveDeHoja) => boolean; ocultas: readonly ClaveDeHoja[]; lang: Lang; t: T; vacio: string;
}) {
  const visibles = COLUMNAS_DE_HOJA.filter((c) => ve(c.key));
  const tramo = tramoDelTotal(ocultas, 1);
  const celda = (f: FilaDeHoja, k: ClaveDeHoja) => {
    switch (k) {
      case "folio": return <td key={k} className="hoja-folio">{f.folio}</td>;
      case "dia": return <td key={k}>{fmtDia(f.dia, lang)}</td>;
      case "producto": return <td key={k}>{f.producto}</td>;
      case "danadas": return <td key={k} className="num">{f.danadas}</td>;
      case "perdida": return <td key={k} className="num">{fmtMoney(f.perdida)}</td>;
      case "motivo": return <td key={k}>{f.motivo}</td>;
      case "rompio": return <td key={k}>{f.rompio}</td>;
      case "reporto": return <td key={k}>{f.reporto}</td>;
    }
  };
  return (
    <table className="hoja-tabla" data-hoja-filas={filas.length}>
      <thead>
        <tr>
          <th>#</th>
          {visibles.map((c) => <th key={c.key} className={c.num ? "num" : undefined} data-col-hoja={c.key}>{lang === "es" ? c.es : c.en}</th>)}
        </tr>
      </thead>
      <tbody>
        {filas.map((f, n) => <tr key={f.id} data-hoja-reporte={f.id}><td>{n + 1}</td>{visibles.map((c) => celda(f, c.key))}</tr>)}
        {filas.length === 0 && <tr><td colSpan={visibles.length + 1} className="hoja-vacia">{vacio}</td></tr>}
      </tbody>
      {filas.length > 0 && (
        <tfoot>
          {tramo
            ? <tr><td colSpan={tramo.antes} className="num">{t("Total", "Total")}</td><td className="num" data-hoja-total>{fmtMoney(totalDeHoja(filas))}</td>{tramo.despues > 0 && <td colSpan={tramo.despues} />}</tr>
            : <tr><td colSpan={visibles.length + 1} className="num" data-hoja-total>{t("Total", "Total")}: {fmtMoney(totalDeHoja(filas))}</td></tr>}
        </tfoot>
      )}
    </table>
  );
}
