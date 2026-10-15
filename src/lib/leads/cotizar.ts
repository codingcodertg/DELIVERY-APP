/**
 * Leads → Quote Builder (D-558): la primera conexión del mapa de apps (D-554). Un lead llega al Quote Builder sin
 * volver a teclearlo, y la cotización que sale de él queda enlazada al lead (`estimator_quotes.lead_id`, migración 175).
 *
 * El dueño, 2026-10-15, a «¿construyo la primera conexión, Leads → Quote Builder?»: «si a todo».
 *
 * Aquí vive TODO lo que decide, sin navegador ni base; las dos pantallas (`src/app/leads/Leads.tsx` y
 * `src/app/estimator/Estimador.tsx`) solo lo llaman:
 *   - quién puede cotizar un lead (`puedeCotizarLead`), la MISMA regla en las dos pantallas;
 *   - qué datos del lead pasan a la cotización y a qué campo (`borradorDesdeLead`);
 *   - cómo se escribe el enlace en cada sentido (`enlaceACotizar`, `enlaceALead`, `enlaceACotizacion`);
 *   - cómo se agrupan las cotizaciones de cada lead (`cotizacionesPorLead`) y qué dice la cotización de su lead
 *     (`vinculoDeLead`).
 */
import { telefonoAlEscribir, type QuoteDraft } from "@/lib/estimator/modelo";
import type { Lead, Persona } from "./reglas";

/** El módulo del Quote Builder: admin siempre, o `'estimator'` en `module_access`. La misma regla que
 *  `has_estimator_access()` (148) y que la puerta de `src/app/estimator/layout.tsx`. */
export function tieneEstimador(perfil: { role?: string | null; module_access?: string[] | null } | null | undefined): boolean {
  if (!perfil) return false;
  return perfil.role === "admin" || (perfil.module_access ?? []).includes("estimator");
}

/**
 * ¿Puede esta persona sacar una cotización de este lead?
 *
 * - Hace falta el Quote Builder (`conEstimador`): sin él la cotización no se podría ni abrir.
 * - El admin, de cualquier lead que vea.
 * - Los demás, solo de un lead SUYO, tomado o vendido. Un lead libre se toma primero: cotizarlo sin tomarlo sería
 *   trabajarlo sin que ocupe puesto, y el tope de leads abiertos (162) dejaría de medir nada. Uno de otra persona,
 *   no: su contacto está oculto (`veContacto`) y la cotización lo traería escrito.
 */
export function puedeCotizarLead(
  lead: Pick<Lead, "status" | "holder">, yo: Pick<Persona, "id" | "admin">, conEstimador: boolean,
): boolean {
  if (!conEstimador) return false;
  if (yo.admin) return true;
  return lead.holder === yo.id && (lead.status === "taken" || lead.status === "won");
}

/** El nombre con el que se dice un lead: el mismo título de su tarjeta en Leads. */
export function nombreDeLead(l: Pick<Lead, "project_name" | "facility_name" | "tabs_project">): string {
  return (l.project_name ?? "").trim() || (l.facility_name ?? "").trim() || l.tabs_project;
}

