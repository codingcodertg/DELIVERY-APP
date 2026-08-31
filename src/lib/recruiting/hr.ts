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
};

export const DOC_KINDS: DocKind[] = [
  // --- HR ---
  { key: "license",        label: "License",            label_es: "Licencia",           group: "hr", expires: true },
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

export const docKind = (key: string): DocKind | undefined => DOC_KINDS.find((d) => d.key === key);

/** Los que se esperan de TODO el mundo. La baja no: solo existe si la persona se fue, y
 *  contarla como pendiente marcaría en rojo a la plantilla entera. */
export const REQUIRED_FORMS = DOC_KINDS.filter((d) => d.group === "forms" && d.key !== "quit_form");
