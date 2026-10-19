import type { Candidate, Contact } from "./types";
import { mergeTemplate, rcSms, telClean } from "./utils";

/* ---- «📱 Texto de seguimiento» tras un buzón de voz o un «volver a llamar» (D-598, 2026-10-19) ----
 * El dueño: «en la entrevista si le doy buzón de voz o volver a llamar dame la opción para mandarle un follow up text
 * message con ese template de te estoy llamando por el trabajo de tal y cuándo está disponible». Medido: esos dos
 * botones del diálogo de entrevista registraban el contacto «Call / Buzón de voz» y cerraban el diálogo; para textear
 * había que volver a abrir al candidato y usar el «💬 Texto» vacío. Ahora, tras esos dos resultados, el diálogo se queda
 * abierto con el texto de seguimiento armado y editable, y un botón que lo abre en RingCentral (mismo camino que D-581:
 * enlace rcsms, contacto SMS marcado; nada sale hasta pulsar enviar allí). Una plantilla de Ajustes → Plantillas cuyo
 * nombre lleve «seguimiento» o «follow up» manda sobre la de aquí. */

/** Los resultados de llamada que ofrecen el seguimiento (las claves en inglés de los botones, no la etiqueta traducida). */
export const RESULTADOS_CON_SEGUIMIENTO: ReadonlySet<string> = new Set(["Voicemail", "Call back later"]);

export function ofreceSeguimiento(resultado: string): boolean {
  return RESULTADOS_CON_SEGUIMIENTO.has(resultado);
}

export const RESULTADO_SEGUIMIENTO = "sent · follow-up";

/** De usted, como los textos que dictó el dueño (D-595, D-597); firma quien pulsa. */
export const PLANTILLA = {
  en: "Hello, this is {recruiter} from Rodriguez Tile Group. I'm calling you about the {role} position you applied for. When would you be available for a brief phone interview? Reply with a good time and I'll call you then. Thank you!",
  es: "Hola, le habla {recruiter} de Rodriguez Tile Group. Le estoy llamando por el puesto de {role} al que aplicó. ¿Cuándo está disponible para una breve entrevista telefónica? Respóndame con un horario y le llamo a esa hora. ¡Gracias!",
} as const;

const ETIQUETA_DE_PLANTILLA = /seguimiento|follow[- ]?up/i;

/** La plantilla de Ajustes → Plantillas que manda sobre la de aquí (por el nombre), o null si no hay. */
export function plantillaDeSeguimiento(templates: readonly { label: string; text: string }[]): string | null {
  const t = templates.find((x) => ETIQUETA_DE_PLANTILLA.test(x.label) && x.text.trim());
  return t ? t.text : null;
}

type Cand = Pick<Candidate, "name" | "role"> & { phone: string | null };

/** El texto propuesto: la plantilla (de Ajustes o de aquí) con los marcadores de `mergeTemplate` resueltos. */
export function textoDeSeguimiento(c: Cand, recruiter: string, lang: "en" | "es", plantilla: string | null = null): string {
  return mergeTemplate(plantilla ?? PLANTILLA[lang], c as Candidate, recruiter).replace(/[ \t]{2,}/g, " ").trim();
}

export type Seguimiento =
  | { ok: true; texto: string; enlace: string }
  | { ok: false; motivo: "sin-telefono" | "sin-texto" };

/** Qué abre el botón «📱 Mandar texto de seguimiento» con el texto ya editado, o por qué no. Nunca manda nada solo. */
export function prepararTextoDeSeguimiento(c: Cand, texto: string): Seguimiento {
  if (!telClean(c.phone)) return { ok: false, motivo: "sin-telefono" };
  const limpio = texto.trim();
  if (!limpio) return { ok: false, motivo: "sin-texto" };
  return { ok: true, texto: limpio, enlace: rcSms(c.phone, limpio) };
}

/** El contacto que deja el envío: mismo `type` SMS que el diálogo, `result` marcado para distinguirlo. */
export function contactoDelSeguimiento(texto: string): Pick<Contact, "type" | "result" | "note"> {
  return { type: "SMS", result: RESULTADO_SEGUIMIENTO, note: texto.slice(0, 80) };
}
