import { redirect } from "next/navigation";

/**
 * «Trabajando ahora» ya no es pestaña ni sección (2026-11-24 pasó a Nómina; 2026-11-25 salió de allí, ayuda de Roberto:
 * «remove this tab, no need for it if we clean up and consolidate with the Payroll tab»).
 *
 * La ruta se queda porque hay enlaces que ya existen —marcadores y notificaciones enviadas con
 * `/timetracker/live` dentro (`pushToManagers`)— y un 404 no explica nada. Ya no hay sección que abrir: cae en
 * Nómina, y allí el estado de cada persona va en verde o gris en «Hojas de tiempo».
 */
export default function LiveMonitorMoved() {
  redirect("/timetracker/payroll");
}
