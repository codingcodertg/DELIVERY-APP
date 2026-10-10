"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * «🗺 El mapa de mi ruta» (D-506) monta la MISMA página del Gestor de Rutas (`routes/page.tsx`) dentro de `<SoloLectura>`
 * —sin ninguna acción, D-481— y de `<SoloMisRutas chofer={…}>`, que la acota a las rutas de ese chofer.
 *
 * Va por contexto y no por prop por lo mismo que `<SoloLectura>` (D-481) y `<RutaDeUnChofer>` (D-502): Next no deja que una
 * página declare props propias ni exporte nada más que su componente.
 *
 * El valor es `null` cuando NO se acota —el Gestor del gerente y «Ruta de hoy», que ven a todos— y el nombre del chofer
 * cuando sí. Un nombre vacío («») acota a NADA, no a todas: el defecto peligroso sería el otro, porque una persona sin
 * nombre acabaría viendo la flota entera. Por eso el valor de partida del contexto es `null` y el provider nunca lo
 * devuelve: montado, siempre acota.
 */
const Contexto = createContext<string | null>(null);

export function SoloMisRutas({ chofer, children }: { chofer: string | null | undefined; children?: ReactNode }) {
  return <Contexto.Provider value={chofer ?? ""}>{children}</Contexto.Provider>;
}

/** El chofer al que está acotada la pantalla, o `null` si no está acotada. */
export const useSoloMisRutas = (): string | null => useContext(Contexto);
