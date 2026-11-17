"use server";

import { createClient } from "@/lib/supabase/server";
import {
  EXTENSIONES_FIRMADO, EXTENSIONES_VARIANTE, MAX_BYTES_FIRMADO, MAX_BYTES_VARIANTE,
  estadoAlSubirFirmado, esEstadoDocumento, esIdValido, extensionPermitida, mimePorNombre, puedeCambiarEstado,
  rutaDeFirmado, rutaDeVariante, rutaPermitida, type EstadoDocumento,
} from "@/lib/recruiting/plantillas-de-documentos";

/**
 * Documentos de ingreso (migración 315): biblioteca, variantes, elección por empleado y copias firmadas.
 *
 * Se lee y escribe con la sesión de quien mira; la política de la 315 (admin y gerente de RR. HH., igual que el
 * expediente) decide. Los archivos NO pasan por el cuerpo de una acción (el límite de Vercel corta antes de 20 MB):
 * `prepareDocUpload` reserva la ruta y firma la subida, el navegador sube directo al cubo privado `hr-docs`, y luego se
 * avisa aquí con la ruta para guardar la fila. El nombre de la ruta lo decide el servidor.
 */

const PUEDE = ["admin", "manager"];
/** El cubo privado de los papeles del expediente (096): sus políticas ya son admin y gerente. */
const BUCKET = "hr-docs";
const SIN_PERMISO = "Document templates are for HR admins and managers.";
const SINTABLA = "Migration 315 is not applied yet: onboarding documents are set up pending.";
const CAMPOS_VARIANTE = "id, template_id, label, positions, offer_note, active, file_path, file_name, mime, size, version, updated_at";

async function quien(supabase: Awaited<ReturnType<typeof createClient>>): Promise<{ userId: string; role: string } | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from("profiles").select("recruiting_role").eq("id", user.id).single();
  return { userId: user.id, role: (data?.recruiting_role as string) ?? "" };
}

/** ¿Faltan las tablas de la 315? PGRST205 / 42P01. Así la pantalla dice «pendiente» y no se rompe. */
function faltaLa315(error: { code?: string | null } | null | undefined): boolean {
  return error?.code === "PGRST205" || error?.code === "42P01";
}

function texto(v: unknown, max: number): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s.slice(0, max) : null;
}

/** Los puestos llegan como texto «A, B, C»: se separan, se quitan repetidos y vacíos. */
function puestosDe(v: unknown): string[] {
  const partes = (typeof v === "string" ? v : "").split(",").map((p) => p.trim().slice(0, 120)).filter(Boolean);
  return [...new Set(partes)].slice(0, 30);
}

export type DocumentoFila = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  sort_order: number;
  active: boolean;
  applies_to_all: boolean;
};

export type VarianteFila = {
  id: string;
  template_id: string;
  label: string;
  positions: string[];
  offer_note: string | null;
  active: boolean;
  file_path: string;
  file_name: string;
  mime: string | null;
  size: number | null;
  version: number;
  updated_at: string;
};

export type VersionFila = { id: string; version: number; file_path: string; file_name: string; size: number | null; created_at: string };

export type RegistroDeIngreso = {
  id: string;
  template_id: string;
  variant_id: string | null;
  variant_version: number | null;
  status: EstadoDocumento;
  signed_file_path: string | null;
  signed_file_name: string | null;
  field_values: Record<string, string>;
  reviewed_at: string | null;
  updated_by_name: string | null;
  updated_at: string;
};

export type ArchivoSubido = { path: string; fileName: string; size: number };

/** La biblioteca entera: documentos y variantes (activos y archivados), para la pantalla del gerente. */
export async function listDocumentLibrary(): Promise<
  { ok: true; documentos: DocumentoFila[]; variantes: VarianteFila[] } | { ok: false; message: string; sinTabla: boolean }
