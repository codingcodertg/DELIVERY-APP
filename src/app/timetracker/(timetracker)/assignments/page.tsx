import { redirect } from "next/navigation";

/**
 * «Schedule» (owner, 2026-11-24: «The Schedule tab is retired; from now on it lives in Track Time») ya
 * no es una pantalla de Asignaciones: es una sección plegada de Registrar tiempo, solo para admins, y
 * se abre con ?vista=horario. La puerta de rol la pone la propia sección (y los servidores de horario
 * comprueban al que llama). Esta ruta se queda porque hay marcadores y enlaces guardados.
 */
export default function AssignmentsMoved() {
  redirect("/timetracker?vista=horario");
}
