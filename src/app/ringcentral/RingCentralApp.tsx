"use client";

import { useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { Llamadas } from "./Llamadas";
import { Choferes } from "./Choferes";

type Pestana = "llamadas" | "choferes";

/**
 * La app «RingCentral»: dos pestañas. «Llamadas» enseña las llamadas (entrantes y salientes) de las extensiones de
 * chofer, con su grabación. «Choferes» marca qué extensiones de RingCentral son choferes. Solo para el admin (lo cuida
 * el layout y la API).
 */
export function RingCentralApp() {
  const { t } = usePrefs();
  const [pestana, setPestana] = useState<Pestana>("llamadas");
  const opciones: { clave: Pestana; texto: string }[] = [
    { clave: "llamadas", texto: t("Calls", "Llamadas") },
    { clave: "choferes", texto: t("Drivers (extensions)", "Choferes (extensiones)") },
  ];

  return (
    <main className="rcc">
      <h1 className="rcc-titulo">📞 {t("RingCentral · drivers", "RingCentral · choferes")}</h1>
      <div className="rcc-pestanas" role="tablist" aria-label={t("Sections", "Secciones")}>
        {opciones.map((o) => (
          <button
            key={o.clave}
            type="button"
            role="tab"
            aria-selected={pestana === o.clave}
            data-pestana={o.clave}
            className={`rcc-pestana${pestana === o.clave ? " rcc-pestana-activa" : ""}`}
            onClick={() => setPestana(o.clave)}
          >
            {o.texto}
          </button>
        ))}
      </div>
      {pestana === "llamadas" ? <Llamadas /> : <Choferes />}
    </main>
  );
}
