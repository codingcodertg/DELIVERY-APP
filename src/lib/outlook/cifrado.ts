/**
 * Cifrado del refresh token de Outlook (AES-256-GCM, `node:crypto`, sin dependencias).
 *
 * SOLO SERVIDOR. La llave viene de `OUTLOOK_TOKEN_KEY`: 32 bytes en base64. Si se pierde o cambia, los tokens guardados
 * no se pueden leer y hay que volver a conectar Outlook; por eso no se guarda en la base ni en el repo.
 *
 * Formato del texto cifrado: `v1:<iv>:<tag>:<cuerpo>`, todo en base64 estándar. El IV es nuevo en cada cifrado (12 bytes
 * aleatorios), así que dos cifrados del mismo texto no se parecen. La etiqueta de GCM detecta cualquier cambio: un
 * texto alterado no descifra, y el error no dice nada del contenido.
 *
 * `aad` (datos asociados) liga el cifrado a su uso: un token cifrado para «outlook-refresh» no descifra como si fuera
 * otra cosa. Nunca se loguea el texto plano ni la llave: los errores hablan del formato, no del valor.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";
const ALGORITMO = "aes-256-gcm";
const LONGITUD_IV = 12;
export const AAD_REFRESH_TOKEN = "outlook:refresh-token";

/** La llave a partir de la variable de entorno; `null` si falta o no mide 32 bytes tras decodificar base64. */
export function claveDesdeTexto(valor: string | undefined): Buffer | null {
  const limpio = (valor ?? "").trim();
  if (!limpio) return null;
  const buf = Buffer.from(limpio, "base64");
  // Buffer.from ignora basura en base64 en vez de fallar: se compara la longitud Y que re-codifica igual.
  if (buf.length !== 32 || buf.toString("base64") !== limpio) return null;
  return buf;
}

/** La llave del entorno o un error que nombra la variable (nunca su valor). */
export function claveDelEntorno(env: Record<string, string | undefined> = process.env): Buffer {
  const clave = claveDesdeTexto(env.OUTLOOK_TOKEN_KEY);
  if (!clave) throw new Error("OUTLOOK_TOKEN_KEY falta o no es una llave válida (32 bytes en base64).");
  return clave;
}

export function cifrar(texto: string, clave: Buffer, aad: string = AAD_REFRESH_TOKEN): string {
  if (clave.length !== 32) throw new Error("La llave de cifrado debe medir 32 bytes.");
  const iv = randomBytes(LONGITUD_IV);
  const cipher = createCipheriv(ALGORITMO, clave, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const cuerpo = Buffer.concat([cipher.update(texto, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64"), tag.toString("base64"), cuerpo.toString("base64")].join(":");
}

export function descifrar(cifrado: string, clave: Buffer, aad: string = AAD_REFRESH_TOKEN): string {
  const partes = cifrado.split(":");
  if (partes.length !== 4 || partes[0] !== VERSION) throw new Error("Formato de texto cifrado no reconocido.");
  const [, ivB64, tagB64, cuerpoB64] = partes;
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  if (iv.length !== LONGITUD_IV || tag.length !== 16) throw new Error("Texto cifrado mal formado.");
  const decipher = createDecipheriv(ALGORITMO, clave, iv);
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(Buffer.from(cuerpoB64, "base64")), decipher.final()]).toString("utf8");
  } catch {
    // Llave equivocada, datos alterados o aad distinto: el mismo mensaje para los tres, sin pistas.
    throw new Error("No se pudo descifrar (llave o datos incorrectos).");
  }
}
