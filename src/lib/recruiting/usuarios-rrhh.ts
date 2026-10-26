/**
 * Crear usuarios desde RR. HH. (D-688).
 *
 * La gestión de cuentas se lleva a RR. HH. sin bifurcar la lógica: la pantalla usa el mismo
 * `UsersManager`/`UserDialog` del hub. Aquí vive solo lo que es propio de RR. HH.: qué empleados
 * ya tienen usuario, con qué se precarga el alta, y qué expediente sobra al enlazar.
 */

export type FiltroCuenta = "todos" | "con" | "sin";

type ConCuenta = { profile_id: string | null };

export function tieneUsuario(r: ConCuenta): boolean {
  return !!r.profile_id;
}

export function filtraPorCuenta<T extends ConCuenta>(rows: T[], filtro: FiltroCuenta): T[] {
  if (filtro === "con") return rows.filter(tieneUsuario);
  if (filtro === "sin") return rows.filter((r) => !tieneUsuario(r));
  return rows;
}

export function cuentaPorCuenta(rows: ConCuenta[]): Record<FiltroCuenta, number> {
  const con = rows.filter(tieneUsuario).length;
  return { todos: rows.length, con, sin: rows.length - con };
}

/** Lo que se precarga en «Crear un usuario» desde la fila de un empleado. */
export type Precarga = { fileId: string; full_name: string; email: string; store: string | null };

export function precargaDeEmpleado(f: {
  id: string; full_name: string | null; email?: string | null; personal_email?: string | null; store?: string | null;
}): Precarga {
  // El correo de trabajo primero: es el que sale en el directorio y el que la cuenta debería usar.
  const email = (f.email || f.personal_email || "").trim();
  return { fileId: f.id, full_name: (f.full_name ?? "").trim(), email, store: f.store?.trim() || null };
}

/**
 * Al nacer una cuenta, el trigger de la 106 le crea un expediente VACÍO (id = profile_id). Si la
 * cuenta se crea para un empleado que ya tenía expediente, ese vacío sobra: el índice único de
 * `profile_id` no deja enlazar el bueno mientras exista. Decide cuál borrar.
 *
 * `delPerfil`: los expedientes que hoy apuntan a `profileId`, con cuántos documentos tienen.
 */
export function expedienteQueSobra(
  fileId: string,
  profileId: string,
  delPerfil: { id: string; docs: number }[],
): { ok: true; borrar: string | null } | { ok: false; message: string } {
  const otros = delPerfil.filter((f) => f.id !== fileId);
  if (otros.length === 0) return { ok: true, borrar: null };
  if (otros.length > 1) return { ok: false, message: "This account is linked to more than one employee file." };
  const [o] = otros;
  // Solo el que creó el trigger: id = profile_id y sin papeles. Otro expediente con documentos es
  // de una persona de verdad, y borrarlo se llevaría sus papeles en cascada.
  if (o.id !== profileId || o.docs > 0) {
    return { ok: false, message: "This account already belongs to another employee file." };
  }
  return { ok: true, borrar: o.id };
}
