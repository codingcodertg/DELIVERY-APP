"use client";

import { usePrefs } from "@/lib/prefs";
import type { IdiomaDeVariante } from "@/lib/recruiting/plantillas-de-documentos";

/**
 * El interruptor de idioma de un documento de ingreso: «English | Español». Sale solo cuando la variante tiene su
 * traducción (ver `parejaDeIdioma`); cambia entre los dos archivos sin salir de donde se está.
 */
export function InterruptorDeIdioma({ idioma, onCambia, disabled, de }: {
  idioma: IdiomaDeVariante;
  onCambia: (idioma: IdiomaDeVariante) => void;
  disabled?: boolean;
  /** A qué pertenece (id del documento o de la variante), para encontrarlo en pantalla. */
  de?: string;
}) {
  const { t } = usePrefs();
  return (
    <div className="docs-idioma" role="group" aria-label={t("Document language", "Idioma del documento")} data-idioma-de={de} data-idioma={idioma}>
      {(["en", "es"] as const).map((i) => (
        <button key={i} type="button" className={"docs-idioma-op" + (i === idioma ? " on" : "")} aria-pressed={i === idioma}
          disabled={disabled} data-idioma-op={i} onClick={() => { if (i !== idioma) onCambia(i); }}>
          {i === "en" ? "English" : "Español"}
        </button>
      ))}
    </div>
  );
}
