"use client";

import { useEffect, useState } from "react";
import { enAppDeEscritorio } from "@/lib/desktop-shell";

/**
 * El botón ⟳ de recargar, **solo dentro de una app de escritorio** (D-NEXT).
 *
 * Vive en la web, no en las cáscaras: así lo tienen las dos sin reinstalar nada, y la de Time Tracker
 * —que no tiene menú ni atajos— deja de estar sin salida cuando una pantalla se queda a medias.
 *
 * En un navegador no sale: ahí ya está la recarga del propio navegador, y un botón de más en la barra
 * le quita sitio a las pestañas. La comprobación es tras montar, porque `window` no existe al pintar en
 * el servidor.
 */
export function BotonRecargar({ titulo, className = "tab tab-icon" }: { titulo: string; className?: string }) {
  const [enEscritorio, setEnEscritorio] = useState(false);
  useEffect(() => { setEnEscritorio(enAppDeEscritorio(window)); }, []);

  if (!enEscritorio) return null;

  return (
    <button
      type="button"
      className={className}
      onClick={() => window.location.reload()}
      title={titulo}
      aria-label={titulo}
    >
      ⟳
    </button>
  );
}
