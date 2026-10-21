"use client";

import { usePrefs } from "@/lib/prefs";

/**
 * El aviso de «ya hay alguien agendado a esa hora» (D-632, 2026-10-21), dentro del propio diálogo. No bloquea: el
 * dueño pidió «detente, o así, o estás seguro». «Sí, agendar» repite el guardado que se paró, en el MISMO clic (así el
 * «Guardar y mandar texto» sigue abriendo RingCentral con el gesto del usuario, D-599). La regla vive en
 * `src/lib/recruiting/choque-de-horario.ts`.
 */
export function AvisoDeChoque({ texto, onCancelar, onSi }: { texto: string; onCancelar: () => void; onSi: () => void }) {
  const { t } = usePrefs();
  return (
    <div
      role="alertdialog"
      aria-live="assertive"
      data-aviso-choque
      style={{
        marginTop: 12, padding: "10px 12px", borderRadius: 10,
        border: "1px solid var(--amber, #d97706)", background: "color-mix(in srgb, var(--amber, #d97706) 12%, transparent)",
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 14, lineHeight: 1.4, overflowWrap: "anywhere" }}>{texto}</div>
      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        <button type="button" className="btn btn-ghost" onClick={onCancelar}>{t("Cancel", "Cancelar")}</button>
        <button type="button" className="btn btn-primary" onClick={onSi}>{t("Yes, schedule", "Sí, agendar")}</button>
      </div>
    </div>
  );
}
