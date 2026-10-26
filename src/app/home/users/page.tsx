"use client";

import Link from "next/link";
import { UsersManager } from "@/components/UsersManager";
import { usePrefs } from "@/lib/prefs";

// La pantalla entera vive en UsersManager desde D-NEXT, para poder abrirla también
// desde RR. HH. (siguiente paso: Empleados → «Crear usuario»).
export default function UsersPage() {
  const { t } = usePrefs();
  return (
    <UsersManager
      header={
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 10 }}>
          <Link href="/home" className="hint" style={{ display: "inline-flex", alignItems: "center", gap: 4, textDecoration: "none", marginTop: 0 }}>
            ← {t("Back to hub", "Volver al hub")}
          </Link>
        </div>
      }
    />
  );
}
