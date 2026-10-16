"use client";

import { SideNav } from "@/components/erp/side-nav";
import { usePrefs } from "@/lib/prefs";
import type { UserRole } from "@/lib/types";

/**
 * La barra de «Clientes» (migración 180): la MISMA barra lateral del ERP (`SideNav`), con su nombre, su única
 * entrada y la pastilla del rol del hub. Es un componente de cliente porque las etiquetas llevan idioma (`usePrefs`),
 * y una página servidor no puede pasar una función a un componente de cliente.
 */
export function BarraDeClientes({ role, fullName, email, hubReachable }: {
  role: UserRole; fullName: string | null; email: string; hubReachable: boolean;
}) {
  const { t } = usePrefs();
  return (
    <SideNav
      role={role}
      fullName={fullName}
      email={email}
      cost={false}
      hubReachable={hubReachable}
      otra={{
        brand: t("RTG Customers", "RTG Clientes"),
        badge: role,
        nav: { main: [{ href: "/customers", label: t("Customers", "Clientes") }], analytics: [] },
      }}
    />
  );
}
