// ============================================================================
// La solicitud de artículo del ERP, columna por columna de la hoja del dueño.
//
// El dueño (2026-09-30): «en el erp en solicitud quiero que me agregues esa columnas si aun no esta
// como fields par allenar». «Esas columnas» son las de su hoja de Excel de solicitudes de artículos
// (dos capturas, 2026-09-29). Este fichero es el mapa de esa hoja al ERP, y lo que las pantallas y
// las acciones usan para saber qué campos hay, en qué orden, con qué rótulo, quién ve el costo y qué
// viaja al servidor en cada tipo de solicitud. Puro: sin React ni Supabase, para que vitest lo mida.
//
// Dónde vive cada cosa (migración 158, escrita y no aplicada):
//   - El TIPO de solicitud: erp.product_requests.type (texto con CHECK; la 063 lo tenía como enum).
//   - Los campos del artículo: payload (jsonb) de la solicitud, y en «new»/«copy» la fila borrador de
//     erp.products. Todas las columnas que usa este mapa EXISTEN en erp.products desde la 063.
//   - REQUESTER STATUS: columna requester_status ('ready' | 'not_ready'), no en el payload, para que
//     el ejecutor filtre por ella y decide_request la compruebe sin abrir el JSON.
//   - EXECUTOR STATUS y Executor comments: status y decision_note, de siempre.
// ============================================================================

export type T = (en: string, es: string) => string;

/** Los seis tipos. Los dos nuevos de la hoja: «Create Copy» y «Discontinue». */
export const TIPOS_DE_SOLICITUD = ["new", "copy", "edit", "reactivate", "deactivate", "discontinue"] as const;
export type TipoDeSolicitud = (typeof TIPOS_DE_SOLICITUD)[number];

/** Los que crean un borrador de producto (se publican desde el Catálogo, no desde Aprobaciones). */
export const TIPOS_QUE_CREAN_BORRADOR: readonly TipoDeSolicitud[] = ["new", "copy"];
/** Los que atiende la cola de Aprobaciones (/erp/requests) con decide_request. */
export const TIPOS_DEL_EJECUTOR: readonly TipoDeSolicitud[] = ["edit", "reactivate", "deactivate", "discontinue"];

export const ESTADOS_DEL_SOLICITANTE = ["ready", "not_ready"] as const;
export type EstadoDelSolicitante = (typeof ESTADOS_DEL_SOLICITANTE)[number];

export const MODOS_DE_PRECIO = ["fixed", "leveled"] as const;

/** Un campo del artículo tal como lo pinta el formulario y lo manda la acción. */
export type CampoDeArticulo = {
  key: string;
  /** Rótulo de la hoja del dueño (inglés) y su traducción. */
  en: string;
  es: string;
  /** Solo lo ve (y lo manda) quien puede ver costos. */
  cost?: boolean;
  /** Obligatorio siempre, o solo para azulejo (`tile`). */
  required?: "always" | "tile";
  /** Cómo se pinta: texto libre, número, selector, texto con sugerencias. */
  kind: "text" | "number" | "select" | "suggest";
};

/**
 * Los campos del artículo, EN EL ORDEN DE LA HOJA. La hoja no lleva el estado comercial (lo exige la
 * tabla: va tras el tipo). «Item Number (if known)» es el SKU, y por eso NO es obligatorio: sin él
 * el borrador nace con un SKU provisional (`REQ-…`) y la etiqueta «NEEDS SKU» para que un admin le
 * asigne el real (assign_draft_sku).
 */
export const CAMPOS_DEL_ARTICULO: readonly CampoDeArticulo[] = [
  { key: "category_id", en: "Category", es: "Categoría", required: "always", kind: "select" },
  { key: "product_type", en: "Type", es: "Tipo", required: "always", kind: "select" },
  { key: "status", en: "Commercial status", es: "Estado comercial", required: "always", kind: "select" },
  { key: "material", en: "Material", es: "Material", kind: "suggest" },
  { key: "style", en: "Style", es: "Estilo", kind: "suggest" },
  { key: "color1", en: "Color", es: "Color", kind: "suggest" },
  { key: "vendor_id", en: "Preferred vendor", es: "Proveedor preferido", kind: "select" },
  { key: "mpn", en: "Manufacturer's part number", es: "Número de parte del fabricante", kind: "text" },
  { key: "description", en: "Description on purchase transactions", es: "Descripción en compras", kind: "text" },
  { key: "cost", en: "Cost", es: "Costo", cost: true, kind: "number" },
  { key: "finish", en: "Shine (finish)", es: "Brillo (acabado)", kind: "suggest" },
  { key: "size_in", en: "Size (in)", es: "Tamaño (in)", required: "tile", kind: "text" },
  { key: "sf_per_box", en: "SF / box", es: "SF / caja", required: "tile", kind: "number" },
  { key: "base_unit", en: "U/M (base unit)", es: "U/M (unidad base)", required: "tile", kind: "suggest" },
  { key: "sku", en: "Item number (if known)", es: "Número de artículo (si se sabe)", kind: "text" },
  { key: "name", en: "Description on sales transactions", es: "Descripción en ventas", required: "always", kind: "text" },
  { key: "price", en: "Sales price", es: "Precio de venta", kind: "number" },
  { key: "price_mode", en: "Fixed price or levels", es: "Precio fijo o por niveles", kind: "select" },
];

