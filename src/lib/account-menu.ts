import { canReachHub } from "./constants";
import type { UserRole } from "./types";

/**
 * El desplegable del nombre en la barra de Entregas (D-274).
 *
 * El dueño: «when press the name put the dropdown for sign out and teaching mode, so no more preferences
 * in the delivery app». La pantalla de Cuenta deja de estar enlazada, y lo que vivía en ella tiene que
 * seguir al alcance de quien lo necesita. Por eso el menú no es igual para todos:
 *
 * - **Modo enseñanza y Salir**, para todo el mundo: lo que se pidió.
 * - **Ver como**, para el admin **real**. Antes era la píldora del rol en la barra; ahora la barra no
 *   enseña ninguna etiqueta de rol, y el control vive aquí. Se mira el rol real, no el que se está
 *   previsualizando: quien ve la app como vendedor tiene que poder volver.
 * - **Ajustes**, para el admin **efectivo**. No es una pestaña: hasta hoy solo se llegaba desde la
 *   pantalla de Cuenta. Mientras el admin previsualiza como vendedor, no sale, como no le sale a un
 *   vendedor.
 * - **Mi perfil y Tutoriales**, solo para quien **no llega al hub**, con la misma `canReachHub` que
 *   esconde la casa de la barra: quien no ve la casa los encuentra aquí. Hoy eso es el chofer, que tiene
 *   el hub cerrado por D-173 (el directorio es una herramienta del hub visible para todos, así que
 *   cualquier otro rol llega). Usaba la pantalla de Cuenta para llegar a los dos, y sin esto se quedaría
 *   sin puerta. Las dos rutas solo piden sesión.
 *
 * - **Vista móvil** vivió aquí de D-278 a D-306, para el admin real y fuera de su propio marco. Se
 *   fue al hub con «Cambiar de usuario»: son del hub, no de Entregas. Con ella se fue `enMarco`, que
 *   solo existía para no ofrecerla dentro de su iframe.
 *
 * - **Personalizar** (D-490), para todo el mundo, justo antes de Salir: el idioma y el tema se eligen
 *   en un solo sitio del hub (`/home/personalizar`) y ninguna barra tiene ya botón propio. La página
 *   solo pide sesión, así que también le vale al chofer.
 *
 * Salir va siempre el último, para que nadie lo toque por error al buscar otra cosa.
 *
 * Recibe lo mismo que tiene la barra —el rol real, y el rol y los módulos efectivos— y no tres
 * booleanos: así la prueba pasa por el mismo cableado que la barra, `canReachHub` incluida.
 */
export const OPCIONES_DEL_MENU = ["ensenanza", "vercomo", "ajustes", "perfil", "tutoriales", "personalizar", "salir"] as const;
export type OpcionDelMenu = (typeof OPCIONES_DEL_MENU)[number];

export function opcionesDelMenuDeCuenta(a: {
  realRole: UserRole | null | undefined;
  me: { role: UserRole; module_access?: string[] | null };
}): OpcionDelMenu[] {
  const out: OpcionDelMenu[] = ["ensenanza"];
  if (a.realRole === "admin") out.push("vercomo");
  if (a.me.role === "admin") out.push("ajustes");
  if (!canReachHub(a.me)) out.push("perfil", "tutoriales");
  out.push("personalizar", "salir");
  return out;
}

/**
 * El menú del nombre en Time Tracker (D-490).
 *
 * El dueño, el 2026-10-07: «hay demasiados botones […] quiero que sea igual que el Delivery app. Que
 * […] si aprietas el nombre de Carlos Fuentes, te sale Sign Out. Y teaching mode […] en el time tracker
 * también para todos». La barra perdió la pastilla del rol, el ES/EN, el 🌙 y el «Sign out» suelto; lo
 * que quedaba de eso vive aquí, **igual para todos los roles**:
 *
 * - **Modo capacitación**: lo que se hace mientras está encendido no se guarda (`lib/timetracker/capacitacion.ts`).
 * - **Mi cuenta**: el nombre era la puerta a `/timetracker/account` desde D-160. Ahora el nombre abre
 *   este menú, y sin esta opción la pantalla de la cuenta (forma de pago, ciudad) se quedaría sin entrada.
 * - **Personalizar** y **Cerrar sesión**, como en Entregas; Salir el último.
 */
export const OPCIONES_DEL_MENU_TT = ["capacitacion", "cuenta", "personalizar", "salir"] as const;
export type OpcionDelMenuTt = (typeof OPCIONES_DEL_MENU_TT)[number];

/**
 * El menú del nombre en RR. HH. (D-490): su botón ES/EN y su «Salir» suelto se mudan aquí, como en
 * Entregas. RR. HH. no tiene modo de práctica, así que solo lleva lo que se quitó de la barra.
 */
export const OPCIONES_DEL_MENU_RRHH = ["personalizar", "salir"] as const;
export type OpcionDelMenuRrhh = (typeof OPCIONES_DEL_MENU_RRHH)[number];
