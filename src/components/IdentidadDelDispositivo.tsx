"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { idDelDispositivo } from "@/lib/security/identidad";
import { LATIDO_DISPOSITIVO_MS, tocaAvisar } from "@/lib/security/latido-dispositivo";

/** Cada cuánto se vuelve a decir «sigo aquí»: 5 min (D-1004, Disk IO; antes 2 min, D-942). Al cambiar de ruta se
 *  reavisa solo si pasó 1 min desde el último, para que el módulo en vivo siga a la persona sin un UPDATE por clic. */
let ultimoAviso: number | null = null;

/**
 * La huella del dispositivo (D-811): asegura el id (cookie + localStorage) y avisa a `/api/security/seen` al cargar y
 * cada cinco minutos. No pinta nada y no bloquea nada: lo que bloquea es el middleware con `security_gate`. En las
 * pantallas sin sesión (login, el enlace del cliente) la ruta contesta 401 y aquí se ignora. En modo demo
 * (`NEXT_PUBLIC_LOCAL_MODE`) no hay servidor que lo reciba: no se avisa, y así la consola queda limpia para grabar.
 */
const LOCAL_MODE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";

export function IdentidadDelDispositivo() {
  const pathname = usePathname();
  const sinSesion = LOCAL_MODE || !pathname || pathname.startsWith("/login") || pathname.startsWith("/track/") || pathname.startsWith("/unsubscribe/") || pathname.startsWith("/reset-password") || pathname.startsWith("/auth");
  useEffect(() => {
    if (sinSesion) return;
    const id = idDelDispositivo(typeof window === "undefined" ? null : window);
    if (!id) return;
    const avisa = (porRuta: boolean) => {
      const ahora = Date.now();
      if (!tocaAvisar(ultimoAviso, ahora, porRuta)) return;
      ultimoAviso = ahora;
      void fetch("/api/security/seen", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // El id y el tipo los lee el servidor de la petición (cabecera de la app, o cookie + agente). El cuerpo solo
        // lleva la RUTA actual (D-942), para el «en vivo por módulo» de Seguridad; sin la migración 278 el servidor la
        // ignora sin romper nada.
        body: JSON.stringify({ route: pathname }),
        keepalive: true,
      }).catch(() => undefined);
    };
    avisa(true);
    const t = setInterval(() => avisa(false), LATIDO_DISPOSITIVO_MS);
    return () => clearInterval(t);
  }, [sinSesion, pathname]);
  return null;
}
