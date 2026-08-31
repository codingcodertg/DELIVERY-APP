"use server";

import { createClient } from "@/lib/supabase/server";

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
  id: string;
  full_name: string;
  employee_code: string | null;
  birthday: string | null;
  date_hired: string | null;
  phone: string | null;
  address: string | null;
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

/** La plantilla con su ficha, para la lista. Sin documentos: esos se piden al abrir a alguien. */
export async function listEmployeeFiles(): Promise<
  { ok: true; rows: (EmployeeFile & { docKinds: string[] })[] } | { ok: false; message: string }
> {
  const supabase = await createClient();
  const yo = await tier(supabase);
  if (!yo || !PUEDE.includes(yo.role)) return { ok: false, message: "Employee files are for HR admins and managers." };

  const [{ data: people, error }, { data: files }, { data: docs }] = await Promise.all([
    supabase.from("profiles").select("id, full_name").order("full_name"),
    supabase.schema("recruiting").from("employee_files").select("*"),
    // Solo `kind` y de quién: la lista únicamente necesita saber QUÉ hay, no su contenido.
    supabase.schema("recruiting").from("employee_docs").select("employee_id, kind, signed_at"),
  ]);
  if (error) return { ok: false, message: error.message };

  const porId = new Map((files ?? []).map((f) => [f.id as string, f]));
  const kindsDe = new Map<string, string[]>();
  for (const d of docs ?? []) {
    // Un papel sin fecha de firma está empezado, no hecho: no cuenta como entregado.
    if (!d.signed_at) continue;
    const k = d.employee_id as string;
    kindsDe.set(k, [...(kindsDe.get(k) ?? []), d.kind as string]);
  }

  return {
    ok: true,
    rows: (people ?? []).map((p) => {
      const f = porId.get(p.id as string);
      return {
        id: p.id as string,
        full_name: (p.full_name as string) ?? "—",
        employee_code: (f?.employee_code as string) ?? null,
        birthday: (f?.birthday as string) ?? null,
        date_hired: (f?.date_hired as string) ?? null,
        phone: (f?.phone as string) ?? null,
        address: (f?.address as string) ?? null,
        days_off: (f?.days_off as number) ?? null,
        notes: (f?.notes as string) ?? null,
        docKinds: kindsDe.get(p.id as string) ?? [],
      };
    }),
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

/** Guarda la parte de INFO. Crea la fila la primera vez. */
export async function saveEmployeeFile(
  employeeId: string,
  patch: Partial<Omit<EmployeeFile, "id" | "full_name">>,
): Promise<{ ok: boolean; message?: string }> {
  const supabase = await createClient();
  const yo = await tier(supabase);
  if (!yo) return { ok: false, message: "Not signed in." };
  if (!PUEDE.includes(yo.role)) return { ok: false, message: "Employee files are for HR admins and managers." };

  // Las fechas vacías se guardan como NULL y no como "": una cadena vacía en una columna de
  // fecha la rechaza Postgres, y el formulario manda "" en cuanto alguien borra el campo.
  const limpio: Record<string, unknown> = { id: employeeId, updated_at: new Date().toISOString(), updated_by: yo.userId };
  for (const [k, v] of Object.entries(patch)) limpio[k] = v === "" ? null : v;

  const { error } = await supabase.schema("recruiting").from("employee_files").upsert(limpio);
  if (error) return { ok: false, message: error.message };
  return { ok: true };
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

/** Enlace temporal para ver un documento. El bucket es privado y sigue siéndolo. */
export async function signDocUrl(path: string): Promise<string | null> {
  const supabase = await createClient();
  const yo = await tier(supabase);
  if (!yo || !PUEDE.includes(yo.role)) return null;

  const { data } = await supabase.storage.from("resumes").createSignedUrl(path, 3600);
  return data?.signedUrl ?? null;
}
