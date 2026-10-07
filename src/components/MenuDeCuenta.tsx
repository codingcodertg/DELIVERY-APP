"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePrefs } from "@/lib/prefs";
import { RUTA_PERSONALIZAR } from "@/lib/personalizar";
import { avatarColor, initials } from "@/lib/utils";

/**
 * El menú que se abre al tocar tu nombre en la barra (D-274 lo hizo para Entregas; D-490 lo saca
 * aquí para que Time Tracker y RR. HH. usen EL MISMO, no una copia).
 *
 * Esto es solo el armazón: el botón con la inicial y el nombre, la capa que lo cierra al pulsar fuera,
 * el volteo cuando no cabe a la izquierda, y el cierre al navegar. **Qué opciones salen lo decide cada
 * app** (`lib/account-menu.ts`) y se pintan dentro con `children(cerrar)`. Las opciones que son iguales
 * en todas —Personalizar y Cerrar sesión— están abajo, una vez.
 */
export function MenuDeCuenta({
  nombre,
  foto = null,
  children,
  minWidth = 210,
}: {
  nombre: string;
  /** La foto de la persona, si la app la tiene (RR. HH.). Sin foto, la inicial sobre su color. */
  foto?: string | null;
  children: (cerrar: () => void) => React.ReactNode;
  minWidth?: number;
}) {
  const pathname = usePathname();
  const [abierto, setAbierto] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [volteado, setVolteado] = useState(false);
  // El menú cuelga del borde DERECHO del botón y crece hacia la izquierda; con el nombre cerca del
  // borde izquierdo (una fila de pestañas partida, un teléfono) se saldría de la ventana. Se mide al
  // abrir y, si no cabe, crece hacia la derecha.
  useEffect(() => {
    if (!abierto) { setVolteado(false); return; }
    const el = menuRef.current;
    if (!el) return;
    if (el.getBoundingClientRect().left < 8) setVolteado(true);
  }, [abierto]);
  // Navegar cierra el menú (atrás y adelante incluidos).
  useEffect(() => { setAbierto(false); }, [pathname]);
  const cerrar = () => setAbierto(false);

  return (
    <div style={{ position: "relative" }} data-menu-de-cuenta>
      <button
        type="button"
        className={"account-link" + (abierto ? " active" : "")}
        onClick={() => setAbierto((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={abierto}
        style={{ fontSize: 12, opacity: 0.95, display: "inline-flex", alignItems: "center", gap: 6,
          padding: "4px 8px", borderRadius: 8, color: "inherit" }}
      >
        {foto ? (
          <span className="avatar sm" style={{ backgroundImage: `url(${foto})` }} />
        ) : (
          <span className="avatar sm" style={{ background: avatarColor(nombre || "?") }}>
            {initials(nombre || "?")}
          </span>
        )}
        {nombre} <span aria-hidden>▾</span>
      </button>
      {abierto && (
        <>
          {/* Pulsar en cualquier otro sitio lo cierra. */}
          <div style={{ position: "fixed", inset: 0, zIndex: 70 }} onClick={cerrar} />
          <div
            ref={menuRef}
            className="col-menu"
            style={{ zIndex: 71, minWidth, ...(volteado ? { left: 0, right: "auto" } : { right: 0, left: "auto" }) }}
            role="menu"
          >
            {children(cerrar)}
          </div>
        </>
      )}
    </div>
  );
}

/** «Personalizar»: idioma y tema de todas las apps, en el hub (D-490). */
export function OpcionPersonalizar({ alPulsar }: { alPulsar: () => void }) {
  const { t } = usePrefs();
  return (
    <Link href={RUTA_PERSONALIZAR} role="menuitem" className="col-opt" style={{ textDecoration: "none" }} onClick={alPulsar}>
      🎨 {t("Customize", "Personalizar")}
    </Link>
  );
}

/**
 * «Cerrar sesión»: el ÚNICO formulario de salida de las barras de Entregas, Time Tracker y RR. HH.
 * Cierra este equipo, no la cuenta en todos (D-264).
 */
export function OpcionSalir() {
  const { t } = usePrefs();
  return (
    <form action="/auth/signout" method="post">
      <button className="col-opt" type="submit" style={{ width: "100%", textAlign: "left" }} role="menuitem">
        {t("Sign out", "Cerrar sesión")}
      </button>
    </form>
  );
}
