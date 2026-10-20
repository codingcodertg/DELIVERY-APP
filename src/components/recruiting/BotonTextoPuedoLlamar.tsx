"use client";

import { useState } from "react";
import { useData } from "@/lib/recruiting-data-provider";
import { usePrefs } from "@/lib/prefs";
import { abrirSmsEnRingCentral, avisoTrasAbrir, navegadorReal } from "@/lib/recruiting/abrir-sms";
import { contactoDelEnvio, estadoDelBoton, prepararTextoPuedoLlamar } from "@/lib/recruiting/texto-puedo-llamar";
import type { Candidate } from "@/lib/recruiting/types";

/** «📱 Texto: ¿te puedo llamar?» — manda el texto por el mismo camino que el diálogo de entrevista
 * (enlace a RingCentral + contacto SMS) sin abrir el diálogo, y pasa a «SMS enviado ✓ hh:mm» (D-581). */
export function BotonTextoPuedoLlamar({ c, className = "btn btn-ghost btn-sm" }: { c: Candidate; className?: string }) {
  const { contactsFor, addContact, notify, me } = useData();
  const { t, lang } = usePrefs();
  const [error, setError] = useState<string | null>(null);
  const estado = estadoDelBoton(contactsFor(c.id), c.id, lang);

  const enviar = async () => {
    const r = prepararTextoPuedoLlamar(c, contactsFor(c.id), me?.full_name ?? "", lang);
    if (!r.ok) {
      setError(r.motivo === "sin-telefono" ? t("No phone number", "Sin número de teléfono") : t("Already sent", "Ya enviado"));
      return;
    }
    setError(null);
    const abierto = abrirSmsEnRingCentral(r.enlace, r.texto, navegadorReal());
    notify(avisoTrasAbrir(abierto, lang));
    await addContact(c.id, contactoDelEnvio(r.texto));
  };

  return (
    <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
      <button
        className={className}
        disabled={estado.enviado}
        title={estado.enviado ? t("Text already sent", "Texto ya enviado") : t("Opens the text in RingCentral", "Abre el texto en RingCentral")}
        onClick={enviar}
      >
        {estado.etiqueta}
      </button>
      {error && <span style={{ color: "var(--red, #c0392b)", fontSize: 11 }}>{error}</span>}
    </span>
  );
}
