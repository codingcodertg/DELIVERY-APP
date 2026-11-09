/**
 * Formulario de renuncia (quit form) — D-935 (migración 276).
 *
 * Roberto en la junta: cuando un empleado renuncia firma un formato con el motivo (otro trabajo, asuntos personales, …)
 * para protegerse de reclamos de desempleo. Aquí lo puro: los motivos, su validación y la del formulario; la base y la
 * pantalla están en `actions/quit-form.ts` y en el expediente. La foto del formato firmado se sube con el mismo patrón
 * que los documentos del empleado (`uploadDocFile`).
 */

export type MotivoRenuncia =
  | "another_job" | "personal" | "relocation" | "health" | "school" | "family" | "schedule" | "pay" | "other";

/** Los motivos del menú, bilingües. Las claves son las del `check` de la 276 y no se traducen. */
export const MOTIVOS_RENUNCIA: readonly { key: MotivoRenuncia; en: string; es: string }[] = [
  { key: "another_job", en: "Another job", es: "Otro trabajo" },
  { key: "personal", en: "Personal matters", es: "Asuntos personales" },
  { key: "relocation", en: "Relocation / moving", es: "Mudanza / cambio de ciudad" },
  { key: "health", en: "Health", es: "Salud" },
  { key: "school", en: "School / studies", es: "Escuela / estudios" },
  { key: "family", en: "Family reasons", es: "Motivos familiares" },
  { key: "schedule", en: "Schedule", es: "Horario" },
  { key: "pay", en: "Pay", es: "Sueldo" },
  { key: "other", en: "Other", es: "Otro" },
] as const;

export const MOTIVOS_RENUNCIA_KEYS: readonly string[] = MOTIVOS_RENUNCIA.map((m) => m.key);

export function esMotivoRenuncia(v: unknown): v is MotivoRenuncia {
  return typeof v === "string" && MOTIVOS_RENUNCIA_KEYS.includes(v);
}

/** Vacío = sin motivo (`null`); algo fuera de la lista = `undefined`, para rechazarlo con una frase. */
export function normalizaMotivoRenuncia(v: string | null | undefined): MotivoRenuncia | null | undefined {
  const limpio = (v ?? "").trim();
  if (!limpio) return null;
  return esMotivoRenuncia(limpio) ? limpio : undefined;
}

export function etiquetaMotivoRenuncia(v: string | null | undefined, lang: "en" | "es"): string {
  const m = MOTIVOS_RENUNCIA.find((x) => x.key === v);
  return m ? m[lang] : "";
}

/** Lo que llega del formulario antes de guardar. */
export interface DatosQuitForm {
  motivo?: string | null;
  nota?: string | null;
  firmaNombre?: string | null;
  firmaFecha?: string | null;
  fotoPath?: string | null;
}

/** El formulario saneado, listo para la base; o un motivo (en clave) de por qué no vale. */
export type RevisionQuitForm =
  | { ok: true; motivo: MotivoRenuncia; nota: string | null; firmaNombre: string; firmaFecha: string | null; fotoPath: string | null }
  | { ok: false; motivo: "sin_motivo" | "motivo_desconocido" | "sin_firma" };

/**
 * ¿Vale el quit form? Pide motivo de la lista y nombre de quien firma (lo mínimo para que el formato proteja: quién y por
 * qué). La nota, la fecha y la foto son opcionales; «other» exige que la nota diga algo.
 */
export function revisaQuitForm(d: DatosQuitForm): RevisionQuitForm {
  const motivo = normalizaMotivoRenuncia(d.motivo);
  if (motivo === null) return { ok: false, motivo: "sin_motivo" };
  if (motivo === undefined) return { ok: false, motivo: "motivo_desconocido" };
  const nota = (d.nota ?? "").trim() || null;
  if (motivo === "other" && !nota) return { ok: false, motivo: "sin_motivo" };
  const firmaNombre = (d.firmaNombre ?? "").trim();
  if (!firmaNombre) return { ok: false, motivo: "sin_firma" };
  return {
    ok: true,
    motivo,
    nota,
    firmaNombre,
    firmaFecha: (d.firmaFecha ?? "").trim() || null,
    fotoPath: (d.fotoPath ?? "").trim() || null,
  };
}
