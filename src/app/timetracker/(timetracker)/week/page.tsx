import { redirect } from "next/navigation";

/**
 * «Mi semana» (owner, 2026-11-24: «My week is removed») ya no es una pantalla: es una sección plegada
 * dentro de Registrar tiempo, y se abre con ?vista=semana. Esta ruta se queda porque hay marcadores y
 * enlaces guardados, y un 404 no explica nada.
 */
export default function WeekMoved() {
  redirect("/timetracker?vista=semana");
}
