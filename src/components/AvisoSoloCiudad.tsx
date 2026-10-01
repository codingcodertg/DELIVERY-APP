"use client";

import { usePrefs } from "@/lib/prefs";
import type { Delivery } from "@/lib/types";
import { AVISO_SOLO_CIUDAD, ordenSoloCiudad } from "@/lib/solo-ciudad";

/**
 * El aviso de una orden cuya dirección es solo una ciudad (D-NEXT): «Solo ciudad — dirección por confirmar». No pinta
 * nada si la orden no lo es (`ordenSoloCiudad`). `corto` es la pastilla para una celda de tabla del Gestor, con el texto
 * entero al pasar el ratón; sin él, una línea completa (Mi ruta y la parada del chofer).
 */
export function AvisoSoloCiudad({ orden, corto }: {
  orden: Pick<Partial<Delivery>, "delivery_address" | "delivery_pin_source"> | null | undefined;
  corto?: boolean;
}) {
  const { t } = usePrefs();
  if (!ordenSoloCiudad(orden)) return null;
  const texto = t(AVISO_SOLO_CIUDAD.en, AVISO_SOLO_CIUDAD.es);
  return corto
    ? <span data-solo-ciudad title={texto} style={{ color: "var(--amber-text)", fontWeight: 700, whiteSpace: "nowrap" }}> ⚠ {t("city only", "solo ciudad")}</span>
    : <span data-solo-ciudad style={{ display: "block", color: "var(--amber-text)", fontWeight: 700 }}>⚠ {texto}</span>;
}
