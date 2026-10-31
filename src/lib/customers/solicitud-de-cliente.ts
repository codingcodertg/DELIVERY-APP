/**
 * El alta de un cliente por vendedor o gerente es una SOLICITUD que aprueba el admin (D-743, 2026-10-29; migración 216).
 *
 * El dueño: «nuevo cliente no es que lo agregan, es que ellos ponen la info y llenan un formulario, pero para ellos y
 * para manager ellos deben mandar eso como request para que el admin lo apruebe».
 *
 * - Quién solicita (`altaEsSolicitud`): vendedor y gerente. El admin crea directo, como siempre.
 * - El mismo formulario de alta (D-664, varias tiendas); al «Enviar solicitud» se guarda en `erp.customer_requests`
 *   (`cuerpoDeSolicitud`: las tiendas y los campos, sin `store` ni `company_id`) y se avisa al admin por el canal que ya
 *   mira: una solicitud de ayuda (`/api/help`, D-311) con `mensajeDeAltaPendiente`.
 * - El admin ve «Solicitudes» en Clientes y aprueba o rechaza; aprobar crea las filas (una por tienda, misma empresa,
 *   `created_by` = quien pidió) con `erp.aprueba_solicitud_de_cliente`.
 */
import type { UserRole } from "@/lib/types";
import type { Parche } from "./reglas";

export type EstadoDeSolicitud = "pending" | "approved" | "rejected";

export interface SolicitudDeCliente {
  id: number;
  /** D-780 (221): 'alta' (216) o 'edicion' de una fila (`customer_id`): `payload` solo con lo que cambia, `before` con lo que había, `note` el porqué. */
  kind: "alta" | "edicion";
  customer_id: number | null;
  before: Record<string, unknown> | null;
  note: string | null;
  requested_by: string;
  /** El nombre de quien pidió, si el almacén lo pudo poner. */
  requested_name: string | null;
  stores: string[];
  payload: Record<string, unknown>;
  status: EstadoDeSolicitud;
  created_at: string;
  decided_at: string | null;
  decision_note: string | null;
  created_ids: number[] | null;
}

export function altaEsSolicitud(role: UserRole | null | undefined): boolean {
  return role === "sales" || role === "manager";
}

/** Lo que se escribe en la base: las tiendas marcadas y los campos del formulario (la fila, sin tienda ni empresa). */
export function cuerpoDeSolicitud(parche: Parche, tiendas: readonly string[]): { stores: string[]; payload: Record<string, unknown> } {
  const payload: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(parche)) {
    if (k === "store" || k === "company_id" || v === undefined) continue;
    payload[k] = v;
  }
  return { stores: [...new Set(tiendas.map((s) => s.trim()).filter(Boolean))], payload };
}

const texto = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
const numero = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function solicitudDeLaBase(f: Record<string, unknown>): SolicitudDeCliente {
  const estado = f.status === "approved" || f.status === "rejected" ? f.status : "pending";
  return {
    id: Number(f.id),
    kind: f.kind === "edicion" ? "edicion" : "alta",
    customer_id: numero(f.customer_id),
    before: f.before && typeof f.before === "object" && !Array.isArray(f.before) ? (f.before as Record<string, unknown>) : null,
    note: texto(f.note),
    requested_by: String(f.requested_by ?? ""),
    requested_name: texto(f.requested_name),
    stores: Array.isArray(f.stores) ? f.stores.filter((s): s is string => typeof s === "string") : [],
    payload: f.payload && typeof f.payload === "object" && !Array.isArray(f.payload) ? (f.payload as Record<string, unknown>) : {},
    status: estado,
    created_at: String(f.created_at ?? ""),
    decided_at: texto(f.decided_at),
    decision_note: texto(f.decision_note),
    created_ids: Array.isArray(f.created_ids) ? f.created_ids.map(numero).filter((n): n is number => n !== null) : null,
  };
}

/** La cuenta pedida, y lo que ayuda a reconocerla: contacto y teléfono si vienen. */
export function resumenDeSolicitud(s: Pick<SolicitudDeCliente, "payload" | "stores">): { cuenta: string; tiendas: string; detalle: string } {
  const p = s.payload;
  const contacto = texto(p.contact_name) ?? (Array.isArray(p.contacts) ? texto((p.contacts[0] as Record<string, unknown> | undefined)?.name) : null);
  const telefono = texto(p.phone) ?? (Array.isArray(p.contacts) ? texto(((p.contacts[0] as Record<string, unknown> | undefined)?.phones as unknown[] | undefined)?.[0]) : null);
  return {
    cuenta: texto(p.account) ?? "—",
    tiendas: s.stores.join(", "),
    detalle: [contacto, telefono].filter(Boolean).join(" · "),
  };
}

export const pendientes = (lista: readonly SolicitudDeCliente[]): SolicitudDeCliente[] => lista.filter((s) => s.status === "pending");

/** La página a la que vuelve el admin desde la solicitud de ayuda: Clientes con la ventana de solicitudes abierta. */
export const PAGINA_DE_SOLICITUDES = "/customers?solicitudes=1";

/** El texto de la solicitud de ayuda con la que se avisa al admin. */
export function mensajeDeAltaPendiente(s: Pick<SolicitudDeCliente, "id" | "payload" | "stores">, lang: "en" | "es"): string {
  const es = lang === "es";
  const r = resumenDeSolicitud(s);
  const lineas = [
    es ? `Solicitud de cliente nuevo (Clientes) #${s.id}` : `New customer request (Customers) #${s.id}`,
    es ? `Cuenta: ${r.cuenta}` : `Account: ${r.cuenta}`,
    es ? `Tiendas: ${r.tiendas}` : `Stores: ${r.tiendas}`,
  ];
  if (r.detalle) lineas.push(es ? `Contacto: ${r.detalle}` : `Contact: ${r.detalle}`);
  lineas.push(es ? `Apruébala o recházala en Clientes → Solicitudes.` : `Approve or reject it in Customers → Requests.`);
  return lineas.join("\n");
}
