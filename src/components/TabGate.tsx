"use client";

import { usePathname } from "next/navigation";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { canOpenTab, tabForPath, TAB_GATE_EXEMPT } from "@/lib/constants";

/**
 * Quién entra a cada pantalla, en un solo sitio (D-NEXT).
 *
 * Antes cada página tenía su propia idea, cuando la tenía: tres coincidían con `TABS`,
 * tres llevaban una lista propia que no coincidía, y **cuatro no tenían ninguna** — entre
 * ellas el Gestor de rutas, donde se asignan choferes. Y la pestaña era la única barrera,
 * porque ni el `middleware.ts` ni el layout del grupo filtran rutas por rol.
 *
 * Así fue como `accounting` acabó en medio: `accounts/page.tsx` listaba a los NEGADOS
 * (`sales|driver|warehouse`) y `TABS` a los PERMITIDOS (`admin|manager`). No estaba en
 * ninguna de las dos, así que no veía la pestaña **y** la página lo dejaba pasar.
 *
 * Va **dentro** de `DataProvider` a propósito: pregunta por `me`, que es el rol
 * **efectivo** —con «ver como» aplicado—, y no por el de la sesión. Un admin
 * previsualizando almacén entra en `/warehouse` y no en `/routes`, que es lo que vería esa
 * persona. El rol real sigue mandando donde ya mandaba: la ventana de historial (D-239).
 *
 * Es una guarda de PANTALLA, igual de fuerte que las que sustituye —todas eran de
 * cliente— y no sustituye a la RLS: lo que cada rol puede escribir lo siguen decidiendo la
 * base y sus `guard_*`.
 */
export function TabGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { me } = useData();
  const { t } = usePrefs();

  const tab = tabForPath(pathname);
  // Una ruta que no es pestaña no se toca: `/account` es la ficha de uno mismo,
  // `/settings` ya se guarda sola con admin, y `/users` es un redirect al hub (D-056).
  if (!tab) return <>{children}</>;
  // Y las que la decisión deja abiertas a propósito, por su id y con su motivo.
  if (TAB_GATE_EXEMPT.includes(tab.id)) return <>{children}</>;
  if (canOpenTab(tab.id, me)) return <>{children}</>;

  return <div className="empty">{t("Not available for your role.", "No disponible para su rol.")}</div>;
}
