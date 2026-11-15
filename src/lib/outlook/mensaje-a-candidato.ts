/**
 * Un mensaje de candidato de Indeed no crea a nadie: se anota en la ficha del candidato que ya existe, como una
 * actividad de tipo «Note» (la misma tabla que usan las llamadas y los SMS de RR. HH.: recruiting.contacts).
 *
 * Coincidencia: el nombre completo, sin mayúsculas ni acentos (normalizeName), entre los candidatos no archivados. Si
 * sale más de uno, se desempata por el puesto. Si sigue habiendo más de uno, o ninguno, NO se anota nada: el correo queda
 * como «skipped» con el motivo, para que RR. HH. lo vea en la tarjeta.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeName } from "@/lib/recruiting/utils";
import type { MensajeDeIndeed } from "./indeed";

export type BusquedaCandidato = { tipo: "unico"; id: string } | { tipo: "ninguno" } | { tipo: "ambiguo"; cuantos: number };

/**
 * Patrón `ilike` tolerante a acentos: cada vocal (y la ñ/n) se vuelve un comodín de un carácter, para que «Sanchez»
 * encuentre «Sánchez» en la base. El resto se compara después en JS con normalizeName, que es la verdad.
 */
export function patronApellido(nombre: string): string | null {
  const ultimo = normalizeName(nombre).split(" ").filter(Boolean).pop();
  if (!ultimo || ultimo.length < 3) return null;
  const patron = [...ultimo].map((ch) => (/[aeiouyn]/.test(ch) ? "_" : ch)).join("");
  return `%${patron}%`;
}

type Fila = { id: string; name: string | null; role: string | null; archived: boolean | null };

export async function buscarCandidatoParaMensaje(db: SupabaseClient, nombre: string, puesto: string | null): Promise<BusquedaCandidato> {
  const patron = patronApellido(nombre);
  if (!patron) return { tipo: "ninguno" };
  const { data, error } = await db
    .schema("recruiting")
    .from("candidates")
    .select("id, name, role, archived")
    .ilike("name", patron)
    .limit(100);
  if (error) throw new Error(`No se pudo buscar al candidato: ${error.message}`);

  const buscado = normalizeName(nombre);
  let coinciden = ((data ?? []) as Fila[]).filter((f) => f.archived !== true && normalizeName(f.name ?? "") === buscado);
  if (coinciden.length > 1 && puesto) {
    const p = normalizeName(puesto);
    const porPuesto = coinciden.filter((f) => {
      const r = normalizeName(f.role ?? "");
      return r.length > 0 && (r === p || r.includes(p) || p.includes(r));
    });
    if (porPuesto.length >= 1) coinciden = porPuesto;
  }
  if (coinciden.length === 1) return { tipo: "unico", id: coinciden[0].id };
  if (coinciden.length === 0) return { tipo: "ninguno" };
  return { tipo: "ambiguo", cuantos: coinciden.length };
}

/** La nota de actividad: el texto del candidato, con el puesto y la fecha del correo. Sin datos de más. */
export function textoDeLaNota(m: MensajeDeIndeed, recibido: string): string {
  const cabecera = `Mensaje de Indeed${m.puesto ? ` (${m.puesto})` : ""} · ${recibido.slice(0, 16).replace("T", " ")} UTC`;
  return `${cabecera}:\n${m.texto}`;
}

export async function anotarMensajeEnCandidato(db: SupabaseClient, candidateId: string, nota: string): Promise<void> {
  const { error } = await db
    .schema("recruiting")
    .from("contacts")
    .insert({ candidate_id: candidateId, type: "Note", note: nota, result: null });
  if (error) throw new Error(`No se pudo anotar el mensaje: ${error.message}`);
}
