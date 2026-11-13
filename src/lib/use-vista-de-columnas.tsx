"use client";

import { useEffect, useMemo, useState, type DragEvent } from "react";
import { claveDeVista, mueveEnOrden, sueltaEnOrden, vistaLimpia, type VistaDeTabla } from "@/lib/tabla-estandar";

/**
 * Las columnas que VE cada persona y en qué orden, guardado en su navegador: la mitad «⚙ Columnas + arrastrar la
 * cabecera» del estándar de tablas (`docs/ESTANDAR-DE-TABLAS.md`). Lo usa `TablaEstandar` y las tablas que ya tenían
 * su propio marcado (y ya ordenaban, filtraban y cambiaban anchos) para completar el estándar sin reescribirse.
 *
 * Devuelve las columnas en orden (`enOrden`), las visibles (`visibles`), lo que pide `SelectorDeColumnas`
 * (`selector`) y lo que se le pone al `<th>` para arrastrarlo (`th(key)`).
 */
export function useVistaDeColumnas<C extends { key: string; fija?: true; oculta?: true }>(id: string, columnas: readonly C[], alArrastrar?: () => void) {
  const claves = useMemo(() => columnas.map((c) => c.key), [columnas]);
  const fijas = useMemo(() => columnas.filter((c) => c.fija).map((c) => c.key), [columnas]);
  const ocultasDeEntrada = useMemo(() => columnas.filter((c) => c.oculta).map((c) => c.key), [columnas]);
  const firma = claves.join("|");

  const [vista, setVista] = useState<VistaDeTabla>(() => vistaLimpia(null, claves, fijas, ocultasDeEntrada));
  useEffect(() => {
    let guardado: unknown = null;
    try { const v = localStorage.getItem(claveDeVista(id)); guardado = v ? JSON.parse(v) : null; } catch { /* sin almacenamiento */ }
    setVista(vistaLimpia(guardado, claves, fijas, ocultasDeEntrada));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, firma]);
  const guarda = (n: VistaDeTabla) => {
    setVista(n);
    try { localStorage.setItem(claveDeVista(id), JSON.stringify({ ...n, conocidas: claves })); } catch { /* dura hasta recargar */ }
  };

  const porClave = useMemo(() => new Map(columnas.map((c) => [c.key, c])), [columnas]);
  const enOrden = useMemo(() => vista.orden.map((k) => porClave.get(k)).filter((c): c is C => !!c), [vista.orden, porClave]);
  const visibles = useMemo(() => enOrden.filter((c) => !vista.ocultas.includes(c.key)), [enOrden, vista.ocultas]);
  const [arrastrada, setArrastrada] = useState<string | null>(null);

  return {
    enOrden, visibles,
    selector: {
      columnas: enOrden,
      elegidas: visibles.map((c) => c.key),
      onAlterna: (k: string) => guarda({ ...vista, ocultas: vista.ocultas.includes(k) ? vista.ocultas.filter((x) => x !== k) : [...vista.ocultas, k] }),
      mover: {
        seMueve: (k: string, d: -1 | 1) => { const i = vista.orden.indexOf(k) + d; return i >= 0 && i < vista.orden.length; },
        onMueve: (k: string, d: -1 | 1) => guarda({ ...vista, orden: mueveEnOrden(vista.orden, k, d) }),
        ordenPropio: vista.orden.join("|") !== firma,
        onRestablece: () => guarda({ ...vista, orden: [...claves] }),
        onSuelta: (desde: string, sobre: string) => guarda({ ...vista, orden: sueltaEnOrden(vista.orden, desde, sobre) }),
      },
    },
    /** Para el `<th>` de la columna `k`: se arrastra y se suelta sobre otra cabecera. */
    th: (k: string) => ({
      className: "th-arrastrable" + (arrastrada === k ? " th-arrastrada" : ""),
      draggable: true,
      onDragStart: (e: DragEvent) => { e.dataTransfer.setData("text/plain", k); e.dataTransfer.effectAllowed = "move"; alArrastrar?.(); setArrastrada(k); },
      onDragOver: (e: DragEvent) => { if (arrastrada) e.preventDefault(); },
      onDrop: (e: DragEvent) => { e.preventDefault(); if (arrastrada && arrastrada !== k) guarda({ ...vista, orden: sueltaEnOrden(vista.orden, arrastrada, k) }); setArrastrada(null); },
      onDragEnd: () => setArrastrada(null),
    }),
    /** Para el asa del ancho: que arrastrarla no mueva la columna. */
    asa: { draggable: true, onDragStart: (e: DragEvent) => { e.preventDefault(); e.stopPropagation(); } },
  };
}
