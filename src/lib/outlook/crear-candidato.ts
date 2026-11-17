/**
 * Alta de un candidato que llegó por correo de Indeed, desde el servidor (cron o «Revisar ahora»).
 *
 * POR QUÉ NO ES LA MISMA FUNCIÓN QUE USA RR. HH. Su alta (`addCandidate` en recruiting-data-provider.tsx) corre en el
 * NAVEGADOR con la sesión del usuario: no hay sesión en un cron. Por eso aquí se reusan las MISMAS piezas puras que
 * usa esa función: `patronTel`/`patronNombre`/`buscaDuplicado` (candidato-duplicado.ts) para no crear dos veces a la
 * misma persona, y `estandarizaCandidato` para que el teléfono, el nombre y el correo queden en el formato estándar.
 * Si esa lógica cambia, cambian las dos; lo comparten los tests de candidato-duplicado.
 *
 * Reglas del importador (las decide el dueño):
 *  - Toda ficha creada por el importador lleva la etiqueta `ETIQUETA_IMPORTACION_INDEED`.
 *  - Si la persona ya existe, NUNCA se sobrescribe: solo se llenan los campos VACÍOS (teléfono, correo, puesto, ciudad
 *    de la vacante, dónde vive) y, si no tenía CV, se guarda el de este correo.
 *  - Un mensaje de Indeed sin teléfono nace descartado (`descarte`). Si después llega un teléfono para esa persona, la
 *    ficha se queda descartada, se llena el teléfono si estaba vacío y se anota «Llegó teléfono después».
 *
 * Escribe con la llave de servicio (salta RLS), así que quien llama tiene que ser el servidor ya autorizado.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { buscaDuplicado, digitosTel, patronNombre, patronTel } from "@/lib/recruiting/candidato-duplicado";
import { estandarizaCandidato } from "@/lib/recruiting/formato";
import { nombreDelCv, nombreSeguro } from "@/lib/recruiting/nombre-del-cv";
import type { CandidatoDeIndeed } from "./indeed";
import { validaCv } from "./cv";

/** Etiqueta que lleva toda ficha creada desde Indeed (para filtrarlas en RR. HH.). Cambiarla aquí la cambia en todo. */
export const ETIQUETA_IMPORTACION_INDEED = "Indeed import";

/** Motivo del descarte automático de un mensaje de Indeed que no trae teléfono. */
export const MOTIVO_SIN_TELEFONO_MENSAJE = "Sin teléfono en el mensaje de Indeed";

/** Campos que se llenan solo si la ficha existente los tiene vacíos. */
export const CAMPOS_QUE_SE_LLENAN = ["phone", "email", "role", "location", "home_location"] as const;
export type CampoQueSeLlena = (typeof CAMPOS_QUE_SE_LLENAN)[number];

/** Las etiquetas del alta: las calificaciones de la solicitud más la de importación, sin repetir. */
export function etiquetasDeAlta(tags: readonly string[]): string[] {
  const limpias = tags.map((t) => t.trim()).filter((t) => t.length > 0);
  return [...new Set([...limpias, ETIQUETA_IMPORTACION_INDEED])];
}

/**
 * De los campos del alta, solo los que la ficha tiene VACÍOS y el correo trae con valor. Nunca pisa un valor existente.
 */
export function camposVacios(
  ficha: Partial<Record<CampoQueSeLlena, string | null>>,
  alta: Partial<Record<CampoQueSeLlena, string | null>>,
): Partial<Record<CampoQueSeLlena, string>> {
  const out: Partial<Record<CampoQueSeLlena, string>> = {};
  for (const campo of CAMPOS_QUE_SE_LLENAN) {
    const nuevo = (alta[campo] ?? "").trim();
    const actual = (ficha[campo] ?? "").trim();
    if (nuevo && !actual) out[campo] = nuevo;
  }
  return out;
}

/** ¿Llegó teléfono para una ficha descartada que no lo tenía? Esa es la nota «Llegó teléfono después». */
export function llegoTelefonoTarde(ficha: { status: string | null; phone: string | null }, telefono: string | null): boolean {
  return ficha.status === "discarded" && !(ficha.phone ?? "").trim() && !!(telefono ?? "").trim();
}

