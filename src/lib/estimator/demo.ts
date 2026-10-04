import type { AlmacenDeCotizaciones, AprobacionPendiente, CotizacionGuardada, ProductoDelCatalogo, Resultado } from "./almacen";
import { claveDeEstimado, lineaSfVacia, borradorVacio, type QuoteDraft } from "./modelo";
import type { AprobacionEstado, EstimadoHallado } from "./validar";
import {
  LIMITES_DE_COMPETENCIA, filaDeCompetencia, filaSuelta, masNuevoPrimero, puedeQuitar, rutaDeCompetencia, rutaSuelta,
  validaArchivos, type AlmacenDeCompetencia, type EstimadoDeCompetencia,
} from "./competencia";
import { filaDeLectura, normalizaLectura, type AlmacenDeLecturas, type LecturaGuardada } from "./lectura";

/**
 * El Estimador en **modo demo**: datos inventados, en memoria, con la misma interfaz que la base.
 *
 * Simula lo que haría la 148 —una cotización por estimado, el dueño que no cambia, la aprobación del
 * otro vendedor— para que el flujo entero se pueda mirar en un navegador sin base. Los usuarios son
 * los del demo de siempre (`lib/demo-data`, «Ver como»); nada de aquí es un dato real.
 *
 * `?sinTabla=1` en la URL hace que el demo se comporte como una base **sin la 148 aplicada**: así se
 * puede medir el modo degradado, que en producción es el primero que se verá.
 */

export const DEMO_OTRO_VENDEDOR = { id: "u-sales2", name: "Sofia Ventas" };
export const DEMO_ESTIMADO_AJENO = "DEMO-1001";

/**
 * La extensión de cada persona del demo (D-432): simula `recruiting.employee_files.ringcentral_ext`, que en producción
 * lee el servidor. «Maria Manager» (`u-mgr`) no tiene a propósito: así se mide el caso sin extensión conocida, en el que
 * el campo queda para escribirla a mano.
 */
export const EXTENSIONES_DEMO: Readonly<Record<string, string>> = { "u-admin": "200", "u-sales": "214", "u-sales2": "201" };
export const extensionDemo = (id: string): string | null => EXTENSIONES_DEMO[id] ?? null;

/** Catálogo inventado: códigos DEMO-*, para que nadie los confunda con un producto real. */
export const CATALOGO_DEMO: ProductoDelCatalogo[] = [
  { sku: "DEMO-2448", name: "Demo Porcelain Marble-look 24x48 Polished", size_in: "24x48", sf_per_box: 23.8, price_per_sf: 1.89 },
  { sku: "DEMO-1224", name: "Demo Ceramic Wood-look 12x24 Matte", size_in: "12x24", sf_per_box: 15.5, price_per_sf: 1.29 },
  { sku: "DEMO-MOS2", name: "Demo Glass Mosaic 2x2 Sheet", size_in: "2x2", sf_per_box: 10, price_per_sf: 8.99 },
];

export function buscarEnCatalogoDemo(codigo: string): ProductoDelCatalogo[] {
  const c = codigo.trim().toUpperCase();
  if (!c) return [];
  return CATALOGO_DEMO.filter((p) => p.sku.startsWith(c));
}

interface FilaDemo { id: string; owner_id: string; owner_name: string; store: string | null; print_count: number; draft: QuoteDraft }
interface AprobDemo { id: string; quote_id: string; requested_by: string; requester_name: string; status: AprobacionEstado; requested_at: string }

function semilla(): { cotizaciones: FilaDemo[]; aprobaciones: AprobDemo[] } {
  const draft = borradorVacio();
  draft.estimate_num = DEMO_ESTIMADO_AJENO;
  draft.sales_ext = "201";
  draft.customer = { salutation: "Mr.", full_name: "Demo Customer", company: "Demo Builders", phone: "956-555-0100" };
  draft.lines = [{ ...lineaSfVacia(), customer_category: "12x24 Tile", requested_sf: 400, sf_per_box: 15.5, price_per_sf: 1.29, item_code: "DEMO-1224", internal_description: "Demo Ceramic Wood-look 12x24 Matte" }];
  return {
    cotizaciones: [{ id: "demo-q-1", owner_id: DEMO_OTRO_VENDEDOR.id, owner_name: DEMO_OTRO_VENDEDOR.name, store: "Weslaco", print_count: 0, draft }],
    aprobaciones: [],
  };
}

