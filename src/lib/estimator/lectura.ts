import type { SupabaseClient } from "@supabase/supabase-js";
import { faltaLaTabla, type Resultado } from "./almacen";
import { precioAplicado, preciosDeLinea, totalDeLinea, type QuoteLine } from "./modelo";
import { TOPES_DE_TEXTO } from "./competencia";

/**
 * Los PRODUCTOS del estimado de la competencia (D-NEXT, migración 161). El dueño, 2026-10-04: «in the quote builder
 * addd the compettiton pdf or pcicture upload / compettiros company name and also products from the  and the ocr to
 * recognize the images,».
 *
 * Un estimado de la competencia ya subido (D-425, D-451) se **lee** —lo hace el servidor con Claude, ruta
 * `/api/estimator/leer-competencia`— y de él salen la empresa, la fecha, el número, los productos y los totales. Lo
 * leído se enseña en una tabla que el vendedor **corrige a mano** antes de guardar; sin la llave de la API se teclea
 * entero. Lo guardado vive en `public.estimator_competitor_extracts` (161), una fila por archivo.
 *
 * **Es interno**, como el archivo: nada de esto entra en `QuoteDraft` ni en `HojaDelCliente`.
 *
 * Este fichero es el lado que comparte el navegador: tipos, la forma del JSON, cómo se valida y dónde se guarda. Lo
 * que solo corre en el servidor (la llave, la llamada, los topes) está en `lectura-servidor.ts`.
 */

export const TOPES_DE_LECTURA = {
  /** Filas de producto por estimado. La 161 pone el mismo techo en la tabla. */
  maxProductos: 200,
  descripcion: 300,
  marca: 80,
  sku: 80,
  unidad: 20,
  numeroDeDocumento: 60,
} as const;

export interface ProductoDeCompetencia {
  /** Clave de la fila en la pantalla y dentro del `jsonb`. No sale del papel. */
  id: string;
  description: string | null;
  brand: string | null;
  sku: string | null;
  quantity: number | null;
  /** «SF», «box», «piece», o lo que diga el papel si no es ninguna de las tres. */
  unit: string | null;
  unit_price: number | null;
  line_total: number | null;
  /** La línea propia con la que el vendedor la emparejó **a mano**; nunca la pone la lectura. */
  matched_line_id: string | null;
}

export interface LecturaDeCompetencia {
  competitor: string | null;
  /** AAAA-MM-DD. */
  doc_date: string | null;
  doc_number: string | null;
  subtotal: number | null;
  tax: number | null;
  total: number | null;
  items: ProductoDeCompetencia[];
  /** «ocr»: salió de la lectura (aunque luego se corrija). «manual»: se tecleó entera. */
  source: "ocr" | "manual";
}

export interface LecturaGuardada extends LecturaDeCompetencia {
  file_id: string;
  saved_by_name: string | null;
  saved_at: string;
}

