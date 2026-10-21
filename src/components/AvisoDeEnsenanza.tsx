"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { usePrefs } from "@/lib/prefs";
import { EVENTO_ENSENANZA, escribeEnsenanza, igualaCookieDeEnsenanza, leeEnsenanza } from "@/lib/boton-general";
import { CABECERA_DE_CORTE, avisoGeneralEnLaRuta } from "@/lib/ensenanza-general";
import { mensajeDeLoQueNoSePractica } from "@/lib/practica/mensajes";
import { EVENTO_PRACTICA_AVISO } from "@/lib/practica/fetch-de-practica";

/**
 * El aviso morado del modo enseñanza en las apps que no tienen el suyo (D-626): el hub, el Inventario, RR. HH.,
 * Clientes, Leads, Encuestas, Promociones y el Estimador. Entregas lo lleva en su barra (con «Reiniciar práctica») y
 * Time Tracker el de capacitación.
 *
 * Desde D-628 se practica de verdad: lo que se cambia se ve guardado (`practica/fetch-de-practica.ts`) y al salir todo
 * vuelve a como estaba. Lo poco que no se puede practicar avisa aquí, en cualquier app, para que nunca parezca que
 * «no pasa nada».
 *
 * Lo ve cualquiera que lo tenga encendido, no solo el admin: así nadie se queda atrapado en un modo que no puede apagar.
 */
export function AvisoDeEnsenanza() {
  const { t, lang } = usePrefs();
  const pathname = usePathname();
  const [encendido, setEncendido] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const idioma = useRef(lang);
  idioma.current = lang;

  useEffect(() => {
    const mira = () => setEncendido(leeEnsenanza(typeof localStorage === "undefined" ? null : localStorage));
    mira();
    let reloj: ReturnType<typeof setTimeout> | undefined;
    const avisa = (e: Event) => {
      setMensaje(String((e as CustomEvent<string>).detail ?? ""));
      clearTimeout(reloj);
      reloj = setTimeout(() => setMensaje(null), 8000);
    };
    window.addEventListener(EVENTO_ENSENANZA, mira);
    window.addEventListener(EVENTO_PRACTICA_AVISO, avisa);
    // Lo que corta el middleware (un correo, una llamada…) vuelve con su cabecera: se avisa igual que lo demás.
    const fetchOriginal = window.fetch;
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const r = await fetchOriginal(...args);
      if (r.headers.get(CABECERA_DE_CORTE) === "cortado") {
        window.dispatchEvent(new CustomEvent(EVENTO_PRACTICA_AVISO, { detail: mensajeDeLoQueNoSePractica(idioma.current) }));
      }
      return r;
    };
    return () => {
      window.fetch = fetchOriginal;
      clearTimeout(reloj);
      window.removeEventListener(EVENTO_ENSENANZA, mira);
      window.removeEventListener(EVENTO_PRACTICA_AVISO, avisa);
    };
  }, []);

  // La cookie que lee el corte sigue a la bandera, en cualquier app en la que se entre.
  useEffect(() => {
    try { igualaCookieDeEnsenanza(localStorage, document, lang); } catch { /* sin almacenamiento */ }
  }, [encendido, lang]);

  const salir = () => {
    escribeEnsenanza(localStorage, false, { doc: document, idioma: lang });
    window.dispatchEvent(new CustomEvent(EVENTO_ENSENANZA));
    // Lo que la pantalla tiene en memoria es de la práctica: se recarga para ver lo real.
    window.location.reload();
  };

  const conAviso = encendido && avisoGeneralEnLaRuta(pathname);
  return (
    <>
      {conAviso && (
        <div className="aviso-ensenanza no-print" role="status" data-aviso-ensenanza>
          <span>
            🎓 {t("TEACHING MODE — practice freely: what you change shows as saved, and when you exit everything goes back to how it was.",
                  "MODO ENSEÑANZA — practica con libertad: lo que cambies se ve guardado, y al salir todo vuelve a como estaba.")}
          </span>
          <button type="button" onClick={salir}>{t("Exit", "Salir")}</button>
        </div>
      )}
      {encendido && mensaje && (
        <div className="aviso-practica no-print" role="alert" data-aviso-practica onClick={() => setMensaje(null)}>
          🎓 {mensaje}
        </div>
      )}
    </>
  );
}
