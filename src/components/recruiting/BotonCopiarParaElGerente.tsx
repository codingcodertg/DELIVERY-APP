"use client";

import { useState } from "react";
import { useData } from "@/lib/recruiting-data-provider";
import { usePrefs } from "@/lib/prefs";
import { mensajeParaElGerente, SEGUNDOS_DEL_ENLACE_DEL_CV } from "@/lib/recruiting/mensaje-para-el-gerente";
import type { Candidate } from "@/lib/recruiting/types";

/**
 * «📋 Copiar para el gerente» (D-590): copia al portapapeles nombre, teléfono, enlace al CV (firmado, 7 días), la nota
 * de la entrevista y la cita presencial, para pegarlo en un texto o correo al gerente de la tienda. Pasa a «Copiado ✓»
 * unos segundos. Si el navegador no deja copiar (iOS tras esperar el enlace), enseña el texto para copiarlo a mano.
 */
export function BotonCopiarParaElGerente({ c, className = "btn btn-ghost btn-sm" }: { c: Candidate; className?: string }) {
  const { contactsFor, resumeLink } = useData();
  const { t, lang } = usePrefs();
  const [estado, setEstado] = useState<"quieto" | "copiando" | "copiado">("quieto");
  const [aMano, setAMano] = useState<string | null>(null);

  const copiar = async () => {
    if (estado === "copiando") return;
    setEstado("copiando");
    setAMano(null);
    const cvEnlace = c.resume_path ? await resumeLink(c.id, SEGUNDOS_DEL_ENLACE_DEL_CV) : null;
    const texto = mensajeParaElGerente(c, { cvEnlace, contactos: contactsFor(c.id) }, lang);
    try {
      await navigator.clipboard.writeText(texto);
      setEstado("copiado");
      setTimeout(() => setEstado("quieto"), 2500);
    } catch {
      setEstado("quieto");
      setAMano(texto);
    }
  };

  return (
    <span style={{ display: "inline-flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
      <button
        type="button"
        className={className}
        data-copiar-para-el-gerente={c.id}
        disabled={estado === "copiando"}
        title={t("Copies name, phone, CV link, interview note and in-person appointment", "Copia nombre, teléfono, enlace al CV, nota de la entrevista y cita presencial")}
        onClick={() => void copiar()}
      >
        {estado === "copiado" ? `✓ ${t("Copied", "Copiado")}` : estado === "copiando" ? t("Copying…", "Copiando…") : `📋 ${t("Copy for manager", "Copiar para el gerente")}`}
      </button>
      {aMano && (
        <textarea
          readOnly
          data-copiar-a-mano
          value={aMano}
          rows={5}
          style={{ width: "100%", fontSize: 12 }}
          onFocus={(e) => e.currentTarget.select()}
          title={t("Your browser didn't allow copying: select and copy by hand", "El navegador no dejó copiar: selecciona y copia a mano")}
        />
      )}
    </span>
  );
}
