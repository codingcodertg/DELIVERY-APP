/**
 * Alta de un candidato que llegó por correo de Indeed, desde el servidor (cron o «Revisar ahora»).
 *
 * POR QUÉ NO ES LA MISMA FUNCIÓN QUE USA RR. HH. Su alta (`addCandidate` en recruiting-data-provider.tsx) corre en el
 * NAVEGADOR con la sesión del usuario: no hay sesión en un cron. Por eso aquí se reusan las MISMAS piezas puras que
 * usa esa función: `patronTel`/`patronNombre`/`buscaDuplicado` (candidato-duplicado.ts) para no crear dos veces a la
 * misma persona, y `estandarizaCandidato` para que el teléfono, el nombre y el correo queden en el formato estándar.
 * Si esa lógica cambia, cambian las dos; lo comparten los tests de candidato-duplicado.
 *
 * Escribe con la llave de servicio (salta RLS), así que quien llama tiene que ser el servidor ya autorizado.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { buscaDuplicado, patronNombre, patronTel } from "@/lib/recruiting/candidato-duplicado";
import { estandarizaCandidato } from "@/lib/recruiting/formato";
import { nombreDelCv, nombreSeguro } from "@/lib/recruiting/nombre-del-cv";
import type { CandidatoDeIndeed } from "./indeed";
import { validaCv } from "./cv";

export interface AltaDesdeCorreo {
  resultado: "created" | "duplicate";
  candidateId: string;
  /** Aviso no fatal sobre el CV (no era PDF/DOC/DOCX, pesaba mucho, no se pudo subir). El candidato sí se creó. */
  avisoCv: string | null;
}

export async function crearCandidatoDesdeCorreo(
  db: SupabaseClient,
  c: CandidatoDeIndeed,
  cv: { nombreFichero: string; bytes: Buffer } | null,
): Promise<AltaDesdeCorreo> {
  const payload = estandarizaCandidato({
    name: c.name,
    phone: c.phone,
    email: c.email,
    role: c.role,
    home_location: c.home_location,
    source: "Indeed",
    notes: c.notes,
    tags: c.tags,
    resume_passed: false,
  });

  // Antes de crear, se pregunta a la BASE por el mismo teléfono (cualquier formato) o el mismo nombre. Igual que el alta
  // del navegador: si existe, se usa esa persona y no se crea otra.
  const pTel = patronTel(payload.phone ?? null);
  const pNom = patronNombre(payload.name ?? null);
  const recruiting = db.schema("recruiting");
  const [porTel, porNom] = await Promise.all([
    pTel ? recruiting.from("candidates").select("id, name, phone").ilike("phone", pTel).limit(25) : Promise.resolve({ data: [] as Fila[], error: null }),
    pNom ? recruiting.from("candidates").select("id, name, phone").ilike("name", pNom).limit(25) : Promise.resolve({ data: [] as Fila[], error: null }),
  ]);
  if (porTel.error) throw new Error(`No se pudo buscar duplicados: ${porTel.error.message}`);
  if (porNom.error) throw new Error(`No se pudo buscar duplicados: ${porNom.error.message}`);
  const existente = buscaDuplicado([...((porTel.data ?? []) as Fila[]), ...((porNom.data ?? []) as Fila[])], payload);
  if (existente) return { resultado: "duplicate", candidateId: existente.id, avisoCv: null };

  const { data, error } = await recruiting.from("candidates").insert(payload).select("id").single();
  if (error || !data) throw new Error(`No se pudo guardar el candidato: ${error?.message ?? "sin fila"}`);
  const candidateId = (data as { id: string }).id;

  if (!cv) return { resultado: "created", candidateId, avisoCv: null };
  const validacion = validaCv(cv.nombreFichero, cv.bytes);
  if (!validacion.ok) return { resultado: "created", candidateId, avisoCv: `CV no guardado: ${validacion.motivo}` };

  // Mismo nombre y ruta que el CV que sube RR. HH. a mano (D-590): «<Nombre> resume.<ext>» en «<id>/<marca>_<nombre>».
  const nombre = nombreDelCv(payload.name, cv.nombreFichero);
  const ruta = `${candidateId}/${Date.now()}_${nombreSeguro(nombre)}`;
  const subida = await db.storage.from("resumes").upload(ruta, cv.bytes, { upsert: true, contentType: tipoDe(validacion.extension) });
  if (subida.error) return { resultado: "created", candidateId, avisoCv: `CV no guardado: ${subida.error.message}` };

  const act = await recruiting
    .from("candidates")
    .update({ resume_path: ruta, resume_name: nombre, resume_passed: true })
    .eq("id", candidateId);
  if (act.error) {
    await db.storage.from("resumes").remove([ruta]);
    return { resultado: "created", candidateId, avisoCv: `CV no guardado: ${act.error.message}` };
  }
  return { resultado: "created", candidateId, avisoCv: null };
}

type Fila = { id: string; name: string | null; phone: string | null };

function tipoDe(ext: "pdf" | "doc" | "docx"): string {
  if (ext === "pdf") return "application/pdf";
  if (ext === "doc") return "application/msword";
  return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
}
