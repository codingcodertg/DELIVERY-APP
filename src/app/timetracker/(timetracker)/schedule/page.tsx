import { redirect } from "next/navigation";

/**
 * El horario vive ahora en Registrar tiempo, como sección plegada (owner, 2026-11-24), y se abre con
 * ?vista=horario. La ruta se queda porque hay marcadores y enlaces guardados; el salto heredado de
 * fichaje (D-121) apunta directo a ese sitio en next.config.mjs. La puerta de rol la pone la sección.
 */
export default function SchedulePage() {
  redirect("/timetracker?vista=horario");
}
