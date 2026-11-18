// ============================================================
// Comunicaciones de RingCentral con candidatos (puro, sin I/O). Empareja cada llamada y cada SMS de la linea del dueno
// con el candidato por su telefono. Lo usa el sincronizador (rc-comms-sync.ts) y su prueba (rc-comms.test.ts).
//
// Regla de oro: si el numero de la otra parte no es de ningun candidato, la funcion devuelve null y no se guarda nada.
// Asi las llamadas personales del dueno nunca entran al hub.
// ============================================================

/** Un registro del call log de RingCentral (vista Detailed). Solo los campos que usamos. */
export interface RegistroDeLlamada {
  id: string | number;
  startTime: string;
  duration?: number | null;
  direction?: string | null;
  result?: string | null;
  from?: { phoneNumber?: string | null } | null;
  to?: { phoneNumber?: string | null } | null;
  recording?: { id?: string | number; contentUri?: string | null } | null;
}

/** Un registro del message store de RingCentral (SMS). Solo los campos que usamos. */
export interface RegistroDeTexto {
  id: string | number;
  creationTime: string;
  direction?: string | null;
  subject?: string | null;
  messageStatus?: string | null;
  from?: { phoneNumber?: string | null } | null;
  to?: Array<{ phoneNumber?: string | null }> | null;
}

/** Un candidato para el indice: solo el id, el telefono y cuando se creo (para el desempate). */
export interface CandidatoParaIndice {
  id: string;
  phone: string | null;
  created_at?: string | null;
}

/** Mapa de telefono de 10 digitos -> id del candidato. */
export type IndiceDeCandidatos = Map<string, string>;

/** La fila que se guarda en recruiting.rc_comms (sin id ni created_at). */
export interface FilaDeComunicacion {
  rc_id: string;
  kind: "call" | "sms";
  candidate_id: string;
  phone: string;
  direction: "in" | "out";
  at: string;
  duration_s: number | null;
  result: string | null;
  body: string | null;
  recording_uri: string | null;
  recording_pending: boolean;
}

/** Telefono como 10 digitos: quita todo lo que no sea digito, quita el 1 de EE. UU. si vienen 11, y devuelve los
 *  ultimos 10. Null si quedan menos de 10 (un numero corto no sirve para emparejar). */
export function diezDigitos(telefono: string | null | undefined): string | null {
  if (!telefono) return null;
  let digitos = String(telefono).replace(/\D/g, "");
  if (digitos.length === 11 && digitos.startsWith("1")) digitos = digitos.slice(1);
  if (digitos.length < 10) return null;
  return digitos.slice(-10);
}

/** Indice telefono -> candidato. Si dos candidatos comparten telefono gana el creado mas recientemente (el alta mas
 *  nueva es la que el reclutador esta trabajando). Los candidatos sin telefono valido no entran. */
export function indiceDeCandidatos(candidatos: readonly CandidatoParaIndice[]): IndiceDeCandidatos {
  const indice: IndiceDeCandidatos = new Map();
  const creadoEn = new Map<string, number>();
  for (const c of candidatos) {
    const diez = diezDigitos(c.phone);
    if (!diez) continue;
    const fecha = c.created_at ? Date.parse(c.created_at) : Number.NEGATIVE_INFINITY;
    const previo = creadoEn.get(diez);
    if (previo === undefined || fecha >= previo) {
      indice.set(diez, c.id);
      creadoEn.set(diez, fecha);
    }
  }
  return indice;
}

/** Direccion de RingCentral a la de la base: 'in' o 'out'. Cualquier otra cosa no se guarda. */
function sentido(direccion: string | null | undefined): "in" | "out" | null {
  if (direccion === "Inbound") return "in";
  if (direccion === "Outbound") return "out";
  return null;
}

/** La otra parte de la conversacion: `to` si salio del dueno, `from` si entro. */
function otraParte(
  direccion: "in" | "out",
  desde: { phoneNumber?: string | null } | null | undefined,
  hacia: { phoneNumber?: string | null } | null | undefined,
): string | null {
  return direccion === "out" ? (hacia?.phoneNumber ?? null) : (desde?.phoneNumber ?? null);
}

/** Fila de una llamada, o null si no es de un candidato o la direccion no se conoce. Si la llamada tiene grabacion,
 *  la marca pendiente de bajar y guarda su URL (contentUri) para la siguiente corrida. */
export function filaDeLlamada(registro: RegistroDeLlamada, indice: IndiceDeCandidatos): FilaDeComunicacion | null {
  const dir = sentido(registro.direction);
  if (!dir) return null;
  const diez = diezDigitos(otraParte(dir, registro.from, registro.to));
  const candidatoId = diez ? indice.get(diez) : undefined;
  if (!diez || !candidatoId) return null;
  const uri = registro.recording?.contentUri ?? null;
  return {
    rc_id: String(registro.id),
    kind: "call",
    candidate_id: candidatoId,
    phone: diez,
    direction: dir,
    at: registro.startTime,
    duration_s: typeof registro.duration === "number" ? Math.round(registro.duration) : null,
    result: registro.result ?? null,
    body: null,
    recording_uri: uri,
    recording_pending: !!uri,
  };
}

/** Fila de un SMS, o null si no es de un candidato o la direccion no se conoce. `result` guarda el estado del mensaje. */
export function filaDeTexto(registro: RegistroDeTexto, indice: IndiceDeCandidatos): FilaDeComunicacion | null {
  const dir = sentido(registro.direction);
  if (!dir) return null;
  const hacia = Array.isArray(registro.to) ? registro.to[0] : null;
  const diez = diezDigitos(otraParte(dir, registro.from, hacia));
  const candidatoId = diez ? indice.get(diez) : undefined;
  if (!diez || !candidatoId) return null;
  return {
    rc_id: String(registro.id),
    kind: "sms",
    candidate_id: candidatoId,
    phone: diez,
    direction: dir,
    at: registro.creationTime,
    duration_s: null,
    result: registro.messageStatus ?? null,
    body: registro.subject ?? null,
    recording_uri: null,
    recording_pending: false,
  };
}

/** La agenda de las credenciales del dueno: la que diga `nombre` (sin distinguir mayusculas), o la primera si no hay
 *  nombre o no existe. Lista vacia -> null. */
export function elegirAgenda<T extends { nombre: string }>(agendas: readonly T[], nombre?: string | null): T | null {
  if (!agendas.length) return null;
  const buscado = (nombre ?? "").trim().toLowerCase();
  if (!buscado) return agendas[0];
  return agendas.find((a) => a.nombre.trim().toLowerCase() === buscado) ?? agendas[0];
}
