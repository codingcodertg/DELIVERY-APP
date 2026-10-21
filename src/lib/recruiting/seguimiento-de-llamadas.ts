import type { Candidate, Contact, Stage } from "./types";

/* ---- Pestaña «📞 Seguimiento»: buzones de voz y llamadas agendadas pendientes (D-629, 2026-10-21) ----
 * El dueño: «la gente que me sale el voicemail, me salga ahí como voicemail, follow up, y yo tengo un ancho como
 * dismiss o descartar o keep following up. Y si yo agendo una llamada, que me aparezca hasta ahí, hey, tienes esa
 * llamada pendiente. Y hasta que yo le di, ya le llamé o voicemail o dismiss».
 *
 * Nada se guarda aparte: la lista se DERIVA del historial de contactos (`recruiting.contacts`) y de `phone_date`, como
 * «Hoy» (D-061). Los botones de la pestaña solo añaden contactos —el mismo `addContact` de siempre— con un `result`
 * marcado, igual que «sent · can I call?» (D-581) o «hired by manager» (D-600). Sin migración.
 *
 * Qué entra:
 *   · «fallida»: el último resultado de llamada que decide es Buzón de voz / Sin respuesta / Volver a llamar (los tres
 *     de `RESULTADOS_CON_SEGUIMIENTO`, D-612, y los mismos que ponen la etiqueta «call again»). El resultado se guarda
 *     traducido (D-598), así que se reconocen las dos lenguas.
 *   · «agendada»: tiene `phone_date`, aún no hay entrevista guardada, y desde la cita (con una hora de margen por si se
 *     llama antes) no se ha registrado ningún resultado. Si se registra un buzón, deja de ser «agendada» y pasa a «fallida».
 * Qué saca a alguien: un resultado de llamada que no es fallido (Contestó, Número equivocado, «Ya le llamé»…), el
 * «Descartar» de esta pestaña, una entrevista guardada, un contacto «In person» (ya va a presencial), o que el candidato
 * esté archivado o en una etapa final (contratado / descartado). Un «📞 Llamar» suelto (result vacío) NO saca a nadie:
 * es un intento, no un desenlace.
 * «Descartar» quita de ESTA lista, no descarta al candidato: su etapa no se toca. */

/** Resultados de llamada que dejan al candidato en seguimiento, en las dos lenguas en que se guardan. */
export const RESULTADOS_FALLIDOS: ReadonlyMap<string, MotivoFallido> = new Map<string, MotivoFallido>([
  ["Voicemail", "buzon"], ["Buzón de voz", "buzon"],
  ["No answer", "sin-respuesta"], ["Sin respuesta", "sin-respuesta"],
  ["Call back later", "volver-a-llamar"], ["Volver a llamar", "volver-a-llamar"],
]);
export type MotivoFallido = "buzon" | "sin-respuesta" | "volver-a-llamar";

export const TIPO_LLAMADA = "Call";
export const TIPO_SEGUIMIENTO = "Follow-up";
/** «Ya le llamé»: un resultado de llamada más, que cierra. */
export const RESULTADO_YA_LLAMADO = "called · follow-up done";
/** «Descartar»: lo quita de la lista sin tocar al candidato. */
export const RESULTADO_DESCARTADO = "dismissed from follow-up";
/** «Seguir llamando»: queda constancia de la decisión; no cambia quién está en la lista. */
export const RESULTADO_SEGUIR = "keep following up";
/** Margen antes de la cita: un resultado registrado hasta una hora antes de `phone_date` cuenta como de esa llamada. */
export const MARGEN_DE_LA_CITA_MS = 60 * 60 * 1000;

/** La nota que ata un «Ya le llamé» / «Descartar» a UNA cita concreta, para que valga aunque se pulse antes de la hora. */
export const notaDeLaCita = (phoneDate: string) => `cita ${phoneDate}`;

type Evento = { en: number; clase: "fallida" | "cierre" | "seguir"; motivo?: MotivoFallido; nota: string | null };

function clasificar(k: Pick<Contact, "type" | "result" | "note" | "created_at">): Evento | null {
  const en = Date.parse(k.created_at);
  if (Number.isNaN(en)) return null;
  const r = (k.result ?? "").trim();
  if (k.type === TIPO_LLAMADA) {
    if (!r) return null; // «📞 Llamar»: un intento sin desenlace
    const motivo = RESULTADOS_FALLIDOS.get(r);
    return motivo ? { en, clase: "fallida", motivo, nota: k.note } : { en, clase: "cierre", nota: k.note };
  }
  if (k.type === TIPO_SEGUIMIENTO && r === RESULTADO_DESCARTADO) return { en, clase: "cierre", nota: k.note };
  if (k.type === TIPO_SEGUIMIENTO && r === RESULTADO_SEGUIR) return { en, clase: "seguir", nota: k.note };
  if (k.type === "In person") return { en, clase: "cierre", nota: k.note };
  return null;
}

export type ItemDeSeguimiento =
  | {
      tipo: "agendada";
      c: Candidate;
      /** La cita (`phone_date`). */
      cuando: string;
      atrasada: boolean;
      /** Llamadas fallidas desde el último cierre (para «2 buzones antes»). */
      intentos: number;
    }
  | {
      tipo: "fallida";
      c: Candidate;
      motivo: MotivoFallido;
      /** Cuándo fue el último intento fallido. */
      ultima: string;
      intentos: number;
      /** Último «Seguir llamando» después de ese cierre, si lo hubo. */
      siguiendoDesde: string | null;
    };

