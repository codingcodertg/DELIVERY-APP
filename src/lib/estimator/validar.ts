import { cajasDeLinea, hoyLocal, sfReal, totalDeLinea, type QuoteDraft } from "./modelo";

/**
 * Quién puede trabajar sobre un estimado, y qué falta antes de generar la copia del cliente.
 *
 * La política del dueño: *«Do not create competing quotes. Search the estimate number first. If
 * another sales representative owns the estimate, obtain their approval before proceeding.»* La
 * base lo hace cumplir (migración 148: un índice único por estimado y las políticas de escritura);
 * esto es el espejo en la pantalla, para decirlo antes de que la base diga que no.
 */

export type AprobacionEstado = "pending" | "approved" | "denied";

/** Lo que devuelve buscar un estimado (`estimator_find_estimate`, o el demo). */
export interface EstimadoHallado {
  quote_id: string;
  estimate_num: string;
  owner_id: string | null;
  owner_name: string | null;
  owner_store: string | null;
  my_approval_id: string | null;
  my_approval: AprobacionEstado | null;
}

/**
 * - `sin-buscar`: aún no se buscó ESTE número (o se cambió después de buscar).
 * - `nueva`: nadie tiene cotización para ese estimado; quien la guarde queda como dueño.
 * - `propia`: es mía. `admin`: no es mía, pero el admin no necesita permiso.
 * - `aprobada`: es de otro y me dio permiso. `pendiente` / `denegada` / `sin-pedir`: es de otro y no.
 * - `sin-base`: la tabla no existe todavía (148 sin aplicar); no se puede comprobar el dueño.
 */
export type EstadoDelEstimado =
  | "sin-buscar" | "nueva" | "propia" | "admin" | "aprobada" | "pendiente" | "denegada" | "sin-pedir" | "sin-base";

export function estadoDelEstimado(args: {
  baseDisponible: boolean;
  buscado: boolean;
  hallado: EstimadoHallado | null;
  meId: string | null;
  esAdmin: boolean;
}): EstadoDelEstimado {
  if (!args.baseDisponible) return "sin-base";
  if (!args.buscado) return "sin-buscar";
  const h = args.hallado;
  if (!h) return "nueva";
  if (h.owner_id !== null && h.owner_id === args.meId) return "propia";
  if (args.esAdmin) return "admin";
  if (h.my_approval === "approved") return "aprobada";
  if (h.my_approval === "pending") return "pendiente";
  if (h.my_approval === "denied") return "denegada";
  return "sin-pedir";
}

/** Puede guardar y generar: lo nuevo, lo suyo, lo aprobado, el admin — y, sin base, todo (no hay con qué comprobar). */
export function puedeTrabajar(e: EstadoDelEstimado): boolean {
  return e === "nueva" || e === "propia" || e === "admin" || e === "aprobada" || e === "sin-base";
}

export type Falta =
  | "estimado" | "buscar" | "permiso" | "extension" | "nombre" | "apellido" | "lineas" | "linea-incompleta"
  | "categoria" | "direccion" | "validez" | "validez-pasada";

/** Lo que falta para generar la copia del cliente. Vacío = se puede. */
export function loQueFalta(q: QuoteDraft, estado: EstadoDelEstimado, hoy: string = hoyLocal()): Falta[] {
  const f: Falta[] = [];
  if (!q.estimate_num.trim()) f.push("estimado");
  else if (estado === "sin-buscar") f.push("buscar");
  else if (!puedeTrabajar(estado)) f.push("permiso");
  if (!q.sales_ext.trim()) f.push("extension");
  if (!q.customer.full_name.trim()) f.push("nombre");
  if (!q.customer.last_name.trim()) f.push("apellido");
  if (q.lines.length === 0) f.push("lineas");
  if (q.lines.some((l) => totalDeLinea(l) === null)) f.push("linea-incompleta");
  if (q.lines.some((l) => !l.customer_category.trim())) f.push("categoria");
  if (q.delivery.mode === "delivery" && !direccionCompleta(q)) f.push("direccion");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(q.valid_through)) f.push("validez");
  else if (q.valid_through < hoy) f.push("validez-pasada");
  return f;
}

/** Si es entrega, la dirección completa es obligatoria (y no se imprime). */
export function direccionCompleta(q: Pick<QuoteDraft, "delivery">): boolean {
  const d = q.delivery;
  return [d.street, d.city, d.state, d.zip].every((s) => s.trim() !== "");
}

/** Para guardar basta con el número y el permiso: un borrador a medias también se guarda. */
export function puedeGuardar(q: QuoteDraft, estado: EstadoDelEstimado): boolean {
  return q.estimate_num.trim() !== "" && estado !== "sin-base" && estado !== "sin-buscar" && puedeTrabajar(estado);
}

/** Avisos que no bloquean: menos cajas de las que cubren lo pedido. */
export function lineasCortas(q: QuoteDraft): string[] {
  return q.lines
    .filter((l) => l.kind === "sf")
    .filter((l) => {
      if (l.kind !== "sf" || l.requested_sf === null) return false;
      const real = sfReal(l);
      return real !== null && cajasDeLinea(l) !== null && real < l.requested_sf;
    })
    .map((l) => l.id);
}

export const TEXTO_DE_FALTA: Record<Falta, { en: string; es: string }> = {
  estimado: { en: "Enter the estimate #", es: "Escribe el # de estimado" },
  buscar: { en: "Search the estimate # first", es: "Busca primero el # de estimado" },
  permiso: { en: "Another rep owns this estimate: you need their approval", es: "El estimado es de otro vendedor: necesitas su aprobación" },
  extension: { en: "Enter your extension", es: "Escribe tu extensión" },
  nombre: { en: "Enter the customer's full name", es: "Escribe el nombre completo del cliente" },
  apellido: { en: "Enter the last name to print", es: "Escribe el apellido que se imprime" },
  lineas: { en: "Add at least one line", es: "Añade al menos una línea" },
  "linea-incompleta": { en: "A line is missing quantity, SF/box or price", es: "A una línea le falta cantidad, SF/caja o precio" },
  categoria: { en: "Every line needs a customer category", es: "Cada línea necesita su categoría para el cliente" },
  direccion: { en: "Delivery needs the complete address", es: "La entrega necesita la dirección completa" },
  validez: { en: "Set the valid-through date", es: "Pon la fecha de validez" },
  "validez-pasada": { en: "The valid-through date is in the past", es: "La fecha de validez ya pasó" },
};