> {
  const supabase = await createClient();
  const yo = await quien(supabase);
  if (!yo || !PUEDE.includes(yo.role)) return { ok: false, message: SIN_PERMISO, sinTabla: false };
  const sb = supabase.schema("recruiting");
  const [{ data: docs, error: e1 }, { data: vars, error: e2 }] = await Promise.all([
    sb.from("document_templates").select("id, name, description, category, sort_order, active, applies_to_all")
      .order("sort_order", { ascending: true }).order("name", { ascending: true }),
    sb.from("document_variants").select(CAMPOS_VARIANTE).order("label", { ascending: true }),
  ]);
  const error = e1 ?? e2;
  if (error) return { ok: false, message: faltaLa315(error) ? SINTABLA : error.message, sinTabla: faltaLa315(error) };
  return { ok: true, documentos: (docs ?? []) as DocumentoFila[], variantes: (vars ?? []) as VarianteFila[] };
}

/** Las versiones anteriores del archivo de una variante, la más nueva primero. */
export async function listVariantVersions(variantId: string): Promise<
  { ok: true; versiones: VersionFila[] } | { ok: false; message: string }
> {
  const supabase = await createClient();
  const yo = await quien(supabase);
  if (!yo || !PUEDE.includes(yo.role)) return { ok: false, message: SIN_PERMISO };
  if (!esIdValido(variantId)) return { ok: false, message: "Unknown variant." };
  const { data, error } = await supabase.schema("recruiting").from("document_variant_versions")
    .select("id, version, file_path, file_name, size, created_at").eq("variant_id", variantId).order("version", { ascending: false });
  if (error) return { ok: false, message: faltaLa315(error) ? SINTABLA : error.message };
  return { ok: true, versiones: (data ?? []) as VersionFila[] };
}

/**
 * Paso 1 de cualquier subida. Valida el archivo, reserva su ruta y devuelve una firma de subida para el navegador.
 *   · «variante» nueva: `templateId`, sin `variantId` → versión 1. Nueva versión: `variantId` → la siguiente.
 *   · «firmado»: copia firmada de un empleado para un documento.
 */
export async function prepareDocUpload(input:
  | { kind: "variante"; templateId?: string | null; variantId?: string | null; fileName: string; size: number }
  | { kind: "firmado"; employeeId: string; templateId: string; fileName: string; size: number },
): Promise<{ ok: true; id: string; version: number; path: string; token: string } | { ok: false; message: string }> {
  const supabase = await createClient();
  const yo = await quien(supabase);
  if (!yo || !PUEDE.includes(yo.role)) return { ok: false, message: SIN_PERMISO };

  const nombre = texto(input.fileName, 200) ?? "";
  const size = Number(input.size);

  if (input.kind === "variante") {
    if (!extensionPermitida(nombre, EXTENSIONES_VARIANTE)) return { ok: false, message: "Documents must be Word (.docx), PDF or Excel (.xlsx)." };
    if (!(size > 0) || size > MAX_BYTES_VARIANTE) return { ok: false, message: "Documents are 20 MB max." };
    let id = crypto.randomUUID();
    let version = 1;
    if (input.variantId) {
      if (!esIdValido(input.variantId)) return { ok: false, message: "Unknown variant." };
      const { data, error } = await supabase.schema("recruiting").from("document_variants")
        .select("version").eq("id", input.variantId).maybeSingle();
      if (error) return { ok: false, message: faltaLa315(error) ? SINTABLA : error.message };
      if (!data) return { ok: false, message: "That variant no longer exists." };
      id = input.variantId;
      version = Number(data.version) + 1;
    } else if (!esIdValido(input.templateId)) {
      return { ok: false, message: "Unknown document." };
    }
    const path = rutaDeVariante(id, version, nombre);
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error || !data) return { ok: false, message: error?.message ?? "Could not prepare the upload." };
    return { ok: true, id, version, path: data.path, token: data.token };
  }

  if (!esIdValido(input.employeeId) || !esIdValido(input.templateId)) return { ok: false, message: "Unknown employee or document." };
  if (!extensionPermitida(nombre, EXTENSIONES_FIRMADO)) return { ok: false, message: "Signed copies: PDF, Word, Excel or an image." };
  if (!(size > 0) || size > MAX_BYTES_FIRMADO) return { ok: false, message: "Signed copies are 25 MB max." };
  const path = rutaDeFirmado(input.employeeId, input.templateId, Date.now(), nombre);
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data) return { ok: false, message: error?.message ?? "Could not prepare the upload." };
  return { ok: true, id: input.templateId, version: 0, path: data.path, token: data.token };
}

