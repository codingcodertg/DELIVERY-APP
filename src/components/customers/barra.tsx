"use client";

import { useEffect, useState } from "react";
import { SideNav } from "@/components/erp/side-nav";
import { createClient } from "@/lib/erp/supabase/client";
import { cuentaPendientes } from "@/lib/customers/almacen";
import { almacenDemo } from "@/lib/customers/demo";
import { EVENTO_DE_LA_COLA, rotuloDeDecidir } from "@/lib/customers/empresas";
import { usePrefs } from "@/lib/prefs";
import type { UserRole } from "@/lib/types";

const SIN_BASE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";

/**
 * La barra de «Clientes» (migración 180): la MISMA barra del ERP (`SideNav`, la superior desde D-622), con su nombre,
 * sus entradas y la pastilla del rol del hub. Es un componente de cliente porque las etiquetas llevan idioma
 * (`usePrefs`), y una página servidor no puede pasar una función a un componente de cliente.
 *
 * Desde la 189 tiene dos pestañas: la lista y «Decidir si se juntan», con las pendientes contadas (con la sesión de
 * quien mira: la RLS de la 189 decide; sin la 189 o sin permiso, sin número).
 */
export function BarraDeClientes({ role, fullName, email, hubReachable }: {
  role: UserRole; fullName: string | null; email: string; hubReachable: boolean;
}) {
  const { t } = usePrefs();
  const [pendientes, setPendientes] = useState<number | null>(null);
  useEffect(() => {
    let vivo = true;
    const contar = () => {
      const cuenta = SIN_BASE
        ? almacenDemo().sugerencias().then((r) => (r.ok ? r.valor.length : null))
        : cuentaPendientes(createClient());
      void cuenta.then((n) => { if (vivo) setPendientes(n); });
    };
    contar();
    // Al juntar o rechazar en «Decidir si se juntan», el número baja sin recargar.
    window.addEventListener(EVENTO_DE_LA_COLA, contar);
    return () => { vivo = false; window.removeEventListener(EVENTO_DE_LA_COLA, contar); };
  }, []);
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
        nav: {
          main: [
            { href: "/customers", label: t("Customers", "Clientes") },
            { href: "/customers/juntar", label: rotuloDeDecidir(pendientes, t) },
          ],
          analytics: [],
        },
      }}
    />
  );
}
