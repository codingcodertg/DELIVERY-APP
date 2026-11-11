"use client";

import Link from "next/link";
import { usePrefs } from "@/lib/prefs";

/**
 * La CASITA que vuelve al inicio del hub, para las páginas del hub que no llevan la barra de las apps (Directorio,
 * Ayuda, Perfil, Mapa, Usuarios…). El dueño, 2026-11-11: «volver al inicio cámbialo por la casita y haz eso throughout
 * el app… porque eso es lo standard en el app». La barra de cada app ya tiene la suya (`HubHomeLink`, clase
 * `tab-casa`); esta es la misma casa para fuera de la barra, con su propia clase (`boton-casa`) para no tocar la barra.
 */
export function BotonCasa({ className = "" }: { className?: string }) {
  const { t } = usePrefs();
  return (
    <Link href="/home" className={`boton-casa${className ? ` ${className}` : ""}`} aria-label={t("Home", "Inicio")} title={t("Home", "Inicio")} data-boton-casa>
      🏠
    </Link>
  );
}