const bien = <T,>(valor: T): Resultado<T> => ({ ok: true, valor });
const SIN_TABLA: Resultado<never> = { ok: false, sinTabla: true, error: "PGRST205: Could not find the table 'public.estimator_quotes' (demo)" };

/**
 * `me` se pide en cada llamada (no se captura) porque «Ver como» cambia de persona sin recargar, y
 * el demo tiene que responder como respondería la base a quien pregunta AHORA.
 */
export function almacenDemo(me: () => { id: string; name: string; admin: boolean; store?: string | null }, sinTabla: boolean): AlmacenDeCotizaciones {
  const db = semilla();
  let n = 1;

  return {
    async buscar(numero) {
      if (sinTabla) return SIN_TABLA;
      const q = db.cotizaciones.find((c) => claveDeEstimado(c.draft.estimate_num) === claveDeEstimado(numero));
      if (!q) return bien(null);
      const mia = db.aprobaciones.find((a) => a.quote_id === q.id && a.requested_by === me().id);
      const hallado: EstimadoHallado = {
        quote_id: q.id, estimate_num: q.draft.estimate_num, owner_id: q.owner_id, owner_name: q.owner_name,
        owner_store: null, my_approval_id: mia?.id ?? null, my_approval: mia?.status ?? null,
      };
      return bien(hallado);
    },

    async cargar(quoteId) {
      if (sinTabla) return SIN_TABLA;
      const q = db.cotizaciones.find((c) => c.id === quoteId);
      if (!q) return { ok: false, sinTabla: false, error: "not visible" };
      const out: CotizacionGuardada = { id: q.id, owner_id: q.owner_id, owner_name: q.owner_name, store: q.store, print_count: q.print_count, draft: structuredClone(q.draft) };
      return bien(out);
    },

    async guardar(quoteId, draft) {
      if (sinTabla) return SIN_TABLA;
      const yo = me();
      if (quoteId) {
        const q = db.cotizaciones.find((c) => c.id === quoteId);
        if (!q) return { ok: false, sinTabla: false, error: "0 rows" };
        const aprobada = db.aprobaciones.some((a) => a.quote_id === q.id && a.requested_by === yo.id && a.status === "approved");
        // La misma regla que la política de UPDATE de la 148: dueño, admin o aprobado. Si no, cero filas.
        if (!(q.owner_id === yo.id || yo.admin || aprobada)) return { ok: false, sinTabla: false, error: "0 rows" };
        q.draft = structuredClone({ ...draft, estimate_num: q.draft.estimate_num });
        return bien(q.id);
      }
      // El índice único por estimado de la 148: una segunda cotización para el mismo número falla.
      if (db.cotizaciones.some((c) => claveDeEstimado(c.draft.estimate_num) === claveDeEstimado(draft.estimate_num))) {
        return { ok: false, sinTabla: false, duplicado: true, error: "duplicate key value violates unique constraint \"estimator_quotes_one_per_estimate\"" };
      }
      n += 1;
      const id = `demo-q-${n}`;
      // Como el disparador de la 148: la tienda es la del perfil de quien la crea.
      db.cotizaciones.push({ id, owner_id: yo.id, owner_name: yo.name, store: yo.store?.trim() || null, print_count: 0, draft: structuredClone(draft) });
      return bien(id);
    },

    async pedirAprobacion(quoteId, approvalId) {
      if (sinTabla) return SIN_TABLA;
      const yo = me();
      const existente = approvalId ? db.aprobaciones.find((a) => a.id === approvalId) : undefined;
      if (existente) { existente.status = "pending"; return bien("pending" as AprobacionEstado); }
      n += 1;
      db.aprobaciones.push({ id: `demo-a-${n}`, quote_id: quoteId, requested_by: yo.id, requester_name: yo.name, status: "pending", requested_at: new Date().toISOString() });
      return bien("pending" as AprobacionEstado);
    },

    async pendientes() {
      if (sinTabla) return SIN_TABLA;
      const yo = me();
      const out: AprobacionPendiente[] = db.aprobaciones
        .filter((a) => a.status === "pending")
        .filter((a) => yo.admin || db.cotizaciones.find((c) => c.id === a.quote_id)?.owner_id === yo.id)
        .map((a) => ({
          approval_id: a.id, quote_id: a.quote_id,
          estimate_num: db.cotizaciones.find((c) => c.id === a.quote_id)?.draft.estimate_num ?? "",
          requester_name: a.requester_name, requested_at: a.requested_at,
        }));
      return bien(out);
    },

    async decidir(approvalId, estado) {
      if (sinTabla) return SIN_TABLA;
      const a = db.aprobaciones.find((x) => x.id === approvalId);
      if (!a) return { ok: false, sinTabla: false, error: "0 rows" };
      a.status = estado;
      return bien(null);
    },

    async marcarImpresa(quoteId, printCount) {
      if (sinTabla) return SIN_TABLA;
      const q = db.cotizaciones.find((c) => c.id === quoteId);
      if (q) q.print_count = printCount;
      return bien(null);
    },
  };
}