/** Crea un documento (sin archivo: sus archivos son las variantes). */
export async function createDocument(input: {
  name: string; description?: string | null; category?: string | null; sortOrder?: number; active: boolean; appliesToAll: boolean;
}): Promise<{ ok: boolean; id?: string; message?: string }> {
  const supabase = await createClient();
  const yo = await quien(supabase);
  if (!yo || !PUEDE.includes(yo.role)) return { ok: false, message: SIN_PERMISO };
  const nombre = texto(input.name, 120);
  if (!nombre) return { ok: false, message: "The document needs a name." };
  const id = crypto.randomUUID();
  const { error } = await supabase.schema("recruiting").from("document_templates").insert({
    id, name: nombre, description: texto(input.description, 1000), category: texto(input.category, 40),
    sort_order: Number.isFinite(input.sortOrder) ? Number(input.sortOrder) : 100,
    active: input.active, applies_to_all: input.appliesToAll, created_by: yo.userId,
  });
  if (error) return { ok: false, message: faltaLa315(error) ? SINTABLA : error.message };
  return { ok: true, id };
}

export async function updateDocument(id: string, input: {
  name: string; description?: string | null; category?: string | null; sortOrder?: number; active: boolean; appliesToAll: boolean;
}): Promise<{ ok: boolean; message?: string }> {
  const supabase = await createClient();
  const yo = await quien(supabase);
  if (!yo || !PUEDE.includes(yo.role)) return { ok: false, message: SIN_PERMISO };
  if (!esIdValido(id)) return { ok: false, message: "Unknown document." };
  const nombre = texto(input.name, 120);
  if (!nombre) return { ok: false, message: "The document needs a name." };
  const { error } = await supabase.schema("recruiting").from("document_templates").update({
    name: nombre, description: texto(input.description, 1000), category: texto(input.category, 40),
    sort_order: Number.isFinite(input.sortOrder) ? Number(input.sortOrder) : 100,
    active: input.active, applies_to_all: input.appliesToAll, updated_at: new Date().toISOString(),
  }).eq("id", id);
  if (error) return { ok: false, message: faltaLa315(error) ? SINTABLA : error.message };
  return { ok: true };
}

/** Borra un documento solo si no tiene variantes con registros de empleados. Si no, se archiva. */
export async function deleteDocument(id: string): Promise<{ ok: boolean; message?: string }> {
  const supabase = await createClient();
  const yo = await quien(supabase);
  if (!yo || !PUEDE.includes(yo.role)) return { ok: false, message: SIN_PERMISO };
  if (!esIdValido(id)) return { ok: false, message: "Unknown document." };
  const sb = supabase.schema("recruiting");
  const { count, error: e1 } = await sb.from("employee_documents").select("id", { count: "exact", head: true }).eq("template_id", id);
  if (e1) return { ok: false, message: faltaLa315(e1) ? SINTABLA : e1.message };
  if ((count ?? 0) > 0) return { ok: false, message: "Employees already have a record for this document, so it can't be deleted. Archive it instead." };
  const { data: variantes } = await sb.from("document_variants").select("id, file_path").eq("template_id", id);
  const idsVariantes = (variantes ?? []).map((v) => v.id as string);
  const { data: versiones } = idsVariantes.length
    ? await sb.from("document_variant_versions").select("file_path").in("variant_id", idsVariantes)
    : { data: [] as { file_path: string }[] };
  const rutas = [...(variantes ?? []).map((v) => v.file_path as string), ...(versiones ?? []).map((v) => v.file_path as string)]
    .filter((p) => rutaPermitida(p));
  const { error: e2 } = await sb.from("document_templates").delete().eq("id", id);
  if (e2) return { ok: false, message: e2.message };
  if (rutas.length) await supabase.storage.from(BUCKET).remove(rutas);
  return { ok: true };
}

