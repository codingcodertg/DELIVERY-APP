"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSyntheticEmail } from "@/lib/username";
import {
  esColumnaQueFalta, extensionValida, filaNueva, filasDeExpediente, limpiaExtension, normalizaGrupoDirectorio,
  normalizaMotivoBaja, parcheAlta, parcheAltaCompleto, parcheBaja, parcheBajaCompleto, puedeDarDeBaja,
  puedeEditarGrupoDirectorio, sin159, telefonoDeFicha, tiene159,
} from "@/lib/recruiting/employee-file";
import type { HechosDeCuenta } from "@/lib/recruiting/employee-file";

/**
 * El expediente de RR. HH. (D-145).
 *
 * Se sirve por acciones y no por el proveedor de datos de recruiting a propósito: un
 * expediente lleva cumpleaños, dirección, antidoping y amonestaciones. Cargarlo en el estado
 * global lo pondría en memoria de cualquier pantalla del módulo, incluida la de candidatos, y
 * lo dejaría en el HTML de la página para quien mirase. Se pide cuando se abre una ficha, y no
 * antes.
 *
 * **Quién puede:** admin y gerente, no el reclutador. La 093 dejó estas tablas bajo
 * `has_recruiting_access()` —el mismo guardián que el resto del módulo— y eso resultó ser
 * demasiado ancho: un reclutador entra a RR. HH. para mover candidatos, no para leer la
 * dirección y las amonestaciones de la plantilla. La 094 estrecha las políticas; esto lo repite
 * aquí a propósito y no por desconfianza de la base: una acción de servidor que devuelve la
 * lista entera merece fallar con un mensaje en vez de con una lista vacía inexplicable.
 */

const PUEDE = ["admin", "manager"];

/** Su propio cubo, privado, y NO `resumes` — ahí viven currículums de candidatos, y su
 *  política deja entrar al reclutador, a quien la 094 acaba de dejar fuera del expediente. */
const HR_BUCKET = "hr-docs";

/** El tramo de RR. HH. de quien llama, o null si no ha entrado. */
async function tier(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<{ userId: string; role: string } | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from("profiles").select("recruiting_role").eq("id", user.id).single();
  return { userId: user.id, role: (data?.recruiting_role as string) ?? "" };
}

export type EmployeeFile = {
  /** El id del EXPEDIENTE (106), que ya no es el de la cuenta. Para las personas que
   *  ya estaban coincide con su `profile_id`, porque la migración conservó cada id. */
  id: string;
  /** La cuenta, si tiene. Null = expediente sin cuenta, que ahora es válido. */
  profile_id: string | null;
  full_name: string;
  /** Correo de contacto, no el de acceso. */
  email: string | null;
  employee_code: string | null;
  birthday: string | null;
  date_hired: string | null;
  date_left: string | null;
  phone: string | null;
  address: string | null;
  ringcentral_ext: string | null;
  /** Departamento, para el directorio de la compañía (D-256). */
  department: string | null;
  /** Tienda del EXPEDIENTE, solo para quien no tiene cuenta (D-258). */
  store: string | null;
  /** Tienda de la CUENTA, si la hay; cuando existe es la que vale. De solo lectura aquí. */
  account_store: string | null;
  /** Grupo especial del directorio (D-261): «remote», «sin_tienda», o null = normal. Solo admin. */
  directory_group: string | null;
  days_off: number | null;
  notes: string | null;
  // ---- Migración 159 (null mientras no esté aplicada) ----
  /** Puesto. */
  job_title: string | null;
  /** Teléfono PERSONAL, solo RR. HH. `phone` es el de oficina: el que enseña el directorio. */
  personal_phone: string | null;
  personal_email: string | null;
  emergency_name: string | null;
  emergency_relation: string | null;
  emergency_phone: string | null;
  left_reason: string | null;
  left_note: string | null;
  left_by: string | null;
  /** El nombre de quien registró la baja, ya resuelto. De solo lectura. */
  left_by_name: string | null;
  left_recorded_at: string | null;
};

/** Lo que NO se guarda por «Guardar datos»: la identidad, lo derivado, y la baja, que tiene su botón. */
type NoEditable =
  | "id" | "account_store" | "profile_id" | "date_left"
  | "left_reason" | "left_note" | "left_by" | "left_by_name" | "left_recorded_at";
