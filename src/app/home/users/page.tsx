"use client";

import Link from "next/link";
import { UsersManager } from "@/components/UsersManager";
import { usePrefs } from "@/lib/prefs";

/**
 * Usuarios del hub. D-704: el alta desde un empleado (`?employee=`, D-702) y el resumen de expedientes se fueron a
 * «Crear usuarios» de RR. HH. (/recruiting/user-creation). Esta se queda como la pantalla del hub y no redirige allí:
 * la abre la tarjeta «Usuarios» del hub (HUB_TOOLS) a cualquier admin del hub, y el layout de RR. HH. echa al que no
 * tiene recruiting_role; redirigir dejaría a ese admin sin gestión de usuarios. Es la misma UsersManager, con un
 * atajo a la de RR. HH.
 */
export default function UsersPage() {
  const { t } = usePrefs();
  return (
    <UsersManager
      header={
        <div className="card" style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <Link href="/home" className="hint" style={{ textDecoration: "none", marginTop: 0 }}>
            ← {t("Back to hub", "Volver al hub")}
          </Link>
          <Link href="/recruiting/user-creation" className="hint" style={{ textDecoration: "none", marginTop: 0 }} data-enlace="user-creation">
            🔑 {t("HR → User creation", "RR. HH. → Crear usuarios")}
          </Link>
        </div>
      }
    />
  );
}
