/**
 * El expediente como ficha principal de la persona (D-NEXT).
 *
 * Hasta la 106, el expediente **era** la cuenta: su clave primaria era la del perfil
 * (`093:25`), así que sin cuenta no había expediente y borrar la cuenta se llevaba el
 * expediente y sus documentos. Ahora la cuenta es un dato **dentro** del expediente,
 * y puede faltar, llegar más tarde o irse sin llevárselo.
 *
 * Aquí vive lo que se deriva de esa ficha. Dos reglas que mandan sobre el resto:
 *
 *   · **El estado no se guarda, se deriva** de `date_left`. Una columna de estado
 *     junto a su fecha se desincroniza en el primer guardado a medias, y entonces
 *     hay dos respuestas a «¿sigue aquí?».
 *   · **Los hechos de la cuenta no se copian, se leen.** Si existe, cómo entra y
 *     cuándo entró por última vez son estado de `auth`, y guardarlos aquí sería
 *     mentir en cuanto alguien iniciara sesión.
 */

import { isSyntheticEmail } from "@/lib/username";

/** La fila del expediente, tal como vive en `recruiting.employee_files` tras la 106. */
export interface EmployeeFileRow {
  id: string;
  /** La cuenta, si tiene. Null = expediente sin cuenta, que ahora es un estado válido. */
  profile_id: string | null;
  full_name: string | null;
  /** Correo de CONTACTO. No es el de acceso: ese vive en auth y puede ser sintético. */
  email: string | null;
  employee_code?: string | null;
  birthday?: string | null;
  date_hired: string | null;
  date_left: string | null;
  phone?: string | null;
  address?: string | null;
  ringcentral_ext: string | null;
  days_off?: number | null;
  notes?: string | null;
}

export type EstadoEmpleado = "activo" | "baja";

/** Activo mientras no haya fecha de salida. No hay tercer estado, y no hay columna. */
export function estadoEmpleado(f: Pick<EmployeeFileRow, "date_left">): EstadoEmpleado {
  return (f.date_left ?? "").trim() ? "baja" : "activo";
}

export function etiquetaEstado(estado: EstadoEmpleado, lang: "en" | "es"): string {
  if (estado === "baja") return lang === "es" ? "Baja" : "Left";
  return lang === "es" ? "Activo" : "Active";
}

/** El nombre que se enseña. Con cuenta manda el del perfil, porque es el que se edita
 * en Usuarios y el que sale en el resto de la app; sin cuenta, el del expediente. */
export function nombreVisible(
  f: Pick<EmployeeFileRow, "full_name" | "profile_id">,
  nombreDelPerfil?: string | null,
): string {
  const perfil = (nombreDelPerfil ?? "").trim();
  if (f.profile_id && perfil) return perfil;
  return (f.full_name ?? "").trim() || perfil || "—";
}

// ---- Los hechos de la cuenta, que se leen de auth ---------------------------

/** Lo que el servidor sabe de una cuenta. Todo esto se consulta; nada se guarda. */
export interface HechosDeCuenta {
  profile_id: string;
  existe: boolean;
  /** Cómo entra: con su correo, o con un usuario (correo sintético). */
  acceso: "correo" | "usuario" | null;
  last_sign_in_at: string | null;
  /** Deshabilitada en Auth (baneada). Es lo que hace «desactivado» en vez de borrado. */
  deshabilitada: boolean;
}

/** Con qué entra alguien, mirando su dirección de acceso. Un correo derivado de un
 * usuario (`…@users.rdztilegroup.net`) no es un correo: es maquinaria. */
export function tipoDeAcceso(emailDeAcceso: string | null | undefined): "correo" | "usuario" | null {
  const e = (emailDeAcceso ?? "").trim();
  if (!e) return null;
  return isSyntheticEmail(e) ? "usuario" : "correo";
}

/** Lo que la lista de RR. HH. quiere saber de la cuenta de una persona, en una pieza.
 *
 * `ocupada` responde a lo que el dueño llama «si lo ocupan»: hay cuenta **y** alguien
 * ha entrado con ella alguna vez. Una cuenta creada y nunca usada es justo el caso que
 * quiere ver, así que se distingue de «no tiene». */
export function resumenDeCuenta(
  f: Pick<EmployeeFileRow, "profile_id">,
  hechos?: HechosDeCuenta | null,
): { tieneCuenta: boolean; acceso: "correo" | "usuario" | null; ocupada: boolean; deshabilitada: boolean; ultimoAcceso: string | null } {
  if (!f.profile_id || !hechos || !hechos.existe) {
    return { tieneCuenta: false, acceso: null, ocupada: false, deshabilitada: false, ultimoAcceso: null };
  }
  return {
    tieneCuenta: true,
    acceso: hechos.acceso,
    ocupada: !!hechos.last_sign_in_at,
    deshabilitada: hechos.deshabilitada,
    ultimoAcceso: hechos.last_sign_in_at,
  };
}

/** Empareja cada expediente con los hechos de su cuenta. Los expedientes sin cuenta
 * salen igual, que es el punto de la rama: la lista es de personas, no de cuentas. */
export function conHechosDeCuenta<T extends Pick<EmployeeFileRow, "profile_id">>(
  files: T[],
  hechos: HechosDeCuenta[],
): (T & { cuenta: ReturnType<typeof resumenDeCuenta> })[] {
  const porPerfil = new Map(hechos.map((h) => [h.profile_id, h]));
  return files.map((f) => ({ ...f, cuenta: resumenDeCuenta(f, f.profile_id ? porPerfil.get(f.profile_id) : null) }));
}