/** Los campos que una solicitud de cambio («Request Change») puede proponer. */
export const CAMPOS_DE_EDICION: readonly CampoDeArticulo[] = [
  { key: "name", en: "Description on sales transactions", es: "Descripción en ventas", kind: "text" },
  { key: "description", en: "Description on purchase transactions", es: "Descripción en compras", kind: "text" },
  { key: "price", en: "Sales price", es: "Precio de venta", kind: "number" },
  { key: "price_mode", en: "Fixed price or levels", es: "Precio fijo o por niveles", kind: "select" },
  { key: "cost", en: "Cost", es: "Costo", cost: true, kind: "number" },
  { key: "base_unit", en: "U/M (base unit)", es: "U/M (unidad base)", kind: "text" },
  { key: "sf_per_box", en: "SF / box", es: "SF / caja", kind: "number" },
  { key: "pieces_per_box", en: "Pieces / box", es: "Piezas / caja", kind: "number" },
  { key: "size_in", en: "Size (in)", es: "Tamaño (in)", kind: "text" },
  { key: "size_cm", en: "Size (cm)", es: "Tamaño (cm)", kind: "text" },
  { key: "material", en: "Material", es: "Material", kind: "text" },
  { key: "finish", en: "Shine (finish)", es: "Brillo (acabado)", kind: "text" },
  { key: "style", en: "Style", es: "Estilo", kind: "text" },
  { key: "color1", en: "Color", es: "Color", kind: "text" },
  { key: "mpn", en: "Manufacturer's part number", es: "Número de parte del fabricante", kind: "text" },
];

export function etiquetaDeCampo(key: string, t: T): string {
  const c = CAMPOS_DEL_ARTICULO.find((x) => x.key === key) ?? CAMPOS_DE_EDICION.find((x) => x.key === key);
  return c ? t(c.en, c.es) : key;
}

/** Qué campos ve esta persona (el costo solo quien puede verlo). */
export function camposVisibles(campos: readonly CampoDeArticulo[], canSeeCost: boolean): CampoDeArticulo[] {
  return campos.filter((c) => !c.cost || canSeeCost);
}

/** Lo que una columna de la hoja del dueño es en el ERP. Sirve a la prueba y a la entrada de DECISIONS. */
export type ColumnaDeLaHoja = {
  excel: string;
  /** Dónde se guarda: columna de product_requests, columna de products (vía payload / borrador), o el tipo. */
  campo: string;
  donde: "product_requests" | "products" | "tipo";
  /** ¿Ya existía como campo del ERP antes de esta decisión (aunque con otro nombre)? */
  existia: boolean;
};

