"use client";

import { useEffect, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { filasQueSePintan, TAMANOS_DE_TABLA, tamanoValido, TODOS, type TamanoDeTabla } from "@/lib/mostrar-n";

/** Tamaño elegido de una tabla, recordado por navegador bajo `clave`. */
export function useTamanoDeTabla(clave: string, porDefecto: TamanoDeTabla = 100): [TamanoDeTabla, (n: TamanoDeTabla) => void] {
  const [n, setN] = useState<TamanoDeTabla>(porDefecto);
  useEffect(() => {
    try { setN(tamanoValido(localStorage.getItem(`tabla-n:${clave}`), porDefecto)); } catch { /* sin almacenamiento */ }
  }, [clave, porDefecto]);
  const elegir = (x: TamanoDeTabla) => {
    setN(x);
    try { localStorage.setItem(`tabla-n:${clave}`, String(x)); } catch { /* sin almacenamiento */ }
  };
  return [n, elegir];
}

/** Selector «Mostrar 10 / 50 / 100 / Todos» al pie de una tabla, con «N de M». D-NEXT: «Todos» en vez de 1000. */
export function MostrarN({ valor, onCambio, total }: { valor: TamanoDeTabla; onCambio: (n: TamanoDeTabla) => void; total: number }) {
  const { t } = usePrefs();
  return (
    <div className="flex flex-wrap items-center justify-center gap-2 text-sm text-slate-600" data-mostrar-n>
      <span>{t("Show", "Mostrar")}</span>
      {TAMANOS_DE_TABLA.map((x) => (
        <button key={x} type="button" onClick={() => onCambio(x)} data-mostrar={x}
          className={"rounded-md border px-2 py-0.5 " + (x === valor ? "border-slate-800 bg-slate-800 text-white" : "border-slate-200 hover:bg-slate-50")}>
          {x === TODOS ? t("All", "Todos") : x}
        </button>
      ))}
      <span className="text-xs text-slate-500">{t(`${filasQueSePintan(valor, total)} of ${total}`, `${filasQueSePintan(valor, total)} de ${total}`)}</span>
    </div>
  );
}
