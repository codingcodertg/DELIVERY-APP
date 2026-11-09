"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { idDelDispositivo } from "@/lib/security/identidad";

/** Cada cuánto se vuelve a decir «sigo aquí», con la pestaña abierta. Dos minutos (D-942): lo bastante fresco para
 *  que Seguridad vea quién está en vivo y en qué módulo, sin cargar la base con un latido por segundo. Además se
 *  reavisa al cambiar de ruta, para que el módulo en vivo refleje dónde está la persona ahora. */
const CADA_MS = 2 * 60 * 1000;

/**
 * La huella del dispositivo (D-811): asegura el id (cookie + localStorage) y avisa a `/api/security/seen` al cargar y
 * cada diez minutos. No pinta nada y no bloquea nada: lo que bloquea es el middleware con `security_gate`. En las
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
    const avisa = () => {
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
    avisa();
    const t = setInterval(avisa, CADA_MS);
    return () => clearInterval(t);
  }, [sinSesion, pathname]);
  return null;
}