// ---- el estimado de la competencia, en memoria ------------------------------------------------------

const SIN_TABLA_COMPETENCIA: Resultado<never> = {
  ok: false, sinTabla: true, error: "PGRST205: Could not find the table 'public.estimator_competitor_files' (demo)",
};

/**
 * Los archivos de la competencia en **modo demo**: en memoria, sin red. Abrir da una URL de objeto
 * (`blob:`) del propio archivo elegido; recargar la página lo olvida todo, como el resto del demo.
 * Imita de la 153 lo que se ve desde la pantalla: cinco por cotización, los tipos y el tamaño del
 * cubo, y quitar solo quien lo subió o el admin. Con `?sinTabla=1`, como la base sin la 153.
 */
export function almacenDeCompetenciaDemo(
  me: () => { id: string; name: string; admin: boolean; store?: string | null }, sinTabla: boolean,
  /** `?sin156=1`: como la base con la 153 y sin la 156 (la pestaña de todos y los sueltos, apagados). */
  sin156 = false,
): AlmacenDeCompetencia {
  const filas: EstimadoDeCompetencia[] = [];
  const blobs = new Map<string, Blob>();
  let n = 0;
  return {
    async disponible() {
      return sinTabla ? SIN_TABLA_COMPETENCIA : bien(null);
    },
    async listar(quoteId) {
      if (sinTabla) return SIN_TABLA_COMPETENCIA;
      return bien(filas.filter((f) => f.quote_id === quoteId).map((f) => ({ ...f })));
    },
    async subir(quoteId, f, meta) {
      if (sinTabla) return SIN_TABLA_COMPETENCIA;
      const yaHay = filas.filter((x) => x.quote_id === quoteId).length;
      const fallo = validaArchivos([f], yaHay);
      if (fallo) return { ok: false, sinTabla: false, error: `demo: ${fallo.motivo}` };
      n += 1;
      const yo = me();
      const path = rutaDeCompetencia(quoteId, f.name, new Date(), `d${n}`);
      const fila: EstimadoDeCompetencia = {
        ...filaDeCompetencia(quoteId, path, f, meta),
        customer_name: null, store: yo.store?.trim() || null, estimate_num: null,
        id: `demo-c-${n}`, uploaded_by: yo.id, uploaded_by_name: yo.name, uploaded_at: new Date().toISOString(),
      };
      filas.push(fila);
      blobs.set(fila.id, f);
      return bien({ ...fila });
    },
    async abrir(a) {
      const b = blobs.get(a.id);
      if (!b || typeof URL.createObjectURL !== "function") return { ok: false, sinTabla: false, error: "demo: not found" };
      return bien(URL.createObjectURL(b));
    },
    async listarTodos() {
      if (sinTabla || sin156) return SIN_TABLA_COMPETENCIA;
      // Como la 156: todo el que tiene el módulo ve todos, de todas las tiendas.
      return bien(masNuevoPrimero(filas).map((f) => ({ ...f })));
    },
    async subirSuelto(yoId, f, meta) {
      if (sinTabla || sin156) return SIN_TABLA_COMPETENCIA;
      if (!meta.customer_name.trim()) return { ok: false, sinTabla: false, error: "demo: customer name required" };
      const mios = filas.filter((x) => x.quote_id === null && x.uploaded_by === yoId).length;
      if (mios >= LIMITES_DE_COMPETENCIA.maxSueltosPorPersona) return { ok: false, sinTabla: false, error: "demo: up to 50 loose files" };
      const fallo = validaArchivos([f], 0);
      if (fallo) return { ok: false, sinTabla: false, error: `demo: ${fallo.motivo}` };
      n += 1;
      const yo = me();
      const base = filaSuelta(rutaSuelta(yoId, f.name, new Date(), `d${n}`), f, meta);
      const fila: EstimadoDeCompetencia = {
        ...base, store: base.store ?? (yo.store?.trim() || null),
        id: `demo-c-${n}`, uploaded_by: yoId, uploaded_by_name: yo.name, uploaded_at: new Date().toISOString(),
      };
      filas.push(fila);
      blobs.set(fila.id, f);
      return bien({ ...fila });
    },
    async quitar(a) {
      if (sinTabla) return SIN_TABLA_COMPETENCIA;
      const i = filas.findIndex((x) => x.id === a.id);
      if (i < 0 || !puedeQuitar(filas[i], me())) return { ok: false, sinTabla: false, error: "0 rows" };
      filas.splice(i, 1);
      blobs.delete(a.id);
      return bien(null);
    },
  };
}

