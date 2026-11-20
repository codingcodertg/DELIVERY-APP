"use client";
/**
 * Título de tarjeta que la pliega y despliega (junta con el dueño, 2026-11-20: «if possible, make everything
 * collapsible»). Va en lugar del <h2> de una `.card`: al tocarlo, la tarjeta esconde todo menos el título.
 */
import { useRef, useState, type ReactNode } from "react";
import { usePrefs } from "@/lib/prefs";

export function TituloPlegable({ children }: { children: ReactNode }) {
  const { t } = usePrefs();
  const ref = useRef<HTMLHeadingElement>(null);
  const [plegada, setPlegada] = useState(false);
  const cambiar = () => {
    const n = !plegada;
    setPlegada(n);
    ref.current?.closest(".card")?.classList.toggle("tarjeta-plegada", n);
  };
  return (
    <h2 ref={ref} className="titulo-plegable">
      <button type="button" className="titulo-plegable-boton" onClick={cambiar} aria-expanded={!plegada}
        title={plegada ? t("Show", "Mostrar") : t("Hide", "Ocultar")} data-plegable={plegada ? "plegada" : "abierta"}>
        <span>{children}</span>
        <span aria-hidden className="titulo-plegable-flecha">{plegada ? "▸" : "▾"}</span>
      </button>
    </h2>
  );
}
