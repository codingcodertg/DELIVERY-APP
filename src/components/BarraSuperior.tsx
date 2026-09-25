"use client";

import { createRef, useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { anchoDelRelleno, hayQueMostrarBarra, scrollQueToca } from "@/lib/barra-superior";

/**
 * Una ref de caja por clave, para las tablas que se pintan dentro de un `.map` (las paradas de cada chofer en
 * el Gestor de Rutas): ahí no se puede llamar a `useRef` por fila. Devuelve siempre la MISMA ref para la misma
 * clave, que es lo que necesita `BarraSuperior` para no volver a engancharse en cada pintado.
 */
export function useCajasPorClave() {
  const mapa = useRef(new Map<string, RefObject<HTMLDivElement | null>>());
  return useCallback((clave: string) => {
    let r = mapa.current.get(clave);
    if (!r) { r = createRef<HTMLDivElement>(); mapa.current.set(clave, r); }
    return r;
  }, []);
}

/**
 * La barra de desplazamiento horizontal que va ENCIMA de la cabecera de una tabla (D-NEXT).
 *
 * Se pone justo antes de la caja (`<div className="tbl-scroll … tbl-caja" ref={caja}>`) y mueve esa caja a lo
 * ancho; la barra de abajo de la caja sigue ahí y las dos se siguen en los dos sentidos. Solo existe cuando la
 * tabla es más ancha que la caja: si todo cabe, no se pinta nada.
 *
 * La lógica —cuándo se ve, cuánto mide el relleno, a dónde llevar la otra— está en `lib/barra-superior.ts`,
 * que es lo que prueban las pruebas; esto solo la conecta al DOM.
 */
export function BarraSuperior({ caja }: { caja: RefObject<HTMLDivElement | null> }) {
  const barra = useRef<HTMLDivElement>(null);
  const [medida, setMedida] = useState<{ ve: boolean; relleno: number }>({ ve: false, relleno: 0 });

  // Medir: la caja cambia de ancho con la ventana, y la tabla con las columnas (se arrastran, se esconden).
  useEffect(() => {
    const c = caja.current;
    if (!c) return;
    const mide = () => {
      const ve = hayQueMostrarBarra(c.scrollWidth, c.clientWidth);
      const anchoBarra = barra.current?.clientWidth ?? c.clientWidth;
      const relleno = anchoDelRelleno(anchoBarra, c);
      setMedida((m) => (m.ve === ve && m.relleno === relleno ? m : { ve, relleno }));
    };
    mide();
    const ro = new ResizeObserver(mide);
    ro.observe(c);
    if (c.firstElementChild) ro.observe(c.firstElementChild);
    return () => ro.disconnect();
  }, [caja, medida.ve]);

  // Sincronizar en los dos sentidos. `scrollQueToca` devuelve null cuando ya coinciden: eso corta el eco.
  useEffect(() => {
    const c = caja.current, b = barra.current;
    if (!c || !b || !medida.ve) return;
    const sigue = (origen: HTMLElement, destino: HTMLElement) => () => {
      const x = scrollQueToca(origen, destino);
      if (x !== null) destino.scrollLeft = x;
    };
    const deLaCaja = sigue(c, b), deLaBarra = sigue(b, c);
    deLaCaja(); // al aparecer, la barra arranca donde está la caja
    c.addEventListener("scroll", deLaCaja, { passive: true });
    b.addEventListener("scroll", deLaBarra, { passive: true });
    return () => {
      c.removeEventListener("scroll", deLaCaja);
      b.removeEventListener("scroll", deLaBarra);
    };
  }, [caja, medida.ve, medida.relleno]);

  if (!medida.ve) return null;
  return (
    <div ref={barra} className="tbl-barra-superior no-print" data-barra-superior aria-hidden>
      <div style={{ width: medida.relleno, height: 1 }} />
    </div>
  );
}