/** Paso 2 de «variante nueva»: guarda la fila con el archivo ya subido. */
export async function createVariant(input: {
  id: string; templateId: string; label: string; positions: unknown; offerNote?: string | null; active: boolean; file: ArchivoSubido;
}): Promise<{ ok: boolean; message?: string }> {
  const supabase = await createClient();
  const yo = await quien(supabase);
  if (!yo || !PUEDE.includes(yo.role)) return { ok: false, message: SIN_PERMISO };
  if (!esIdValido(input.id) || !esIdValido(input.templateId)) return { ok: false, message: "Unknown document or variant." };
  const label = texto(input.label, 160);
  if (!label) return { ok: false, message: "The variant needs a name." };
  // La ruta tiene que ser la reservada para esta variante, versión 1: nada de meter una ruta ajena.
  if (input.file.path !== rutaDeVariante(input.id, 1, input.file.fileName)) return { ok: false, message: "The uploaded file does not match this variant." };
  const { error } = await supabase.schema("recruiting").from("document_variants").insert({
    id: input.id, template_id: input.templateId, label, positions: puestosDe(input.positions),
    offer_note: texto(input.offerNote, 200), active: input.active,
    file_path: input.file.path, file_name: texto(input.file.fileName, 200) ?? "archivo",
    mime: mimePorNombre(input.file.fileName), size: input.file.size, version: 1, created_by: yo.userId,
  });
  if (error) return { ok: false, message: faltaLa315(error) ? SINTABLA : error.message };
  return { ok: true };
}

/** Cambia los datos de una variante (no su archivo: para eso, una versión nueva). Sirve para archivarla. */
export async function updateVariant(id: string, input: {
  label: string; positions: unknown; offerNote?: string | null; active: boolean;
}): Promise<{ ok: boolean; message?: string }> {
  const supabase = await createClient();
  const yo = await quien(supabase);
  if (!yo || !PUEDE.includes(yo.role)) return { ok: false, message: SIN_PERMISO };
  if (!esIdValido(id)) return { ok: false, message: "Unknown variant." };
  const label = texto(input.label, 160);
  if (!label) return { ok: false, message: "The variant needs a name." };
  const { error } = await supabase.schema("recruiting").from("document_variants").update({
    label, positions: puestosDe(input.positions), offer_note: texto(input.offerNote, 200),
    active: input.active, updated_at: new Date().toISOString(),
  }).eq("id", id);
  if (error) return { ok: false, message: faltaLa315(error) ? SINTABLA : error.message };
  return { ok: true };
}

/**
 * Paso 2 de «nueva versión»: el archivo vigente pasa al historial y el nuevo queda vigente con versión + 1. Si la versión
 * de la base ya no es la reservada (otra persona subió antes), se rechaza.
 */