// ---- Enlazar la cuenta, dar de baja, reactivar -----------------------------

/** Enlazar o desenlazar una cuenta lo hace SOLO el admin de RR. HH. Es lo que dice de
 * quién es este expediente. La base lo para igual (trigger de la 106): esto es para no
 * ofrecer un control que va a fallar. */
export function puedeEnlazarCuenta(recruitingRole: string | null | undefined): boolean {
  return (recruitingRole ?? "") === "admin";
}

/** Quién puede abrir un expediente. Mismo tramo que la 094: el reclutador no entra. */
export function puedeVerExpedientes(recruitingRole: string | null | undefined): boolean {
  return ["admin", "manager"].includes(recruitingRole ?? "");
}

/** El parche de una baja. La fecha por defecto es hoy, en el formato de la columna. */
export function parcheBaja(fecha?: string | null): { date_left: string } {
  const f = (fecha ?? "").trim();
  return { date_left: /^\d{4}-\d{2}-\d{2}$/.test(f) ? f : new Date().toISOString().slice(0, 10) };
}

/** El parche de una reactivación: se borra la fecha, y con ella el estado. */
export function parcheAlta(): { date_left: null } {
  return { date_left: null };
}

// ---- La extensión de RingCentral -------------------------------------------
// Es un campo a mano y lo seguirá siendo mientras la integración sea de empresa (un
// JWT en lib/ringcentral.ts, sin nada por persona). Lo único que se valida es la forma.

export function limpiaExtension(v: string | null | undefined): string | null {
  const solo = (v ?? "").replace(/[^\d]/g, "");
  return solo || null;
}

export function extensionValida(v: string | null | undefined): boolean {
  const limpia = limpiaExtension(v);
  return limpia === null || (limpia.length >= 2 && limpia.length <= 6);
}

// ---- Armar la lista -------------------------------------------------------

/** Una fila de la lista de RR. HH.: el expediente, su cuenta si la tiene, y qué papeles
 * ha entregado. */
export type FilaExpediente = {
  id: string;
  profile_id: string | null;
  /** Ya resuelto: el del perfil si hay cuenta, el del expediente si no. Nunca vacío. */
  full_name: string;
  email: string | null;
  employee_code: string | null;
  birthday: string | null;
  date_hired: string | null;
  date_left: string | null;
  phone: string | null;
  address: string | null;
  ringcentral_ext: string | null;
  days_off: number | null;
  notes: string | null;
  docKinds: string[];
};

/**
 * Junta expedientes, perfiles y documentos en la lista que ve RR. HH.
 *
 * Es pura y vive aquí, y no dentro de la acción de servidor, por lo que hace en el caso
 * raro: **tolera la tabla ANTERIOR a la 106**. Con `select("*")`, una columna que todavía
 * no existe no da error, llega ausente. En la tabla vieja el id del expediente ERA el de
 * la cuenta, así que eso es lo que se usa mientras `profile_id` no exista, y la pantalla
 * sigue en pie aunque la migración no se haya aplicado.
 *
 * Y añade a quien no tenga expediente todavía. Después de la 106 no habrá nadie —la
 * migración le crea uno a cada perfil—, pero antes es lo que mantiene la lista completa,
 * y después es lo que se ve el día que se crea una cuenta nueva.
 */
export function filasDeExpediente(
  files: Record<string, unknown>[],
  perfiles: { id: string; full_name?: string | null }[],
  docsEntregados: { employee_id: string; kind: string; signed_at?: string | null }[],
): FilaExpediente[] {
  const nombreDePerfil = new Map(perfiles.map((p) => [p.id, (p.full_name ?? "").trim()]));
  const kindsDe = new Map<string, string[]>();
  for (const d of docsEntregados) {
    // Un papel sin fecha de firma está empezado, no hecho: no cuenta como entregado.
    if (!d.signed_at) continue;
    kindsDe.set(d.employee_id, [...(kindsDe.get(d.employee_id) ?? []), d.kind]);
  }

  const fila = (f: Record<string, unknown>, profileId: string | null): FilaExpediente => ({
    id: f.id as string,
    profile_id: profileId,
    full_name: nombreVisible(
      { full_name: (f.full_name as string) ?? null, profile_id: profileId },
      profileId ? nombreDePerfil.get(profileId) : null,
    ),
    email: (f.email as string) ?? null,
    employee_code: (f.employee_code as string) ?? null,
    birthday: (f.birthday as string) ?? null,
    date_hired: (f.date_hired as string) ?? null,
    date_left: (f.date_left as string) ?? null,
    phone: (f.phone as string) ?? null,
    address: (f.address as string) ?? null,
    ringcentral_ext: (f.ringcentral_ext as string) ?? null,
    days_off: (f.days_off as number) ?? null,
    notes: (f.notes as string) ?? null,
    docKinds: kindsDe.get(f.id as string) ?? [],
  });

  const filas = files.map((f) =>
    fila(f, "profile_id" in f
      ? ((f.profile_id as string | null) ?? null)
      : (nombreDePerfil.has(f.id as string) ? (f.id as string) : null)),
  );

  const yaListados = new Set(filas.flatMap((r) => [r.id, r.profile_id].filter(Boolean) as string[]));
  for (const [id, nombre] of nombreDePerfil) {
    if (yaListados.has(id)) continue;
    filas.push(fila({ id, full_name: nombre }, id));
  }

  filas.sort((a, b) => a.full_name.localeCompare(b.full_name));
  return filas;
}