const SOLO_POR_SU_BOTON = ["date_left", "left_reason", "left_note", "left_by", "left_by_name", "left_recorded_at"];
const FALTA_159 = "Migration 159 is not applied yet: the new fields can't be saved.";

export type EmployeeDoc = {
  id: string;
  employee_id: string;
  kind: string;
  signed_at: string | null;
  expires_at: string | null;
  file_path: string | null;
  note: string | null;
};

/**
 * La plantilla con su ficha, para la lista.
 *
 * **Ahora la lista sale del EXPEDIENTE, no de `profiles`** (106): esa es la rama entera.
 * Antes se recorrían las cuentas y se les pegaba su ficha, así que una persona sin
 * cuenta —una baja, alguien que aún no la tiene— no existía. Ahora se recorren los
 * expedientes y la cuenta es un dato de cada uno.
 *
 * El nombre del perfil sigue mandando cuando hay cuenta: es el que se edita en Usuarios
 * y el que sale en el resto de la app. El del expediente es el respaldo, y el único que
 * hay para quien no tiene cuenta.
 */
export async function listEmployeeFiles(): Promise<
  // `campos159`: si la tabla ya tiene las columnas de la 159. Sin ellas la pantalla apaga los campos nuevos.
  { ok: true; rows: (EmployeeFile & { docKinds: string[] })[]; campos159: boolean } | { ok: false; message: string }
> {
  const supabase = await createClient();
  const yo = await tier(supabase);
  if (!yo || !PUEDE.includes(yo.role)) return { ok: false, message: "Employee files are for HR admins and managers." };

  const [{ data: files, error }, { data: people }, { data: docs }] = await Promise.all([
    supabase.schema("recruiting").from("employee_files").select("*"),
    // La tienda del perfil viaja con la fila para que la ficha la enseñe de solo lectura cuando
    // la persona tiene cuenta (D-258). `profiles` la lee cualquier sesión (099), así que no
    // abre nada que RR. HH. no pudiera ver ya.
    supabase.from("profiles").select("id, full_name, store"),
    // Solo `kind` y de quién: la lista únicamente necesita saber QUÉ hay, no su contenido.
    supabase.schema("recruiting").from("employee_docs").select("employee_id, kind, signed_at"),
  ]);
  if (error) return { ok: false, message: error.message };

  return {
    ok: true,
    campos159: tiene159((files ?? []) as Record<string, unknown>[]),
    rows: filasDeExpediente(
      (files ?? []) as Record<string, unknown>[],
      (people ?? []) as { id: string; full_name?: string | null; store?: string | null }[],
      (docs ?? []) as { employee_id: string; kind: string; signed_at?: string | null }[],
    ),
  };
}

/** Los documentos de una persona, al abrir su ficha. */
export async function getEmployeeDocs(employeeId: string): Promise<
  { ok: true; docs: EmployeeDoc[] } | { ok: false; message: string }
> {
  const supabase = await createClient();
  const yo = await tier(supabase);
  if (!yo || !PUEDE.includes(yo.role)) return { ok: false, message: "Employee files are for HR admins and managers." };

  const { data, error } = await supabase
    .schema("recruiting")
    .from("employee_docs")
    .select("id, employee_id, kind, signed_at, expires_at, file_path, note")
    .eq("employee_id", employeeId)
    .order("signed_at", { ascending: false, nullsFirst: true });
  if (error) return { ok: false, message: error.message };
  return { ok: true, docs: (data ?? []) as EmployeeDoc[] };
}

/** Guarda la parte de INFO. Crea la fila la primera vez.
 *
 * `fileId` es el id del EXPEDIENTE desde la 106, no el de la cuenta. Para quien ya
 * estaba son el mismo numero, porque la migracion conservo cada id. */