export async function addVariantVersion(id: string, file: ArchivoSubido): Promise<{ ok: boolean; message?: string }> {
  const supabase = await createClient();
  const yo = await quien(supabase);
  if (!yo || !PUEDE.includes(yo.role)) return { ok: false, message: SIN_PERMISO };
  if (!esIdValido(id)) return { ok: false, message: "Unknown variant." };
  const sb = supabase.schema("recruiting");
  const { data: actual, error: e1 } = await sb.from("document_variants")
    .select("version, file_path, file_name, mime, size").eq("id", id).maybeSingle();
  if (e1) return { ok: false, message: faltaLa315(e1) ? SINTABLA : e1.message };
  if (!actual) return { ok: false, message: "That variant no longer exists." };

  const nueva = Number(actual.version) + 1;
  if (file.path !== rutaDeVariante(id, nueva, file.fileName)) return { ok: false, message: "The uploaded file does not match this version." };

  // Primero el historial (la versión que se va); luego el puntero con optimismo (`eq version`). Si el puntero no se mueve,
  // se deshace el historial, para no dejar una versión duplicada.
  const { data: hist, error: e2 } = await sb.from("document_variant_versions").insert({
    variant_id: id, version: Number(actual.version), file_path: actual.file_path, file_name: actual.file_name,
    mime: actual.mime, size: actual.size, created_by: yo.userId,
  }).select("id").single();
  if (e2) return { ok: false, message: faltaLa315(e2) ? SINTABLA : e2.message };

  const { data: movida, error: e3 } = await sb.from("document_variants").update({
    file_path: file.path, file_name: texto(file.fileName, 200) ?? "archivo", mime: mimePorNombre(file.fileName),
    size: file.size, version: nueva, updated_at: new Date().toISOString(),
  }).eq("id", id).eq("version", actual.version).select("id");
  if (e3 || !movida || movida.length === 0) {
    await sb.from("document_variant_versions").delete().eq("id", hist.id);
    return { ok: false, message: e3?.message ?? "Someone else changed this document a moment ago. Reload and try again." };
  }
  return { ok: true };
}

/** Borra una variante con su historial y sus archivos. Con registros de empleados, no: se archiva. */
export async function deleteVariant(id: string): Promise<{ ok: boolean; message?: string }> {
  const supabase = await createClient();
  const yo = await quien(supabase);
  if (!yo || !PUEDE.includes(yo.role)) return { ok: false, message: SIN_PERMISO };
  if (!esIdValido(id)) return { ok: false, message: "Unknown variant." };
  const sb = supabase.schema("recruiting");
  const { count, error: e1 } = await sb.from("employee_documents").select("id", { count: "exact", head: true }).eq("variant_id", id);
  if (e1) return { ok: false, message: faltaLa315(e1) ? SINTABLA : e1.message };
  if ((count ?? 0) > 0) return { ok: false, message: "Employees already use this variant, so it can't be deleted. Archive it instead." };
  const { data: v } = await sb.from("document_variants").select("file_path").eq("id", id).maybeSingle();
  const { data: versiones } = await sb.from("document_variant_versions").select("file_path").eq("variant_id", id);
  const rutas = [v?.file_path, ...(versiones ?? []).map((x) => x.file_path)].filter((p): p is string => !!p && rutaPermitida(p));
  const { error: e2 } = await sb.from("document_variants").delete().eq("id", id);
  if (e2) return { ok: false, message: e2.message };
  if (rutas.length) await supabase.storage.from(BUCKET).remove(rutas);
  return { ok: true };
}

/** Enlace temporal (una hora) para ver o bajar un archivo del cubo. Solo rutas de variantes o de firmas. */
export async function signDocFileUrl(path: string): Promise<string | null> {
  const supabase = await createClient();
  const yo = await quien(supabase);
  if (!yo || !PUEDE.includes(yo.role)) return null;
  if (!rutaPermitida(path)) return null;
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
  return data?.signedUrl ?? null;
}

/**
 * Lo que la ficha de un empleado necesita: TODOS los documentos y variantes activos (el filtro por puesto lo hace la
 * pantalla con `documentosParaEmpleado`) más el registro que ya exista para él, aunque su variante esté archivada.
 */
export async function listOnboardingDocs(employeeId: string): Promise<
  { ok: true; documentos: DocumentoFila[]; variantes: VarianteFila[]; registros: RegistroDeIngreso[] }
  | { ok: false; message: string; sinTabla: boolean }
