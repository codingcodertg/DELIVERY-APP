import type { Contact, Interview } from "./types";

/** Una pregunta de la entrevista ya hecha, tal como quedó guardada. */
export interface FilaDeEntrevista {
  text: string;
  category: string | null;
  weight: number;
  grade: number | null;
  note: string;
  /** Sin calificación y sin nota: no se contestó (o se marcó N/A). */
  sinContestar: boolean;
}

/**
 * Todas las preguntas de la entrevista guardada, en el orden en que se hicieron: también las que
 * quedaron sin calificar, que el Resumen no enseña. Se lee de la copia que la entrevista guarda de
 * sus preguntas, así que no cambia aunque después se edite o se borre el cuestionario.
 */
export function filasDeLaEntrevista(iv: Interview | null | undefined): FilaDeEntrevista[] {
  if (!iv) return [];
  return (iv.questions ?? []).map((q) => {
    const note = (q.note ?? "").trim();
    const grade = q.grade ?? null;
    return {
      text: q.text,
      category: q.category ?? null,
      weight: q.weight || 1,
      grade,
      note,
      sinContestar: grade == null && note === "",
    };
  });
}

/** Cuántas preguntas se contestaron (con calificación o con nota), de cuántas. */
export function cuentaDeContestadas(filas: readonly FilaDeEntrevista[]): { contestadas: number; total: number } {
  return { contestadas: filas.filter((f) => !f.sinContestar).length, total: filas.length };
}

/**
 * Lo anotado de la entrevista presencial. No tiene cuestionario: su único rastro son los renglones
 * del registro con tipo «In person» (el resultado y la nota que se escriben al registrar el resultado).
 */
export function notasDeLaPresencial(contactos: readonly Contact[]): Contact[] {
  return contactos
    .filter((k) => (k.type ?? "").trim().toLowerCase() === "in person")
    .slice()
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/** ¿Hay algo que ver? Una entrevista por teléfono guardada, o al menos una nota de la presencial. */
export function hayEntrevistaHecha(iv: Interview | null | undefined, contactos: readonly Contact[]): boolean {
  return !!iv || notasDeLaPresencial(contactos).length > 0;
}
