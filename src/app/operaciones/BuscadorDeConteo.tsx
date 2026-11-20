"use client";

import { useMemo, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { buscarEnLista } from "@/lib/almacen-ops/conteos-alcance";

export interface OpcionDeBusqueda { valor: string; texto: string; detalle?: string }

/**
 * Un selector que se busca ESCRIBIENDO (proveedor, medida): en el teléfono no hay que bajar una lista larga. Sin texto,
 * salen las primeras; al escribir, solo las que coinciden (sin acentos ni mayúsculas, y «24 x» encuentra «24x48»).
 * Elegida una, sale su nombre con «Cambiar». Las opciones de la lista son botones grandes (un toque).
 */
export function BuscadorDeConteo({ etiqueta, placeholder, opciones, valor, onElegir, dato }: {
  etiqueta: string; placeholder: string; opciones: readonly OpcionDeBusqueda[]; valor: string | null; onElegir: (valor: string | null) => void; dato: string;
}) {
  const { t } = usePrefs();
  const [q, setQ] = useState("");
  const elegida = valor == null ? null : opciones.find((o) => o.valor === valor) ?? null;
  const lista = useMemo(() => buscarEnLista(opciones, (o) => `${o.texto} ${o.detalle ?? ""}`, q, 40), [opciones, q]);
  if (elegida) {
    return (
      <div className="ops-seleccion" data-elegido={dato} data-valor-elegido={elegida.valor}>
        <span>{elegida.texto}{elegida.detalle && <span className="hint"> · {elegida.detalle}</span>}</span>
        <button type="button" className="btn btn-sm" onClick={() => { onElegir(null); setQ(""); }} data-accion={`cambiar-${dato}`}>{t("Change", "Cambiar")}</button>
      </div>
    );
  }
  return (
    <div className="ops-buscador" data-buscador={dato}>
      <input className="ops-campo ops-campo" value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder}
        inputMode="search" autoComplete="off" autoCorrect="off" spellCheck={false} aria-label={etiqueta} data-campo={dato} />
      <ul className="ops-buscador-lista" role="listbox" aria-label={etiqueta} data-opciones={lista.length}>
        {lista.map((o) => (
          <li key={o.valor}>
            <button type="button" className="ops-opcion ops-buscador-opcion" role="option" aria-selected={false} onClick={() => onElegir(o.valor)} data-opcion-buscada={o.valor}>
              {o.texto}{o.detalle && <span className="hint"> · {o.detalle}</span>}
            </button>
          </li>
        ))}
        {lista.length === 0 && <li className="hint">{t("Nothing matches. Type less or check the spelling.", "Nada coincide. Escribe menos o revisa la escritura.")}</li>}
      </ul>
    </div>
  );
}
