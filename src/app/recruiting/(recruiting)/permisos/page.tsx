"use client";

import { useData } from "@/lib/recruiting-data-provider";
import { usePrefs } from "@/lib/prefs";
import { PanelDePermisos } from "@/app/security/PanelDePermisos";

/**
 * «Permisos» en RR. HH. (D-946): el administrador de permisos se movió aquí desde Seguridad (pedido del dueño). Usa el
 * perfil DEL HUB que el layout de recruiting ya pasa por el proveedor (`hub`), el mismo que monta «Permisos» en el
 * expediente. Solo el admin del hub; el panel es autónomo (pide su «en vivo» a `/api/security/vivo`).
 */
export default function PermisosDeRrhhPage() {
  const { hub } = useData();
  const { t } = usePrefs();
  if (!hub || hub.role !== "admin") {
    return <div className="card"><p className="hint">{t("Only a hub admin can manage permissions.", "Solo un admin del hub puede administrar permisos.")}</p></div>;
  }
  return (
    <div>
      <h1 style={{ margin: "0 0 4px" }}>🛡 {t("Permissions", "Permisos")}</h1>
      <p className="hint" style={{ marginTop: 0 }}>
        {t("What each person can open — role per app — and who is live right now.",
          "Qué puede abrir cada persona —rol por app— y quién está en vivo ahora mismo.")}
      </p>
      <PanelDePermisos hub={hub} />
    </div>
  );
}