/** El parche del alta de un candidato NUEVO. Un mensaje sin teléfono sale descartado; el resto, normal. */
export function payloadDeAlta(c: CandidatoDeIndeed) {
  const base = estandarizaCandidato({
    name: c.name,
    phone: c.phone,
    email: c.email,
    role: c.role,
    location: c.location ?? null,
    home_location: c.home_location,
    source: "Indeed",
    notes: c.notes,
    tags: etiquetasDeAlta(c.tags),
    resume_passed: false,
  });
  if (!c.descarte) return base;
  return {
    ...base,
    status: "discarded",
    discard_source: "recruiter",
    discard_reason: c.descarte.motivo,
    phone_date: null,
    follow_up: null,
  };
}

/** Aviso cuando la persona existe pero la coincidencia es solo por nombre: no se toca nada. */
export const AVISO_SOLO_NOMBRE = "Coincide solo por nombre; no se completó";

/** Por qué una ficha existente es la misma persona que el correo. Solo «telefono» y «email» son de confianza. */
export type PorDonde = "telefono" | "email" | "nombre";

/**
 * Cómo coincide la ficha existente con el alta. Teléfono (mismos dígitos) o correo directo (no relay) son de confianza;
 * solo el nombre no lo es (D-1050: dos personas pueden llamarse igual).
 */
export function comoCoincide(
  existente: { phone: string | null; email?: string | null; name?: string | null },
  nuevo: { phone: string; email: string | null; correoEsRelay: boolean; name?: string | null },
): PorDonde {
  // Teléfono o correo solos no bastan para escribir en una ficha ajena: el teléfono puede venir del texto libre de un
  // mensaje. Además el nombre no puede chocar (revisión de seguridad); si choca, cuenta como «solo nombre» (no se toca).
  const n = (x: string | null | undefined) => (x ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
  if (nuevo.name !== undefined && existente.name !== undefined && n(nuevo.name) && n(existente.name) && n(nuevo.name) !== n(existente.name)) return "nombre";
  const tel = digitosTel(nuevo.phone);
  if (tel.length >= 7 && digitosTel(existente.phone) === tel) return "telefono";
  const correo = (nuevo.email ?? "").trim().toLowerCase();
  if (correo && !nuevo.correoEsRelay && (existente.email ?? "").trim().toLowerCase() === correo) return "email";
  return "nombre";
}

export interface AltaDesdeCorreo {
  resultado: "created" | "duplicate";
  candidateId: string;
  /** Aviso no fatal sobre el CV (no era PDF/DOC/DOCX, pesaba mucho, no se pudo subir). El candidato sí se creó. */
  avisoCv: string | null;
  /** Aviso de la coincidencia (p. ej. «Coincide solo por nombre; no se completó»). */
  aviso?: string | null;
}

export async function crearCandidatoDesdeCorreo(
  db: SupabaseClient,
  c: CandidatoDeIndeed,
  cv: { nombreFichero: string; bytes: Buffer } | null,
): Promise<AltaDesdeCorreo> {
  const payload = payloadDeAlta(c);

  // Antes de crear, se pregunta a la BASE por el mismo teléfono (cualquier formato) o el mismo nombre. Igual que el alta
  // del navegador: si existe, se usa esa persona y no se crea otra.
  const pTel = patronTel(payload.phone ?? null);
  const pNom = patronNombre(payload.name ?? null);
  const recruiting = db.schema("recruiting");
  // El correo directo (no relay) también identifica a la persona; el relay de Indeed no dice quién es.
  const correoDirecto = !c.correoEsRelay && payload.email ? payload.email : null;
  const [porTel, porNom, porMail] = await Promise.all([
    pTel ? recruiting.from("candidates").select("id, name, phone, email").ilike("phone", pTel).limit(25) : Promise.resolve({ data: [] as Fila[], error: null }),
    pNom ? recruiting.from("candidates").select("id, name, phone, email").ilike("name", pNom).limit(25) : Promise.resolve({ data: [] as Fila[], error: null }),
    correoDirecto
      ? recruiting.from("candidates").select("id, name, phone, email").eq("email", correoDirecto).limit(25)
      : Promise.resolve({ data: [] as Fila[], error: null }),
  ]);
  if (porTel.error) throw new Error(`No se pudo buscar duplicados: ${porTel.error.message}`);
  if (porNom.error) throw new Error(`No se pudo buscar duplicados: ${porNom.error.message}`);
  if (porMail.error) throw new Error(`No se pudo buscar duplicados: ${porMail.error.message}`);
  const filas = [...((porTel.data ?? []) as Fila[]), ...((porNom.data ?? []) as Fila[]), ...((porMail.data ?? []) as Fila[])];
  const existente = buscaDuplicado(filas, payload) ?? ((porMail.data ?? []) as Fila[])[0] ?? null;
  if (existente) {
    const por = comoCoincide(existente, { phone: payload.phone ?? "", email: payload.email ?? null, correoEsRelay: c.correoEsRelay, name: payload.name ?? null });
    // Solo nombre: no se cambia nada (ni campos, ni CV, ni nota). RR. HH. decide.
    if (por === "nombre") return { resultado: "duplicate", candidateId: existente.id, avisoCv: null, aviso: AVISO_SOLO_NOMBRE };
    const avisoCv = await completaExistente(db, existente.id, payload, cv);
    return { resultado: "duplicate", candidateId: existente.id, avisoCv, aviso: null };
  }

  const { data, error } = await recruiting.from("candidates").insert(payload).select("id").single();
  if (error || !data) throw new Error(`No se pudo guardar el candidato: ${error?.message ?? "sin fila"}`);
  const candidateId = (data as { id: string }).id;

  if (!cv) return { resultado: "created", candidateId, avisoCv: null };
  const avisoCv = await guardaCv(db, candidateId, payload.name ?? c.name, cv);
  return { resultado: "created", candidateId, avisoCv };
}

/**
 * Persona que ya existía: llena SOLO los campos vacíos, anota si llegó un teléfono a una ficha descartada, y guarda el CV
 * de este correo si la ficha no tenía ninguno. No cambia el estado de la ficha.
 */
async function completaExistente(
  db: SupabaseClient,
  id: string,
  alta: Partial<Record<CampoQueSeLlena, string | null>> & { name?: string | null },
  cv: { nombreFichero: string; bytes: Buffer } | null,
): Promise<string | null> {
  const recruiting = db.schema("recruiting");
  const { data, error } = await recruiting
    .from("candidates")
    .select("phone, email, role, location, home_location, status, resume_path")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) throw new Error(`No se pudo leer al candidato existente: ${error?.message ?? "no existe"}`);
  const ficha = data as Ficha;

  if (llegoTelefonoTarde(ficha, alta.phone ?? null)) {
    await anotaNota(db, id, `Llegó teléfono después: ${alta.phone}`);
  }
  const parche = camposVacios(ficha, alta);
  if (Object.keys(parche).length) {
    const { error: eUpd } = await recruiting.from("candidates").update(parche).eq("id", id);
    if (eUpd) throw new Error(`No se pudo completar al candidato: ${eUpd.message}`);
  }
  if (!cv || ficha.resume_path) return null;
  return guardaCv(db, id, alta.name ?? "", cv);
}

