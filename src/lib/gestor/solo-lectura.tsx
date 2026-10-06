"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * «Ruta de hoy» = el Gestor de Rutas en SOLO LECTURA (D-NEXT, b). El dueño, 2026-10-06 (dictado, literal): «today srotue is
 * an exact duplicate of routes manager but without any actionable buttom or action».
 *
 * `/map` monta la MISMA página que `/routes` dentro de `<SoloLectura>`. Va por contexto, no por prop: Next no deja que una
 * página declare props propias ni exporte nada más que su componente.
 */
const Contexto = createContext(false);

export function SoloLectura({ children }: { children: ReactNode }) {
  return <Contexto.Provider value={true}>{children}</Contexto.Provider>;
}

export const useSoloLectura = (): boolean => useContext(Contexto);
