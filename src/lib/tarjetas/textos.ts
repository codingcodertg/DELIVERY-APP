/**
 * Los textos de la tarjeta pública y del editor, en los dos idiomas. Son los del `index.html` del contratista, con
 * los del editor y los de error añadidos. La página pública tiene su propio interruptor ES/EN (recordado en el
 * navegador); no usa el de la hub.
 */
export type Idioma = "es" | "en";

export const IDIOMA_POR_DEFECTO: Idioma = "es";
export const CLAVE_DE_IDIOMA = "rtg-lang";

export function idiomaDesdeTexto(texto: string | null | undefined): Idioma {
  return texto === "en" ? "en" : "es";
}

export const TEXTOS = {
  es: {
    call: "Llamar", whatsapp: "WhatsApp", text: "Mensaje", email: "Correo", save: "Guardar contacto", storeLine: "Línea de la tienda",
    reviewT: "Déjanos tu reseña", reviewS: "Califícanos en Google", rate: "Tu opinión",
    showroom: "Showroom", directions: "Cómo llegar", visit: "Sitio web",
    video: "Mira nuestro video", play: "Reproducir", watch: "Abrir en YouTube", videoSoon: "Aquí va el video de YouTube",
    followT: "¡Síguenos en redes!", followS: "Proyectos, ideas y lo nuevo en tile.",
    allStores: "Nuestros 6 showrooms", here: "Estás aquí",
    footer: "6 showrooms en el Valle", copied: "Link copiado", saved: "Contacto listo para guardar",
    waMsg: "Hola {n}, te contacto desde tu tarjeta de Rodriguez Tile Group.", share: "Compartir",
    langLabel: "Idioma / Language", prev: "Anterior", next: "Siguiente",
    sala: "Showroom", horarioCorto: "Horario",
    noEncontradaT: "Esta tarjeta no existe", noEncontradaS: "Revisa el enlace o pide tu tarjeta de nuevo.",
    editT: "Tu foto de tu tarjeta", editS: "Arrastra para mover · usa la barra o pellizca para acercar",
    editHint: "Todo lo que quede dentro del marco se ve en tu tarjeta.",
    editPhoto: "Foto", editCover: "Portada", editPick: "Elegir otra foto", editReset: "Reiniciar",
    editSave: "Guardar", editSaving: "Guardando…", editSaved: "¡Guardado! Tu tarjeta ya está actualizada",
    editNeedPhoto: "Primero elige una foto", editBadLink: "Enlace inválido o expirado",
    editBadFile: "Solo JPG, PNG o WebP", editTooBig: "La foto pesa más de 20 MB", editError: "Error al guardar. Intenta de nuevo.",
    editView: "Ver mi tarjeta ↗", editCropCircle: "Foto de perfil", editCropCover: "Portada de la tarjeta",
    editPickFirst: "Todavía no hay una foto: elige una para empezar.",
    editLoading: "Cargando tu tarjeta…", editTooMany: "Demasiados intentos. Espera un poco y vuelve a intentar.",
  },
  en: {
    call: "Call", whatsapp: "WhatsApp", text: "Text", email: "Email", save: "Save contact", storeLine: "Store line",
    reviewT: "Leave us a review", reviewS: "Rate us on Google", rate: "Your feedback",
    showroom: "Showroom", directions: "Directions", visit: "Website",
    video: "Watch our video", play: "Play", watch: "Open in YouTube", videoSoon: "YouTube video goes here",
    followT: "Follow us!", followS: "Projects, ideas and what’s new in tile.",
    allStores: "Our 6 showrooms", here: "You are here",
    footer: "6 showrooms across the Valley", copied: "Link copied", saved: "Contact ready to save",
    waMsg: "Hi {n}, reaching out from your Rodriguez Tile Group card.", share: "Share",
    langLabel: "Idioma / Language", prev: "Previous", next: "Next",
    sala: "Showroom", horarioCorto: "Hours",
    noEncontradaT: "This card does not exist", noEncontradaS: "Check the link or ask for your card again.",
    editT: "Your card photo", editS: "Drag to move · use the slider or pinch to zoom",
    editHint: "Everything inside the frame shows on your card.",
    editPhoto: "Photo", editCover: "Cover", editPick: "Choose another photo", editReset: "Reset",
    editSave: "Save", editSaving: "Saving…", editSaved: "Saved! Your card is updated",
    editNeedPhoto: "Choose a photo first", editBadLink: "Invalid or expired link",
    editBadFile: "JPG, PNG or WebP only", editTooBig: "The photo is over 20 MB", editError: "Could not save. Please try again.",
    editView: "View my card ↗", editCropCircle: "Profile photo", editCropCover: "Card cover",
    editPickFirst: "There is no photo yet: choose one to start.",
    editLoading: "Loading your card…", editTooMany: "Too many attempts. Wait a bit and try again.",
  },
} as const;

export type Textos = (typeof TEXTOS)["es"];

/** El mensaje de WhatsApp con el primer nombre de la persona. */
export function mensajeDeWhatsApp(idioma: Idioma, primerNombre: string): string {
  return TEXTOS[idioma].waMsg.replace("{n}", primerNombre);
}
