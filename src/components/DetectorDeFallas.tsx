"use client";

import { useEffect } from "react";
import { informarFalla, vaciarAlSalir } from "@/lib/fallas/cliente";

/**
 * El detector de fallas de la app (2026-11-25). Se monta UNA vez, en el layout raíz: escucha los errores no capturados
 * (`error`) y las promesas rechazadas sin manejar (`unhandledrejection`), y los informa a /api/fallas. No pinta nada.
 * Al ocultarse la página, manda lo que quede en cola.
 */
export function DetectorDeFallas() {
  useEffect(() => {
    const alError = (ev: ErrorEvent) => {
      // Los errores de carga de recursos (imágenes, hojas) no pasan por aquí: no son fallas de código.
      if (!ev.error && !ev.message) return;
      informarFalla(ev.error ?? ev.message, { origen: "cliente" });
    };
    const alRechazo = (ev: PromiseRejectionEvent) => {
      informarFalla(ev.reason ?? "Promesa rechazada sin motivo", { origen: "cliente", componente: "promesa" });
    };
    const alOcultarse = () => {
      if (document.visibilityState === "hidden") vaciarAlSalir();
    };
    window.addEventListener("error", alError);
    window.addEventListener("unhandledrejection", alRechazo);
    document.addEventListener("visibilitychange", alOcultarse);
    return () => {
      window.removeEventListener("error", alError);
      window.removeEventListener("unhandledrejection", alRechazo);
      document.removeEventListener("visibilitychange", alOcultarse);
    };
  }, []);
  return null;
}
