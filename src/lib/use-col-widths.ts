"use client";

import { useEffect, useRef, useState } from "react";

// Excel-style resizable table columns. Keeps a width per column (persisted per
// table in localStorage) and hands back a mousedown handler for a drag handle
// placed at each header cell's right edge. Pair with a <colgroup> of <col>s and
// a `table-layout: fixed` table (see the .tbl-resize CSS).
/**
 * El ancho que hay que ponerle a una tabla `tbl-resize` para que sus columnas se respeten (D-345).
 *
 * Medido en Chrome el 2026-09-20 con el CSS de la app: con `width: auto`, `table-layout: fixed` NO se
 * aplica — el navegador cae al reparto automático. Seis columnas pedidas a 172/108/96/128/112/76 px se
 * pintaron todas a ~246; pedir una a 60 px no la movió; pedirla a 300 la llevó a 409 quitándole a las
 * demás. Eso era «el arrastre no funciona»: encoger era imposible.
 *
 * Con un ancho explícito el reparto fijo sí manda. `max(100%, suma)`: si la suma no llena el hueco la
 * tabla se estira hasta el marco y el sobrante se reparte EN PROPORCIÓN a lo pedido (lo que quería
 * D-281); si lo pasa, cada columna mide exactamente lo pedido y la tabla se desplaza.
 */
/**
 * Cuántos píxeles de pantalla ocupa cada píxel PEDIDO de esta columna (D-345). Con la tabla estirada
 * hasta el marco es mayor que 1, y sin corregirlo la columna se adelanta al cursor: medido, arrastrar
 * 100 px la hacía crecer 159; dividiendo por la escala crece 79 y no se pasa. El asa vive dentro del th.
 */
export function escalaDelAsa(asa: EventTarget | null, pedido: number): number {
  const th = (asa as HTMLElement | null)?.parentElement;
  const real = th?.getBoundingClientRect().width ?? 0;
  return real > 0 && pedido > 0 ? Math.max(1, real / pedido) : 1;
}

export function anchoDeTabla(anchos: readonly number[]): { width: string } {
  const suma = anchos.reduce((s, w) => s + (Number.isFinite(w) && w > 0 ? w : 0), 0);
  return { width: `max(100%, ${Math.round(suma)}px)` };
}

export function useColWidths(storageKey: string, defaults: number[]) {
  const [widths, setWidths] = useState<number[]>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) { const p = JSON.parse(raw); if (Array.isArray(p) && p.length === defaults.length) return p; }
    } catch { /* ignore */ }
    return defaults;
  });

  // Returns a mousedown handler for the resize grip on column `i`.
  const startResize = (i: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const base = widths[i];
    const escala = escalaDelAsa(e.currentTarget, base);
    const onMove = (ev: MouseEvent) => {
      setWidths((w) => { const n = [...w]; n[i] = Math.max(16, Math.round(base + (ev.clientX - startX) / escala)); return n; });
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      setWidths((w) => { try { localStorage.setItem(storageKey, JSON.stringify(w)); } catch { /* ignore */ } return w; });
    };
    document.body.style.cursor = "col-resize";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  const reset = () => {
    setWidths(defaults);
    try { localStorage.removeItem(storageKey); } catch { /* ignore */ }
  };

  return { widths, startResize, reset };
}

// Same idea, but keyed by column KEY instead of index — for tables whose column
// set is dynamic (e.g. the Orders table's user-toggled columns).
/**
 * A sensible width per column, by what it actually holds.
 *
 * Every column used to default to 150px, so "SO #" — almost always a dash —
 * claimed exactly as much of the screen as a customer name. On a wide monitor
 * that pushed real columns off the right edge and made the table scroll to
 * reach data that would otherwise have fitted.
 *
 * A resize is still remembered per column; these are only the starting points.
 *
 * Apretados en D-344 (entre 10 y 26 px por columna), junto con el relleno de las celdas, que baja 8 px
 * por columna. Las columnas pierden algo más que el relleno: un texto que cabía justo ahora se corta
 * con puntos suspensivos, y para eso está el asa. Quien ya arrastró una columna conserva SU ancho;
 * esto solo mueve el punto de partida.
 */
export const COLUMN_WIDTHS: Record<string, number> = {
  __id: 172,      // invoice numbers, sometimes two, with the order code beneath
  stage: 108,     // a pill
  type: 96,       // Customer / Intertienda / Transfer
  store: 128,
  account: 184,   // company names run long — this is the one that needs room
  so: 72,
  po: 72,
  invoice: 108,
  date: 112,
  windows: 112,
  pallets: 76,
  fee: 72,
  driver: 120,
  contact: 116,
  address: 216,
};

/**
 * `opciones` (D-338), para la tabla de Órdenes, donde el ancho es de la PERSONA y no del navegador:
 *   · `deLaPersona`: los anchos leídos de la base. Llegan después de pintar; cuando llegan, mandan sobre el navegador.
 *   · `alCambiar`: se llama UNA vez al soltar (o al restablecer una columna), nunca en cada píxel.
 *   · `minimo`: por debajo no se encoge. Sin él, los 16 px de siempre (las tablas del Gestor).
 */
export interface OpcionesDeAncho { deLaPersona?: Record<string, number> | null; alCambiar?: (anchos: Record<string, number>) => void; minimo?: number }

export function useColWidthMap(storageKey: string, defaultWidth = 150, opciones: OpcionesDeAncho = {}) {
  const minimo = opciones.minimo ?? 16;
  const [widths, setWidths] = useState<Record<string, number>>(() => {
    try { const raw = localStorage.getItem(storageKey); if (raw) return JSON.parse(raw); } catch { /* ignore */ }
    return {};
  });
  // Lo último pintado, para avisar al soltar sin meter un efecto dentro de un `setState`.
  const ultimos = useRef(widths);
  ultimos.current = widths;
  const alCambiar = useRef(opciones.alCambiar);
  alCambiar.current = opciones.alCambiar;
  const deLaPersona = opciones.deLaPersona ? JSON.stringify(opciones.deLaPersona) : null;
  useEffect(() => { if (deLaPersona) setWidths(JSON.parse(deLaPersona)); }, [deLaPersona]);
  const guarda = (w: Record<string, number>) => {
    try { localStorage.setItem(storageKey, JSON.stringify(w)); } catch { /* ignore */ }
    alCambiar.current?.(w);
  };
  // `porDefecto` (D-NEXT): el ancho de partida de UNA columna, cuando no es el general. Lo usa el Gestor para que una
  // columna tomada de Órdenes nazca con el ancho que tiene allí. Lo que la persona ya arrastró sigue mandando.
  const widthOf = (key: string, porDefecto?: number) => widths[key] ?? COLUMN_WIDTHS[key] ?? porDefecto ?? defaultWidth;

  const startResize = (key: string, porDefecto?: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const base = widths[key] ?? COLUMN_WIDTHS[key] ?? porDefecto ?? defaultWidth;
    const escala = escalaDelAsa(e.currentTarget, base);
    const onMove = (ev: MouseEvent) => {
      setWidths((w) => ({ ...w, [key]: Math.max(minimo, Math.round(base + (ev.clientX - startX) / escala)) }));
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      // Al SOLTAR, y fuera del `setState`: un tic después, cuando `ultimos` ya lleva el último ancho pintado.
      setTimeout(() => guarda(ultimos.current), 0);
    };
    document.body.style.cursor = "col-resize";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  // Double-click a grip to reset just that column to the default width.
  const resetCol = (key: string) => {
    const n = { ...ultimos.current }; delete n[key];
    setWidths(n);
    guarda(n);
  };

  return { widthOf, startResize, resetCol };
}
