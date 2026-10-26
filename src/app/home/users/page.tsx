"use client";

import Link from "next/link";
import { UsersManager } from "@/components/UsersManager";
import { usePrefs } from "@/lib/prefs";

// La pantalla entera vive en UsersManager desde D-NEXT, compartida con RR. HH.
// (/recruiting/user-creation), adonde el dueño quiere llevar las cuentas. Esta sigue
// funcionando igual hasta que él decida cómo unificarlas.
export default function UsersPage() {
  const { t } = usePrefs();
  return (
    <UsersManager
      header={
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 10 }}>
          <Link href="/home" className="hint" style={{ display: "inline-flex", alignItems: "center", gap: 4, textDecoration: "none", marginTop: 0 }}>
            ← {t("Back to hub", "Volver al hub")}
          </Link>
          <Link href="/recruiting/user-creation" className="hint" data-enlace="rrhh-usuarios" style={{ textDecoration: "none", marginTop: 0 }}>
            👤 {t("Also in HR → User creation", "También en RR. HH. → Crear usuarios")}
          </Link>
        </div>
      }
    />
  );
}
