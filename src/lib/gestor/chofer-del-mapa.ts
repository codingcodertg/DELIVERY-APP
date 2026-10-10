import type { Profile } from "@/lib/types";
import { pestanaChoferEsRutaDeUnChofer, type ChoferVisto } from "@/lib/vista-de-chofer";

/**
 * De quién es el mapa que se va a pintar en `/my-route/mapa` (D-508).
 *
 * D-506 acotó ese mapa a `me.full_name` y escondió el enlace al mirar la ruta de OTRO, para que no abriera el mapa de
 * quien mira. El efecto fue que el admin —que es quien revisa la pestaña «Chofer» (D-502)— no veía el mapa nuevo por
 * ninguna parte. El dueño: *«aun miro el mismo mapa en drivers»*.
 *
 * Ahora el enlace lleva el chofer en la URL y **aquí se vuelve a decidir si esa persona puede verlo**. La pregunta no se
 * contesta mirando de dónde viene el enlace: quien pide la ruta de otro tiene que poder pedirla, y eso lo dice la misma
 * regla que abre la pestaña «Chofer» (`pestanaChoferEsRutaDeUnChofer`, hoy solo el admin). A cualquier otro se le da
 * **su propia** ruta, no un error: pedir lo que no te toca no es un fallo que haya que explicar, es simplemente que ves
 * lo tuyo.
 *
 * Ojo con lo que esto NO es: un permiso de la base. El acotado sigue siendo de pantalla (ver D-506 y el hallazgo S-9 de
 * `docs/AUDIT-2026-10-09.md`), así que esto decide qué se pinta, no qué puede pedir alguien por su cuenta.
 */
export function choferDelMapa(
  me: Pick<Profile, "id" | "full_name" | "role"> | null | undefined,
  pedido: string | null | undefined,
  users: readonly ChoferVisto[],
): ChoferVisto | null {
  if (!me) return null;
  const mio: ChoferVisto = { id: me.id, full_name: me.full_name };
  const id = (pedido ?? "").trim();
  // Pedirse a uno mismo no se ataja aparte: cae por el mismo camino y da lo mismo (medido con un mutante).
  if (!id) return mio;
  if (!pestanaChoferEsRutaDeUnChofer(me)) return mio;
  return users.find((u) => u.id === id) ?? mio;
}
