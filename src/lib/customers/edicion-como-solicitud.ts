/**
 * La EDICIÓN de un cliente por vendedor o gerente es una SOLICITUD que revisa el admin, y todo cambio queda en el
 * historial del cliente (D-780, 2026-10-30; migración 221).
 *
 * El dueño: «el botón de edit también es request to edit y cuando alguien haga una edit y el admin lo revise deberá
 * poder ver el valor anterior con el de ahora y hasta una opción de nota por qué se hizo la edición y que todo eso
 * quede guardado en el historial del cliente».
 *
 * - Quién solicita (`edicionEsSolicitud`): vendedor y gerente (los que editan sin ser admin). El admin edita directo.
 * - El mismo formulario de la ficha; al «Enviar solicitud» se guarda en `erp.customer_requests` con `kind = 'edicion'`:
 *   `payload` = SOLO los campos que cambian con su valor nuevo, `before` = los mismos con el valor que vio quien pidió
 *   (`cuerpoDeEdicion`), y `note` = por qué (opcional). Se avisa al admin por el canal de ayuda, como el alta (D-743).
 * - El admin ve en «Solicitudes» cada campo con antes → después (`cambiosDeSolicitud`) y la nota; aprueba (con nota
 *   opcional) con `erp.aprueba_edicion_de_cliente`, que aplica el parche, o rechaza.
 * - El historial (`erp.customer_history`) lo escribe la base: un disparador deja el diff de columnas de cada cambio
 *   (quien, cuándo, antes, después) y las funciones de solicitud añaden la nota, el número y la decisión.
 */
import type { UserRole } from "@/lib/types";
import { CAMPOS, type Cliente, type Parche } from "./reglas";
import type { SolicitudDeCliente } from "./solicitud-de-cliente";

export function edicionEsSolicitud(role: UserRole | null | undefined): boolean {
  return role === "sales" || role === "manager";
}

export type CuerpoDeEdicion = {
  kind: "edicion";
  customer_id: number;
  stores: string[];
  payload: Record<string, unknown>;
  before: Record<string, unknown>;
  note: string | null;
};

/** Lo que se escribe: solo lo que cambia (nuevo) y lo mismo con lo que había (antes). La cuenta va en `before` para reconocerla. */
export function cuerpoDeEdicion(cliente: Cliente, parche: Parche, nota: string): CuerpoDeEdicion {
  const payload: Record<string, unknown> = {};
  const before: Record<string, unknown> = { account: cliente.account };
  const fila = cliente as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(parche)) {
    if (k === "store" || k === "company_id" || v === undefined) continue;
    payload[k] = v;
    before[k] = fila[k] ?? null;
  }
  return { kind: "edicion", customer_id: cliente.id, stores: [cliente.store], payload, before, note: nota.trim() || null };
}

export interface Cambio { key: string; en: string; es: string; antes: string; despues: string }

const ETIQUETA_EXTRA: Record<string, { en: string; es: string }> = {
  contacts: { en: "Contacts", es: "Contactos" },
  socials: { en: "Social media", es: "Redes sociales" },
  rep_id: { en: "Sales rep", es: "Vendedor" },
  archived_at: { en: "Archived", es: "Archivado" },
  archived_reason: { en: "Archive reason", es: "Motivo de archivo" },
};

export function etiquetaDeClave(key: string): { en: string; es: string } {
  const c = CAMPOS.find((x) => x.key === key);
  if (c) return { en: c.en, es: c.es };
  return ETIQUETA_EXTRA[key] ?? { en: key, es: key };
}

const texto = (v: unknown): string => (typeof v === "string" ? v : String(v));

/** Un valor del parche, legible: contactos y redes en una línea; vacío, «—». */
export function textoDeValor(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (Array.isArray(v)) {
    const partes = v.map((c) => {
      if (c && typeof c === "object") {
        const o = c as Record<string, unknown>;
        const tel = Array.isArray(o.phones) ? o.phones.map(texto).filter(Boolean).join(", ") : "";
        const mail = Array.isArray(o.emails) ? o.emails.map(texto).filter(Boolean).join(", ") : "";
        return [o.name, o.title, tel, mail, o.note, o.address].map((x) => (x === undefined || x === null ? "" : texto(x))).filter(Boolean).join(" · ");
      }
      return texto(c);
    }).filter(Boolean);
    return partes.length ? partes.join(" | ") : "—";
  }
  if (typeof v === "object") {
    const partes = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== null && x !== "" && x !== undefined).map(([k, x]) => `${k}: ${texto(x)}`);
    return partes.length ? partes.join(" · ") : "—";
  }
  return texto(v);
}

