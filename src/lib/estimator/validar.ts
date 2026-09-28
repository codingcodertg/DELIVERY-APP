import { borradorVacio, cajasDeLinea, hoyLocal, sfReal, totalDeLinea, type QuoteDraft } from "./modelo";

/**
 * Quién puede trabajar sobre un estimado, y qué falta antes de generar la copia del cliente.
 *
 * La política del dueño: *«Do not create competing quotes. Search the estimate number first. If
 * another sales representative owns the estimate, obtain their approval before proceeding.»* La
 * base lo hace cumplir (migración 148: un índice único por estimado y las políticas de escritura);
 * esto es el espejo en la pantalla, para decirlo antes de que la base diga que no.
 *
 * Desde D-NEXT **la búsqueda la hace la pantalla sola** (el dueño: «No need to search first»): al teclear el número
 * (con una pausa), al salir del campo y siempre antes de guardar. La regla de buscar primero sigue; lo que desaparece
 * es el botón que había que pulsar. Mientras la comprobación no ha vuelto, el estado es `sin-buscar`.
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
 * - `sin-buscar`: aún no se comprobó ESTE número (se está tecleando, o la comprobación no ha vuelto).
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
  | "estimado" | "buscar" | "permiso" | "extension" | "nombre" | "lineas" | "linea-incompleta"
  | "categoria" | "direccion" | "validez" | "validez-pasada";

/** Lo que falta para generar la copia del cliente. Vacío = se puede. */
export function loQueFalta(q: QuoteDraft, estado: EstadoDelEstimado, hoy: string = hoyLocal()): Falta[] {
  const f: Falta[] = [];
  if (!q.estimate_num.trim()) f.push("estimado");
  else if (estado === "sin-buscar") f.push("buscar");
  else if (!puedeTrabajar(estado)) f.push("permiso");
  if (!q.sales_ext.trim()) f.push("extension");
  // El apellido que se imprime sale del nombre (D-NEXT): con nombre hay apellido, así que no hay falta aparte.
  if (!q.customer.full_name.trim()) f.push("nombre");
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

/**
 * Para guardar basta con el número y el permiso: un borrador a medias también se guarda. `sin-buscar` deja PULSAR
 * Guardar (D-NEXT): el propio guardado comprueba el estimado antes de escribir (`guardar` en la pantalla), y si es de
 * otro se para ahí. Sin eso, el botón se quedaría apagado sin decir por qué mientras la comprobación vuelve.
 */
export function puedeGuardar(q: QuoteDraft, estado: EstadoDelEstimado): boolean {
  return q.estimate_num.trim() !== "" && estado !== "sin-base" && (estado === "sin-buscar" || puedeTrabajar(estado));
}

/**
 * ¿El borrador no tiene aún trabajo, fuera del número, la extensión y la fecha? Decide si una cotización guardada que
 * aparece al comprobar el estimado se abre sola (D-NEXT). Con la búsqueda automática, abrirla encima de lo que el
 * vendedor ya tecleó le borraría el trabajo sin avisar; así que solo se abre sola sobre un borrador en blanco, y si no,
 * se ofrece.
 */
export function borradorSinTrabajo(q: QuoteDraft): boolean {
  const v = borradorVacio(q.valid_through);
  const c = q.customer;
  const clienteVacio = [c.full_name, c.company, c.phone, c.address].every((s) => !s.trim());
  const entregaVacia = q.delivery.mode === "pickup" && q.delivery.charge === null
    && [q.delivery.street, q.delivery.city, q.delivery.state, q.delivery.zip].every((s) => !s.trim());
  const lineasVacias = q.lines.every((l) => {
    if ([l.item_code, l.internal_description, l.customer_category, l.customer_note].some((s) => s.trim())) return false;
    return l.kind === "sf"
      ? l.requested_sf === null && l.boxes === null && l.sf_per_box === null && l.price_per_sf === null
      : l.unit_price === null;
  });
  return clienteVacio && entregaVacia && lineasVacias && !q.project_summary.trim() && q.display_level === v.display_level;
}

/**
 * Qué hace la pantalla con lo que devuelve la comprobación automática del estimado (D-NEXT):
 * - `nueva`: nadie la tiene; quien la prepara será el dueño.
 * - `ajena`: es de otro y no tengo permiso: aviso y «Request approval» (D-413, igual que antes).
 * - `ya-abierta`: es la cotización que ya tengo abierta; nada que hacer.
 * - `abrir`: puedo abrirla y el borrador está en blanco: se abre sola.
 * - `ofrecer`: puedo abrirla pero ya tecleé algo (o la comprobación la lanzó Guardar): se ofrece, no se pisa.
 */
export type TrasComprobar = "nueva" | "ajena" | "ya-abierta" | "abrir" | "ofrecer";

export function trasComprobar(a: {
  hallado: EstimadoHallado | null;
  meId: string | null;
  esAdmin: boolean;
  quoteIdAbierto: string | null;
  borrador: QuoteDraft;
  abrirSola: boolean;
}): TrasComprobar {
  const h = a.hallado;
  if (!h) return "nueva";
  const puedeAbrir = (h.owner_id !== null && h.owner_id === a.meId) || a.esAdmin || h.my_approval === "approved";
  if (!puedeAbrir) return "ajena";
  if (h.quote_id === a.quoteIdAbierto) return "ya-abierta";
  return a.abrirSola && borradorSinTrabajo(a.borrador) ? "abrir" : "ofrecer";
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
  buscar: { en: "Checking the estimate #…", es: "Comprobando el # de estimado…" },
  permiso: { en: "Another rep owns this estimate: you need their approval", es: "El estimado es de otro vendedor: necesitas su aprobación" },
  extension: { en: "Enter your extension", es: "Escribe tu extensión" },
  nombre: { en: "Enter the customer's full name", es: "Escribe el nombre completo del cliente" },
  lineas: { en: "Add at least one line", es: "Añade al menos una línea" },
  "linea-incompleta": { en: "A line is missing quantity, SF/box or price", es: "A una línea le falta cantidad, SF/caja o precio" },
  categoria: { en: "Every line needs a customer category", es: "Cada línea necesita su categoría para el cliente" },
  direccion: { en: "Delivery needs the complete address", es: "La entrega necesita la dirección completa" },
  validez: { en: "Set the valid-through date", es: "Pon la fecha de validez" },
  "validez-pasada": { en: "The valid-through date is in the past", es: "La fecha de validez ya pasó" },
};
