import { diezDigitos } from "@/lib/recruiting/rc-comms";
import type { Lead } from "./reglas";

// ============================================================
// Llamadas de RingCentral con los leads (puro, sin I/O). Empareja cada llamada de la cuenta con el teléfono de un lead
// por los 10 dígitos. Lo usa el sincronizador (llamadas-sync.ts) y la pantalla (la ficha del lead). Su prueba:
// llamadas-rc.test.ts.
//
// Regla de oro (igual que las comunicaciones de candidatos): si el número de la otra parte no es de ningún lead, no se
// guarda nada. Las llamadas personales de la empresa nunca entran a la base.
//
// La regla de la clave está copiada en SQL en `public.leads_clave_de_telefono` (migración 337). Si se cambia una, se
// cambia la otra.
// ============================================================

/** Un registro del call log de la cuenta (vista Detailed). Solo los campos que usamos. */
export interface RegistroDeLlamadaDeLead {
  id: string | number;
  startTime: string;
  duration?: number | null;
  direction?: string | null;
  result?: string | null;
  from?: { phoneNumber?: string | null; name?: string | null; extensionNumber?: string | null } | null;
  to?: { phoneNumber?: string | null; name?: string | null; extensionNumber?: string | null } | null;
  recording?: { id?: string | number; contentUri?: string | null } | null;
}

/** La fila que se guarda en `rc_lead_calls` (sin id ni created_at). */
export interface FilaDeLlamadaDeLead {
  rc_call_id: string;
  direction: "in" | "out";
  started_at: string;
  duration_s: number | null;
  result: string | null;
  phone_key: string;
  rep_extension: string | null;
  rep_name: string | null;
  recording_uri: string | null;
  recording_pending: boolean;
}

/** Una llamada tal como la lee la pantalla (`leads_llamadas_de_lead`). Sin ruta de archivo. */
export interface LlamadaDeLead {
  id: string;
  rc_call_id: string;
  direction: "in" | "out";
  started_at: string;
  duration_s: number | null;
  result: string | null;
  rep_name: string | null;
  rep_extension: string | null;
  phone_key: string;
  has_recording: boolean;
  recording_pending: boolean;
}

/** Quién es el teléfono del lead: el contratista (el del Excel o el de mano) o el propietario. */
export type LadoDelTelefono = "contratista" | "propietario";

/** La clave de 10 dígitos de un número de teléfono, o null si no sirve. Quita la extensión antes de contar dígitos. */
export function claveDeTelefono(telefono: string | null | undefined): string | null {
  if (!telefono) return null;
  const sinExtension = String(telefono).replace(/\s*(ext\.?|x|#).*$/i, "");
  return diezDigitos(sinExtension);
}

/** Todos los teléfonos de un lead (Excel y de mano, contratista y propietario) como claves, sin repetir. */
export function telefonosDeLead(
  l: Pick<Lead, "owner_phone" | "owner_phone_manual" | "tenant_phone" | "tenant_phone_manual">,
): { lado: LadoDelTelefono; clave: string }[] {
  const vistos = new Set<string>();
  const salida: { lado: LadoDelTelefono; clave: string }[] = [];
  const agrega = (lado: LadoDelTelefono, texto: string | null) => {
    const clave = claveDeTelefono(texto);
    if (!clave || vistos.has(`${lado}:${clave}`)) return;
    vistos.add(`${lado}:${clave}`);
    salida.push({ lado, clave });
  };
  agrega("contratista", l.owner_phone_manual ?? null);
  agrega("contratista", l.owner_phone ?? null);
  agrega("propietario", l.tenant_phone_manual ?? null);
  agrega("propietario", l.tenant_phone ?? null);
  return salida;
}

/** El conjunto de claves de todos los leads: lo que el sincronizador busca en cada llamada. */
export function clavesDeLeads(leads: readonly Pick<Lead, "owner_phone" | "owner_phone_manual" | "tenant_phone" | "tenant_phone_manual">[]): Set<string> {
  const claves = new Set<string>();
  for (const l of leads) for (const t of telefonosDeLead(l)) claves.add(t.clave);
  return claves;
}

/** Sentido de la llamada respecto a la empresa: 'in' (entrante) o 'out' (saliente). Cualquier otra cosa no se guarda. */
function sentido(direccion: string | null | undefined): "in" | "out" | null {
  if (direccion === "Inbound") return "in";
  if (direccion === "Outbound") return "out";
  return null;
}

/**
 * Fila de una llamada, o null si la otra parte no es de ningún lead o la dirección no se conoce.
 * La otra parte es `to` si la llamada salió de la empresa y `from` si entró. El lado interno (el vendedor) es el
 * contrario: su extensión y su nombre son los que se muestran como «quién llamó».
 */
export function filaDeLlamadaDeLead(registro: RegistroDeLlamadaDeLead, claves: ReadonlySet<string>): FilaDeLlamadaDeLead | null {
  const dir = sentido(registro.direction);
  if (!dir) return null;
  const externo = dir === "out" ? registro.to : registro.from;
  const interno = dir === "out" ? registro.from : registro.to;
  const clave = claveDeTelefono(externo?.phoneNumber);
  if (!clave || !claves.has(clave)) return null;
  const uri = registro.recording?.contentUri ?? null;
  return {
    rc_call_id: String(registro.id),
    direction: dir,
    started_at: registro.startTime,
    duration_s: typeof registro.duration === "number" ? Math.round(registro.duration) : null,
    result: registro.result ?? null,
    phone_key: clave,
    rep_extension: interno?.extensionNumber?.trim() || null,
    rep_name: interno?.name?.trim() || null,
    recording_uri: uri,
    recording_pending: !!uri,
  };
}

/** Cada cuánto se barre la cuenta. El cron de RingCentral corre cada 10 minutos; esto decide cuándo toca de verdad. */
export const INTERVALO_DE_LLAMADAS_MS = 2 * 60 * 60 * 1000;
/** Un poco menos de 2 horas: el cron no cae siempre exacto, y sin este margen un barrido saltaría uno de cada dos. */
export const MARGEN_DE_BARRIDO_MS = 5 * 60 * 1000;

/** ¿Toca barrer? Si nunca corrió, sí; si no, cuando pasó casi el intervalo desde el último intento. */
export function tocaBarrer(ultimaCorrida: string | null | undefined, ahora: Date): boolean {
  if (!ultimaCorrida) return true;
  const t = Date.parse(ultimaCorrida);
  if (!Number.isFinite(t)) return true;
  return ahora.getTime() - t >= INTERVALO_DE_LLAMADAS_MS - MARGEN_DE_BARRIDO_MS;
}
