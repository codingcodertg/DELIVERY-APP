"use client";

import { useState } from "react";
import { usePrefs } from "@/lib/prefs";

/**
 * Visor de fotos DENTRO de la app (dueño, 10 nov): nada de abrir pestañas afuera. Muestra las miniaturas y, al tocar
 * una, la agranda en un overlay con ‹ › para pasar entre ellas. Recibe las URLs ya firmadas (las arma quien lo usa).
 */
export function VisorDeFotos({ fotos, demo }: { fotos: string[]; demo?: boolean }) {
  const { t } = usePrefs();
  const [i, setI] = useState<number | null>(null);
  const abrir = i != null && i >= 0 && i < fotos.length;
  const ir = (d: number) => setI((n) => (n == null ? n : (n + d + fotos.length) % fotos.length));
  return (
    <>
      <div className="ops-fotos-lista">
        {fotos.map((u, n) => (
          <button type="button" key={n} className="ops-foto-mini" onClick={() => setI(n)} data-abrir-foto={n} aria-label={t(`Open photo ${n + 1}`, `Abrir foto ${n + 1}`)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={u} alt={t(`Photo ${n + 1}`, `Foto ${n + 1}`)} />
          </button>
        ))}
        {demo && <p className="hint">{t("Photos are not shown in demo mode.", "En el demo no se enseñan fotos.")}</p>}
        {!demo && fotos.length === 0 && <p className="hint">{t("No photos.", "Sin fotos.")}</p>}
      </div>
      {abrir && (
        <div className="overlay ops-visor-overlay" onClick={() => setI(null)} role="dialog" aria-modal="true" data-visor-foto={i}>
          <div className="ops-visor" onClick={(e) => e.stopPropagation()}>
            {fotos.length > 1 && (
              <button type="button" className="btn ops-visor-nav" onClick={() => ir(-1)} aria-label={t("Previous", "Anterior")} data-visor-anterior>‹</button>
            )}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="ops-visor-img" src={fotos[i!]} alt={t(`Photo ${i! + 1}`, `Foto ${i! + 1}`)} />
            {fotos.length > 1 && (
              <button type="button" className="btn ops-visor-nav" onClick={() => ir(1)} aria-label={t("Next", "Siguiente")} data-visor-siguiente>›</button>
            )}
            <div className="ops-visor-pie no-imprimir">
              <span className="hint">{i! + 1} / {fotos.length}</span>
              <button type="button" className="btn btn-primary" onClick={() => setI(null)}>{t("Close", "Cerrar")}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
