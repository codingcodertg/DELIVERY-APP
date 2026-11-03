"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { idDelDispositivo } from "@/lib/security/identidad";

/** Cada cuánto se vuelve a decir «sigo aquí», con la pestaña abierta. */
const CADA_MS = 10 * 60 * 1000;

/**
 * La huella del dispositivo (D-811): asegura el id (cookie + localStorage) y avisa a `/api/security/seen` al cargar y
 * cada diez minutos. No pinta nada y no bloquea nada: lo que bloquea es el middleware con `security_gate`. En las
 * pantallas sin sesión (login, el enlace del cliente) la ruta contesta 401 y aquí se ignora.
 */
export function IdentidadDelDispositivo() {
  const pathname = usePathname();
  const sinSesion = !pathname || pathname.startsWith("/login") || pathname.startsWith("/track/") || pathname.startsWith("/unsubscribe/") || pathname.startsWith("/reset-password") || pathname.startsWith("/auth");
  useEffect(() => {
    if (sinSesion) return;
    const id = idDelDispositivo(typeof window === "undefined" ? null : window);
    if (!id) return;
    const avisa = () => {
      void fetch("/api/security/seen", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // El id y el tipo los lee el servidor de la petición (cabecera de la app, o cookie + agente); el cuerpo va vacío.
        body: "{}",
        keepalive: true,
      }).catch(() => undefined);
    };
    avisa();
    const t = setInterval(avisa, CADA_MS);
    return () => clearInterval(t);
  }, [sinSesion]);
  return null;
}
