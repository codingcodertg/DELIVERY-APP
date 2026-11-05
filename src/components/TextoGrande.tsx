"use client";

import { useEffect } from "react";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { ATRIBUTO_TEXTO_GRANDE, useTextoGrande } from "@/lib/texto-grande";

/**
 * Pone `data-texto-grande="on"` en `<html>` mientras quien está en la sesión es chofer y no lo apagó (D-NEXT). En `<html>`
 * y no en un `div`: así alcanza también a las fichas y diálogos (la ficha de la orden, «Confirmar entrega») y al reloj de
 * turno. Para cualquier otro rol lo quita: la oficina sigue con Entregas compacta (D-855). No pinta nada.
 */
export function AplicaTextoGrande() {
  const { me } = useData();
  const [on] = useTextoGrande(me?.id);
  const activo = me?.role === "driver" && on;
  useEffect(() => {
    const html = document.documentElement;
    if (activo) html.setAttribute(ATRIBUTO_TEXTO_GRANDE, "on");
    else html.removeAttribute(ATRIBUTO_TEXTO_GRANDE);
    return () => html.removeAttribute(ATRIBUTO_TEXTO_GRANDE);
  }, [activo]);
  return null;
}

/** «🔠 Texto grande»: el interruptor, para el chofer y para el admin que mira la ruta de un chofer. */
export function InterruptorTextoGrande() {
  const { me } = useData();
  const { t } = usePrefs();
  const [on, cambia] = useTextoGrande(me?.id);
  return (
    <button type="button" className={"btn btn-sm " + (on ? "btn-primary" : "btn-ghost")} data-interruptor-texto-grande
      aria-pressed={on} onClick={() => cambia(!on)}
      title={t("Bigger text and buttons for the driver screens", "Letra y botones más grandes en las pantallas del chofer")}>
      🔠 {t("Large text", "Texto grande")}: {on ? t("On", "Sí") : t("Off", "No")}
    </button>
  );
}
