"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Un aviso de la ruta: su título (en negrita) y su detalle. Qué dice cada uno lo decide quien lo usa. */
export type AvisoDeLaRuta = { clave: string; titulo: ReactNode; detalle: ReactNode };

const ANCHO_MAX = 420;
const MARGEN = 8;
const SEPARACION = 6;
/** Al salir el ratón del botón, el panel aguanta un momento: da tiempo a llegar a él sin que se cierre. */
const RETARDO_SALIDA_MS = 150;

export type PosicionDelAviso = { left: number; width: number; top?: number; bottom?: number; maxHeight: number };

/**
 * Dónde cae el panel: debajo del botón, o encima si debajo no cabe, y siempre dentro de la ventana (a los lados, con
 * margen). Su alto máximo deja el resto a la vista; lo que sobre, se desplaza dentro. Pura, para probarla sin navegador.
 */
export function posicionDelAviso(
  boton: { top: number; bottom: number; left: number; right: number },
  ventana: { width: number; height: number },
): PosicionDelAviso {
  const width = Math.max(120, Math.min(ANCHO_MAX, ventana.width - 2 * MARGEN));
  const left = Math.min(Math.max(boton.right - width, MARGEN), ventana.width - MARGEN - width);
  const abajo = ventana.height - boton.bottom - MARGEN - SEPARACION;
  const arriba = boton.top - MARGEN - SEPARACION;
  const techo = Math.floor(ventana.height * 0.7);
  if (abajo >= 180 || abajo >= arriba) {
    return { left, width, top: boton.bottom + SEPARACION, maxHeight: Math.max(80, Math.min(abajo, techo)) };
  }
  return { left, width, bottom: ventana.height - boton.top + SEPARACION, maxHeight: Math.max(80, Math.min(arriba, techo)) };
}

/** La lista de avisos, tal cual va en el panel: título en negrita y detalle debajo (si lo hay). */
export function ListaDeAvisos({ avisos }: { avisos: readonly AvisoDeLaRuta[] }) {
  return (
    <>
      {avisos.map((a) => (
        <div key={a.clave} className="avisos-de-ruta-aviso" data-aviso-de-ruta={a.clave}>
          <b className="avisos-de-ruta-titulo"><span className="avisos-de-ruta-signo" aria-hidden>⚠</span> {a.titulo}</b>
          {a.detalle != null && <div className="hint avisos-de-ruta-detalle">{a.detalle}</div>}
        </div>
      ))}
    </>
  );
}

/**
 * El «⚠ N» de la cabecera de una ruta (y de la barra del Gestor, para los avisos que no son de ninguna ruta a la vista).
 * Sustituye a las tarjetas rosas que tapaban la tabla. Nada si no hay avisos.
 *
 * - **Ratón**: al pasar por encima, el panel sale; al salir, se cierra.
 * - **Teclado**: con el foco visible en el botón, sale; al perderlo, se cierra.
 * - **Pulsar** (ratón o teléfono): lo deja fijado hasta pulsar fuera o Escape.
 *
 * El panel va en un portal con `position: fixed`, colocado con `posicionDelAviso`: flota sobre lo que haya debajo y no
 * empuja nada. Se recoloca al desplazarse o cambiar la ventana.
 */
export function IconoDeAvisos({ avisos, t }: { avisos: readonly AvisoDeLaRuta[]; t: (en: string, es: string) => string }) {
  const n = avisos.length;
  const id = useId();
  const botonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const salida = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [fijado, setFijado] = useState(false);
  const [raton, setRaton] = useState(false);
  const [teclado, setTeclado] = useState(false);
  const [pos, setPos] = useState<PosicionDelAviso | null>(null);
  const abierto = n > 0 && (fijado || raton || teclado);

  const cancelaSalida = () => {
    if (salida.current) { clearTimeout(salida.current); salida.current = null; }
  };
  const saleSoon = () => {
    cancelaSalida();
    salida.current = setTimeout(() => { salida.current = null; setRaton(false); }, RETARDO_SALIDA_MS);
  };
  useEffect(() => cancelaSalida, []);

  // Colocación: al abrir, y al desplazar o cambiar la ventana mientras esté abierto.
  useLayoutEffect(() => {
    if (!abierto) return;
    const coloca = () => {
      const b = botonRef.current;
      if (!b) return;
      setPos(posicionDelAviso(b.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight }));
    };
    coloca();
    window.addEventListener("resize", coloca);
    window.addEventListener("scroll", coloca, true);
    return () => {
      window.removeEventListener("resize", coloca);
      window.removeEventListener("scroll", coloca, true);
    };
  }, [abierto]);

  // Clic fuera (o toque fuera) cierra lo fijado; Escape cierra todo.
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: Event) => {
      const x = e.target as Node;
      if (botonRef.current?.contains(x) || panelRef.current?.contains(x)) return;
      setFijado(false); setRaton(false); setTeclado(false);
    };
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setFijado(false); setRaton(false); setTeclado(false); }
    };
    document.addEventListener("pointerdown", fuera);
    document.addEventListener("keydown", tecla);
    return () => {
      document.removeEventListener("pointerdown", fuera);
      document.removeEventListener("keydown", tecla);
    };
  }, [abierto]);

  if (n === 0) return null;
  const rotulo = n === 1 ? t("1 route warning", "1 aviso de la ruta") : t(`${n} route warnings`, `${n} avisos de la ruta`);

  return (
    // Los clics de aquí no llegan a la tarjeta de la ruta (su clic limpia la selección); el panel va en un portal, pero
    // sus clics suben por el árbol de React, así que se cortan también allí.
    <span className="avisos-de-ruta" onClick={(e) => e.stopPropagation()}>
      <button
        ref={botonRef}
        type="button"
        className="sema avisos-de-ruta-boton"
        aria-label={rotulo}
        aria-expanded={abierto}
        aria-controls={abierto ? id : undefined}
        aria-haspopup="dialog"
        title={t("Route warnings: hover, or tap to keep them open", "Avisos de la ruta: pase el ratón, o pulse para dejarlos abiertos")}
        onClick={() => setFijado((v) => !v)}
        onPointerEnter={(e) => { if (e.pointerType === "mouse") { cancelaSalida(); setRaton(true); } }}
        onPointerLeave={(e) => { if (e.pointerType === "mouse") saleSoon(); }}
        onFocus={(e) => { if (e.currentTarget.matches(":focus-visible")) setTeclado(true); }}
        onBlur={() => setTeclado(false)}
      >
        ⚠ {n}
      </button>
      {abierto && pos && createPortal(
        <div
          ref={panelRef}
          id={id}
          role="dialog"
          aria-label={rotulo}
          className="avisos-de-ruta-panel"
          style={{ left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxHeight }}
          onPointerEnter={(e) => { if (e.pointerType === "mouse") { cancelaSalida(); setRaton(true); } }}
          onPointerLeave={(e) => { if (e.pointerType === "mouse") saleSoon(); }}
          onClick={(e) => e.stopPropagation()}
        >
          <ListaDeAvisos avisos={avisos} />
        </div>,
        document.body,
      )}
    </span>
  );
}