export async function saveEmployeeFile(
  fileId: string,
  patch: Partial<Omit<EmployeeFile, NoEditable>> & { profile_id?: string | null },
): Promise<{ ok: boolean; message?: string }> {
  const supabase = await createClient();
  const yo = await tier(supabase);
  if (!yo) return { ok: false, message: "Not signed in." };
  if (!PUEDE.includes(yo.role)) return { ok: false, message: "Employee files are for HR admins and managers." };

  // Enlazar o quitar la cuenta es del admin de RR. HH., no del gerente: es lo que dice de
  // quien es este expediente. Lo para el trigger de la 106 igual que aqui; esto solo
  // convierte un error de Postgres en una frase.
  if ("profile_id" in patch && yo.role !== "admin") {
    return { ok: false, message: "Only an HR admin can link an employee file to an account." };
  }
  // El grupo del directorio (D-261) es SOLO del admin de RR. HH.: decide dónde sale alguien en
  // el directorio de toda la empresa, fuera de la cascada de tiendas. La ficha solo enseña el
  // selector a un admin, pero la barrera está aquí, porque una llamada directa a esta acción no
  // pasa por la pantalla.
  if ("directory_group" in patch) {
    if (!puedeEditarGrupoDirectorio(yo.role)) {
      return { ok: false, message: "Only an HR admin can change the directory group." };
    }
    const grupo = normalizaGrupoDirectorio(patch.directory_group);
    if (grupo === undefined) return { ok: false, message: "Unknown directory group." };
    patch = { ...patch, directory_group: grupo };
  }

  // La tienda del expediente es SOLO para quien no tiene cuenta (D-258). Con cuenta manda
  // `profiles.store`, que decide qué ve esa persona en Entregas. La ficha enseña el campo de
  // solo lectura, pero eso es comodidad: la barrera está aquí, porque una llamada directa a
  // esta acción no pasa por la pantalla.
  if ("store" in patch) {
    const { data: actual, error: errActual } = await supabase
      .schema("recruiting").from("employee_files").select("profile_id").eq("id", fileId).maybeSingle();
    // Si no se pudo preguntar, NO se guarda: descartar el error y seguir escribiría la tienda
    // justo en el caso que esta comprobación existe para parar.
    if (errActual) return { ok: false, message: errActual.message };
    if (actual?.profile_id) {
      return { ok: false, message: "This person has an account: change their store in Users." };
    }
  }
  if (patch.ringcentral_ext !== undefined && !extensionValida(patch.ringcentral_ext)) {
    return { ok: false, message: "A RingCentral extension is 2 to 6 digits." };
  }
  // La baja no entra por aquí: tiene su botón, que pide motivo, apunta quién la registró y es solo del
  // admin de RR. HH. Dejarla pasar por «Guardar datos» sería una segunda puerta sin nada de eso.
  if (SOLO_POR_SU_BOTON.some((k) => k in patch)) {
    return { ok: false, message: "Use the Deactivate / Reactivate buttons to change someone's status." };
  }
  // El nombre del expediente solo se escribe para quien NO tiene cuenta. Con cuenta manda el del perfil
  // (`nombreVisible`), que se cambia en Usuarios: escribirlo aquí no se vería y parecería que no guarda.
  if ("full_name" in patch) {
    const nombre = (patch.full_name ?? "").trim().replace(/\s+/g, " ");
    if (!nombre) return { ok: false, message: "The name can't be empty." };
    const { data: actual, error: errActual } = await supabase
      .schema("recruiting").from("employee_files").select("profile_id").eq("id", fileId).maybeSingle();
    if (errActual) return { ok: false, message: errActual.message };
    if (actual?.profile_id) return { ok: false, message: "This person has an account: change their name in Users." };
    patch = { ...patch, full_name: nombre };
  }

  // Las fechas vacias se guardan como NULL y no como "": una cadena vacia en una columna de
  // fecha la rechaza Postgres, y el formulario manda "" en cuanto alguien borra el campo.
  const limpio: Record<string, unknown> = { id: fileId, updated_at: new Date().toISOString(), updated_by: yo.userId };
  for (const [k, v] of Object.entries(patch)) limpio[k] = v === "" ? null : v;
  if (patch.ringcentral_ext !== undefined) limpio.ringcentral_ext = limpiaExtension(patch.ringcentral_ext);
  // Los teléfonos se guardan con la forma de la app, 956-xxx-xxxx (D-432).
  for (const k of ["phone", "personal_phone", "emergency_phone"] as const) {
    if (patch[k] !== undefined) limpio[k] = telefonoDeFicha(patch[k]);
  }

  const { error } = await supabase.schema("recruiting").from("employee_files").upsert(limpio);
  if (error) return { ok: false, message: esColumnaQueFalta(error) ? FALTA_159 : error.message };
  return { ok: true };
}

