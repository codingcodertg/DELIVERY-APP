"use client";

import Link from "next/link";
import { usePrefs } from "@/lib/prefs";
import { accessibleModules, HUB_TOOLS } from "@/lib/constants";
import type { Profile } from "@/lib/types";
import { MapaDeApps } from "@/components/MapaDeApps";
import { veComprasDe } from "@/lib/mapa-de-apps";

/**
 * «🗺️ Mapa de la empresa» (D-556): el mapa de apps al estilo QuickBooks de D-554, en su propia página del hub.
 *
 * D-554 lo había puesto EN LUGAR de las tarjetas del inicio; el dueño, 2026-10-15: «el schema que hicimos de la app pon
 * lo dentro de una app no asi coomo lo dejaste y trae le diseno al rtb hub denuevo». El inicio vuelve a ser el de antes
 * y esta página enseña el mapa con las MISMAS dos listas que usa el inicio (`available` y `tools`): no abre nada nuevo.
 * Los mensajes de ayuda sin leer siguen contándose en el inicio (D-311); aquí la casilla no lleva número.
 */
export function MapaDeLaEmpresa({ me, suplantando }: { me: Profile; suplantando: boolean }) {
  const { t, lang } = usePrefs();
  const available = accessibleModules(me.module_access);
  const tools = HUB_TOOLS.filter((tool) => tool.visible({ ...me, suplantando }));
  return (
    <div className="auth-wrap">
      <div className="auth-card hub-mapa-card">
        <Link href="/home" className="hub-profile-link" data-mapa-volver>
          ← {t("Back to the hub", "Volver al inicio")}
        </Link>
        <h1>🗺️ {t("Company map", "Mapa de la empresa")}</h1>
        {/* `veCompras` (D-NEXT): Purchase Orders y Receive Inventory abren pantallas del ERP que rebotan a quien no tiene
            el nivel de compras (`erp_role` manager/admin, que la página lee); a esa persona, con candado. */}
        <MapaDeApps alcance={{ role: me.role, modulos: available, herramientas: tools, veCompras: veComprasDe(me) }} lang={lang} t={t} sinLeerDe={() => 0} />
      </div>
    </div>
  );
}
