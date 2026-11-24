import { redirect } from "next/navigation";

/**
 * «Employees» salió de la barra del Time Tracker (tt/a-hr). La pantalla es la misma y ahora
 * vive en RR. HH. como «⏱ Time tracking setup» (/recruiting/tt-empleados), con su propio
 * control de acceso (solo admins del Time Tracker).
 *
 * Esta ruta se queda porque los enlaces viejos existen —marcadores, el escritorio de Electron
 * que no tiene barra de direcciones, y notificaciones ya enviadas con esta url dentro— y un 404
 * no explica nada.
 */
export default function PeopleMoved() {
  redirect("/recruiting/tt-empleados");
}
