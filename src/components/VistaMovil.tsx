"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { usePrefs } from "@/lib/prefs";
import { TAMANOS_MOVIL, enlaceAVistaMovil, rutaParaElMarco } from "@/lib/mobile-preview";

/**
 * La app dentro de un marco con ancho de teléfono, para probar en el PC cómo se ve en móvil (D-NEXT).
 *
 * Es la app de verdad, con su CSS móvil: el marco tiene viewport propio y ahí sí corren las media
 * queries. Por lo mismo es **una segunda app abierta**, y lo que eso arrastra está en la decisión: otra
 * carga de datos y otros canales en vivo mientras está abierta, «ver como» e idioma compartidos con la
 * pestaña de fuera, y los avisos de versión y las notificaciones push por duplicado.
 */
export function VistaMovil({ rutaInicial, anchoInicial }: { rutaInicial: string; anchoInicial: number }) {
  const { t } = usePrefs();
  const router = useRouter();
  const marco = useRef<HTMLIFrameElement>(null);
  const [ruta, setRuta] = useState(rutaInicial);
  const [campo, setCampo] = useState(rutaInicial);
  const [ancho, setAncho] = useState(anchoInicial);
  // Cambia al recargar a mano: una `key` nueva monta el marco otra vez en la ruta elegida.
  const [vuelta, setVuelta] = useState(0);
  const tamano = TAMANOS_MOVIL.find((x) => x.ancho === ancho) ?? TAMANOS_MOVIL[1];

  const ir = (nuevaRuta: string, nuevoAncho = ancho) => {
    const segura = rutaParaElMarco(nuevaRuta);
    setRuta(segura);
    setCampo(segura);
    setAncho(nuevoAncho);
    setVuelta((v) => v + 1);
    // En la URL, no en localStorage: recargar o guardar el enlace conserva ruta y tamaño.
    router.replace(enlaceAVistaMovil(segura, nuevoAncho));
  };

  // Lo que se navega DENTRO del marco se refleja en el campo. Mismo origen, así que se puede leer; si el
  // navegador no deja, el campo se queda como estaba.
  const alCargar = () => {
    try {
      const loc = marco.current?.contentWindow?.location;
      if (loc) setCampo(loc.pathname + loc.search);
    } catch { /* sin acceso: no pasa nada */ }
  };

  return (
    <>
      <div className="page-head">
        <h2>📱 {t("Mobile view", "Vista móvil")}</h2>
        <Link href="/home" className="btn btn-ghost btn-sm">{t("Back to hub", "Volver al hub")}</Link>
      </div>

      <div className="card">
        <form
          className="vista-movil-barra"
          onSubmit={(e) => { e.preventDefault(); ir(campo); }}
        >
          <input
            value={campo}
            onChange={(e) => setCampo(e.target.value)}
            aria-label={t("Route to open", "Ruta que se abre")}
            placeholder="/"
            spellCheck={false}
          />
          <button type="submit" className="btn btn-primary btn-sm">{t("Open", "Abrir")}</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => ir(campo)}>⟳ {t("Reload", "Recargar")}</button>
        </form>
        <div className="toggle-group vista-movil-tamanos" role="group" aria-label={t("Phone size", "Tamaño del teléfono")}>
          {TAMANOS_MOVIL.map((x) => (
            <button
              key={x.ancho}
              type="button"
              className={"toggle-btn " + (x.ancho === ancho ? "on" : "")}
              aria-pressed={x.ancho === ancho}
              onClick={() => ir(campo, x.ancho)}
            >
              {x.ancho} × {x.alto}
            </button>
          ))}
        </div>
        <p className="hint" style={{ marginBottom: 0 }}>
          {t(
            "This is a second copy of the app: it loads its own data, and changing «View as» or the language inside it also changes this tab when it reloads.",
            "Es una segunda copia de la app: carga sus propios datos, y cambiar «Ver como» o el idioma dentro también lo cambia en esta pestaña al recargar.",
          )}
        </p>
      </div>

      <div className="vista-movil-escenario">
        <iframe
          key={vuelta}
          ref={marco}
          src={ruta}
          title={t("App at phone size", "La app en tamaño de teléfono")}
          width={tamano.ancho}
          height={tamano.alto}
          className="vista-movil-marco"
          onLoad={alCargar}
        />
      </div>
    </>
  );
}
