/**
 * Cómo se hace ligera una foto de tarjeta antes de guardarla. Las dos subidas (el admin y el editor por enlace) usan
 * estas medidas. La foto del círculo va a 800 px; la portada, a 1200 px (la tarjeta la muestra a 440 px de ancho,
 * y en pantallas de alta densidad 1200 px sigue siendo nítida sin pesar de más).
 */
export const ANCHO_FOTO = 800;
export const ANCHO_PORTADA = 1200;
export const CALIDAD_FOTO = 0.85;

/** Lo que se acepta del archivo original (una foto de celular). Lo que se guarda, en cambio, tiene que caber en 5 MB. */
export const TAMANO_ORIGINAL_MAX = 20 * 1024 * 1024;