> {
  const supabase = await createClient();
  const yo = await quien(supabase);
  if (!yo || !PUEDE.includes(yo.role)) return { ok: false, message: SIN_PERMISO, sinTabla: false };
  if (!esIdValido(employeeId)) return { ok: false, message: "Unknown employee.", sinTabla: false };
  const sb = supabase.schema("recruiting");
  const [{ data: docs, error: e1 }, { data: vars, error: e2 }, { data: regs, error: e3 }] = await Promise.all([
    sb.from("document_templates").select("id, name, description, category, sort_order, active, applies_to_all")
      .eq("active", true).order("sort_order", { ascending: true }).order("name", { ascending: true }),
    sb.from("document_variants").select(CAMPOS_VARIANTE),
    sb.from("employee_documents")
      .select("id, template_id, variant_id, variant_version, status, signed_file_path, signed_file_name, field_values, reviewed_at, updated_by_name, updated_at")
      .eq("employee_id", employeeId),
  ]);
  const error = e1 ?? e2 ?? e3;
  if (error) return { ok: false, message: faltaLa315(error) ? SINTABLA : error.message, sinTabla: faltaLa315(error) };
  return {
    ok: true,
    documentos: (docs ?? []) as DocumentoFila[],
    variantes: (vars ?? []) as VarianteFila[],
    registros: ((regs ?? []) as RegistroDeIngreso[]).map((r) => ({ ...r, field_values: (r.field_values ?? {}) as Record<string, string> })),
  };
}

/** Qué variante se usa para un empleado y un documento (la sugerida, o la que RR. HH. elige a mano). No cambia el estado. */
export async function setOnboardingVariant(input: {
  employeeId: string; templateId: string; variantId: string; variantVersion: number;
}): Promise<{ ok: boolean; message?: string }> {
  const supabase = await createClient();
  const yo = await quien(supabase);
  if (!yo || !PUEDE.includes(yo.role)) return { ok: false, message: SIN_PERMISO };
  if (!esIdValido(input.employeeId) || !esIdValido(input.templateId) || !esIdValido(input.variantId)) return { ok: false, message: "Unknown employee, document or variant." };
  const { error } = await supabase.schema("recruiting").from("employee_documents").upsert({
    employee_id: input.employeeId, template_id: input.templateId, variant_id: input.variantId,
    variant_version: input.variantVersion, updated_by: yo.userId, updated_at: new Date().toISOString(),
  }, { onConflict: "employee_id,template_id" });
  if (error) return { ok: false, message: faltaLa315(error) ? SINTABLA : error.message };
  return { ok: true };
}

/** Cambia el estado de un documento para un empleado. Lo marca quien lo hace. */
export async function setOnboardingStatus(input: {
  employeeId: string; templateId: string; status: EstadoDocumento;
}): Promise<{ ok: boolean; message?: string }> {
  const supabase = await createClient();
  const yo = await quien(supabase);
  if (!yo || !PUEDE.includes(yo.role)) return { ok: false, message: SIN_PERMISO };
  if (!esIdValido(input.employeeId) || !esIdValido(input.templateId)) return { ok: false, message: "Unknown employee or document." };
  if (!esEstadoDocumento(input.status)) return { ok: false, message: "Unknown status." };

  const sb = supabase.schema("recruiting");
  const { data: previo, error: e1 } = await sb.from("employee_documents")
    .select("status, signed_file_path").eq("employee_id", input.employeeId).eq("template_id", input.templateId).maybeSingle();
  if (e1) return { ok: false, message: faltaLa315(e1) ? SINTABLA : e1.message };

  const cambio = puedeCambiarEstado(previo?.status as EstadoDocumento | undefined, input.status, !!previo?.signed_file_path);
  if (!cambio.ok) {
    if (cambio.motivo === "igual") return { ok: true };
    return { ok: false, message: cambio.motivo === "con_firma"
      ? "It has a signed copy: remove it before setting it back to pending."
      : "Unknown status." };
  }

  const { data: actor } = await supabase.from("profiles").select("full_name").eq("id", yo.userId).maybeSingle();
  const { error } = await sb.from("employee_documents").upsert({
    employee_id: input.employeeId, template_id: input.templateId, status: input.status,
    updated_by: yo.userId, updated_by_name: actor?.full_name ?? null, updated_at: new Date().toISOString(),
  }, { onConflict: "employee_id,template_id" });
  if (error) return { ok: false, message: faltaLa315(error) ? SINTABLA : error.message };
  return { ok: true };
}

