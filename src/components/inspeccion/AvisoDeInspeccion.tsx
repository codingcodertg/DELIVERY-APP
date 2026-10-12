"use client";

import Link from "next/link";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { debeAvisar } from "@/lib/inspeccion/reglas";
import { useInspecciones } from "@/lib/inspeccion/usa-inspecciones";
import { todayISO } from "@/lib/utils";

/**
 * «Haz tu inspección pre-viaje» al principio de «Mi ruta» (D-NEXT), mientras hoy no haya ninguna. **Avisa, no
 * bloquea**: la ruta se ve y se trabaja igual. Cuándo sale lo decide `debeAvisar` (sin la migración 165, no sale).
 */
export function AvisoDeInspeccion() {
  const { me } = useData();
  const { t } = usePrefs();
  const hoy = todayISO();
  const { estado, filas } = useInspecciones(hoy, me?.id ?? null);
  if (!debeAvisar(estado, filas, me?.id, hoy)) return null;
  return (
    <div className="banner info" role="status" data-aviso-inspeccion style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <span style={{ flex: "1 1 180px" }}>✅ <b>{t("Do your pre-trip inspection", "Haz tu inspección pre-viaje")}</b> {t("before you head out.", "antes de salir.")}</span>
      <Link className="btn btn-primary btn-sm" href="/inspection">{t("Start", "Empezar")}</Link>
    </div>
  );
}
