/**
 * El expediente como ficha principal de la persona (D-251).
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
  /** Departamento, para el directorio de la compañía (D-256). */
  department?: string | null;
  /** Tienda, SOLO para quien no tiene cuenta: con cuenta manda `profiles.store` (D-258). */
  store?: string | null;
  /** Grupo especial del directorio (D-261): «remote», «sin_tienda», o null = normal. */
  directory_group?: string | null;
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
  department: string | null;
  /** La tienda guardada en el EXPEDIENTE. Solo cuenta si no hay cuenta. */
  store: string | null;
  /** La tienda de la CUENTA, si la hay. Cuando existe, es la que vale. */
  account_store: string | null;
  /** Grupo especial del directorio: «remote», «sin_tienda», o null = normal. */
  directory_group: string | null;
  days_off: number | null;
  notes: string | null;
  docKinds: string[];
  // ---- Migración 159. Mientras no esté aplicada llegan todas en null. ----
  /** Puesto. */
  job_title: string | null;
  /** Teléfono PERSONAL: solo RR. HH. `phone` es el de oficina, el que enseña el directorio. */
  personal_phone: string | null;
  personal_email: string | null;
  emergency_name: string | null;
  emergency_relation: string | null;
  emergency_phone: string | null;
  left_reason: string | null;
  left_note: string | null;
  /** Quién registró la baja (perfil), y su nombre ya resuelto para enseñarlo. */
  left_by: string | null;
  left_by_name: string | null;
  left_recorded_at: string | null;
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
  perfiles: { id: string; full_name?: string | null; store?: string | null }[],
  docsEntregados: { employee_id: string; kind: string; signed_at?: string | null }[],
): FilaExpediente[] {
  const nombreDePerfil = new Map(perfiles.map((p) => [p.id, (p.full_name ?? "").trim()]));
  const tiendaDePerfil = new Map(perfiles.map((p) => [p.id, (p.store ?? "").trim() || null]));
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
    department: (f.department as string) ?? null,
    store: (f.store as string) ?? null,
    account_store: profileId ? (tiendaDePerfil.get(profileId) ?? null) : null,
    directory_group: (f.directory_group as string) ?? null,
    days_off: (f.days_off as number) ?? null,
    notes: (f.notes as string) ?? null,
    docKinds: kindsDe.get(f.id as string) ?? [],
    job_title: (f.job_title as string) ?? null,
    personal_phone: (f.personal_phone as string) ?? null,
    personal_email: (f.personal_email as string) ?? null,
    emergency_name: (f.emergency_name as string) ?? null,
    emergency_relation: (f.emergency_relation as string) ?? null,
    emergency_phone: (f.emergency_phone as string) ?? null,
    left_reason: (f.left_reason as string) ?? null,
    left_note: (f.left_note as string) ?? null,
    left_by: (f.left_by as string) ?? null,
    left_by_name: f.left_by ? (nombreDePerfil.get(f.left_by as string) || null) : null,
    left_recorded_at: (f.left_recorded_at as string) ?? null,
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

/**
 * La tienda que vale para una persona (D-258): la de su cuenta si la dice, la del expediente si
 * no. Es la misma regla que aplica `public.phone_book()` (migración 109), escrita aquí para que la
 * ficha de RR. HH. enseñe lo mismo que el directorio.
 *
 * Con cuenta manda la cuenta porque `profiles.store` tiene consecuencias en Entregas —qué pedidos
 * ve un vendedor, de qué tienda es un gerente—, y la del expediente solo existe para quien no la
 * tiene. Así las dos no pueden contar cosas distintas de la misma persona.
 */
export function tiendaVisible(f: { account_store?: string | null; store?: string | null }): string | null {
  const cuenta = (f.account_store ?? "").trim();
  if (cuenta) return cuenta;
  const expediente = (f.store ?? "").trim();
  return expediente || null;
}

/**
 * ¿Se puede elegir la tienda desde el expediente? Solo si la persona no tiene cuenta.
 *
 * Con cuenta, el campo se enseña pero no se edita: cambiar la tienda de alguien con usuario es
 * cambiar lo que ve en Entregas, y eso se hace en Usuarios, no en RR. HH.
 */
export function puedeElegirTienda(f: { profile_id?: string | null }): boolean {
  return !f.profile_id;
}

/**
 * Los grupos especiales del directorio (D-261), con el mismo vocabulario que el `check` de la
 * migración que crea la columna. `null` es «normal»: la persona sale bajo su tienda.
 */
export const GRUPOS_DIRECTORIO = ["remote", "sin_tienda"] as const;
export type GrupoDirectorio = (typeof GRUPOS_DIRECTORIO)[number];

/**
 * Lo que llega del formulario, pasado al valor que se guarda. Vacío es «normal» y se guarda como
 * `null`, no como cadena vacía: el `check` de la base no la admitiría, y el guardado fallaría por
 * elegir la opción por defecto.
 *
 * Devuelve `undefined` si el valor no es de los que admite la base, para que quien llama lo
 * rechace con un motivo en vez de mandarle a Postgres algo que va a devolver un error críptico.
 */
export function normalizaGrupoDirectorio(v: string | null | undefined): GrupoDirectorio | null | undefined {
  const limpio = (v ?? "").trim();
  if (!limpio) return null;
  return (GRUPOS_DIRECTORIO as readonly string[]).includes(limpio) ? (limpio as GrupoDirectorio) : undefined;
}

/**
 * ¿Puede esta persona cambiar el grupo de directorio de un expediente? Solo el admin de RR. HH.
 *
 * El gerente de RR. HH. edita el resto de la ficha, pero no esto: decide dónde sale alguien en el
 * directorio de toda la empresa, fuera de la cascada normal de tiendas.
 */
export function puedeEditarGrupoDirectorio(recruitingRole: string | null | undefined): boolean {
  return recruitingRole === "admin";
}

// =============================================================================================
// Los botones del expediente y los campos de la 159 (dar de baja con motivo, agregar, «incompleto»)
// =============================================================================================
// Todo lo de aquí abajo es puro: lo usan la pantalla y las acciones de servidor, y se prueba sin base.

/** Las columnas que añade la migración 159. Mientras no esté aplicada, `select("*")` no las trae. */
export const COLUMNAS_159 = [
  "job_title", "personal_phone", "personal_email",
  "emergency_name", "emergency_relation", "emergency_phone",
  "left_reason", "left_note", "left_by", "left_recorded_at",
] as const;
export type Columna159 = (typeof COLUMNAS_159)[number];

/**
 * ¿Está aplicada la 159? Se mira en las filas, no en un ajuste: con `select("*")` una columna que no existe
 * llega AUSENTE (no `null`), así que basta con que una fila traiga la clave. Sin filas no se puede saber y se
 * contesta que no: la pantalla apaga los campos nuevos, que es el lado seguro.
 */
export function tiene159(files: Record<string, unknown>[]): boolean {
  return files.some((f) => "personal_phone" in f);
}

/**
 * ¿Este error es «esa columna no existe»? PostgREST contesta PGRST204 cuando el cuerpo nombra una columna que
 * no está en su caché de esquema, y Postgres 42703 cuando llega hasta él. Es como se reconoce que falta la 159.
 */
export function esColumnaQueFalta(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "PGRST204" || error.code === "42703") return true;
  const m = error.message ?? "";
  return /could not find the '.+' column/i.test(m) || /column .+ does not exist/i.test(m);
}

