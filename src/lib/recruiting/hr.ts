/**
 * El expediente de RR. HH.: qué documentos existen y cómo se agrupan (D-145).
 *
 * Vive aquí y no repartido por la pantalla para que añadir un papel nuevo sea **una línea**.
 * `kind` no tiene restricción en la base por el mismo motivo: RR. HH. va a inventar
 * formularios, y eso no debería costar una migración.
 */

export type DocKind = {
  key: string;
  label: string;
  label_es: string;
  /** "hr" = documentos y expedientes · "forms" = papeles que se firman. */
  group: "hr" | "forms";
  /** Varios por persona (amonestaciones, antidoping) frente a uno solo (el manual). */
  many?: boolean;
  /** Caduca, así que la ficha pregunta hasta cuándo vale. */
  expires?: boolean;
  /** Solo se pregunta hasta cuándo vale, no desde cuándo (D-725: la licencia). Lleva `expires`. */
  soloVence?: boolean;
};

export const DOC_KINDS: DocKind[] = [
  // --- HR ---
  // D-725: solo el vencimiento. El dueño, 2026-10-28: «Only ask for the expiration date. Remove the start/issue date field».
  { key: "license",        label: "License",            label_es: "Licencia",           group: "hr", expires: true, soloVence: true },
  { key: "resume",         label: "Resume",             label_es: "Currículum",         group: "hr" },
  { key: "certification",  label: "Certifications",     label_es: "Certificaciones",    group: "hr", many: true, expires: true },
  { key: "warning",        label: "Warnings",           label_es: "Amonestaciones",     group: "hr", many: true },
  { key: "drug_test",      label: "Drug tests",         label_es: "Pruebas antidoping", group: "hr", many: true },
  // --- FORMS ---
  { key: "handbook",       label: "Handbook signed",    label_es: "Manual firmado",           group: "forms" },
  { key: "commission",     label: "Commission signed",  label_es: "Comisiones firmado",       group: "forms" },
  { key: "background",     label: "Background check",   label_es: "Verificación de antecedentes", group: "forms" },
  { key: "noncompete",     label: "Non-compete",        label_es: "No competencia",           group: "forms" },
  { key: "nondisclosure",  label: "Non-disclosure",     label_es: "Confidencialidad",         group: "forms" },
  { key: "quit_form",      label: "Quit form",          label_es: "Formato de baja",          group: "forms" },
];

/** Los que se esperan de TODO el mundo. La baja no: solo existe si la persona se fue, y
 *  contarla como pendiente marcaría en rojo a la plantilla entera. */
export const REQUIRED_FORMS = DOC_KINDS.filter((d) => d.group === "forms" && d.key !== "quit_form");

// ---- La licencia que vence (D-725) ------------------------------------------------------------
/** Con cuántos días de margen se avisa: un mes, para pedir el documento nuevo a tiempo. */
export const DIAS_DE_AVISO_DE_LICENCIA = 30;

export type EstadoDeLicencia = "vencida" | "por_vencer" | null;

/** Vencida, por vencer (dentro de `DIAS_DE_AVISO_DE_LICENCIA`), o nada. Fechas «AAAA-MM-DD». */
export function estadoDeLicencia(vence: string | null | undefined, hoy: string, dias = DIAS_DE_AVISO_DE_LICENCIA): EstadoDeLicencia {
  if (!vence) return null;
  const v = Date.parse(vence + "T00:00:00Z");
  const h = Date.parse(hoy + "T00:00:00Z");
  if (!Number.isFinite(v) || !Number.isFinite(h)) return null;
  const faltan = Math.round((v - h) / 86400000);
  if (faltan < 0) return "vencida";
  if (faltan <= dias) return "por_vencer";
  return null;
}

/** El texto del aviso: «License expired 2026-01-02» / «License expires in 12 days (2026-11-09)». */
export function avisoDeLicencia(vence: string | null | undefined, hoy: string, lang: "en" | "es"): string | null {
  const estado = estadoDeLicencia(vence, hoy);
  if (!estado || !vence) return null;
  if (estado === "vencida") return lang === "es" ? `Licencia vencida el ${vence}` : `License expired on ${vence}`;
  const faltan = Math.round((Date.parse(vence + "T00:00:00Z") - Date.parse(hoy + "T00:00:00Z")) / 86400000);
  return lang === "es" ? `Licencia vence en ${faltan} días (${vence})` : `License expires in ${faltan} days (${vence})`;
}
