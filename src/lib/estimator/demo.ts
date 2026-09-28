import type { AlmacenDeCotizaciones, AprobacionPendiente, CotizacionGuardada, ProductoDelCatalogo, Resultado } from "./almacen";
import { claveDeEstimado, lineaSfVacia, borradorVacio, type QuoteDraft } from "./modelo";
import type { AprobacionEstado, EstimadoHallado } from "./validar";
import {
  filaDeCompetencia, puedeQuitar, rutaDeCompetencia, validaArchivos, type AlmacenDeCompetencia, type ArchivoDeCompetencia,
} from "./competencia";

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

interface FilaDemo { id: string; owner_id: string; owner_name: string; print_count: number; draft: QuoteDraft }
interface AprobDemo { id: string; quote_id: string; requested_by: string; requester_name: string; status: AprobacionEstado; requested_at: string }

function semilla(): { cotizaciones: FilaDemo[]; aprobaciones: AprobDemo[] } {
  const draft = borradorVacio();
  draft.estimate_num = DEMO_ESTIMADO_AJENO;
  draft.sales_ext = "201";
  draft.customer = { salutation: "Mr.", full_name: "Demo Customer", last_name: "Customer", last_name_edited: false, company: "Demo Builders", phone: "555-0100", address: "1 Demo St" };
  draft.lines = [{ ...lineaSfVacia(), customer_category: "12x24 Tile", requested_sf: 400, sf_per_box: 15.5, price_per_sf: 1.29, item_code: "DEMO-1224", internal_description: "Demo Ceramic Wood-look 12x24 Matte" }];
  return {
    cotizaciones: [{ id: "demo-q-1", owner_id: DEMO_OTRO_VENDEDOR.id, owner_name: DEMO_OTRO_VENDEDOR.name, print_count: 0, draft }],
    aprobaciones: [],
  };
}

const bien = <T,>(valor: T): Resultado<T> => ({ ok: true, valor });
const SIN_TABLA: Resultado<never> = { ok: false, sinTabla: true, error: "PGRST205: Could not find the table 'public.estimator_quotes' (demo)" };

/**
 * `me` se pide en cada llamada (no se captura) porque «Ver como» cambia de persona sin recargar, y
 * el demo tiene que responder como respondería la base a quien pregunta AHORA.
 */
export function almacenDemo(me: () => { id: string; name: string; admin: boolean }, sinTabla: boolean): AlmacenDeCotizaciones {
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
      const out: CotizacionGuardada = { id: q.id, owner_id: q.owner_id, owner_name: q.owner_name, print_count: q.print_count, draft: structuredClone(q.draft) };
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
      db.cotizaciones.push({ id, owner_id: yo.id, owner_name: yo.name, print_count: 0, draft: structuredClone(draft) });
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
  me: () => { id: string; name: string; admin: boolean }, sinTabla: boolean,
): AlmacenDeCompetencia {
  const filas: ArchivoDeCompetencia[] = [];
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
      const fila: ArchivoDeCompetencia = {
        ...filaDeCompetencia(quoteId, path, f, meta),
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
