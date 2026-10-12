import type { EstadoDeLaInspeccion } from "@/lib/inspeccion/reglas";

/**
 * Seguro / no seguro, como está AHORA (`estadoDeLaInspeccion`). La que no era segura y ya tiene sus críticos corregidos
 * lo dice así, sin borrar que no lo era: es lo que el chofer firmó.
 */
export function BadgeDeSeguridad({ est, t }: { est: EstadoDeLaInspeccion; t: (en: string, es: string) => string }) {
  if (est === "no_segura") return <span className="badge insp-badge-no-seguro" data-seguro="no">⛔ {t("Not safe to drive", "No es seguro salir")}</span>;
  if (est === "corregida") {
    return (
      <span className="badge insp-badge-seguro" data-seguro="corregida" title={t("It was not safe when inspected; its critical defects are marked fixed.", "No era seguro al inspeccionar; sus defectos críticos están marcados como corregidos.")}>
        ✅ {t("Fixed — OK to drive", "Corregido — ya puede salir")}
      </span>
    );
  }
  return <span className="badge insp-badge-seguro" data-seguro="si">✅ {t("Safe to drive", "Seguro para salir")}</span>;
}
