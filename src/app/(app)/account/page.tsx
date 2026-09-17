import { redirect } from "next/navigation";

/**
 * La pantalla de Cuenta de Entregas ya no existe (D-274).
 *
 * El dueño: «no more preferences in the delivery app». Lo que tenía se repartió, y nada se quedó
 * sin sitio salvo una cosa:
 *   · nombre, idioma, tema y contraseña → «Mi perfil», en el hub, que vale para todas las apps
 *     (D-265); el nombre se edita allí desde este cambio;
 *   · modo enseñanza → el desplegable del nombre en la barra; reiniciar la práctica → el aviso
 *     del modo enseñanza, que solo se ve con el modo encendido;
 *   · Ajustes (admin) y Tutoriales → el desplegable del nombre;
 *   · «Lo que puedo hacer» → **se pierde, sin sustituto**. Decidido así.
 *
 * La ruta se queda como redirección, igual que `/users` (D-056): hay marcadores, y la vuelta de
 * Ajustes apuntaba aquí. «Mi perfil» solo pide sesión, así que el chofer, que no entra al hub
 * (D-173), también llega.
 */
export default function AccountMoved() {
  redirect("/home/profile");
}
