/**
 * Elegir un cliente YA EXISTENTE en el Quote Builder (D-784, 2026-11-01).
 *
 * Roberto (admin): «Quote builder should also be able to choose from that reps existing customers». Hasta ahora el
 * bloque «Cliente (interno)» se escribía a mano cada vez, aunque el cliente estuviera en Clientes con su nombre de
 * contacto y su teléfono. Ahora, encima de esos campos, hay un buscador: con dos letras o más pregunta a la base
 * (`erp.customers`, cuenta o nombre de contacto), y al elegir uno se rellenan nombre, empresa y teléfono. Los campos
 * siguen siendo editables después: elegir solo rellena.
 *
 * **De quién son los clientes que salen:** la política de la fila (215) ya decide qué llega al vendedor (su tienda
 * entera más los suyos); aquí se afina igual que en Clientes (`puedeAbrirCliente`): el vendedor elige SOLO los suyos
 * (`rep_id` = él, o los que creó él); el admin, cualquiera. Lo archivado no se ofrece.
 */
import { telefonoAlEscribir } from "./modelo";
import { type QuienMira, veLaFila } from "@/lib/customers/visibilidad";

/** Lo que se pide a la base: pocas columnas, las que rellenan el bloque. */
export const COLUMNAS_PARA_COTIZAR = "id, store, account, contact_name, phone, contacts, rep_id, created_by, archived_at";
export const MIN_LETRAS = 2;
export const RETARDO_MS = 300;
export const MAX_OPCIONES = 8;

export interface ClienteParaCotizar {
  id: number;
  store: string;
  account: string;
  contact_name: string | null;
  phone: string | null;
  /** El primer teléfono de la ficha de contactos (193), si lo hay: manda sobre `phone`, que es el de antes. */
  telefono_de_contacto: string | null;
  rep_id: string | null;
  created_by: string | null;
  archived_at: string | null;
}

const texto = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

/** Una fila cruda de la base como `ClienteParaCotizar`. */
export function clienteParaCotizar(f: Record<string, unknown>): ClienteParaCotizar {
  let telefonoDeContacto: string | null = null;
  const contactos = Array.isArray(f.contacts) ? f.contacts : [];
  for (const c of contactos) {
    const tels = c && typeof c === "object" && Array.isArray((c as { phones?: unknown }).phones) ? (c as { phones: unknown[] }).phones : [];
    const t = tels.map(texto).find((x) => x !== null) ?? null;
    if (t) { telefonoDeContacto = t; break; }
  }
  return {
    id: Number(f.id), store: String(f.store ?? ""), account: String(f.account ?? ""), contact_name: texto(f.contact_name),
    phone: texto(f.phone), telefono_de_contacto: telefonoDeContacto, rep_id: texto(f.rep_id), created_by: texto(f.created_by),
    archived_at: texto(f.archived_at),
  };
}

/** ¿Se pregunta a la base con esto escrito? */
export const seBusca = (q: string): boolean => q.trim().length >= MIN_LETRAS;

/**
 * Los que esta persona puede elegir: sin archivados y, de esos, los que VE según la regla de Clientes (`veLaFila`, el
 * gemelo de la 217, en `src/lib/customers/visibilidad.ts`). D-NEXT (el dueño): «la regla de customer debe ir totalmente
 * ligada al customer app, y así en todas las apps» — aquí no se reescribe nada: se importa.
 */
export function elegibles(filas: readonly ClienteParaCotizar[], yo: QuienMira): ClienteParaCotizar[] {
  return filas.filter((c) => c.archived_at === null && veLaFila(c, yo));
}

/** Las que casan con lo escrito (cuenta o contacto, sin mayúsculas), por cuenta y tienda, como mucho `max`. */
export function coincidencias(filas: readonly ClienteParaCotizar[], q: string, max = MAX_OPCIONES): ClienteParaCotizar[] {
  const n = q.trim().toLowerCase();
  if (n.length < MIN_LETRAS) return [];
  return [...filas]
    .filter((c) => c.account.toLowerCase().includes(n) || (c.contact_name ?? "").toLowerCase().includes(n))
    .sort((a, b) => a.account.localeCompare(b.account) || a.store.localeCompare(b.store))
    .slice(0, max);
}

/** Cómo se lee cada opción: «Risse Builders · Carlos Serna · BRO». */
export function rotulo(c: ClienteParaCotizar): string {
  return [c.account, c.contact_name, c.store].filter((x): x is string => !!x).join(" · ");
}

/**
 * Lo que se vuelca al bloque del cliente al elegir: el contacto como nombre completo (es lo que se imprime, «Mr. Serna»),
 * la cuenta como empresa, y el teléfono con el formato de la casa (956-555-0123). Lo que no hay se deja VACÍO, no se
 * inventa: si la ficha no tiene contacto, el nombre queda en blanco y se escribe a mano.
 */
export function relleno(c: ClienteParaCotizar): { full_name: string; company: string; phone: string } {
  const tel = c.telefono_de_contacto ?? c.phone ?? "";
  return { full_name: c.contact_name ?? "", company: c.account, phone: tel ? telefonoAlEscribir(tel) : "" };
}

/** Unos cuantos para el demo. */
export const CLIENTES_DEMO: readonly ClienteParaCotizar[] = [
  { id: 1, store: "BRO", account: "Risse Builders", contact_name: "Carlos Serna", phone: "9567033694", telefono_de_contacto: null, rep_id: "u-sales", created_by: null, archived_at: null },
  { id: 2, store: "BRO", account: "Rio Homes LLC", contact_name: "Ana Pérez", phone: null, telefono_de_contacto: "956-555-0101", rep_id: "u-sales", created_by: null, archived_at: null },
  { id: 3, store: "MCA", account: "Valley Flooring", contact_name: null, phone: "9565550102", telefono_de_contacto: null, rep_id: "u-sales2", created_by: null, archived_at: null },
  { id: 4, store: "BRO", account: "Old Account", contact_name: "Ya No", phone: null, telefono_de_contacto: null, rep_id: "u-sales", created_by: null, archived_at: "2026-01-01" },
];
