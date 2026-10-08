"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { ChoferVisto } from "./vista-de-chofer";

/**
 * «Mi ruta» de OTRO chofer (D-NEXT): la pestaña «Chofer» del admin monta la MISMA página de `/my-route` dentro de
 * `<RutaDeUnChofer chofer={…}>`, y la página pinta la ruta de ese chofer en vez de la de quien está en la sesión.
 *
 * Va por contexto, no por prop, por lo mismo que `<SoloLectura>` del Gestor (D-481): Next no deja que una página declare
 * props propias ni exporte nada más que su componente. Sin este contexto —el chofer en su teléfono— no cambia nada.
 */
const Contexto = createContext<ChoferVisto | null>(null);

export function RutaDeUnChofer({ chofer, children }: { chofer: ChoferVisto; children?: ReactNode }) {
  return <Contexto.Provider value={chofer}>{children}</Contexto.Provider>;
}

/** El chofer cuya ruta se está mirando desde fuera, o `null` si es la propia. */
export const useChoferDeLaRuta = (): ChoferVisto | null => useContext(Contexto);
