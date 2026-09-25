"use client";

import { usePrefs } from "@/lib/prefs";

/** La ✕ que cierra un aviso del Gestor de Rutas para esta persona (D-400). Va arriba a la derecha del aviso. */
export function CerrarAviso({ aviso, onCerrar }: { aviso: string; onCerrar: () => void }) {
  const { t } = usePrefs();
  const etiqueta = t("Close this notice — it won't show again", "Cerrar este aviso — no volverá a salir");
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      data-cerrar-aviso={aviso}
      aria-label={etiqueta}
      title={etiqueta}
      onClick={(e) => { e.stopPropagation(); onCerrar(); }}
      style={{ padding: "0 7px", lineHeight: "20px", minWidth: 0, flexShrink: 0, marginLeft: "auto" }}
    >
      ✕
    </button>
  );
}
