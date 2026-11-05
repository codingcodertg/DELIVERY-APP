/**
 * D-NEXT (Roberto Rodriguez Jr, admin, solicitud 5e8b3ea8): «Allow admin to change this. In this case i wanted to create
 * one for a rep in pharr». En el Quote Builder el admin del hub elige la TIENDA y el VENDEDOR de la cotización. De
 * entrada, los de ahora: el dueño guardado y su tienda; en una nueva, quien la crea y la tienda de su perfil.
 *
 * Quién decide: la base. El disparador de la 148 ya dejaba al admin poner `owner_id` y le prohíbe a cualquier otro
 * cambiar el dueño (42501); la 246 deja además al admin fijar `store`. Sin la 246, la base pone la tienda del perfil
 * del vendedor, y la pantalla lo dice (`avisoDeTienda`) en vez de fingir la tienda elegida.
 */

export interface VendedorElegible { id: string; full_name: string; store: string | null }
export interface Asignacion { owner_id: string; store: string | null }

const limpia = (s: string | null | undefined) => (s ?? "").trim() || null;

/**
 * Los vendedores del desplegable: los de la tienda elegida (sin tienda, todos), por nombre. El elegido ahora siempre
 * está, aunque sea de otra tienda o no sea vendedor (el admin que la creó): si no, el select mostraría otro.
 */
export function vendedoresParaElegir(todos: readonly VendedorElegible[], tienda: string | null, actual: VendedorElegible | null): VendedorElegible[] {
  const t = limpia(tienda)?.toLowerCase() ?? null;
  const lista = todos.filter((v) => t === null || limpia(v.store)?.toLowerCase() === t);
  if (actual && !lista.some((v) => v.id === actual.id)) lista.push(actual);
  return lista.sort((a, b) => (a.full_name ?? "").localeCompare(b.full_name ?? "", undefined, { sensitivity: "base" }));
}

/** Al cambiar de tienda: si el vendedor elegido no es de ella, se propone el primero de esa tienda (o se queda). */
export function vendedorAlCambiarTienda(todos: readonly VendedorElegible[], tienda: string | null, ownerId: string): string {
  const t = limpia(tienda)?.toLowerCase() ?? null;
  const delaTienda = vendedoresParaElegir(todos, tienda, null);
  if (t === null || delaTienda.some((v) => v.id === ownerId)) return ownerId;
  return delaTienda[0]?.id ?? ownerId;
}

/**
 * Lo que se manda a la base. Solo el admin, y solo lo que cambió respecto a lo guardado (`antes`; null = nueva): una
 * edición que no toca dueño ni tienda no los reenvía. Nunca para el no-admin: la base se lo negaría igual.
 */
export function filaDeAsignacion(esAdmin: boolean, elegida: Asignacion | null, antes: Asignacion | null): Partial<Asignacion> {
  if (!esAdmin || !elegida || !elegida.owner_id) return {};
  const store = limpia(elegida.store);
  const out: Partial<Asignacion> = {};
  if (!antes || elegida.owner_id !== antes.owner_id) out.owner_id = elegida.owner_id;
  if (!antes ? store !== null : store !== limpia(antes.store)) out.store = store;
  return out;
}

/** Tras guardar: si la base dejó otra tienda que la elegida (sin la 246), se dice cuál quedó. null = todo bien. */
export function avisoDeTienda(elegida: string | null, guardada: string | null): string | null {
  const a = limpia(elegida); const b = limpia(guardada);
  if (a === null || (b !== null && a.toLowerCase() === b.toLowerCase())) return null;
  return b ?? "";
}
