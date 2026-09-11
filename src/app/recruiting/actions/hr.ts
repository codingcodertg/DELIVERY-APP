"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSyntheticEmail } from "@/lib/username";
import { extensionValida, filasDeExpediente, limpiaExtension, parcheAlta, parcheBaja } from "@/lib/recruiting/employee-file";
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
  days_off: number | null;
  notes: string | null;
};

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
  { ok: true; rows: (EmployeeFile & { docKinds: string[] })[] } | { ok: false; message: string }
> {
  const supabase = await createClient();
  const yo = await tier(supabase);
  if (!yo || !PUEDE.includes(yo.role)) return { ok: false, message: "Employee files are for HR admins and managers." };

  const [{ data: files, error }, { data: people }, { data: docs }] = await Promise.all([
    supabase.schema("recruiting").from("employee_files").select("*"),
    supabase.from("profiles").select("id, full_name"),
    // Solo `kind` y de quién: la lista únicamente necesita saber QUÉ hay, no su contenido.
    supabase.schema("recruiting").from("employee_docs").select("employee_id, kind, signed_at"),
  ]);
  if (error) return { ok: false, message: error.message };

  return {
    ok: true,
    rows: filasDeExpediente(
      (files ?? []) as Record<string, unknown>[],
      (people ?? []) as { id: string; full_name?: string | null }[],
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
  patch: Partial<Omit<EmployeeFile, "id" | "full_name">>,
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
  if (patch.ringcentral_ext !== undefined && !extensionValida(patch.ringcentral_ext)) {
    return { ok: false, message: "A RingCentral extension is 2 to 6 digits." };
  }

  // Las fechas vacias se guardan como NULL y no como "": una cadena vacia en una columna de
  // fecha la rechaza Postgres, y el formulario manda "" en cuanto alguien borra el campo.
  const limpio: Record<string, unknown> = { id: fileId, updated_at: new Date().toISOString(), updated_by: yo.userId };
  for (const [k, v] of Object.entries(patch)) limpio[k] = v === "" ? null : v;
  if (patch.ringcentral_ext !== undefined) limpio.ringcentral_ext = limpiaExtension(patch.ringcentral_ext);

  const { error } = await supabase.schema("recruiting").from("employee_files").upsert(limpio);
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

// ============================================================
// La cuenta: se apaga, no se borra (D-NEXT)
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
  if (yo.role !== "admin") return { ok: false, message: "Only an HR admin can deactivate or reactivate someone." };
  return { ok: true, supabase, userId: yo.userId };
}

/** Da de baja: fecha de salida en el expediente y cuenta deshabilitada, si tiene. */
export async function deactivateEmployee(
  fileId: string,
  dateLeft?: string | null,
): Promise<{ ok: boolean; message?: string }> {
  const acceso = await comoAdminDeHr();
  if (!acceso.ok) return acceso;
  const { supabase, userId } = acceso;

  const { data: file, error: leer } = await supabase
    .schema("recruiting").from("employee_files").select("id, profile_id").eq("id", fileId).maybeSingle();
  if (leer) return { ok: false, message: leer.message };
  if (!file) return { ok: false, message: "No such employee file." };
  if (file.profile_id === userId) return { ok: false, message: "You can't deactivate your own account." };

  // La fecha primero: si el ban falla, la baja queda registrada y se puede reintentar. Al
  // reves, cuenta apagada y expediente sin fecha, nadie sabria por que esa persona no entra.
  const { error } = await supabase.schema("recruiting").from("employee_files")
    .update({ ...parcheBaja(dateLeft), updated_at: new Date().toISOString(), updated_by: userId })
    .eq("id", fileId);
  if (error) return { ok: false, message: error.message };

  if (!file.profile_id) return { ok: true };
  let admin;
  try { admin = createAdminClient(); }
  catch { return { ok: false, message: "Marked as left, but the account could not be disabled: SUPABASE_SERVICE_ROLE_KEY is missing." }; }
  const { error: banError } = await admin.auth.admin.updateUserById(file.profile_id as string, { ban_duration: BAN_INDEFINIDO });
  if (banError) return { ok: false, message: `Marked as left, but the account could not be disabled: ${banError.message}` };
  return { ok: true };
}

/** Lo contrario: se borra la fecha y la cuenta vuelve a entrar. */
export async function reactivateEmployee(fileId: string): Promise<{ ok: boolean; message?: string }> {
  const acceso = await comoAdminDeHr();
  if (!acceso.ok) return acceso;
  const { supabase, userId } = acceso;

  const { data: file, error: leer } = await supabase
    .schema("recruiting").from("employee_files").select("id, profile_id").eq("id", fileId).maybeSingle();
  if (leer) return { ok: false, message: leer.message };
  if (!file) return { ok: false, message: "No such employee file." };

  const { error } = await supabase.schema("recruiting").from("employee_files")
    .update({ ...parcheAlta(), updated_at: new Date().toISOString(), updated_by: userId })
    .eq("id", fileId);
  if (error) return { ok: false, message: error.message };

  if (!file.profile_id) return { ok: true };
  let admin;
  try { admin = createAdminClient(); }
  catch { return { ok: false, message: "Marked as active, but the account could not be re-enabled: SUPABASE_SERVICE_ROLE_KEY is missing." }; }
  const { error: banError } = await admin.auth.admin.updateUserById(file.profile_id as string, { ban_duration: "none" });
  if (banError) return { ok: false, message: `Marked as active, but the account could not be re-enabled: ${banError.message}` };
  return { ok: true };
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