/**
 * Agrega a una persona SIN cuenta del hub. Con cuenta no se agrega desde aquí: la cuenta se crea en Usuarios
 * y el trigger de la 106 le crea el expediente, así que solo hay un sitio donde nacen las cuentas.
 *
 * Lo pueden hacer admin y gerente de RR. HH., igual que editar una ficha (la política de la 094 es la misma
 * para insertar que para actualizar, y un expediente sin cuenta no pasa por el guard del enlace).
 */
export async function createEmployeeFile(input: {
  full_name: string; date_hired?: string | null; department?: string | null; store?: string | null;
  phone?: string | null; ringcentral_ext?: string | null; job_title?: string | null; personal_phone?: string | null;
}): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  const supabase = await createClient();
  const yo = await tier(supabase);
  if (!yo) return { ok: false, message: "Not signed in." };
  if (!PUEDE.includes(yo.role)) return { ok: false, message: "Employee files are for HR admins and managers." };
  if (input.ringcentral_ext && !extensionValida(input.ringcentral_ext)) {
    return { ok: false, message: "A RingCentral extension is 2 to 6 digits." };
  }
  const fila = filaNueva(input, true);
  if (!fila) return { ok: false, message: "The name can't be empty." };

  const sello = { updated_at: new Date().toISOString(), updated_by: yo.userId };
  const tabla = () => supabase.schema("recruiting").from("employee_files");
  let r = await tabla().insert({ ...fila, ...sello }).select("id").single();
  // Sin la 159 se guarda lo que la tabla sí tiene: agregar a alguien no puede depender de una migración.
  if (r.error && esColumnaQueFalta(r.error)) {
    r = await tabla().insert({ ...sin159(fila), ...sello }).select("id").single();
  }
  if (r.error) return { ok: false, message: r.error.message };
  return { ok: true, id: r.data.id as string };
}

// ============================================================
// La cuenta: se apaga, no se borra (D-251)
//
// Hasta hoy la unica baja era `/api/delete-user`, que borra la cuenta de Auth y con ella
// el perfil, y mientras el expediente colgaba de el, tambien el expediente. O sea que dar
// de baja a alguien borraba justo lo que RR. HH. necesita conservar.
//
// Aqui no se borra nada: se pone la fecha de salida y se deshabilita la cuenta. El
// expediente CONSERVA su `profile_id`, a proposito, para que la pregunta "tenia cuenta?"
// siga teniendo respuesta despues de que la persona se vaya.
//
// `delete-user` no se toca: sigue existiendo para lo que es, borrar de verdad.
// ============================================================

/** Un ban sin fecha practica de vuelta. Auth no tiene "deshabilitado" como estado, asi
 *  que un ban largo es la forma que hay; `none` es lo que lo levanta. */
const BAN_INDEFINIDO = "876000h"; // ~100 anos

async function comoAdminDeHr(): Promise<
  { ok: true; supabase: Awaited<ReturnType<typeof createClient>>; userId: string } | { ok: false; message: string }
> {
  const supabase = await createClient();
  const yo = await tier(supabase);
  if (!yo) return { ok: false, message: "Not signed in." };
  // Apagar una cuenta es mas que editar una ficha, asi que pide el mismo tramo que
  // enlazarla: el admin de RR. HH. Y es el rol del modulo, no `profiles.role` (D-053/D-057).
  if (!puedeDarDeBaja(yo.role)) return { ok: false, message: "Only an HR admin can deactivate or reactivate someone." };
  return { ok: true, supabase, userId: yo.userId };
}

