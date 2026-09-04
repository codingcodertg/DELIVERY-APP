"use client";

import { useEffect } from "react";
import { useT } from "@/lib/timetracker/i18n";

/**
 * Una ventana encima de la pantalla, para Time Tracker (D-187).
 *
 * NO es un componente de ventana nuevo: son las clases `.overlay` / `.modal` /
 * `.modal-actions` de `globals.css` —las mismas que usa `UserDialog` en Deliveries— con el
 * mismo comportamiento: clic fuera cierra, clic dentro no (stopPropagation). Lo que añade
 * este envoltorio es solo lo que los tres formularios de Asignaciones necesitan igual y no
 * merece copiarse tres veces: la tecla Escape, el botón de cerrar y el título.
 *
 * Colores: `.modal` de globals pinta con `--card`, que es blanco salvo en el tema oscuro de
 * Deliveries; Time Tracker es oscuro POR DEFECTO y claro con data-theme="light", al revés.
 * Sin más, en el tema por defecto salía una ventana blanca con texto claro. El ajuste
 * mínimo está en `timetracker.css` (`.timetracker-module .modal`), no aquí.
 */
export function Modal({
  title, onClose, children, maxWidth = 640,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  maxWidth?: number;
}) {
  const t = useT();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} style={{ maxWidth }} onClick={(e) => e.stopPropagation()}>
        <div className="between" style={{ marginBottom: 8 }}>
          <h3 style={{ margin: 0 }}>{title}</h3>
          <button type="button" className="btn-ghost btn-sm" aria-label={t("common.close")} onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