/** La lista corta de motivos de baja. Las claves son las del `check` de la 159; no se traducen. */
export const MOTIVOS_BAJA = [
  { key: "resignation", en: "Resigned", es: "Renuncia" },
  { key: "termination", en: "Terminated", es: "Despido" },
  { key: "abandonment", en: "Job abandonment", es: "Abandono de trabajo" },
  { key: "contract_end", en: "End of contract", es: "Fin de contrato" },
  { key: "other", en: "Other", es: "Otro" },
] as const;
export type MotivoBaja = (typeof MOTIVOS_BAJA)[number]["key"];

/** Vacío = sin motivo (`null`); algo que no está en la lista = `undefined`, para rechazarlo con una frase. */
export function normalizaMotivoBaja(v: string | null | undefined): MotivoBaja | null | undefined {
  const limpio = (v ?? "").trim();
  if (!limpio) return null;
  return MOTIVOS_BAJA.some((m) => m.key === limpio) ? (limpio as MotivoBaja) : undefined;
}

export function etiquetaMotivoBaja(v: string | null | undefined, lang: "en" | "es"): string {
  const m = MOTIVOS_BAJA.find((x) => x.key === v);
  return m ? m[lang] : "";
}

/**
 * El parche de una baja CON sus datos (159): fecha, motivo, nota, quién la registró y cuándo. La fecha sale de
 * `parcheBaja`, que es la regla que ya había. `quien` es el perfil de quien pulsa el botón, no un campo libre.
 */
