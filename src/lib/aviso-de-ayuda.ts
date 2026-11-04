import { telefonoE164 } from "@/lib/recruiting/contacto-ringcentral";
import type { Proveedor, ResultadoDeEnvio } from "@/lib/mensajeria";

// ============================================================
// Aviso al teléfono del dueño cuando llega una solicitud de ayuda (D-NEXT).
//
// Un SMS corto por el mismo proveedor que ya usan los avisos al cliente (RingCentral, si no Twilio; `mensajeria.ts`).
// Sin agente y sin sondeo: solo avisa; qué hacer con la solicitud lo decide el dueño. El destino es
// `settings.help_sms_to`; vacío = no se manda nada. Nunca tumba ni retrasa la solicitud: lo llama `/api/help` dentro
// de `after()` y con tiempo límite.
// ============================================================

/** Cuánto se espera al proveedor antes de darlo por perdido. */
export const ESPERA_DEL_AVISO_MS = 8000;
const LARGO_DEL_EXTRACTO = 100;

/** El número al que se manda, en E.164 («+19565550100»), o `null` si está vacío o no es un número de EE. UU. válido. */
export function destinoDelAviso(guardado: string | null | undefined): string | null {
  return telefonoE164(guardado);
}

/** Los primeros 100 caracteres del mensaje en una línea, con «…» si se cortó. */
export function extracto(mensaje: string, largo = LARGO_DEL_EXTRACTO): string {
  const plano = mensaje.replace(/\s+/g, " ").trim();
  const letras = Array.from(plano);
  return letras.length <= largo ? plano : letras.slice(0, largo).join("").trimEnd() + "…";
}

export type DatosDelAviso = { quien: string; rol?: string | null; pagina?: string | null; mensaje: string; fotos: number; enlace?: string | null };

/** `🆘 RTG Help: Ana (Sales) · /orders — "no me deja…" · 📷 2` y el enlace en la línea siguiente. */
export function textoDelAviso(d: DatosDelAviso): string {
  const rol = d.rol?.trim() ? ` (${d.rol.trim()})` : "";
  const pagina = d.pagina?.trim() ? ` · ${d.pagina.trim()}` : "";
  const fotos = d.fotos > 0 ? ` · 📷 ${d.fotos}` : "";
  const linea = `🆘 RTG Help: ${d.quien.trim() || "A user"}${rol}${pagina} — "${extracto(d.mensaje)}"${fotos}`;
  return d.enlace ? `${linea}\n${d.enlace}` : linea;
}

/** Manda el SMS con tiempo límite. Nunca lanza: devuelve el resultado, o un error si tardó o reventó. */
export async function enviarAvisoDeAyuda(proveedor: Proveedor, to: string, texto: string, esperaMs = ESPERA_DEL_AVISO_MS): Promise<ResultadoDeEnvio> {
  let reloj: ReturnType<typeof setTimeout> | undefined;
  const tarde = new Promise<ResultadoDeEnvio>((r) => { reloj = setTimeout(() => r({ ok: false, error: `sms alert timed out after ${esperaMs} ms` }), esperaMs); });
  try {
    return await Promise.race([proveedor.sms(to, texto).catch((e: unknown) => ({ ok: false as const, error: (e as Error)?.message ?? String(e) })), tarde]);
  } finally {
    clearTimeout(reloj);
  }
}
