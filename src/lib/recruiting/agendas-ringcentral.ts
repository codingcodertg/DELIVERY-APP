// ============================================================
// Las agendas de RingCentral donde se guarda el candidato (D-NEXT, 2026-10-19). El dueño, al ver que D-591 lo guardaba en la
// de «Careers» y no en la suya: «osea yo solo quiero que el contacto me aparezca a mi tambien mas que todo en mi ring
// central agenda».
//
// Medido el 2026-10-19: su RingCentral es OTRA cuenta (682192050, número principal 956-782-4603; él es la extensión 908) y
// la app de RTG Hub es privada de la cuenta de «Careers» («Access to account [682192050] is prohibited for private
// application»). Con una app creada por él en su cuenta y un JWT de su usuario, el token sale con `Contacts` y su agenda
// se lee (0 contactos). Así que cada agenda extra es una app + un JWT propios, y van en UNA variable de entorno:
//
//   RINGCENTRAL_AGENDAS_EXTRA = [{"nombre":"Andrés","clientId":"…","clientSecret":"…","jwt":"…"}]
//
// Puro: aquí solo se lee y se valida la variable. La escritura la hace `ringcentral.ts` con esas credenciales.
// ============================================================

export interface CredencialesRingCentral {
  clientId: string;
  clientSecret: string;
  jwt: string;
}

export interface AgendaExtra extends CredencialesRingCentral {
  /** Cómo se llama en los avisos y en la traza: «Andrés». */
  nombre: string;
}

/** Las agendas extra que dice la variable: JSON de una lista de {nombre, clientId, clientSecret, jwt}. Una entrada a la
 *  que le falte algo se salta (no se guarda a medias ni se rompe el resto); una variable vacía o mal formada, ninguna. */
export function agendasExtraDesde(valor: string | null | undefined): AgendaExtra[] {
  const texto = (valor ?? "").trim();
  if (!texto) return [];
  let crudo: unknown;
  try { crudo = JSON.parse(texto); } catch { return []; }
  if (!Array.isArray(crudo)) return [];
  const limpias: AgendaExtra[] = [];
  for (const e of crudo) {
    if (!e || typeof e !== "object") continue;
    const o = e as Record<string, unknown>;
    const campos = ["nombre", "clientId", "clientSecret", "jwt"] as const;
    if (!campos.every((k) => typeof o[k] === "string" && (o[k] as string).trim())) continue;
    limpias.push({ nombre: (o.nombre as string).trim(), clientId: (o.clientId as string).trim(), clientSecret: (o.clientSecret as string).trim(), jwt: (o.jwt as string).trim() });
  }
  return limpias;
}

/** El nombre de la agenda del servidor (la del JWT de siempre): la línea de reclutamiento. */
export const AGENDA_DEL_SERVIDOR = "Careers";

/** La traza que queda en el historial del candidato: «Andres Ugarte WA BRO · Careers, Andrés». */
export function notaDelGuardado(display: string, agendas: readonly string[]): string {
  return agendas.length ? `${display} · ${agendas.join(", ")}` : display;
}