/** El estado de seguimiento de UN candidato, o null si no tiene nada pendiente. `contactos`: los suyos (o todos; se filtran). */
export function seguimientoDelCandidato(
  c: Candidate,
  contactos: readonly Contact[],
  terminales: ReadonlySet<string>,
  ahora: Date = new Date(),
): ItemDeSeguimiento | null {
  if (c.archived || terminales.has(c.status)) return null;

  const eventos: Evento[] = [];
  for (const k of contactos) {
    if (k.candidate_id !== c.id) continue;
    const e = clasificar(k);
    if (e) eventos.push(e);
  }
  const entrevista = c.interview?.date ? Date.parse(c.interview.date) : NaN;
  if (!Number.isNaN(entrevista)) eventos.push({ en: entrevista, clase: "cierre", nota: null });
  eventos.sort((a, b) => a.en - b.en);

  // Lo que pasó desde el último cierre.
  let desde = -1;
  for (let i = 0; i < eventos.length; i++) if (eventos[i].clase === "cierre") desde = i;
  const abiertos = eventos.slice(desde + 1);
  const fallidas = abiertos.filter((e) => e.clase === "fallida");

  if (c.phone_date && !c.interview) {
    const cita = Date.parse(c.phone_date);
    if (!Number.isNaN(cita)) {
      const atada = notaDeLaCita(c.phone_date);
      const resuelta = eventos.some(
        (e) => (e.clase === "fallida" || e.clase === "cierre") && (e.en >= cita - MARGEN_DE_LA_CITA_MS || e.nota === atada),
      );
      if (!resuelta) return { tipo: "agendada", c, cuando: c.phone_date, atrasada: cita < ahora.getTime(), intentos: fallidas.length };
    }
  }

  const ultimaFallida = fallidas[fallidas.length - 1];
  if (!ultimaFallida) return null;
  const seguir = abiertos.filter((e) => e.clase === "seguir").pop();
  return {
    tipo: "fallida",
    c,
    motivo: ultimaFallida.motivo!,
    ultima: new Date(ultimaFallida.en).toISOString(),
    intentos: fallidas.length,
    siguiendoDesde: seguir ? new Date(seguir.en).toISOString() : null,
  };
}

export type ListaDeSeguimiento = {
  /** Por la hora de la cita, la más antigua primero (las atrasadas arriba). */
  agendadas: Extract<ItemDeSeguimiento, { tipo: "agendada" }>[];
  /** Por el último intento, el más reciente primero: lo de esta semana arriba, lo viejo abajo. */
  fallidas: Extract<ItemDeSeguimiento, { tipo: "fallida" }>[];
};

export function listaDeSeguimiento(
  candidatos: readonly Candidate[],
  contactos: readonly Contact[],
  stages: readonly Pick<Stage, "key" | "type">[],
  ahora: Date = new Date(),
): ListaDeSeguimiento {
  const terminales = new Set(stages.filter((s) => s.type !== "active").map((s) => s.key));
  const porCandidato = new Map<string, Contact[]>();
  for (const k of contactos) {
    const l = porCandidato.get(k.candidate_id);
    if (l) l.push(k);
    else porCandidato.set(k.candidate_id, [k]);
  }
  const lista: ListaDeSeguimiento = { agendadas: [], fallidas: [] };
  for (const c of candidatos) {
    const it = seguimientoDelCandidato(c, porCandidato.get(c.id) ?? [], terminales, ahora);
    if (it?.tipo === "agendada") lista.agendadas.push(it);
    else if (it?.tipo === "fallida") lista.fallidas.push(it);
  }
  lista.agendadas.sort((a, b) => Date.parse(a.cuando) - Date.parse(b.cuando));
  lista.fallidas.sort((a, b) => Date.parse(b.ultima) - Date.parse(a.ultima));
  return lista;
}

export type AccionDeSeguimiento = "ya-llamado" | "buzon" | "seguir" | "descartar";

/** El contacto que deja cada botón. En una «agendada», «Ya le llamé» y «Descartar» llevan la cita en la nota, para que
 *  valgan aunque se pulsen antes de la hora. El buzón se guarda traducido, como en la entrevista (D-598). */
export function contactoDeLaAccion(
  accion: AccionDeSeguimiento,
  item: Pick<ItemDeSeguimiento, "tipo"> & { c: Pick<Candidate, "phone_date"> },
  lang: "en" | "es",
): Pick<Contact, "type" | "result" | "note"> {
  const nota = item.tipo === "agendada" && item.c.phone_date ? notaDeLaCita(item.c.phone_date) : "";
  switch (accion) {
    case "ya-llamado":
      return { type: TIPO_LLAMADA, result: RESULTADO_YA_LLAMADO, note: nota };
    case "buzon":
      return { type: TIPO_LLAMADA, result: lang === "es" ? "Buzón de voz" : "Voicemail", note: "" };
    case "seguir":
      return { type: TIPO_SEGUIMIENTO, result: RESULTADO_SEGUIR, note: "" };
    case "descartar":
      return { type: TIPO_SEGUIMIENTO, result: RESULTADO_DESCARTADO, note: nota };
  }
}

/** La etiqueta «call again» acompaña a la lista: el buzón la pone, «Ya le llamé» y «Descartar» la quitan. null = no tocar. */
export function etiquetasTrasLaAccion(accion: AccionDeSeguimiento, tags: readonly string[], etiqueta: string): string[] | null {
  const tiene = tags.includes(etiqueta);
  if (accion === "buzon") return tiene ? null : [...tags, etiqueta];
  if (accion === "ya-llamado" || accion === "descartar") return tiene ? tags.filter((t) => t !== etiqueta) : null;
  return null;
}
