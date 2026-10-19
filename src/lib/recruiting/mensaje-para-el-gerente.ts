import type { Candidate, Contact } from "./types";
import { fmtDateTime } from "./utils";
import { RESULTADO_AGENDADA } from "./agendar-presencial";

// ============================================================
// «📋 Copiar para el gerente» (D-590, 2026-10-19). El dueño: «en el hr app haya una opcion que sea como copiar mensaje
// para el manager, que es copiar, nombre, telefono, curriculum la nota que deje en la entrevista y la hora a la que lo
// cite de cita personal».
//
// Lógica pura: qué cita se cuenta y cómo se arma el texto. El botón (`BotonCopiarParaElGerente`) pide el enlace del CV
// y copia el texto al portapapeles.
// ============================================================

/** Cuántos días vale el enlace del CV que va en el mensaje: 7, para que el gerente lo abra cuando lea el mensaje y no en
 *  el minuto en que se copió. Desde D-NEXT el enlace es el corto (`enlace-corto-del-cv.ts`), que lleva esta misma vida. */
export const DIAS_DEL_ENLACE_DEL_CV = 7;

/**
 * La cita presencial que se cuenta: el ÚLTIMO contacto «In person / Scheduled» (D-585 lo deja como «fecha · lugar ·
 * nota»), que es lo que la ficha enseña como cita; sin ese contacto, la fecha de `inperson_date` (la cita vieja, sin
 * lugar). `null` si no hay cita.
 */
export function citaPresencial(c: Pick<Candidate, "inperson_date">, contactos: readonly Contact[]): string | null {
  const citas = contactos
    .filter((k) => k.type === "In person" && k.result === RESULTADO_AGENDADA && (k.note ?? "").trim())
    .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
  if (citas[0]) return (citas[0].note ?? "").trim();
  return c.inperson_date ? fmtDateTime(c.inperson_date) : null;
}

/** La nota de la entrevista: las notas generales del reclutador, limpias. `null` sin entrevista o sin nota. */
export function notaDeLaEntrevista(c: Pick<Candidate, "interview">): string | null {
  const n = (c.interview?.generalNotes ?? "").trim().replace(/\s+/g, " ");
  return n || null;
}

const SIN = {
  en: { cv: "no CV attached", nota: "no interview yet", cita: "not scheduled yet" },
  es: { cv: "sin CV adjunto", nota: "sin entrevista aún", cita: "sin cita aún" },
} as const;

/**
 * El texto que se copia, listo para pegar al gerente: nombre, teléfono, CV (enlace), nota de la entrevista y cita
 * presencial. Lo que falta se dice («sin CV adjunto»), no se omite: el gerente sabe qué no hay.
 */
export function mensajeParaElGerente(
  c: Pick<Candidate, "name" | "phone" | "role" | "interview" | "inperson_date" | "resume_name">,
  datos: { cvEnlace: string | null; contactos: readonly Contact[] },
  lang: "en" | "es",
): string {
  const s = SIN[lang];
  const puesto = (c.role ?? "").trim();
  const lineas = lang === "es"
    ? [
        `Candidato: ${c.name.trim()}${puesto ? ` (${puesto})` : ""}`,
        `Teléfono: ${c.phone.trim() || "—"}`,
        `CV: ${datos.cvEnlace ?? s.cv}`,
        `Nota de la entrevista: ${notaDeLaEntrevista(c) ?? s.nota}`,
        `Entrevista presencial: ${citaPresencial(c, datos.contactos) ?? s.cita}`,
      ]
    : [
        `Candidate: ${c.name.trim()}${puesto ? ` (${puesto})` : ""}`,
        `Phone: ${c.phone.trim() || "—"}`,
        `CV: ${datos.cvEnlace ?? s.cv}`,
        `Interview note: ${notaDeLaEntrevista(c) ?? s.nota}`,
        `In-person interview: ${citaPresencial(c, datos.contactos) ?? s.cita}`,
      ];
  return lineas.join("\n");
}
