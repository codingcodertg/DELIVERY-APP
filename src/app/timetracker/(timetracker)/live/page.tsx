import { redirect } from "next/navigation";

/**
 * «Trabajando ahora» ya no es pestaña: vive plegada dentro de Nómina (2026-11-24, ayuda de Roberto:
 * «remove this tab, no need for it if we clean up and consolidate with the Payroll tab»).
 *
 * La ruta se queda porque hay enlaces que ya existen —marcadores y notificaciones enviadas con
 * `/timetracker/live` dentro (`pushToManagers`)— y un 404 no explica nada. `?vista=ahora` abre la
 * sección de entrada.
 */
export default function LiveMonitorMoved() {
  redirect("/timetracker/payroll?vista=ahora");
}