/** La dirección de la obra en una línea, como la escribe la búsqueda de dirección: «calle, ciudad, TX zip». */
export function direccionDeObra(l: Pick<Lead, "site_address" | "site_city" | "site_zip">): string {
  const calle = (l.site_address ?? "").trim();
  const ciudad = (l.site_city ?? "").trim();
  const zip = (l.site_zip ?? "").trim();
  if (!calle && !ciudad) return "";
  return [calle, ciudad, ["TX", zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
}

/**
 * El borrador de una cotización nueva, relleno con lo que el lead ya tiene. Lo que cada lado tiene y casa:
 *
 * | Lead (162)                      | Quote Builder (148)                                      |
 * |---------------------------------|----------------------------------------------------------|
 * | `owner_contact` (la persona)    | Nombre completo                                          |
 * | `owner_name` (el dueño de obra) | Empresa; y Nombre completo si no hay contacto            |
 * | `owner_phone`                   | Teléfono, con el formato del campo (956-555-0123)        |
 * | `site_address/city/zip`         | Dirección de entrega (el modo se queda como estaba)      |
 * | `pool` (la tienda más cercana)  | Tienda de salida, solo si es una tienda de Ajustes       |
 *
 * No hay correo en ninguno de los dos lados, y el resumen del proyecto **se imprime**: no se rellena solo.
 * El modo de entrega no cambia (recoge, por defecto): la dirección queda escrita para cuando se elija «Entrega».
 */
export function borradorDesdeLead(
  lead: Pick<Lead, "owner_name" | "owner_contact" | "owner_phone" | "site_address" | "site_city" | "site_zip" | "pool">,
  base: QuoteDraft,
  tiendas: readonly string[],
): QuoteDraft {
  const contacto = (lead.owner_contact ?? "").trim();
  const dueno = (lead.owner_name ?? "").trim();
  const direccion = direccionDeObra(lead);
  const pool = lead.pool.trim().toLowerCase();
  const tienda = tiendas.find((t) => t.trim().toLowerCase() === pool);
  return {
    ...base,
    customer: {
      ...base.customer,
      full_name: contacto || dueno,
      company: contacto ? dueno : "",
      phone: telefonoAlEscribir((lead.owner_phone ?? "").trim()),
    },
    delivery: {
      ...base.delivery,
      ...(direccion ? { address: direccion, lat: null, lng: null, pin_source: null, miles: null } : {}),
      ...(tienda ? { store: tienda, miles: null } : {}),
    },
  };
}

/**
 * Qué hace el Quote Builder al abrirse con `?lead=<id>`, según lo que devolvió la lectura del lead:
 * - `error`: la lectura falló (se dice con su texto);
 * - `no-visible`: la RLS de leads no le deja ver ese lead (o no existe): no se rellena nada;
 * - `sin-permiso`: lo ve, pero no es suyo (ni es admin): no se rellena, y se le dice que lo tome primero;
 * - `rellenar`: se rellena el borrador y la cotización nueva queda enlazada a él.
 */
export type Relleno =
  | { tipo: "error"; error: string }
  | { tipo: "no-visible" }
  | { tipo: "sin-permiso"; lead: Lead }
  | { tipo: "rellenar"; lead: Lead };

export function decidirRelleno(
  leido: { ok: true; valor: Lead | null } | { ok: false; error: string }, yo: Pick<Persona, "id" | "admin">,
): Relleno {
  if (!leido.ok) return { tipo: "error", error: leido.error };
  if (!leido.valor) return { tipo: "no-visible" };
  // Dentro del Quote Builder el módulo ya está (la puerta de su layout lo exige): la regla es la misma que en Leads.
  if (!puedeCotizarLead(leido.valor, yo, true)) return { tipo: "sin-permiso", lead: leido.valor };
  return { tipo: "rellenar", lead: leido.valor };
}

/** Del lead al Quote Builder: el Quote Builder lee el lead con la sesión de quien abre (la RLS de la 163 decide). */
export const enlaceACotizar = (leadId: string): string => `/estimator?lead=${encodeURIComponent(leadId)}`;
/** De la cotización a su lead. */
export const enlaceALead = (leadId: string): string => `/leads?lead=${encodeURIComponent(leadId)}`;
/** Del lead a una de sus cotizaciones. */
export const enlaceACotizacion = (quoteId: string): string => `/estimator?quote=${encodeURIComponent(quoteId)}`;

/** Un parámetro de la URL que parece un id (uuid, o el `demo-…` del modo demo). Lo demás no se busca. */
export function idDeParametro(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  return /^[0-9a-zA-Z-]{1,64}$/.test(s) ? s : null;
}

export interface CotizacionDeLead { id: string; estimate_num: string; lead_id: string; updated_at: string }

/** Las cotizaciones que quien mira VE (la RLS de la 148), agrupadas por lead, de la más reciente a la más vieja. */
export function cotizacionesPorLead(filas: readonly CotizacionDeLead[]): Map<string, CotizacionDeLead[]> {
  const out = new Map<string, CotizacionDeLead[]>();
  for (const f of filas) {
    if (!f.lead_id) continue;
    const lista = out.get(f.lead_id) ?? [];
    lista.push(f);
    out.set(f.lead_id, lista);
  }
  for (const lista of out.values()) lista.sort((a, b) => b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id));
  return out;
}

/**
 * Lo que la cotización dice de su lead:
 * - `ninguno`: no salió de un lead (o la 175 aún no está y no se pudo guardar el enlace);
 * - `cargando`: tiene lead y aún no se ha leído;
 * - `visible`: quien mira ve el lead → «De lead: <nombre>», con enlace;
 * - `oculto`: tiene lead, pero la RLS de leads no se lo deja ver a quien mira (otra tienda, o sin el módulo): se dice
 *   que viene de un lead, sin nombre ni enlace. Saber que hay un enlace no enseña ningún dato del lead.
 * - `error`: la lectura falló. No es «oculto»: una avería no se disfraza de permiso.
 */
export type VinculoDeLead =
  | { estado: "ninguno" }
  | { estado: "cargando" }
  | { estado: "visible"; nombre: string; href: string }
  | { estado: "oculto" }
  | { estado: "error" };

export function vinculoDeLead(leadId: string | null, leido: Lead | null | undefined | "error"): VinculoDeLead {
  if (!leadId) return { estado: "ninguno" };
  if (leido === undefined) return { estado: "cargando" };
  if (leido === "error") return { estado: "error" };
  if (leido === null || leido.id !== leadId) return { estado: "oculto" };
  return { estado: "visible", nombre: nombreDeLead(leido), href: enlaceALead(leadId) };
}