// ---- los productos del estimado de la competencia, en memoria ---------------------------------------

/**
 * Lo que «lee» el demo: un estimado INVENTADO, siempre el mismo, sin red y sin llamar a ninguna API. Trae a propósito
 * campos sin leer (null) —una marca, un SKU, un precio— para que se vea cómo queda lo que el papel no dejó leer.
 */
export const LECTURA_DEMO = {
  competitor: "Rival Tiles Demo", doc_date: "2026-10-01", doc_number: "RT-DEMO-5512",
  subtotal: 1836, tax: 151.47, total: 1987.47,
  items: [
    { description: "Demo Porcelain 24x48 Polished", brand: "DemoBrand", sku: "RT-2448", quantity: 500, unit: "SF", unit_price: 2.19, line_total: 1095 },
    { description: "Demo Wood-look 12x24", brand: null, sku: null, quantity: 30, unit: "boxes", unit_price: 24.7, line_total: 741 },
    { description: "Demo thinset 50 lb", brand: null, sku: "RT-TS50", quantity: 4, unit: "ea", unit_price: null, line_total: null },
  ],
};

/**
 * Las lecturas en **modo demo**: en memoria. `sin161`: como la base sin la migración 161. `sinLlave`: como el servidor
 * sin `ANTHROPIC_API_KEY` (la lectura dice que falta y se teclea a mano; guardar sigue funcionando).
 */
export function almacenDeLecturasDemo(
  me: () => { id: string; name: string; admin: boolean }, o: { sin161?: boolean; sinLlave?: boolean } = {},
): AlmacenDeLecturas {
  const guardadas = new Map<string, LecturaGuardada>();
  const SIN_161: Resultado<never> = { ok: false, sinTabla: true, error: "PGRST205: Could not find the table 'public.estimator_competitor_extracts' (demo)" };
  return {
    async cargar(fileIds) {
      if (o.sin161) return SIN_161;
      const out: Record<string, LecturaGuardada> = {};
      for (const id of fileIds) { const l = guardadas.get(id); if (l) out[id] = structuredClone(l); }
      return bien(out);
    },
    async guardar(fileId, l) {
      if (o.sin161) return SIN_161;
      const { file_id, ...limpia } = filaDeLectura(fileId, l);
      const guardada: LecturaGuardada = { ...limpia, file_id, saved_by_name: me().name, saved_at: new Date().toISOString() };
      guardadas.set(fileId, guardada);
      return bien(structuredClone(guardada));
    },
    async leer() {
      if (o.sin161) return { ok: false, codigo: "sin-161", error: "demo" };
      if (o.sinLlave) return { ok: false, codigo: "sin-llave", error: "Falta configurar ANTHROPIC_API_KEY (demo)." };
      return { ok: true, lectura: normalizaLectura(LECTURA_DEMO, "ocr")! };
    },
  };
}
