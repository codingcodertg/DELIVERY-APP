"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * El mapa del Gestor de Rutas, SOLO el mapa, para ponerlo dentro de otra pantalla (D-514).
 *
 * El dueño lo pidió tres veces para la vista del chofer —*«quiero que el chofer mire el mapa con sus rutas asi como el
 * logistic manager ese mismo mapa»*— y D-506 lo resolvió mal: dejó el mapa propio de «Mi ruta» donde estaba y puso el del
 * Gestor en OTRA página, detrás de un botón. Él siguió viendo el de siempre: *«MIRA EL MAPA SIGUE IGUAL»*.
 *
 * Esto deja montar la página del Gestor (`routes/page.tsx`) y quedarse con su tarjeta del mapa nada más: el MISMO código,
 * no una copia —la línea medida de cada ruta, la vuelta a la base en punteado, el color del chofer, las casitas de las
 * tiendas, el camión en vivo y la leyenda—. Se monta dentro de `<SoloMisRutas>` (acota al chofer, y por tanto es de solo
 * lectura) igual que «🗺 El mapa de mi ruta».
 *
 * Va por contexto y no por prop por lo mismo que `<SoloLectura>` (D-481) y `<SoloMisRutas>` (D-506): Next no deja que una
 * página declare props propias.
 *
 * - `dia`: el día del mapa. El Gestor tiene su propio selector, pero aquí no se pinta: manda el «Ayer/Hoy/Mañana» de la
 *   pantalla que lo monta.
 * - `alto`: el del mapa, en píxeles. En el teléfono del chofer, 430 se come la pantalla.
 * - `alPulsarParada`: qué hacer al tocar una parada. En el Gestor, tocarla la marca; en «Mi ruta», abre la orden.
 */
export interface ModoSoloElMapa {
  dia: string;
  alto?: number;
  alPulsarParada?: (id: string) => void;
}

const Contexto = createContext<ModoSoloElMapa | null>(null);

export function SoloElMapa({ children, ...modo }: ModoSoloElMapa & { children?: ReactNode }) {
  return <Contexto.Provider value={modo}>{children}</Contexto.Provider>;
}

/** El modo «solo el mapa», o `null` si la página del Gestor se pinta entera. */
export const useSoloElMapa = (): ModoSoloElMapa | null => useContext(Contexto);