/**
 * Guarda los campos que RR. HH. confirmó en «Information is correct» (por empleado, documento, variante y versión).
 * Así reimprimir reusa exactamente lo confirmado. No cambia el estado: imprimir no es enviar ni firmar.
 */
export async function saveReviewedFields(input: {
  employeeId: string; templateId: string; variantId: string; variantVersion: number; values: Record<string, string>;
}): Promise<{ ok: boolean; message?: string }> {
  const supabase = await createClient();
  const yo = await quien(supabase);
  if (!yo || !PUEDE.includes(yo.role)) return { ok: false, message: SIN_PERMISO };
  if (!esIdValido(input.employeeId) || !esIdValido(input.templateId) || !esIdValido(input.variantId)) return { ok: false, message: "Unknown employee, document or variant." };
  // Solo texto, con largo acotado: son valores que van a un documento oficial.
  const limpios: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.values ?? {}).slice(0, 50)) {
    if (typeof v === "string") limpios[k.slice(0, 80)] = v.slice(0, 300);
  }
  const { data: actor } = await supabase.from("profiles").select("full_name").eq("id", yo.userId).maybeSingle();
  const ahora = new Date().toISOString();
  const { error } = await supabase.schema("recruiting").from("employee_documents").upsert({
    employee_id: input.employeeId, template_id: input.templateId, variant_id: input.variantId, variant_version: input.variantVersion,
    field_values: limpios, reviewed_by: yo.userId, reviewed_at: ahora,
    updated_by: yo.userId, updated_by_name: actor?.full_name ?? null, updated_at: ahora,
  }, { onConflict: "employee_id,template_id" });
  if (error) return { ok: false, message: faltaLa315(error) ? SINTABLA : error.message };
  return { ok: true };
}

/**
 * Guarda la copia firmada subida y deja el estado en «firmado». La copia anterior NO se borra del cubo: si hubo dos
 * firmas, las dos quedan como prueba.
 */
export async function attachSignedCopy(input: {
  employeeId: string; templateId: string; file: ArchivoSubido;
}): Promise<{ ok: boolean; message?: string }> {
  const supabase = await createClient();
  const yo = await quien(supabase);
  if (!yo || !PUEDE.includes(yo.role)) return { ok: false, message: SIN_PERMISO };
  const { employeeId, templateId, file } = input;
  if (!esIdValido(employeeId) || !esIdValido(templateId)) return { ok: false, message: "Unknown employee or document." };
  if (!rutaPermitida(file.path, employeeId, templateId)) return { ok: false, message: "The uploaded file does not belong to this employee and document." };
  if (!extensionPermitida(file.fileName, EXTENSIONES_FIRMADO)) return { ok: false, message: "Signed copies: PDF, Word, Excel or an image." };

  const { data: actor } = await supabase.from("profiles").select("full_name").eq("id", yo.userId).maybeSingle();
  const { error } = await supabase.schema("recruiting").from("employee_documents").upsert({
    employee_id: employeeId, template_id: templateId, status: estadoAlSubirFirmado(),
    signed_file_path: file.path, signed_file_name: texto(file.fileName, 200) ?? "archivo",
    updated_by: yo.userId, updated_by_name: actor?.full_name ?? null, updated_at: new Date().toISOString(),
  }, { onConflict: "employee_id,template_id" });
  if (error) return { ok: false, message: faltaLa315(error) ? SINTABLA : error.message };
  return { ok: true };
}
