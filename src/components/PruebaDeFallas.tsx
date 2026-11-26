"use client";

import { useEffect } from "react";

const LOCAL_MODE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";

/**
 * Disparador de prueba para el demo: en `/home?probar_falla=1` lanza un error a propósito, para ver cómo queda en la
 * pantalla «Fallas de la app». Solo existe en el demo (`NEXT_PUBLIC_LOCAL_MODE`): fuera de él no hace nada. En el demo
 * la persona es la del admin inventado, así que es el admin el que lo usa.
 */
export function PruebaDeFallas() {
  useEffect(() => {
    if (!LOCAL_MODE) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("probar_falla") !== "1" || window.location.pathname !== "/home") return;
    // Fuera del ciclo de React: llega a `window` como un error no capturado, igual que uno de verdad.
    const id = window.setTimeout(() => {
      throw new Error("Falla de prueba del demo (?probar_falla=1)");
    }, 0);
    return () => window.clearTimeout(id);
  }, []);
  return null;
}