export const MAPA_DE_LA_HOJA: readonly ColumnaDeLaHoja[] = [
  { excel: "Date", campo: "created_at", donde: "product_requests", existia: true },
  { excel: "Location", campo: "requester_store", donde: "product_requests", existia: true }, // la columna existía; el formulario no la llenaba
  { excel: "Required by", campo: "requester", donde: "product_requests", existia: true },
  { excel: "Executed by", campo: "decided_by", donde: "product_requests", existia: true },
  { excel: "Request Change", campo: "edit", donde: "tipo", existia: true },
  { excel: "Reactivate", campo: "reactivate", donde: "tipo", existia: true },
  { excel: "Deactivate (if QOH = 0)", campo: "deactivate", donde: "tipo", existia: true }, // la regla «QOH = 0» es nueva
  { excel: "Discontinue (same as deactivate but can still have QOH)", campo: "discontinue", donde: "tipo", existia: false },
  { excel: "Create New", campo: "new", donde: "tipo", existia: true },
  { excel: "Create Copy", campo: "copy", donde: "tipo", existia: false },
  { excel: "Copy Source: Store & Item Code", campo: "payload.copy_source", donde: "product_requests", existia: false },
  { excel: "Requester Comments", campo: "reason", donde: "product_requests", existia: true },
  { excel: "REQUESTER STATUS", campo: "requester_status", donde: "product_requests", existia: false },
  { excel: "EXECUTOR STATUS", campo: "status", donde: "product_requests", existia: true },
  { excel: "Executor Comments", campo: "decision_note", donde: "product_requests", existia: true },
  { excel: "Category", campo: "category_id", donde: "products", existia: true },
  { excel: "Type", campo: "product_type", donde: "products", existia: true },
  { excel: "Material", campo: "material", donde: "products", existia: true },
  { excel: "Style", campo: "style", donde: "products", existia: false }, // la columna existía; el formulario no la tenía
  { excel: "Color", campo: "color1", donde: "products", existia: false },
  { excel: "Preferred Vendor", campo: "vendor_id", donde: "products", existia: true },
  { excel: "Manufacturer's part number", campo: "mpn", donde: "products", existia: true },
  { excel: "Description on purchase transactions", campo: "description", donde: "products", existia: false },
  { excel: "Cost", campo: "cost", donde: "products", existia: true },
  { excel: "Shine", campo: "finish", donde: "products", existia: true },
  { excel: "Size", campo: "size_in", donde: "products", existia: true },
  { excel: "SF/Box", campo: "sf_per_box", donde: "products", existia: true },
  { excel: "U/M", campo: "base_unit", donde: "products", existia: true },
  { excel: "Item Number (if known)", campo: "sku", donde: "products", existia: true }, // era obligatorio; deja de serlo
  { excel: "Description on sales transactions", campo: "name", donde: "products", existia: true },
  { excel: "Sales price", campo: "price", donde: "products", existia: false },
  { excel: "Fixed Price or Levels", campo: "price_mode", donde: "products", existia: false },
];

// ── Lo que viaja al servidor ───────────────────────────────────────────────

/** De dónde se copia en «Create Copy»: tienda y código de artículo, y el producto que resolvió. */
export type OrigenDeCopia = { store: string; item_code: string; product_id: number; sku: string };

export type ArticuloNuevo = {
  sku: string;
  name: string;
  product_type: string;
  status: string;
  category_id: number | null;
  vendor_id: number | null;
  mpn?: string;
  material?: string;
  finish?: string;
  style?: string;
  color1?: string;
  description?: string;
  size_in?: string;
  base_unit?: string;
  sf_per_box?: string;
  price?: string;
  price_mode?: string;
  cost?: string;
  store?: string;
  reason?: string;
  requester_status?: EstadoDelSolicitante;
  copy_source?: OrigenDeCopia;
};

/**
 * Lo que manda el formulario de «new» / «copy» a partir de su estado. El costo solo viaja si quien
 * lo rellena puede verlo (la base lo rechazaría igual: política «products draft insert»); un campo
 * en blanco no viaja.
 */
export function articuloDesdeElFormulario(
  f: Record<string, string>,
  opts: { canSeeCost: boolean; store: string; requesterStatus: EstadoDelSolicitante; copySource?: OrigenDeCopia | null },
): ArticuloNuevo {
  const s = (k: string) => (f[k] ?? "").trim();
  const out: ArticuloNuevo = {
    sku: s("sku"),
    name: s("name"),
    product_type: s("product_type"),
    status: s("status"),
    category_id: s("category_id") ? Number(s("category_id")) : null,
    vendor_id: s("vendor_id") ? Number(s("vendor_id")) : null,
    store: opts.store || undefined,
    reason: s("reason") || undefined,
    requester_status: opts.requesterStatus,
  };
  for (const k of ["mpn", "material", "finish", "style", "color1", "description", "size_in", "base_unit", "sf_per_box", "price", "price_mode"] as const) {
    if (s(k)) out[k] = s(k);
  }
  if (opts.canSeeCost && s("cost")) out.cost = s("cost");
  if (opts.copySource) out.copy_source = opts.copySource;
  return out;
}

/** Los obligatorios de la hoja: categoría, tipo, estado, descripción en ventas; y para azulejo, tamaño, SF/caja y U/M. */
export function articuloCompleto(f: Record<string, string>): boolean {
  const s = (k: string) => (f[k] ?? "").trim();
  const tile = s("product_type") === "tile";
  return CAMPOS_DEL_ARTICULO.every((c) => {
    if (c.required === "always") return s(c.key) !== "";
    if (c.required === "tile") return !tile || s(c.key) !== "";
    return true;
  });
}