export function parcheBajaCompleto(d: {
  fecha?: string | null; motivo?: string | null; nota?: string | null; quien: string; ahora?: Date;
}): { date_left: string; left_reason: MotivoBaja | null; left_note: string | null; left_by: string; left_recorded_at: string } {
  return {
    ...parcheBaja(d.fecha),
    left_reason: normalizaMotivoBaja(d.motivo) ?? null,
    left_note: (d.nota ?? "").trim() || null,
    left_by: d.quien,
    left_recorded_at: (d.ahora ?? new Date()).toISOString(),
  };
}

/** El parche de una reactivación con la 159: se va la fecha y con ella todo lo que describía la baja. */
export function parcheAltaCompleto(): {
  date_left: null; left_reason: null; left_note: null; left_by: null; left_recorded_at: null;
} {
  return { ...parcheAlta(), left_reason: null, left_note: null, left_by: null, left_recorded_at: null };
}

/** Quita de un parche las columnas de la 159: es lo que se guarda cuando la migración todavía no está. */
export function sin159<T extends Record<string, unknown>>(patch: T): Partial<T> {
  const fuera = new Set<string>(COLUMNAS_159);
  return Object.fromEntries(Object.entries(patch).filter(([k]) => !fuera.has(k))) as Partial<T>;
}

/** Dar de baja, reactivar y tocar el acceso son del admin de RR. HH. (igual que en las acciones; D-251). */
export function puedeDarDeBaja(recruitingRole: string | null | undefined): boolean {
  return ["admin"].includes(recruitingRole ?? "");
}

/**
 * La casilla «Quitar también el acceso al hub» de la ventana de baja. Solo se pinta si la persona tiene cuenta
 * (sin cuenta no hay acceso que quitar), y sale MARCADA al dar de baja. Al corregir una baja que ya estaba
 * sale sin marcar: quien dejó el acceso a propósito no lo pierde por arreglar el motivo.
 */
export function casillaQuitarAcceso(
  f: { profile_id?: string | null; date_left?: string | null },
): { visible: boolean; marcada: boolean } {
  const visible = !!f.profile_id;
  return { visible, marcada: visible && estadoEmpleado({ date_left: f.date_left ?? null }) === "activo" };
}

/** Hoy en la hora LOCAL de quien registra, `AAAA-MM-DD`. `toISOString` daría el día UTC, que por la tarde en
 *  Texas ya es mañana: una baja registrada a las 7 p. m. saldría con fecha del día siguiente. */
