/**
 * Contratar desde el candidato y pedir al admin que cree el usuario (D-688, migración 201).
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

// ---------------------------------------------------------------------------------------------
// D-710: contratar crea también el usuario. Lo que se precarga para /api/invite.
// ---------------------------------------------------------------------------------------------

/** Los roles que acepta /api/invite (el mismo orden que allí). */
export const ROLES_DE_INVITE = ["admin", "manager", "sales", "warehouse", "driver", "logistics", "accounting"] as const;
export type RolDeInvite = (typeof ROLES_DE_INVITE)[number];

/** Sin acentos y en minúsculas, para comparar puestos y armar usuarios. */
function plano(s: string | null | undefined): string {
  return (s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

/**
 * El rol del hub que sale del puesto del candidato, solo si es obvio; si no, `null` y la ventana lo pregunta.
 * El orden importa: «Sales Manager» es gerente antes que ventas, «Warehouse Driver» es chofer.
 */
export function rolDesdePuesto(puesto: string | null | undefined): RolDeInvite | null {
  const p = plano(puesto);
  if (!p) return null;
  if (/\b(manager|gerente|supervisor)\b/.test(p)) return "manager";
  if (/\b(driver|chofer|conductor|repartidor)\b/.test(p)) return "driver";
  if (/\b(warehouse|almacen|bodega|bodeguero|almacenista)\b/.test(p)) return "warehouse";
  if (/\b(accounting|accountant|contabilidad|contador|contadora|payroll|nomina)\b/.test(p)) return "accounting";
  if (/\b(logistics|logistica|dispatch|dispatcher|despacho)\b/.test(p)) return "logistics";
  if (/\b(sales|ventas|vendedor|vendedora|seller|showroom)\b/.test(p)) return "sales";
  return null;
}

/** Un usuario sugerido del nombre: inicial del primero + último apellido («Juan Castañón» → «jcastanon»). */
export function usuarioSugerido(nombre: string | null | undefined): string {
  const partes = plano(nombre).replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  if (!partes.length) return "";
  const u = partes.length === 1 ? partes[0] : partes[0][0] + partes[partes.length - 1];
  return u.slice(0, 30);
}

/** Lo que la ventana de «Contratar» precarga para crear la cuenta. Con correo, va el correo; sin él, un usuario. */
export function precargaDeUsuario(c: {
  name: string; email?: string | null; role?: string | null; location?: string | null;
}): { full_name: string; email: string; username: string; store: string | null; role: RolDeInvite | null } {
  const email = (c.email ?? "").trim().toLowerCase();
  const valido = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
  return {
    full_name: (c.name ?? "").trim().replace(/\s+/g, " "),
    email: valido ? email : "",
    username: valido ? "" : usuarioSugerido(c.name),
    store: (c.location ?? "").trim() || null,
    role: rolDesdePuesto(c.role),
  };
}
