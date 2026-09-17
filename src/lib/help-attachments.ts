/**
 * Documentos y fotos en la solicitud de ayuda (D-284).
 *
 * El dueño: «en la solicitud de ayuda, que se puedan añadir documentos o fotos». Lo que se decide aquí
 * —qué fichero se acepta, con qué nombre se guarda y de quién es— vive fuera de la pantalla y de la
 * ruta, porque lo miran las dos: la pantalla para no subir lo que la base va a rechazar, y la ruta para
 * no firmar el fichero de otra persona.
 *
 * **Enlaces, no adjuntos.** Medido en la documentación de Resend el 2026-09-17: 40 MB por correo
 * **después** de codificar en Base64, que infla alrededor de un tercio. Cinco fotos de móvil se acercan
 * a ese techo, y un correo rechazado por tamaño se pierde entero, con mensaje incluido. El correo lleva
 * enlaces firmados al cubo privado; el mensaje llega siempre, y los ficheros caducan solos.
 */

/** El cubo privado de la 119. */
export const CUBO_DE_ADJUNTOS = "help-files";

/** Treinta dias de validez del enlace firmado: quien atiende la solicitud no siempre la abre el mismo dia,
 *  y pasado ese plazo el fichero sigue en el cubo, donde el admin lo puede volver a firmar. */
export const VALIDEZ_DEL_ENLACE = 60 * 60 * 24 * 30;

export const LIMITES_DE_ADJUNTOS = {
  /** Cinco por solicitud: suficiente para una pantalla y un documento, y acota la subida. */
  maxFicheros: 5,
  /** 10 MB por fichero, el mismo número que lleva el cubo en la migración. */
  maxBytes: 10 * 1024 * 1024,
  /** Fotos y documentos, que es lo que se pidió. La lista real la impone el cubo. */
  tipos: [
    "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif",
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/csv", "text/plain",
  ] as string[],
} as const;

export type FicheroElegido = { name: string; size: number; type: string };
export type FalloDeAdjunto = { motivo: "cuantos" | "tamano" | "tipo"; fichero?: string };

/** Lo que la pantalla comprueba antes de subir. El cubo lo vuelve a comprobar; esto es para avisar. */
export function validaAdjuntos(ficheros: FicheroElegido[]): FalloDeAdjunto | null {
  if (ficheros.length > LIMITES_DE_ADJUNTOS.maxFicheros) return { motivo: "cuantos" };
  for (const f of ficheros) {
    if (f.size > LIMITES_DE_ADJUNTOS.maxBytes) return { motivo: "tamano", fichero: f.name };
    if (!LIMITES_DE_ADJUNTOS.tipos.includes(f.type)) return { motivo: "tipo", fichero: f.name };
  }
  return null;
}

/** El aviso, en el idioma de quien lo lee. */
export function mensajeDeAdjunto(fallo: FalloDeAdjunto, t: (en: string, es: string) => string): string {
  const mb = Math.round(LIMITES_DE_ADJUNTOS.maxBytes / (1024 * 1024));
  if (fallo.motivo === "cuantos") {
    return t(`Up to ${LIMITES_DE_ADJUNTOS.maxFicheros} files per request.`, `Hasta ${LIMITES_DE_ADJUNTOS.maxFicheros} archivos por solicitud.`);
  }
  if (fallo.motivo === "tamano") {
    return t(`“${fallo.fichero}” is over ${mb} MB.`, `«${fallo.fichero}» pasa de ${mb} MB.`);
  }
  return t(`“${fallo.fichero}” isn't a photo or a document.`, `«${fallo.fichero}» no es una foto ni un documento.`);
}

/** Marcas de acento sueltas tras `NFD`, por su código (U+0300–U+036F). */
const COMBINANTES = new RegExp("[" + String.fromCharCode(0x300) + "-" + String.fromCharCode(0x36f) + "]", "g");

/** Un nombre que se puede guardar: sin rutas, sin acentos raros, sin sorpresas, y corto. */
export function nombreSaneado(nombre: string): string {
  const base = (nombre || "archivo").split(/[\\/]/).pop() ?? "archivo";
  const limpio = base
    .normalize("NFD")
    // Los combinantes se nombran por su código: escritos como escape, la herramienta que editó este
    // fichero los resolvía a caracteres invisibles dentro del corchete.
    .replace(COMBINANTES, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+/, "");
  const corto = limpio.slice(0, 80);
  return corto || "archivo";
}

/**
 * Dónde se guarda: **la primera carpeta es quien lo sube**. De eso vive la política del cubo —cada uno
 * escribe y lee lo suyo— y de eso vive la comprobación del servidor antes de firmar nada.
 */
export function rutaDeAdjunto(userId: string, nombre: string, cuando: Date): string {
  const sello = cuando.toISOString().replace(/[:.]/g, "-");
  return `${userId}/${sello}-${nombreSaneado(nombre)}`;
}

/** ¿Esta ruta es de esta persona? Sin esto, quien mande una ruta ajena se llevaría un enlace firmado. */
export function esMiRuta(ruta: string, userId: string): boolean {
  if (!ruta || !userId) return false;
  if (ruta.includes("..")) return false;
  return ruta.split("/")[0] === userId;
}

/** Las líneas del correo con los enlaces, o nada si no se adjuntó ninguno. */
export function lineasDeAdjuntos(adjuntos: { nombre: string; url: string | null }[]): string[] {
  if (!adjuntos.length) return [];
  return [
    "",
    `Attachments (${adjuntos.length}):`,
    ...adjuntos.map((a) => (a.url ? `• ${a.nombre}: ${a.url}` : `• ${a.nombre}: (link could not be created)`)),
  ];
}
