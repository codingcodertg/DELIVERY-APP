// ============================================================
// El CV que se sube se llama como el candidato (D-NEXT, 2026-10-19). El dueño: «quiero que todos los resume que suba al
// cv part upload ahi automaticamente se rename al nombre del candidato + resume».
// ============================================================

/** Lo que va detrás del nombre: «Ana Pérez resume.pdf». En inglés porque así lo pidió («+ resume») y así lo leen los
 *  gerentes; no se traduce. */
export const SUFIJO_DEL_CV = "resume";

/** La extensión del fichero subido, en minúsculas y sin punto; `""` si no tiene. */
export function extensionDe(nombreDelFichero: string): string {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(nombreDelFichero.trim());
  return m ? m[1].toLowerCase() : "";
}

/**
 * El nombre con el que se guarda el CV: el nombre del candidato (limpio de espacios de más) + « resume» + la extensión
 * del fichero que se subió. Sin nombre de candidato, el fichero se queda con el suyo: no se inventa «resume.pdf» a
 * secas para alguien sin nombre.
 */
export function nombreDelCv(nombreDelCandidato: string | null | undefined, nombreDelFichero: string): string {
  const persona = (nombreDelCandidato ?? "").trim().replace(/\s+/g, " ");
  if (!persona) return nombreDelFichero;
  const ext = extensionDe(nombreDelFichero);
  return `${persona} ${SUFIJO_DEL_CV}${ext ? `.${ext}` : ""}`;
}

/** La ruta en el bucket no admite acentos ni espacios: la misma limpieza de siempre sobre el nombre nuevo. */
export function nombreSeguro(nombre: string): string {
  return nombre.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9._-]/g, "_");
}
