"use client";

import type { ZonaDecidida } from "@/lib/zona-decidida";

/**
 * La pastilla LOCAL / NO LOCAL y el aviso «No local — requiere aprobación del gerente», leyendo LA MISMA decisión
 * (`zonaDecidida`, D-920). Antes cada sitio —la ficha dos veces, el cotizador— componía los suyos a mano desde
 * `FeeSuggestion`; con un solo dato de entrada no hay forma de que la pastilla diga LOCAL y el aviso «No local».
 *
 * `t` entra como propiedad, igual que en `BotonesDeTarifa`: el componente no sabe de idioma.
 */
export function PastillaDeZona({ zona, t, children }: {
  zona: ZonaDecidida;
  t: (en: string, es: string) => string;
  /** Lo que va al lado: la ciudad, el motivo, las millas. */
  children?: React.ReactNode;
}) {
  if (zona.local == null) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }} data-zona={zona.local ? "local" : "nolocal"}>
      <span className="sema" style={{ background: zona.local ? "var(--green)" : "var(--red)", color: "#fff" }}>
        {zona.local ? t("LOCAL", "LOCAL") : t("NOT LOCAL", "NO LOCAL")}
      </span>
      {children}
    </div>
  );
}

/** Solo la zona pide esto. El aviso de «Igualar precio (menor al descuento)» es de la tarifa y vive aparte. */
export function AvisoNoLocal({ zona, t }: { zona: ZonaDecidida; t: (en: string, es: string) => string }) {
  if (!zona.needsApproval) return null;
  return (
    <div className="hint" style={{ color: "var(--amber)", fontWeight: 600, marginTop: 6 }} data-no-local>
      ⚠ {t("Not local — requires manager approval.", "No local — requiere aprobación del gerente.")}
      {zona.why && <span style={{ fontWeight: 400, opacity: 0.85 }}> · {zona.why}</span>}
    </div>
  );
}