export function hoyLocalISO(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ---- El filtro Activos / Bajas / Todos ------------------------------------------------------

export type FiltroEstado = "activos" | "bajas" | "todos";

export function filtraPorEstado<T extends Pick<EmployeeFileRow, "date_left">>(filas: T[], filtro: FiltroEstado): T[] {
  if (filtro === "todos") return filas;
  const quiere: EstadoEmpleado = filtro === "bajas" ? "baja" : "activo";
  return filas.filter((f) => estadoEmpleado(f) === quiere);
}

export function cuentaPorEstado(filas: Pick<EmployeeFileRow, "date_left">[]): Record<FiltroEstado, number> {
  const bajas = filas.filter((f) => estadoEmpleado(f) === "baja").length;
  return { activos: filas.length - bajas, bajas, todos: filas.length };
}

// ---- Teléfonos ------------------------------------------------------------------------------

/**
 * Un teléfono como lo guarda la ficha: `956-555-0123` (D-432) si es un número de EE. UU. completo —con
 * paréntesis, espacios, puntos o `+1` delante—, y si no, lo escrito sin tocar. Vacío es `null`.
 */
export function telefonoDeFicha(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  const d = v.replace(/\D/g, "");
  const diez = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  // Solo se reescribe si lo tecleado es un número y nada más: «ext. 12» o un texto se dejan como están.
  if (diez.length !== 10 || /[a-z]/i.test(v)) return v;
  return `${diez.slice(0, 3)}-${diez.slice(3, 6)}-${diez.slice(6)}`;
}

// ---- ¿Sale en el directorio? ----------------------------------------------------------------

export type FaltaParaDirectorio = "baja" | "ext" | "phone";

/**
 * La misma condición que el `where` de `public.phone_book()` (117): activa, CON extensión y CON teléfono de
 * oficina. Está escrita aquí para que la ficha diga por qué alguien no sale, sin preguntarle a la base. Si esa
 * función cambia de regla, esta cambia con ella (hay una prueba que lee el `.sql`).
 */
export function saleEnDirectorio(
  f: Pick<EmployeeFileRow, "date_left" | "phone" | "ringcentral_ext">,
): { sale: boolean; falta: FaltaParaDirectorio[] } {
  const falta: FaltaParaDirectorio[] = [];
  if (estadoEmpleado(f) === "baja") falta.push("baja");
  if (!(f.ringcentral_ext ?? "").trim()) falta.push("ext");
  if (!(f.phone ?? "").trim()) falta.push("phone");
  return { sale: falta.length === 0, falta };
}

// ---- Expediente incompleto ------------------------------------------------------------------

export type CampoQueFalta =
  | "date_hired" | "department" | "store"
  | "job_title" | "personal_phone" | "emergency" | "left_reason";

export const ETIQUETAS_CAMPO: Record<CampoQueFalta, { en: string; es: string }> = {
  date_hired: { en: "Date hired", es: "Fecha de ingreso" },
  department: { en: "Department", es: "Departamento" },
  store: { en: "Store", es: "Tienda" },
  job_title: { en: "Position", es: "Puesto" },
  personal_phone: { en: "Personal phone", es: "Teléfono personal" },
  emergency: { en: "Emergency contact", es: "Contacto de emergencia" },
  left_reason: { en: "Reason for leaving", es: "Motivo de baja" },
};

type ParaIncompleto = Pick<EmployeeFileRow, "date_hired" | "date_left" | "department" | "store" | "directory_group"> & {
  account_store?: string | null;
  job_title?: string | null; personal_phone?: string | null;
  emergency_name?: string | null; emergency_phone?: string | null; left_reason?: string | null;
};

/**
 * Qué le falta a un expediente para estar «bien lleno». Es la lista que se enseña por persona y la que cuenta
 * el contador de arriba.
 *
 * El teléfono de oficina y la extensión NO están aquí a propósito: no tenerlos es un estado válido (almacén,
 * choferes), y lo que eso cambia —salir o no en el directorio— se dice aparte con `saleEnDirectorio`. La tienda
 * tampoco se pide a quien va en un grupo especial del directorio («remote», «sin tienda»): no tenerla es su caso.
 *
 * Sin la 159 solo se juzga lo que la tabla ya tiene: pedir un campo que no se puede escribir dejaría a todo el
 * mundo «incompleto» sin remedio.
 */
export function camposQueFaltan(f: ParaIncompleto, con159: boolean): CampoQueFalta[] {
  const vacio = (v: string | null | undefined) => !(v ?? "").trim();
  const falta: CampoQueFalta[] = [];
  if (vacio(f.date_hired)) falta.push("date_hired");
  if (vacio(f.department)) falta.push("department");
  if (!tiendaVisible(f) && vacio(f.directory_group)) falta.push("store");
  if (!con159) return falta;
  if (vacio(f.job_title)) falta.push("job_title");
  if (vacio(f.personal_phone)) falta.push("personal_phone");
  if (vacio(f.emergency_name) || vacio(f.emergency_phone)) falta.push("emergency");
  if (estadoEmpleado(f) === "baja" && vacio(f.left_reason)) falta.push("left_reason");
  return falta;
}

/** Cuántos expedientes de la lista están incompletos. */
export function cuentaIncompletos(filas: ParaIncompleto[], con159: boolean): number {
  return filas.filter((f) => camposQueFaltan(f, con159).length > 0).length;
}

// ---- Agregar un empleado --------------------------------------------------------------------

/**
 * Lo que se inserta al agregar a alguien SIN cuenta del hub. Con cuenta no se inserta nada desde aquí: la
 * cuenta se crea en Usuarios y el trigger de la 106 le crea su expediente. Devuelve `null` si no hay nombre,
 * que es lo único obligatorio.
 */
export function filaNueva(d: {
  full_name: string; date_hired?: string | null; department?: string | null; store?: string | null;
  phone?: string | null; ringcentral_ext?: string | null; job_title?: string | null; personal_phone?: string | null;
}, con159: boolean): Record<string, unknown> | null {
  const nombre = (d.full_name ?? "").trim().replace(/\s+/g, " ");
  if (!nombre) return null;
  const txt = (v: string | null | undefined) => (v ?? "").trim() || null;
  const base: Record<string, unknown> = {
    full_name: nombre,
    profile_id: null,
    date_hired: txt(d.date_hired),
    department: txt(d.department),
    store: txt(d.store),
    phone: telefonoDeFicha(d.phone),
    ringcentral_ext: limpiaExtension(d.ringcentral_ext),
  };
  if (!con159) return base;
  return { ...base, job_title: txt(d.job_title), personal_phone: telefonoDeFicha(d.personal_phone) };
}
