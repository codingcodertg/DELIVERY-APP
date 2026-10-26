/**
 * Contratar desde el candidato y pedir al admin que cree el usuario (D-NEXT, migración 201).
 *
 * Lo puro vive aquí para probarlo sin base: quién puede pulsar «Hire», qué ficha sale del candidato y cómo se
 * reconoce que la 201 aún no está aplicada (la pantalla sigue funcionando sin ella).
 */

/** Gerente y admin de RR. HH. (rol del módulo, no `profiles.role`). El reclutador y el gerente de tienda, no. */
export function puedeContratar(rol: string | null | undefined): boolean {
  return rol === "admin" || rol === "manager";
}

/** Solo el admin de RR. HH. ve la lista «Usuarios por crear» y la marca hecha (lo mismo que dice la 201). */
export function veSolicitudesDeUsuario(rol: string | null | undefined): boolean {
  return rol === "admin";
}

/** La ficha nueva a partir del candidato. La fecha de alta es la de hoy en el formato de la columna. */
export function fichaDesdeCandidato(
  c: { name: string; phone?: string | null; role?: string | null; location?: string | null },
  hoy: string,
): { full_name: string; date_hired: string; phone: string | null; job_title: string | null; store: string | null } | null {
  const nombre = (c.name ?? "").trim().replace(/\s+/g, " ");
  if (!nombre) return null;
  const txt = (v: string | null | undefined) => (v ?? "").trim() || null;
  return { full_name: nombre, date_hired: hoy, phone: txt(c.phone), job_title: txt(c.role), store: txt(c.location) };
}

/** La tabla o la columna de la 201 todavía no existe: PostgREST da PGRST205/PGRST204, Postgres 42P01/42703. */
export function falta201(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  if (["PGRST205", "PGRST204", "42P01", "42703"].includes(error.code ?? "")) return true;
  const m = error.message ?? "";
  return /user_creation_requests|candidate_id/.test(m) && /does not exist|could not find|schema cache/i.test(m);
}

/** Pulsar dos veces deja una sola pendiente: el índice único da 23505 y eso cuenta como ya pedido. */
export function yaPedido(error: { code?: string | null } | null | undefined): boolean {
  return error?.code === "23505";
}
