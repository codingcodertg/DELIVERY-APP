import { naceAprobada, type QuienCrea } from "@/lib/cuenta-aprobacion";
import type { Stage, UserRole } from "@/lib/types";

/**
 * Enviar un borrador (o reenviar una rechazada): en qué etapa aterriza (D-313).
 *
 * El dueño: *«auto approve all orders for now until further change»*. Con todas las tiendas
 * marcadas para aprobar solas, **crear** una orden ya la dejaba aprobada — pero **enviar un
 * borrador** seguía mandándola a `pending`, donde no la esperaba nadie. La misma orden acababa en
 * un sitio o en otro según por qué botón hubiera salido, que es justo lo que el dueño no pidió.
 *
 * Así que la regla es una sola y es la de crear: `naceAprobada` (D-279, D-292). Vive aquí, y no en
 * el modal, porque **tres sitios** tienen que decir lo mismo — el botón de crear, el de enviar, y
 * el guard de la base (migración 127) — y porque lo que decide es la etapa que se escribe.
 */

/**
 * ¿Es este salto el gesto de *enviar*?
 *
 * Lo define de dónde sale, no a dónde va: desde D-313 el mismo botón puede aterrizar en `pending`
 * o en `approved`, y el corte duro de D-049 —bultos y documento— tiene que aplicarse a los dos.
 * Un admin «desbloqueando» una aprobada de vuelta a `pending` **no** es un envío: viene de
 * `approved`.
 */
export function esEnvioDeBorrador(desde: Stage, hacia: Stage): boolean {
  if (desde !== "draft" && desde !== "rejected") return false;
  return hacia === "pending" || hacia === "approved";
}

/**
 * ¿La base aceptaría que este rol mande su borrador directo a `approved`?
 *
 * Es el espejo del guard de la 127, y está aquí por la lección de D-291: logística veía el botón de
 * anular y la base le rechazaba la escritura. Un rol al que la base le diría que no se queda con el
 * camino de siempre —`pending`— en vez de estrellarse contra un error de Postgres.
 *
 * - `manager` y `accounting` (Office) pasan, y sin depender de la tienda: ya podían **aprobar**.
 * - `sales` y `driver` solo desde una tienda que aprueba sola, que es el `auto` del guard.
 * - `admin` se salta el guard entero.
 * - Cualquier otro rol con el permiso `create` concedido a mano —almacén, logística— no: la base no
 *   le acepta ese salto, aunque la tienda apruebe sola.
 */
export function laBaseAceptaElEnvioAprobado(rol: UserRole, tiendaAutoAprueba: boolean): boolean {
  if (rol === "admin" || rol === "manager" || rol === "accounting") return true;
  if (rol === "sales" || rol === "driver") return tiendaAutoAprueba;
  return false;
}

/**
 * La etapa en la que aterriza un borrador al enviarlo.
 *
 * La decisión es la de crear; lo único que la puede rebajar es que la base no acepte el salto de
 * ese rol. Nunca al revés: esto no aprueba nada que crear no hubiera aprobado.
 */
export function etapaAlEnviar(rol: UserRole, quien: QuienCrea): Stage {
  if (!naceAprobada(quien)) return "pending";
  return laBaseAceptaElEnvioAprobado(rol, quien.tiendaAutoAprueba) ? "approved" : "pending";
}
