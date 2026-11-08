"use client";

import { usePrefs } from "@/lib/prefs";
import { AVISO_DEMO } from "@/lib/recruiting/modo-demo";

/**
 * Lo que se pinta en el demo donde la pantalla de verdad necesita el servidor (D-NEXT): Empleados, Activos y lo que
 * crea cuentas del hub. Una tarjeta, no una pantalla vacía: en un tutorial se tiene que ver que es a propósito.
 */
export function AvisoDeDemo({ titulo }: { titulo?: string }) {
  const { lang } = usePrefs();
  return (
    <div className="card" data-aviso="demo">
      {titulo && <h2>{titulo}</h2>}
      <div className="hint" style={{ marginTop: 0 }}>{lang === "es" ? AVISO_DEMO.es : AVISO_DEMO.en}</div>
    </div>
  );
}
