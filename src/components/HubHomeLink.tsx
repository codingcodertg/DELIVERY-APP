"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePrefs } from "@/lib/prefs";
import { canReachHub } from "@/lib/constants";
import { isDesktop } from "@/lib/timetracker/desktop";
import type { UserRole } from "@/lib/types";

/**
 * La casa que lleva al hub, junto al nombre de la app en la barra de Entregas (D-274).
 *
 * El dueño pidió quitar el selector de módulos de Entregas y dejar la casa, pegada al nombre. Las dos
 * cosas vivían en `ModuleSwitcher`, que comparten las barras de RR. HH. y Time Tracker, así que no se
 * toca: Entregas deja de montarlo y monta esta casa sola.
 *
 * Se esconde **con la misma pregunta** que el selector: `canReachHub`, que es la única regla y lleva
 * dentro el candado del chofer (D-173), y el cliente de escritorio de Time Tracker (D-076), donde salir
 * de la pantalla para la captura. No se copia la regla: se llama.
 */
export function HubHomeLink({ deliveriesRole, moduleAccess }: { deliveriesRole: UserRole; moduleAccess: string[] | null | undefined }) {
  const { t } = usePrefs();
  const [desktopClient, setDesktopClient] = useState(false);
  useEffect(() => { setDesktopClient(isDesktop()); }, []);

  if (!canReachHub({ role: deliveriesRole, module_access: moduleAccess }) || desktopClient) return null;

  return (
    <Link
      href="/home"
      className="tab tab-icon"
      aria-label={t("Back to the hub", "Volver al hub")}
      title={t("Back to the hub", "Volver al hub")}
    >
      ⌂
    </Link>
  );
}
