import { esAdmin } from "./impersonation";
import type { Profile } from "./types";

/**
 * ¿Ve esta persona «Apps para instalar» en el hub? Solo el admin de Entregas (D-262).
 *
 * Decisión del dueño del 2026-09-16, que da la vuelta a D-167: allí se enseñaban a todo el mundo
 * para que nadie tuviera que pedir una app. Ahora es el admin quien las reparte.
 *
 * Recibe el `me` entero y no un rol suelto, porque eso es lo que tiene el selector del hub: así
 * la prueba le pasa lo mismo que le pasa la pantalla. Y compara con `esAdmin`, que es el único
 * sitio donde se escribe «admin».
 *
 * Solo esconde la sección. **No cierra ninguna descarga**: eso vive en `/api/download/*`, que
 * sigue abierta a cualquier sesión.
 */
export function veAppsParaInstalar(me: Pick<Profile, "role"> | null | undefined): boolean {
  return esAdmin(me?.role);
}
