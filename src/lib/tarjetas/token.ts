/**
 * El enlace privado de cada persona para cambiar su foto: `/editar?token=<token>`. El token son 32 bytes al azar
 * (64 caracteres hex). Nunca va en una respuesta pública: lo ven la persona y el admin.
 */
export const TOKEN_RE = /^[a-f0-9]{64}$/;

export function tokenDesdeBytes(bytes: Uint8Array): string {
  if (bytes.length !== 32) throw new Error("el token necesita 32 bytes");
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function aleatorioDelSistema(n: number): Uint8Array {
  const bytes = new Uint8Array(n);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

/** Un token nuevo, con la fuente de azar del navegador o del servidor. */
export function nuevoTokenDeEdicion(random: (n: number) => Uint8Array = aleatorioDelSistema): string {
  return tokenDesdeBytes(random(32));
}

export function tokenValido(texto: string | null | undefined): texto is string {
  return typeof texto === "string" && TOKEN_RE.test(texto);
}
