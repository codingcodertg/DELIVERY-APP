import type { Candidate, Contact } from "./types";
import { mergeTemplate, rcCall, rcSms, telClean } from "./utils";

/** Lo que las funciones de aquí necesitan del candidato; `phone` admite nulo porque el dato viejo puede venir vacío. */
type Cand = Pick<Candidate, "id" | "name" | "role"> & { phone: string | null };

/* ---- «📱 Texto: ¿te puedo llamar?» (D-581) ----
 * El dueño pidió (2026-10-18) un botón junto al candidato que mande el texto de
 * «¿te puedo llamar?» sin abrir el diálogo de «Iniciar entrevista». Medido: RRHH
 * nunca manda SMS por servidor — el «💬 Texto» del diálogo abre la app de RingCentral
 * con el enlace `rcSms(phone)` y anota un contacto `SMS / sent`. Este botón va por el
 * MISMO camino (mismo enlace, misma tabla `contacts`), solo que lleva el texto puesto
 * y deja una marca en `result` para saber que ya se mandó a este candidato. */

export const RESULTADO_PUEDO_LLAMAR = "sent · can I call?";

const PLANTILLA = {
  en: "Hi {name}, this is {recruiter} from RDZ Tile Group about the {role} position. Can I call you? Reply with a good time. Thanks!",
  es: "Hola {name}, soy {recruiter} de RDZ Tile Group, por el puesto de {role}. ¿Te puedo llamar? Respóndeme con una hora que te venga bien. ¡Gracias!",
} as const;

/** El texto que se manda: la plantilla del idioma de quien pulsa, con los marcadores de `mergeTemplate`. */
export function textoPuedoLlamar(c: Omit<Cand, "id">, recruiter: string, lang: "en" | "es"): string {
  return mergeTemplate(PLANTILLA[lang], c as Candidate, recruiter).replace(/\s{2,}/g, " ").trim();
}

/** Último envío de este texto a este candidato, o null si nunca se mandó (idempotencia por candidato). */
export function envioPuedoLlamar(contactos: Contact[], candidateId: string): { cuando: string } | null {
  const mios = contactos
    .filter((k) => k.candidate_id === candidateId && k.type === "SMS" && k.result === RESULTADO_PUEDO_LLAMAR)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  return mios[0] ? { cuando: mios[0].created_at } : null;
}

export type ResultadoDelBoton =
  | { ok: true; texto: string; enlace: string }
  | { ok: false; motivo: "sin-telefono" | "ya-enviado" };

/** Decide, sin tocar nada, qué hace el botón: a dónde abrir y qué registrar, o por qué no. */
export function prepararTextoPuedoLlamar(
  c: Cand,
  contactos: Contact[],
  recruiter: string,
  lang: "en" | "es",
): ResultadoDelBoton {
  if (!telClean(c.phone)) return { ok: false, motivo: "sin-telefono" };
  if (envioPuedoLlamar(contactos, c.id)) return { ok: false, motivo: "ya-enviado" };
  const texto = textoPuedoLlamar(c, recruiter, lang);
  return { ok: true, texto, enlace: rcSms(c.phone, texto) };
}

/** El contacto que deja el envío: mismo `type` que el del diálogo, `result` marcado, la nota con el texto. */
export function contactoDelEnvio(texto: string): Pick<Contact, "type" | "result" | "note"> {
  return { type: "SMS", result: RESULTADO_PUEDO_LLAMAR, note: texto.slice(0, 80) };
}

/** Qué pinta el botón según el historial. */
export function estadoDelBoton(contactos: Contact[], candidateId: string, lang: "en" | "es"): { enviado: boolean; etiqueta: string } {
  const envio = envioPuedoLlamar(contactos, candidateId);
  if (!envio) return { enviado: false, etiqueta: lang === "es" ? "📱 Texto: ¿te puedo llamar?" : "📱 Text: can I call you?" };
  const hora = new Date(envio.cuando).toLocaleTimeString(lang === "es" ? "es-MX" : "en-US", { hour: "2-digit", minute: "2-digit" });
  return { enviado: true, etiqueta: (lang === "es" ? "SMS enviado ✓ " : "SMS sent ✓ ") + hora };
}

/** El teléfono en la fila de la lista (pedido del dueño, misma D-581): el número tal cual lo escribieron,
 * enlazado a RingCentral como el «📞 Llamar» de la ficha. Sin dígitos no se pinta nada. */
export function telefonoEnLaFila(phone: string | null): { texto: string; href: string } | null {
  if (!telClean(phone)) return null;
  return { texto: (phone ?? "").trim(), href: rcCall(phone) };
}