/** Sube el CV y lo deja en la ficha. Devuelve el aviso (no fatal) si no se pudo guardar. */
async function guardaCv(db: SupabaseClient, candidateId: string, nombreCandidato: string, cv: { nombreFichero: string; bytes: Buffer }): Promise<string | null> {
  const validacion = validaCv(cv.nombreFichero, cv.bytes);
  if (!validacion.ok) return `CV no guardado: ${validacion.motivo}`;

  // Mismo nombre y ruta que el CV que sube RR. HH. a mano (D-590): «<Nombre> resume.<ext>» en «<id>/<marca>_<nombre>».
  const nombre = nombreDelCv(nombreCandidato, cv.nombreFichero);
  const ruta = `${candidateId}/${Date.now()}_${nombreSeguro(nombre)}`;
  const subida = await db.storage.from("resumes").upload(ruta, cv.bytes, { upsert: true, contentType: tipoDe(validacion.extension) });
  if (subida.error) return `CV no guardado: ${subida.error.message}`;

  const act = await db.schema("recruiting").from("candidates").update({ resume_path: ruta, resume_name: nombre, resume_passed: true }).eq("id", candidateId);
  if (act.error) {
    await db.storage.from("resumes").remove([ruta]);
    return `CV no guardado: ${act.error.message}`;
  }
  return null;
}

async function anotaNota(db: SupabaseClient, candidateId: string, note: string): Promise<void> {
  const { error } = await db.schema("recruiting").from("contacts").insert({ candidate_id: candidateId, type: "Note", note, result: null });
  if (error) throw new Error(`No se pudo anotar en el candidato: ${error.message}`);
}

type Fila = { id: string; name: string | null; phone: string | null; email: string | null };
type Ficha = { phone: string | null; email: string | null; role: string | null; location: string | null; home_location: string | null; status: string | null; resume_path: string | null };

function tipoDe(ext: "pdf" | "doc" | "docx"): string {
  if (ext === "pdf") return "application/pdf";
  if (ext === "doc") return "application/msword";
  return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
}
