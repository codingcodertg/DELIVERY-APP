import { redirect } from "next/navigation";

/**
 * Informes y pago se fusionó con Nómina (D-164).
 *
 * La pantalla no desaparece: es la tercera vista de /timetracker/payroll. Esta ruta se queda
 * porque los enlaces viejos existen —marcadores, el escritorio de Electron que no tiene barra
 * de direcciones, y notificaciones ya enviadas con esta url dentro— y un 404 a las siete de
 * la mañana no explica nada.
 */
export default function ReportsMoved() {
  redirect("/timetracker/payroll");
}