/**
 * SKU provisional para una solicitud que no sabe el número de artículo. Cumple products_sku_check
 * (`^[A-Z0-9][A-Z0-9-]{0,63}$`); el admin lo sustituye con assign_draft_sku.
 */
export function skuProvisional(ahora: number = Date.now()): string {
  return `REQ-${ahora.toString(36).toUpperCase()}`;
}
export const ETIQUETA_SIN_SKU = "NEEDS SKU";
export const ETIQUETA_NO_LISTA = "NOT READY";

/** La fila borrador de erp.products que nace de una solicitud new/copy. */
export function filaBorrador(input: ArticuloNuevo, userId: string, ahora: number = Date.now()) {
  const num = (v: string | undefined) => (v && !Number.isNaN(Number(v)) ? Number(v) : null);
  const sku = (input.sku || "").trim().toUpperCase() || skuProvisional(ahora);
  const sinSku = !(input.sku || "").trim();
  const noLista = input.requester_status === "not_ready";
  const tags = [...(sinSku ? [ETIQUETA_SIN_SKU] : []), ...(noLista ? [ETIQUETA_NO_LISTA] : [])];
  return {
    sku,
    name: input.name.trim(),
    description: input.description?.trim() || null,
    status: input.status,
    record_status: "draft",
    product_type: input.product_type,
    category_id: input.category_id || null,
    vendor_id: input.vendor_id || null,
    mpn: input.mpn?.trim() || null,
    material: input.material || null,
    finish: input.finish || null,
    style: input.style?.trim() || null,
    color1: input.color1?.trim() || null,
    size_in: input.size_in?.trim() || null,
    base_unit: input.base_unit || null,
    sf_per_box: num(input.sf_per_box),
    price: num(input.price),
    price_mode: input.price_mode && (MODOS_DE_PRECIO as readonly string[]).includes(input.price_mode) ? input.price_mode : null,
    ...(input.cost !== undefined && num(input.cost) !== null ? { cost: num(input.cost) } : {}),
    needs_review: tags.length > 0,
    review_tags: tags,
    taxable: true,
    created_by: userId,
  };
}

/**
 * La fila de erp.product_requests. `requester_status` SOLO viaja cuando no es el defecto ('ready'):
 * así una solicitud normal sigue entrando aunque la 158 no esté aplicada (la columna no existiría), y
 * solo «No lista» —que la necesita— falla con el mensaje de migración pendiente.
 */
export function filaDeSolicitud(input: {
  type: TipoDeSolicitud;
  requester: string;
  product_id?: number | null;
  store?: string | null;
  reason?: string | null;
  payload?: Record<string, unknown>;
  requester_status?: EstadoDelSolicitante;
}) {
  return {
    type: input.type,
    product_id: input.product_id ?? null,
    requester: input.requester,
    requester_store: input.store || null,
    reason: input.reason || null,
    payload: input.payload ?? {},
    ...(input.requester_status === "not_ready" ? { requester_status: "not_ready" as const } : {}),
  };
}

/** Lo que propone una solicitud de cambio: solo lo que cambió, y el costo solo si se puede ver. */
export function cambiosPropuestos(
  editForm: Record<string, string>,
  original: Record<string, string>,
  canSeeCost: boolean,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of CAMPOS_DE_EDICION) {
    if (c.cost && !canSeeCost) continue;
    if ((editForm[c.key] ?? "") !== (original[c.key] ?? "")) out[c.key] = editForm[c.key] ?? "";
  }
  return out;
}

/** «Deactivate (if QOH = 0)»: con existencia no se desactiva, se descontinúa. Sin dato de QOH, es 0. */
export function puedeDesactivar(qoh: number | string | null | undefined): boolean {
  const n = qoh == null || qoh === "" ? 0 : Number(qoh);
  return !Number.isNaN(n) && n <= 0;
}

/**
 * ¿Este error de PostgREST es «la migración 158 no está aplicada»? Tres formas: el enum viejo que
 * no acepta 'copy'/'discontinue' (22P02), la columna requester_status que no existe (42703, o
 * PGRST204 cuando lo detecta la caché de PostgREST), o la función set_request_ready que no existe
 * (42883 / PGRST202). Se contesta con un mensaje claro, no con un 500.
 */
export function esMigracionPendiente(e: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!e) return false;
  const code = e.code ?? "";
  const msg = e.message ?? "";
  if (code === "22P02" && /request_type/.test(msg)) return true;
  if ((code === "42703" || code === "PGRST204") && /requester_status/.test(msg)) return true;
  if ((code === "42883" || code === "PGRST202") && /set_request_ready/.test(msg)) return true;
  return false;
}
