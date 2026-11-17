// ============================================================
// El identificador de un intento de entrar, SIN datos personales (320).
//
// El navegador hashea lo que escribió la persona (usuario o correo) con SHA-256 antes de mandar nada. El servidor solo
// ve el hash: sirve para contar «cuántos fallos seguidos contra esta cuenta» sin saber cuál es. Limitación honesta: el
// hash no lleva sal, así que quien tenga la base y una lista de usuarios probables puede comprobarlos. Por eso el
// rastro no sirve para nada más que contar, y no se muestra en pantalla.
//
// Este módulo es de cliente y de servidor: no importa `server-only`.
// ============================================================

export const RE_HASH_IDENTIFICADOR = /^[0-9a-f]{64}$/;

/** SHA-256 en hexadecimal de un identificador normalizado (sin espacios, en minúsculas). */
export async function hashIdentificador(texto: string): Promise<string> {
  const limpio = texto.trim().toLowerCase();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(limpio));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * El cuerpo que acepta `POST /api/seguridad/login-fallido`: exactamente `{ identificador_hash }` con un SHA-256 en hex.
 * Cualquier otra clave, un tipo distinto o un hash mal formado → null (la ruta contesta 400). Así no entra por ahí
 * ningún dato que no sea el hash.
 */
export function cuerpoLoginFallido(entrada: unknown): { identificador_hash: string } | null {
  if (!entrada || typeof entrada !== "object" || Array.isArray(entrada)) return null;
  const claves = Object.keys(entrada);
  if (claves.length !== 1 || claves[0] !== "identificador_hash") return null;
  const hash = (entrada as { identificador_hash: unknown }).identificador_hash;
  return typeof hash === "string" && RE_HASH_IDENTIFICADOR.test(hash) ? { identificador_hash: hash } : null;
}

/**
 * Avisa del intento fallido sin esperar y sin lanzar: un fallo aquí no puede cambiar lo que ve la persona en el login.
 * Solo se llama cuando Supabase Auth rechazó la entrada.
 */
export function avisaLoginFallido(identificador: string): void {
  void (async () => {
    try {
      const identificador_hash = await hashIdentificador(identificador);
      await fetch("/api/seguridad/login-fallido", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identificador_hash }),
        keepalive: true,
      });
    } catch {
      /* sin red o sin crypto.subtle: el monitoreo pierde este dato; el login sigue igual */
    }
  })();
}
