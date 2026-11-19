/**
 * Las fotos de la tarjeta: qué tipos entran, cuánto pesan, cómo se llaman en el bucket y si una ruta cae dentro de la
 * carpeta de su tarjeta. La base vuelve a comprobar la ruta (`business_card_set_media`); esto es la misma regla en TS.
 */

export const TAMANO_MAX_FOTO = 5 * 1024 * 1024;
export const BUCKET_DE_TARJETAS = "business-cards";

export type ExtensionDeFoto = "jpg" | "png" | "webp";
export type ClaseDeFoto = "foto" | "portada";

const EXTENSIONES: Readonly<Record<string, ExtensionDeFoto>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export function extensionDeFoto(tipo: string): ExtensionDeFoto | null {
  return EXTENSIONES[tipo] ?? null;
}

export function esClaseDeFoto(valor: string): valor is ClaseDeFoto {
  return valor === "foto" || valor === "portada";
}

/** Los primeros bytes del archivo tienen que ser los de su tipo: no basta con que el navegador diga «image/jpeg». */
export function esFirmaDeImagen(bytes: Uint8Array, tipo: string): boolean {
  const empieza = (firma: number[], desde = 0) => firma.every((b, i) => bytes[desde + i] === b);
  if (tipo === "image/jpeg") return empieza([0xff, 0xd8, 0xff]);
  if (tipo === "image/png") return empieza([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (tipo === "image/webp") return empieza([0x52, 0x49, 0x46, 0x46]) && empieza([0x57, 0x45, 0x42, 0x50], 8);
  return false;
}

/** `<id-de-la-tarjeta>/<foto|portada>-<milisegundos>.<ext>`: la carpeta es el id, que no cambia si se cambia el slug. */
export function rutaDeFoto(idTarjeta: string, clase: ClaseDeFoto, ext: ExtensionDeFoto, ahora: number): string {
  return `${idTarjeta}/${clase}-${ahora}.${ext}`;
}

/** ¿Está la ruta dentro de la carpeta de ESA tarjeta, con el nombre que da `rutaDeFoto`? */
export function rutaDeFotoValida(idTarjeta: string, ruta: string): boolean {
  if (!/^[0-9a-f-]{36}$/.test(idTarjeta)) return false;
  const esperado = new RegExp(`^${idTarjeta}/(foto|portada)-[0-9]{1,15}\\.(jpg|png|webp)$`);
  return esperado.test(ruta);
}

/** La URL pública de una foto del bucket (el bucket es público: se lee sin login). */
export function urlPublicaDeFoto(baseSupabase: string, ruta: string): string {
  const base = baseSupabase.replace(/\/+$/, "");
  return `${base}/storage/v1/object/public/${BUCKET_DE_TARJETAS}/${ruta}`;
}
