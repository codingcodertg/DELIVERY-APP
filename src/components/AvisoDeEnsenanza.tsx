"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { usePrefs } from "@/lib/prefs";
import { EVENTO_ENSENANZA, escribeEnsenanza, igualaCookieDeEnsenanza, leeEnsenanza } from "@/lib/boton-general";
import { avisoGeneralEnLaRuta } from "@/lib/ensenanza-general";

/**
 * El aviso morado del modo enseñanza en las apps que no tienen el suyo (D-626): el hub, el Inventario, RR. HH.,
 * Clientes, Leads, Encuestas, Promociones y el Estimador. Entregas lo lleva en su barra (con «Reiniciar práctica») y
 * Time Tracker el de capacitación. Mientras se vea, ningún cambio se guarda (`ensenanza-general.ts`).
 *
 * Lo ve cualquiera que lo tenga encendido, no solo el admin: así nadie se queda atrapado en un modo que no puede apagar.
 */
export function AvisoDeEnsenanza() {
  const { t, lang } = usePrefs();
  const pathname = usePathname();
  const [encendido, setEncendido] = useState(false);

  useEffect(() => {
    const mira = () => setEncendido(leeEnsenanza(typeof localStorage === "undefined" ? null : localStorage));
    mira();
    window.addEventListener(EVENTO_ENSENANZA, mira);
    return () => window.removeEventListener(EVENTO_ENSENANZA, mira);
  }, []);

  // La cookie que lee el corte sigue a la bandera, en cualquier app en la que se entre.
  useEffect(() => {
    try { igualaCookieDeEnsenanza(localStorage, document, lang); } catch { /* sin almacenamiento */ }
  }, [encendido, lang]);

  if (!encendido || !avisoGeneralEnLaRuta(pathname)) return null;

  const salir = () => {
    escribeEnsenanza(localStorage, false, { doc: document, idioma: lang });
    window.dispatchEvent(new CustomEvent(EVENTO_ENSENANZA));
  };

  return (
    <div className="aviso-ensenanza no-print" role="status" data-aviso-ensenanza>
      <span>
        🎓 {t("TEACHING MODE — look around and practice: nothing you change is saved.",
              "MODO ENSEÑANZA — mira y practica: nada de lo que cambies se guarda.")}
      </span>
      <button type="button" onClick={salir}>{t("Exit", "Salir")}</button>
    </div>
  );
}