/** Apaga o enciende la cuenta en Auth. Es el ÚNICO sitio que toca el ban (D-251): no hay otro camino. */
async function ponAcceso(profileId: string, encendida: boolean): Promise<{ ok: boolean; message?: string }> {
  let admin;
  try { admin = createAdminClient(); }
  catch { return { ok: false, message: "SUPABASE_SERVICE_ROLE_KEY is missing." }; }
  const { error } = await admin.auth.admin.updateUserById(profileId, { ban_duration: encendida ? "none" : BAN_INDEFINIDO });
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

/**
 * Da de baja: fecha de salida, motivo, nota y quién la registró en el expediente; y, SI SE PIDE, la cuenta
 * deshabilitada. Sobre alguien que ya está de baja corrige los datos de la baja.
 *
 * `quitarAcceso` es la casilla «Quitar también el acceso al hub» de la ventana. Antes la baja apagaba la cuenta
 * siempre; ahora es una decisión que se ve, porque hay bajas que conservan el acceso unos días.
 */
export async function deactivateEmployee(
  fileId: string,
  datos: { fecha?: string | null; motivo?: string | null; nota?: string | null; quitarAcceso?: boolean } = {},
): Promise<{ ok: boolean; message?: string; sinMotivo?: boolean; accesoQuitado?: boolean }> {
  const acceso = await comoAdminDeHr();
  if (!acceso.ok) return acceso;
  const { supabase, userId } = acceso;
  if (normalizaMotivoBaja(datos.motivo) === undefined) return { ok: false, message: "Unknown reason for leaving." };

  const { data: file, error: leer } = await supabase
    .schema("recruiting").from("employee_files").select("id, profile_id").eq("id", fileId).maybeSingle();
  if (leer) return { ok: false, message: leer.message };
  if (!file) return { ok: false, message: "No such employee file." };
  if (file.profile_id === userId) return { ok: false, message: "You can't deactivate your own account." };

  // La fecha primero: si el ban falla, la baja queda registrada y se puede reintentar. Al
  // reves, cuenta apagada y expediente sin fecha, nadie sabria por que esa persona no entra.
  const sello = { updated_at: new Date().toISOString(), updated_by: userId };
  const tabla = () => supabase.schema("recruiting").from("employee_files");
  let sinMotivo = false;
  let { error } = await tabla()
    .update({ ...parcheBajaCompleto({ fecha: datos.fecha, motivo: datos.motivo, nota: datos.nota, quien: userId }), ...sello })
    .eq("id", fileId);
  // Sin la 159 no hay dónde guardar el motivo: la baja se registra igual, con su fecha, y se dice.
  if (error && esColumnaQueFalta(error)) {
    sinMotivo = true;
    ({ error } = await tabla().update({ ...parcheBaja(datos.fecha), ...sello }).eq("id", fileId));
  }
  if (error) return { ok: false, message: error.message };

  if (!file.profile_id || !datos.quitarAcceso) return { ok: true, sinMotivo, accesoQuitado: false };
  const ban = await ponAcceso(file.profile_id as string, false);
  if (!ban.ok) return { ok: false, sinMotivo, message: `Marked as left, but the account could not be disabled: ${ban.message}` };
  return { ok: true, sinMotivo, accesoQuitado: true };
}

/**
 * Lo contrario: se borra la fecha (y los datos de la baja). **NO devuelve el acceso al hub**: una cuenta
 * apagada sigue apagada hasta que alguien pulse «Devolver acceso». Reactivar a alguien es decir que vuelve a
 * trabajar aquí; que vuelva a entrar al hub, con los permisos que tenía, es otra decisión y se toma aparte.
 */
export async function reactivateEmployee(fileId: string): Promise<{ ok: boolean; message?: string; tieneCuenta?: boolean }> {
  const acceso = await comoAdminDeHr();
  if (!acceso.ok) return acceso;
  const { supabase, userId } = acceso;

  const { data: file, error: leer } = await supabase
    .schema("recruiting").from("employee_files").select("id, profile_id").eq("id", fileId).maybeSingle();
  if (leer) return { ok: false, message: leer.message };
  if (!file) return { ok: false, message: "No such employee file." };

  const sello = { updated_at: new Date().toISOString(), updated_by: userId };
  const tabla = () => supabase.schema("recruiting").from("employee_files");
  let { error } = await tabla().update({ ...parcheAltaCompleto(), ...sello }).eq("id", fileId);
  if (error && esColumnaQueFalta(error)) {
    ({ error } = await tabla().update({ ...parcheAlta(), ...sello }).eq("id", fileId));
  }
  if (error) return { ok: false, message: error.message };
  return { ok: true, tieneCuenta: !!file.profile_id };
}

/**
 * Quita o devuelve el acceso al hub de la cuenta de un expediente, sin tocar su estado. Es el mismo ban de
 * D-251, con botón propio: lo que «Dar de baja» hace si se marca la casilla, y lo único que devuelve el acceso.
 */
export async function setHubAccess(fileId: string, encendida: boolean): Promise<{ ok: boolean; message?: string }> {
  const acceso = await comoAdminDeHr();
  if (!acceso.ok) return acceso;
  const { supabase, userId } = acceso;

  const { data: file, error: leer } = await supabase
    .schema("recruiting").from("employee_files").select("id, profile_id").eq("id", fileId).maybeSingle();
  if (leer) return { ok: false, message: leer.message };
  if (!file) return { ok: false, message: "No such employee file." };
  if (!file.profile_id) return { ok: false, message: "This person has no hub account." };
  if (!encendida && file.profile_id === userId) return { ok: false, message: "You can't remove your own access." };
  return ponAcceso(file.profile_id as string, encendida);
}

/**
 * Lo que Auth sabe de estas cuentas: si existen, como entran, cuando entraron por ultima
 * vez y si estan deshabilitadas.
 *
 * NADA de esto se guarda en el expediente, y esa es la decision. Copiarlo seria mentir en
 * cuanto alguien iniciara sesion: "ultimo acceso" envejece solo, y "deshabilitada" la puede
 * cambiar cualquiera desde el panel de Supabase sin pasar por aqui.
 */
export async function accountFactsFor(profileIds: string[]): Promise<
  { ok: true; facts: HechosDeCuenta[] } | { ok: false; message: string }
> {
  const supabase = await createClient();
  const yo = await tier(supabase);
  if (!yo || !PUEDE.includes(yo.role)) return { ok: false, message: "Employee files are for HR admins and managers." };

  const ids = [...new Set(profileIds.filter(Boolean))];
  if (ids.length === 0) return { ok: true, facts: [] };

  let admin;
  try { admin = createAdminClient(); }
  catch { return { ok: false, message: "Server not configured: SUPABASE_SERVICE_ROLE_KEY is missing." }; }

  const facts = await Promise.all(ids.map(async (id): Promise<HechosDeCuenta> => {
    const { data } = await admin.auth.admin.getUserById(id);
    const u = data?.user;
    if (!u) return { profile_id: id, existe: false, acceso: null, last_sign_in_at: null, deshabilitada: false };
    const email = u.email ?? "";
    // `banned_until` trae una fecha lejana cuando la cuenta esta apagada. Se compara con
    // ahora en vez de mirar solo si existe: un ban ya caducado no deshabilita nada.
    const hasta = (u as { banned_until?: string }).banned_until;
    return {
      profile_id: id,
      existe: true,
      acceso: email ? (isSyntheticEmail(email) ? "usuario" : "correo") : null,
      last_sign_in_at: u.last_sign_in_at ?? null,
      deshabilitada: !!hasta && new Date(hasta).getTime() > Date.now(),
    };
  }));
  return { ok: true, facts };
}

/** Añade o actualiza un documento. Sin `id` es alta; con `id`, corrección. */
export async function saveEmployeeDoc(input: {
  id?: string;
  employeeId: string;
  kind: string;
  signedAt?: string | null;
  expiresAt?: string | null;
  filePath?: string | null;
  note?: string | null;
}): Promise<{ ok: boolean; message?: string }> {
  const supabase = await createClient();
  const yo = await tier(supabase);
  if (!yo) return { ok: false, message: "Not signed in." };
  if (!PUEDE.includes(yo.role)) return { ok: false, message: "Employee files are for HR admins and managers." };

  const fila = {
    employee_id: input.employeeId,
    kind: input.kind,
    signed_at: input.signedAt || null,
    expires_at: input.expiresAt || null,
    file_path: input.filePath || null,
    note: input.note || null,
    created_by: yo.userId,
  };
  const { error } = input.id
    ? await supabase.schema("recruiting").from("employee_docs").update(fila).eq("id", input.id)
    : await supabase.schema("recruiting").from("employee_docs").insert(fila);
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

export async function deleteEmployeeDoc(id: string): Promise<{ ok: boolean; message?: string }> {
  const supabase = await createClient();
  const yo = await tier(supabase);
  if (!yo || !PUEDE.includes(yo.role)) return { ok: false, message: "Employee files are for HR admins and managers." };

  const { error } = await supabase.schema("recruiting").from("employee_docs").delete().eq("id", id);
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

/** Tipos que se aceptan. Un expediente son papeles escaneados y fotos de papeles. */
const TIPOS_OK = ["application/pdf", "image/jpeg", "image/png", "image/heic", "image/webp"];
const MAX_BYTES = 25 * 1024 * 1024;

/**
 * Sube un fichero y lo cuelga de un documento del expediente (D-158).
 *
 * Va por acción de servidor y no subiendo desde el navegador con la clave anónima, aunque la
 * política de la 096 lo permitiría: así el permiso se comprueba **en un solo sitio** y el
 * nombre del fichero lo decide el servidor. Dejar que el navegador elija la ruta es como se
 * acaba con un `../` en una clave de objeto.
 *
 * La ruta es `{empleado}/{tipo}/{uuid}.{ext}`. Con el uuid delante de la extensión, subir dos
 * veces la misma licencia no pisa la anterior — y en un expediente eso importa: la versión
 * vieja de un papel firmado es prueba de lo que se firmó entonces.
 */
export async function uploadDocFile(form: FormData): Promise<{ ok: boolean; path?: string; message?: string }> {
  const supabase = await createClient();
  const yo = await tier(supabase);
  if (!yo || !PUEDE.includes(yo.role)) return { ok: false, message: "Employee files are for HR admins and managers." };

  const file = form.get("file");
  const employeeId = String(form.get("employeeId") ?? "");
  const kind = String(form.get("kind") ?? "");
  if (!(file instanceof File) || !employeeId || !kind) return { ok: false, message: "Missing file." };
  if (file.size === 0) return { ok: false, message: "That file is empty." };
  if (file.size > MAX_BYTES) return { ok: false, message: "Too big — 25 MB max." };
  // Se comprueba el tipo declarado. No es una garantía —el navegador lo dice y el navegador
  // puede mentir— pero el cubo es privado y solo lo abre gente de RR. HH. con enlace firmado:
  // esto es para evitar el .docx subido sin querer, no para defenderse de un atacante.
  if (file.type && !TIPOS_OK.includes(file.type)) {
    return { ok: false, message: "Only PDF or an image." };
  }

  const ext = (file.name.split(".").pop() ?? "bin").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5);
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const path = `${employeeId}/${kind}/${id}.${ext}`;

  const { error } = await supabase.storage.from(HR_BUCKET).upload(path, file, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });
  if (error) return { ok: false, message: error.message };
  return { ok: true, path };
}

/** Enlace temporal para ver un documento. El bucket es privado y sigue siéndolo. */
export async function signDocUrl(path: string): Promise<string | null> {
  const supabase = await createClient();
  const yo = await tier(supabase);
  if (!yo || !PUEDE.includes(yo.role)) return null;

  const { data } = await supabase.storage.from(HR_BUCKET).createSignedUrl(path, 3600);
  return data?.signedUrl ?? null;
}

// ============================================================
// Las tiendas para elegir en el expediente (D-258)
//
// RR. HH. no tiene por qué tener Entregas, y `public.settings` la cierra la 100 a quien sí. Por
// eso la lista viene de `public.store_names()` (109), que devuelve solo nombre y orden. Sin
// sesión de RR. HH. no se pregunta: la lista solo sirve dentro de la ficha.
// ============================================================
export async function listStoreNames(): Promise<{ ok: true; names: string[] } | { ok: false; message: string }> {
  const supabase = await createClient();
  const yo = await tier(supabase);
  if (!yo || !PUEDE.includes(yo.role)) return { ok: false, message: "Employee files are for HR admins and managers." };
  const { data, error } = await supabase.rpc("store_names");
  if (error) return { ok: false, message: error.message };
  return { ok: true, names: ((data ?? []) as { name: string }[]).map((r) => r.name) };
}