/** Cada campo pedido con lo que había y lo que se pide, en el orden de la ficha; lo que no está en la ficha, al final. */
export function cambiosEntre(antes: Record<string, unknown> | null | undefined, despues: Record<string, unknown> | null | undefined): Cambio[] {
  const a = antes ?? {};
  const d = despues ?? {};
  const claves = [...new Set([...Object.keys(d), ...Object.keys(a).filter((k) => k !== "account" || k in d)])];
  const orden = (k: string) => { const i = CAMPOS.findIndex((c) => c.key === k); return i < 0 ? 999 : i; };
  claves.sort((x, y) => orden(x) - orden(y) || x.localeCompare(y));
  return claves.map((key) => ({ key, ...etiquetaDeClave(key), antes: textoDeValor(a[key]), despues: textoDeValor(d[key]) }));
}

export const cambiosDeSolicitud = (s: Pick<SolicitudDeCliente, "payload" | "before">): Cambio[] => cambiosEntre(s.before, s.payload);

export type ClaseDeHistorial = "create" | "edit" | "archive" | "restore" | "approved" | "rejected";

export interface HistorialDeCliente {
  id: number;
  customer_id: number;
  at: string;
  by: string | null;
  by_name: string | null;
  kind: ClaseDeHistorial;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  note: string | null;
  request_id: number | null;
  requested_by: string | null;
  requested_name: string | null;
  decision_note: string | null;
}

export const CLASE_DE_HISTORIAL: Record<ClaseDeHistorial, { en: string; es: string; icono: string }> = {
  create: { en: "Created", es: "Creado", icono: "✨" },
  edit: { en: "Edited", es: "Editado", icono: "✏️" },
  archive: { en: "Archived", es: "Archivado", icono: "🗄️" },
  restore: { en: "Restored", es: "Desarchivado", icono: "↩️" },
  approved: { en: "Edit request approved", es: "Solicitud de edición aprobada", icono: "✅" },
  rejected: { en: "Edit request rejected", es: "Solicitud de edición rechazada", icono: "⛔" },
};

const textoONulo = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
const objeto = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

export function historialDeLaBase(f: Record<string, unknown>): HistorialDeCliente {
  const kind = typeof f.kind === "string" && f.kind in CLASE_DE_HISTORIAL ? (f.kind as ClaseDeHistorial) : "edit";
  return {
    id: Number(f.id),
    customer_id: Number(f.customer_id),
    at: String(f.at ?? ""),
    by: textoONulo(f.by),
    by_name: textoONulo(f.by_name),
    kind,
    before: objeto(f.before),
    after: objeto(f.after),
    note: textoONulo(f.note),
    request_id: typeof f.request_id === "number" ? f.request_id : null,
    requested_by: textoONulo(f.requested_by),
    requested_name: textoONulo(f.requested_name),
    decision_note: textoONulo(f.decision_note),
  };
}

/** Los cambios de una fila del historial: al crear, lo que quedó (sin vacíos); si no, antes → después. */
export function cambiosDelHistorial(h: Pick<HistorialDeCliente, "kind" | "before" | "after">): Cambio[] {
  if (h.kind === "create") {
    const con = Object.fromEntries(Object.entries(h.after ?? {}).filter(([k, v]) => v !== null && v !== "" && !["id", "company_id", "house_no", "source"].includes(k) && !(Array.isArray(v) && v.length === 0) && !(typeof v === "object" && !Array.isArray(v) && v && Object.keys(v).length === 0)));
    return cambiosEntre({}, con);
  }
  return cambiosEntre(h.before, h.after);
}

/** El texto de la solicitud de ayuda con la que se avisa al admin de una edición pendiente. */
export function mensajeDeEdicionPendiente(s: Pick<SolicitudDeCliente, "id" | "payload" | "before" | "note">, lang: "en" | "es"): string {
  const es = lang === "es";
  const cuenta = textoDeValor(s.before?.account);
  const cambios = cambiosDeSolicitud(s);
  const lineas = [
    es ? `Solicitud de edición de cliente (Clientes) #${s.id}` : `Customer edit request (Customers) #${s.id}`,
    es ? `Cuenta: ${cuenta}` : `Account: ${cuenta}`,
    ...cambios.map((c) => `${es ? c.es : c.en}: ${c.antes} → ${c.despues}`),
  ];
  if (s.note) lineas.push(es ? `Nota: ${s.note}` : `Note: ${s.note}`);
  lineas.push(es ? `Apruébala o recházala en Clientes → Solicitudes.` : `Approve or reject it in Customers → Requests.`);
  return lineas.join("\n");
}