let n = 0;
/** Un id de fila. No necesita ser secreto ni global: solo distinto dentro de un estimado. */
export function idDeProducto(): string {
  n += 1;
  return `p${Date.now().toString(36)}${n.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export const productoVacio = (): ProductoDeCompetencia => ({
  id: idDeProducto(), description: null, brand: null, sku: null, quantity: null, unit: null, unit_price: null,
  line_total: null, matched_line_id: null,
});

export const lecturaVacia = (): LecturaDeCompetencia => ({
  competitor: null, doc_date: null, doc_number: null, subtotal: null, tax: null, total: null, items: [], source: "manual",
});

// ---- validar lo que llega (de la API, de la base o del teclado) ----------------------------------------

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Un texto recortado, o null si no hay nada. Lo que no es texto es null: no se convierte un número en nombre. */
function texto(v: unknown, tope: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().slice(0, tope);
  return s || null;
}

/** Un número finito y no negativo, o null. Un texto («12.50», «N/A») es null: lo no leído no se adivina. */
function numero(v: unknown, decimales: number): number | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return null;
  const f = 10 ** decimales;
  return Math.round(v * f) / f;
}

/** AAAA-MM-DD de una fecha que existe, o null. «10/04/2026» es null: no se adivina si es abril u octubre. */
export function fechaIso(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  // Un día o un mes que no existen (30 de febrero, mes 13) caen en OTRO mes: con mirar el mes basta.
  return d.getUTCMonth() === Number(m[2]) - 1 ? m[0] : null;
}

const SF = new Set(["sf", "sqft", "sq ft", "sq. ft.", "sq.ft.", "sq ft.", "ft2", "ft²", "square feet", "square foot", "s/f"]);
const CAJA = new Set(["box", "boxes", "bx", "ctn", "carton", "cartons", "caja", "cajas", "cs", "case", "cases"]);
const PIEZA = new Set(["piece", "pieces", "pc", "pcs", "ea", "each", "pieza", "piezas", "pz", "pza", "unit", "units"]);

/** «SF», «box» o «piece» si la unidad es una de las tres con otro nombre; si no, lo que dice el papel. */
export function unidadNormalizada(v: unknown): string | null {
  const s = texto(v, TOPES_DE_LECTURA.unidad);
  if (!s) return null;
  const k = s.toLowerCase();
  if (SF.has(k)) return "SF";
  if (CAJA.has(k)) return "box";
  if (PIEZA.has(k)) return "piece";
  return s;
}

function producto(v: unknown): ProductoDeCompetencia | null {
  if (!esObjeto(v)) return null;
  const p: ProductoDeCompetencia = {
    id: texto(v.id, 40) ?? idDeProducto(),
    description: texto(v.description, TOPES_DE_LECTURA.descripcion),
    brand: texto(v.brand, TOPES_DE_LECTURA.marca),
    sku: texto(v.sku, TOPES_DE_LECTURA.sku),
    quantity: numero(v.quantity, 4),
    unit: unidadNormalizada(v.unit),
    // Cuatro decimales: un $/SF de 1.899 es corriente en azulejo.
    unit_price: numero(v.unit_price, 4),
    line_total: numero(v.line_total, 2),
    matched_line_id: texto(v.matched_line_id, 80),
  };
  return filaEnBlanco(p) ? null : p;
}

/** Una fila sin nada escrito: no se guarda. */
export function filaEnBlanco(p: ProductoDeCompetencia): boolean {
  return p.description === null && p.brand === null && p.sku === null && p.quantity === null && p.unit === null
    && p.unit_price === null && p.line_total === null;
}

/**
 * De un JSON cualquiera a una lectura válida. Lo que no viene, viene mal o no se entiende queda **null**; las filas en
 * blanco se caen; como mucho `maxProductos`. Devuelve null solo si aquello no es ni un objeto con su lista.
 */
export function normalizaLectura(crudo: unknown, origen: "ocr" | "manual"): LecturaDeCompetencia | null {
  if (!esObjeto(crudo) || !Array.isArray(crudo.items)) return null;
  const items: ProductoDeCompetencia[] = [];
  const vistos = new Set<string>();
  for (const v of crudo.items) {
    const p = producto(v);
    if (!p) continue;
    if (vistos.has(p.id)) p.id = idDeProducto();
    vistos.add(p.id);
    items.push(p);
    if (items.length >= TOPES_DE_LECTURA.maxProductos) break;
  }
  return {
    competitor: texto(crudo.competitor, TOPES_DE_TEXTO.competidor),
    doc_date: fechaIso(crudo.doc_date),
    doc_number: texto(crudo.doc_number, TOPES_DE_LECTURA.numeroDeDocumento),
    subtotal: numero(crudo.subtotal, 2),
    tax: numero(crudo.tax, 2),
    total: numero(crudo.total, 2),
    items,
    source: origen,
  };
}

/** Lo que se manda a la 161. Sin quién ni cuándo: los pone el disparador. */
export function filaDeLectura(fileId: string, l: LecturaDeCompetencia) {
  const limpia = normalizaLectura(l, l.source) ?? lecturaVacia();
  return {
    file_id: fileId, competitor: limpia.competitor, doc_date: limpia.doc_date, doc_number: limpia.doc_number,
    subtotal: limpia.subtotal, tax: limpia.tax, total: limpia.total, items: limpia.items, source: limpia.source,
  };
}

/** ¿Hay algo que guardar? Una lectura sin empresa, sin totales y sin filas no es una lectura. */
export function lecturaEnBlanco(l: LecturaDeCompetencia): boolean {
  const limpia = normalizaLectura(l, l.source);
  return !limpia || (limpia.items.length === 0 && limpia.competitor === null && limpia.doc_date === null
    && limpia.doc_number === null && limpia.subtotal === null && limpia.tax === null && limpia.total === null);
}

// ---- lo que enseña la lista --------------------------------------------------------------------------

/** La empresa y el total de un estimado: lo corregido en la lectura gana a lo escrito al subir. */
export function empresaDe(a: { competitor: string | null }, l: Pick<LecturaDeCompetencia, "competitor"> | null | undefined): string | null {
  return l?.competitor ?? a.competitor;
}
export function totalDe(a: { competitor_total: number | null }, l: Pick<LecturaDeCompetencia, "total"> | null | undefined): number | null {
  return l?.total ?? a.competitor_total;
}

/** Las empresas ya usadas, para ofrecerlas al escribir: sin repetir (sin mirar mayúsculas) y en orden alfabético. */
export function competidoresUsados(nombres: readonly (string | null | undefined)[]): string[] {
  const porClave = new Map<string, string>();
  for (const crudo of nombres) {
    const s = (crudo ?? "").trim();
    if (s && !porClave.has(s.toLowerCase())) porClave.set(s.toLowerCase(), s);
  }
  return [...porClave.values()].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
}

// ---- lado a lado con la cotización propia --------------------------------------------------------------

/** Una línea de la cotización propia, con lo justo para ponerla al lado de la del competidor. */
export interface LineaPropia {
  id: string;
  etiqueta: string;
  /** El precio que se le cobra al cliente (con descuento si aplica): $/SF en las de superficie, por unidad en las otras. */
  precio: number | null;
  unidad: string | null;
  total: number | null;
}

export function lineasPropias(lineas: readonly QuoteLine[]): LineaPropia[] {
  return lineas.map((l, i) => {
    const { regular, bajo } = preciosDeLinea(l);
    const nombre = [l.item_code.trim(), l.customer_category.trim() || l.internal_description.trim()].filter(Boolean).join(" · ");
    return {
      id: l.id,
      etiqueta: `${i + 1}${nombre ? ` · ${nombre}` : ""}`,
      precio: precioAplicado(regular, bajo),
      unidad: l.kind === "sf" ? "SF" : unidadNormalizada(l.unit),
      total: totalDeLinea(l),
    };
  });
}

/** La línea propia emparejada con este producto, si sigue existiendo. */
export function lineaEmparejada(p: Pick<ProductoDeCompetencia, "matched_line_id">, propias: readonly LineaPropia[]): LineaPropia | null {
  if (!p.matched_line_id) return null;
  return propias.find((l) => l.id === p.matched_line_id) ?? null;
}

/**
 * Cuánto más caro (positivo) o más barato (negativo) es el precio unitario PROPIO frente al del competidor. Solo si
 * los dos tienen precio **y la misma unidad**: comparar un $/caja con un $/SF sería inventar una equivalencia.
 */
export function diferenciaDePrecio(p: Pick<ProductoDeCompetencia, "unit" | "unit_price">, propia: LineaPropia | null): number | null {
  if (!propia || p.unit_price === null || propia.precio === null) return null;
  if (!p.unit || !propia.unidad || p.unit.toLowerCase() !== propia.unidad.toLowerCase()) return null;
  return Math.round((propia.precio - p.unit_price) * 10000) / 10000;
}

// ---- dónde se guarda y quién lee -----------------------------------------------------------------------

/** Por qué no se leyó. `sin-llave` y `sin-161` no son averías: la pantalla sigue, tecleando a mano. */
export type CodigoDeLectura =
  | "sin-llave" | "sin-161" | "sin-modulo" | "no-es-tuyo" | "no-esta" | "tipo" | "tamano" | "paginas" | "tope"
  | "descarga" | "proveedor" | "respuesta" | "red";

export type ResultadoDeLeer =
  | { ok: true; lectura: LecturaDeCompetencia }
  | { ok: false; codigo: CodigoDeLectura; error: string };

export interface AlmacenDeLecturas {
  /** Las lecturas guardadas de estos archivos, por `file_id`. Sin la 161, `sinTabla`. */
  cargar(fileIds: string[]): Promise<Resultado<Record<string, LecturaGuardada>>>;
  guardar(fileId: string, l: LecturaDeCompetencia): Promise<Resultado<LecturaGuardada>>;
  /** Pide al servidor que lea el archivo. No guarda nada: devuelve lo leído para corregirlo. */
  leer(fileId: string): Promise<ResultadoDeLeer>;
}

export const RUTA_DE_LECTURA = "/api/estimator/leer-competencia";
const COLUMNAS_DE_LECTURA = "file_id, competitor, doc_date, doc_number, subtotal, tax, total, items, source, saved_by_name, saved_at";

/** De la fila de la 161 a la lectura: pasa por el mismo validador, por si el `jsonb` trae algo que no debía. */
export function lecturaDeFila(fila: Record<string, unknown>): LecturaGuardada | null {
  const origen = fila.source === "ocr" ? "ocr" : "manual";
  const l = normalizaLectura(fila, origen);
  if (!l || typeof fila.file_id !== "string") return null;
  return {
    ...l, file_id: fila.file_id,
    saved_by_name: typeof fila.saved_by_name === "string" ? fila.saved_by_name : null,
    saved_at: typeof fila.saved_at === "string" ? fila.saved_at : "",
  };
}

const CODIGOS: readonly CodigoDeLectura[] = [
  "sin-llave", "sin-161", "sin-modulo", "no-es-tuyo", "no-esta", "tipo", "tamano", "paginas", "tope", "descarga", "proveedor", "respuesta", "red",
];

/** Lo que contestó la ruta, convertido en un resultado. Aparte para probarlo sin red. */
export function resultadoDeLaRuta(status: number, cuerpo: unknown): ResultadoDeLeer {
  const c = esObjeto(cuerpo) ? cuerpo : {};
  if (status === 200) {
    const lectura = normalizaLectura(c.lectura, "ocr");
    if (lectura) return { ok: true, lectura };
    return { ok: false, codigo: "respuesta", error: "The reading came back in an unexpected shape." };
  }
  const codigo = CODIGOS.find((k) => k === c.codigo) ?? "proveedor";
  return { ok: false, codigo, error: typeof c.error === "string" && c.error ? c.error : `HTTP ${status}` };
}

export function almacenDeLecturasDeLaBase(supabase: SupabaseClient, pedir: typeof fetch = fetch): AlmacenDeLecturas {
  return {
    async cargar(fileIds) {
      if (!fileIds.length) {
        // Sin archivos también hay que saber si la 161 está: una lectura vacía lo dice.
        const { error } = await supabase.from("estimator_competitor_extracts").select("file_id").limit(1);
        if (error) return { ok: false, sinTabla: faltaLaTabla(error), error: error.message ?? "error" };
        return { ok: true, valor: {} };
      }
      const { data, error } = await supabase.from("estimator_competitor_extracts").select(COLUMNAS_DE_LECTURA).in("file_id", fileIds);
      if (error) return { ok: false, sinTabla: faltaLaTabla(error), error: error.message ?? "error" };
      const out: Record<string, LecturaGuardada> = {};
      for (const fila of (data ?? []) as Record<string, unknown>[]) {
        const l = lecturaDeFila(fila);
        if (l) out[l.file_id] = l;
      }
      return { ok: true, valor: out };
    },

    async guardar(fileId, l) {
      const { data, error } = await supabase
        .from("estimator_competitor_extracts").upsert(filaDeLectura(fileId, l), { onConflict: "file_id" }).select(COLUMNAS_DE_LECTURA);
      if (error) return { ok: false, sinTabla: faltaLaTabla(error), error: error.message ?? "error" };
      const fila = (data as Record<string, unknown>[] | null)?.[0];
      const guardada = fila ? lecturaDeFila(fila) : null;
      // Cero filas sin error: la política no dejó (no es de quien guarda). Eso no es «guardado».
      if (!guardada) return { ok: false, sinTabla: false, error: "0 rows" };
      return { ok: true, valor: guardada };
    },

    async leer(fileId) {
      try {
        const r = await pedir(RUTA_DE_LECTURA, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileId }),
        });
        const cuerpo: unknown = await r.json().catch(() => null);
        return resultadoDeLaRuta(r.status, cuerpo);
      } catch (e) {
        return { ok: false, codigo: "red", error: e instanceof Error ? e.message : "network error" };
      }
    },
  };
}

/** Lo que dice la pantalla por cada motivo. Los dos primeros invitan a teclear: no son un fallo de quien usa esto. */
export function mensajeDeLectura(codigo: CodigoDeLectura, error: string, t: (en: string, es: string) => string): string {
  switch (codigo) {
    case "sin-llave":
      return t(
        "Automatic reading is not set up yet (ANTHROPIC_API_KEY is missing on the server). Type the products by hand.",
        "La lectura automática todavía no está configurada (falta configurar ANTHROPIC_API_KEY en el servidor). Teclea los productos a mano.",
      );
    case "sin-161":
      return t("Not available yet: the database has not been updated (migration 161).", "Todavía no disponible: falta actualizar la base (migración 161).");
    case "tope":
      return t("Today's limit of automatic readings is used up. Type the products by hand, or try tomorrow.", "Se acabó el tope de lecturas automáticas de hoy. Teclea los productos a mano, o prueba mañana.");
    case "tipo":
      return t("This kind of file cannot be read automatically (only PDF, JPG, PNG and WEBP). Type the products by hand.", "Este tipo de archivo no se puede leer solo (solo PDF, JPG, PNG y WEBP). Teclea los productos a mano.");
    case "tamano":
      return t("The file is too big to be read automatically. Type the products by hand.", "El archivo pesa demasiado para leerlo solo. Teclea los productos a mano.");
    case "paginas":
      return t("The PDF has too many pages to be read automatically (or they could not be counted). Type the products by hand.", "El PDF tiene demasiadas páginas para leerlo solo (o no se pudieron contar). Teclea los productos a mano.");
    case "no-es-tuyo":
      return t("Only whoever uploaded it, or an admin, can read it.", "Solo lo puede leer quien lo subió, o un admin.");
    default:
      return `${t("Could not read the document", "No se pudo leer el documento")}: ${error}. ${t("You can type the products by hand.", "Puedes teclear los productos a mano.")}`;
  }
}
