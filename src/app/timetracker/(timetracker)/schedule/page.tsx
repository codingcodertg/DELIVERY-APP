import { redirect } from "next/navigation";

/**
 * El horario vive ahora dentro de Asignaciones (D-186). La ruta se queda porque hay
 * marcadores y enlaces guardados; el salto heredado de fichaje (D-121) ya no pasa por aquí,
 * apunta directo a /timetracker/assignments en next.config.mjs. La puerta de rol la pone
 * el destino.
 */
export default function SchedulePage() {
  redirect("/timetracker/assignments");
}
