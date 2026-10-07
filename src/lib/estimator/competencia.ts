import type { SupabaseClient } from "@supabase/supabase-js";
import { nombreSaneado } from "@/lib/help-attachments";
import { faltaLaTabla, type Resultado } from "./almacen";

/**
 * El estimado de la competencia (D-425, hija de T-0408): el vendedor sube el PDF o la foto del
 * estimado que le dio otro almacén, **pegado a la cotización** (estimate #), para tenerlo a mano al
 * hablar de precio con el cliente.
 *
 * **Es interno.** Nada de aquí entra en `QuoteDraft` ni en `HojaDelCliente`: vive en su tabla
 * (`estimator_competitor_files`, migración 153) y en su cubo privado, y la hoja impresa no lo puede
 * pintar porque no lo recibe (la prueba de `competencia.test.ts` lo fija).
 *
 * Quién ve y quién sube lo decide la base, no esto: ve quien ve la cotización (su RLS, D-413); sube
 * quien la puede editar (dueño, aprobado, admin); quita quien lo subió o el admin. Aquí solo se avisa
 * antes de mandar lo que la base va a rechazar.
 */

/** El cubo privado de la 153. */
export const CUBO_DE_COMPETENCIA = "estimator-competitor-files";

/** Un minuto de enlace firmado: se abre al pulsar, y un enlace que dura más es un enlace que se reenvía. */
export const VALIDEZ_AL_ABRIR = 60;

export const LIMITES_DE_COMPETENCIA = {
  /**
   * 10 MB por archivo, el mismo número que el cubo de la 153 y que `help-files` (119). Una foto de móvil
   * pesa 2-5 MB y un PDF de estimado, menos de 1; 10 da margen a un escaneo de varias páginas sin
   * abrir la puerta a vídeos.
   */
  maxBytes: 10 * 1024 * 1024,
  /**
   * Cinco por cotización: el techo es de 50 MB por estimado. El 2026-09-25 producción se cayó por cuota
   * (D-403): aquí el techo lo pone la base —tabla y cubo, 153—, no la costumbre.
   */
  maxPorCotizacion: 5,
  /**
   * Sueltos (sin cotización, D-451): 50 por persona, en la tabla y en el cubo (156). = 500 MB por persona como mucho.
   * Número mío, a validar: el 2026-09-29 no había ni un archivo en el cubo.
   */
  maxSueltosPorPersona: 50,
  /** PDF y fotos. La lista que manda es la del cubo; esta es la misma, para avisar antes. */
  tipos: ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"] as string[],
} as const;

/** Lo que acepta el `<input type="file">`: las extensiones de HEIC van aparte porque Windows no les da tipo. */
/**
 * `image/*,application/pdf` (D-466): en el celular, «image/*» es lo que ofrece la galería y la cámara además de los
 * archivos. Lo que se cuele y no sea de la lista (un GIF) lo para `validaArchivos` con su mensaje.
 */
export const ACCEPT_DE_COMPETENCIA = "image/*,application/pdf,.pdf,.heic,.heif";
/** El botón «Tomar foto»: con `capture`, el celular abre la cámara directamente. */
export const ACCEPT_DE_CAMARA = "image/*";

export const TOPES_DE_TEXTO = { competidor: 120, nota: 500, cliente: 120, tienda: 80, estimado: 60 } as const;

export interface ArchivoDeCompetencia {
  id: string;
  /** La cotización a la que va pegado; null si se subió **suelto**, sin cotización (D-451, migración 156). */
  quote_id: string | null;
  path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  competitor: string | null;
  competitor_total: number | null;
  note: string | null;
  uploaded_by: string | null;
  uploaded_by_name: string | null;
  uploaded_at: string;
}

/** Lo opcional que se escribe por archivo. */
export interface MetaDeCompetencia {
  competitor: string;
  competitor_total: number | null;
  note: string;
}

export const metaVacia = (): MetaDeCompetencia => ({ competitor: "", competitor_total: null, note: "" });

const POR_EXTENSION: Record<string, string> = {
  pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
  heic: "image/heic", heif: "image/heif",
};

/**
 * El tipo con el que se sube. El navegador da `""` a un `.heic` en Windows y algunos dicen
 * `image/jpg`: sin arreglarlo, el cubo lo rechazaría con un error que la persona no entiende.
 */
export function tipoDeArchivo(nombre: string, tipo: string): string {
  const t = (tipo || "").toLowerCase().trim();
  if (t === "image/jpg") return "image/jpeg";
  if (t) return t;
  const ext = (nombre.split(".").pop() ?? "").toLowerCase();
  return POR_EXTENSION[ext] ?? "";
}

export type FalloDeCompetencia = { motivo: "cuantos" | "tamano" | "tipo" | "vacio"; fichero?: string };

/** ¿Se pueden subir estos, habiendo ya `yaHay` en la cotización? El cubo y la tabla lo vuelven a mirar. */
export function validaArchivos(ficheros: { name: string; size: number; type: string }[], yaHay: number): FalloDeCompetencia | null {
  if (yaHay + ficheros.length > LIMITES_DE_COMPETENCIA.maxPorCotizacion) return { motivo: "cuantos" };
  for (const f of ficheros) {
    if (f.size <= 0) return { motivo: "vacio", fichero: f.name };
    if (f.size > LIMITES_DE_COMPETENCIA.maxBytes) return { motivo: "tamano", fichero: f.name };
    if (!LIMITES_DE_COMPETENCIA.tipos.includes(tipoDeArchivo(f.name, f.type))) return { motivo: "tipo", fichero: f.name };
  }
  return null;
}

export function mensajeDeCompetencia(f: FalloDeCompetencia, t: (en: string, es: string) => string): string {
  const mb = Math.round(LIMITES_DE_COMPETENCIA.maxBytes / (1024 * 1024));
  const max = LIMITES_DE_COMPETENCIA.maxPorCotizacion;
  if (f.motivo === "cuantos") return t(`Up to ${max} files per quote.`, `Hasta ${max} archivos por cotización.`);
  if (f.motivo === "tamano") return t(`“${f.fichero}” is over ${mb} MB.`, `«${f.fichero}» pasa de ${mb} MB.`);
  if (f.motivo === "vacio") return t(`“${f.fichero}” is empty.`, `«${f.fichero}» está vacío.`);
  return t(`“${f.fichero}” is not a PDF or a photo (JPG, PNG, WEBP, HEIC).`, `«${f.fichero}» no es un PDF ni una foto (JPG, PNG, WEBP, HEIC).`);
}

/**
 * Dónde se guarda: **la primera carpeta es la cotización**. De eso viven las políticas del cubo (quien
 * ve la cotización ve la carpeta) y la comprobación de la tabla (la ruta tiene que empezar por su
 * `quote_id`). El sello y el azar evitan que dos subidas del mismo nombre se pisen (`upsert: false`).
 */
export function rutaDeCompetencia(quoteId: string, nombre: string, cuando: Date, azar: string): string {
  const sello = cuando.toISOString().replace(/[:.]/g, "-");
  return `${quoteId}/${sello}-${azar}-${nombreSaneado(nombre)}`;
}

export function tamanoLegible(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Quita quien lo subió o el admin — la misma regla que la política de DELETE de la 153. */
export function puedeQuitar(a: Pick<ArchivoDeCompetencia, "uploaded_by">, yo: { id: string; admin: boolean }): boolean {
  if (yo.admin) return true;
  return !!yo.id && a.uploaded_by === yo.id;
}

/**
 * En qué estado está la sección:
 * - `sin-base`: falta la 148 o la 153 (la tabla o el cubo). Se ve apagada, y el resto del Estimador sigue.
 * - `sin-cotizacion`: no hay cotización guardada o abierta todavía: la carpeta es su id, y sin id no hay dónde.
 * - `lista`: se puede subir.
 */
export type EstadoDeCompetencia = "sin-base" | "sin-cotizacion" | "lista";

export function estadoDeCompetencia(a: { baseCotizaciones: boolean | null; baseArchivos: boolean | null; quoteId: string | null }): EstadoDeCompetencia {
  if (a.baseCotizaciones === false || a.baseArchivos === false) return "sin-base";
  if (!a.quoteId) return "sin-cotizacion";
  return "lista";
}

/** ¿El error dice «la 153 no está»? La tabla (los códigos de siempre) o el cubo («Bucket not found»). */
export function faltaLaBaseDeCompetencia(error: { code?: string | null; message?: string | null; statusCode?: string | number | null } | null | undefined): boolean {
  if (!error) return false;
  if (faltaLaTabla(error)) return true;
  return /bucket not found/i.test(error.message ?? "");
}

/** Lo que se manda a la tabla. Sin `uploaded_by`, `uploaded_by_name` ni `uploaded_at`: los pone el disparador. */
export function filaDeCompetencia(quoteId: string, path: string, f: { name: string; size: number; type: string }, meta: MetaDeCompetencia) {
  const competidor = meta.competitor.trim().slice(0, TOPES_DE_TEXTO.competidor);
  const nota = meta.note.trim().slice(0, TOPES_DE_TEXTO.nota);
  const total = meta.competitor_total;
  return {
    quote_id: quoteId,
    path,
    file_name: (f.name || "file").slice(0, 200),
    mime_type: tipoDeArchivo(f.name, f.type),
    size_bytes: f.size,
    competitor: competidor || null,
    competitor_total: total !== null && Number.isFinite(total) && total >= 0 ? Math.round(total * 100) / 100 : null,
    note: nota || null,
  };
}

// ---- los sueltos y la pestaña de todos (D-451, migración 156) ------------------------------------------
//
// El dueño, 2026-09-29: «THE COMEPTITORS ESTIMATE YOU CAN UPLOAD IT WITHOUT NEEDE TO CREATE AN ESTIMATE / AND I WANT IT
// TO SHOW ALL ESTIAMTES IN A TAB AND ALL SALES REP COULD SEE IT». Un estimado de la competencia se puede subir sin
// cotización (con el cliente, la tienda y lo opcional), y una pestaña lista TODOS —sueltos y pegados— para todo el que
// tenga el módulo. Quién ve lo decide la 156 (`has_estimator_access()`), no esto.

/** La primera carpeta de los sueltos en el cubo; la segunda es el id de quien sube (lo exigen el cubo y el disparador). */
export const CARPETA_SUELTA = "general";

/** Un estimado de la competencia como lo lista la pestaña: el archivo y lo que dice de quién es. */
export interface EstimadoDeCompetencia extends ArchivoDeCompetencia {
  customer_name: string | null;
  store: string | null;
  /** El # de estimado: el de la cotización si va pegado (lo copia el disparador), o el escrito a mano si es suelto. */
  estimate_num: string | null;
}

/** Lo que se escribe al subir uno suelto. El cliente es obligatorio; lo demás, opcional. */
export interface MetaSuelta extends MetaDeCompetencia {
  customer_name: string;
  store: string;
  estimate_num: string;
}

export const metaSueltaVacia = (tienda = ""): MetaSuelta => ({ ...metaVacia(), customer_name: "", store: tienda, estimate_num: "" });

/** `general/<uid>/<sello>-<azar>-<nombre saneado>`: la carpeta de quien sube, como exige la 156. */
export function rutaSuelta(userId: string, nombre: string, cuando: Date, azar: string): string {
  return `${CARPETA_SUELTA}/${userId}/${rutaDeCompetencia("x", nombre, cuando, azar).slice(2)}`;
}

/** ¿Falta algo para subir uno suelto? Solo el cliente (los archivos los valida `validaArchivos`). */
export function faltaEnSuelto(meta: Pick<MetaSuelta, "customer_name">): "cliente" | null {
  return meta.customer_name.trim() ? null : "cliente";
}

/** La fila de un suelto. Sin `quote_id`; sin quién ni cuándo (los pone el disparador). */
export function filaSuelta(path: string, f: { name: string; size: number; type: string }, meta: MetaSuelta) {
  const recorta = (v: string, n: number) => v.trim().slice(0, n) || null;
  return {
    ...filaDeCompetencia("", path, f, meta),
    quote_id: null,
    customer_name: recorta(meta.customer_name, TOPES_DE_TEXTO.cliente),
    store: recorta(meta.store, TOPES_DE_TEXTO.tienda),
    estimate_num: recorta(meta.estimate_num, TOPES_DE_TEXTO.estimado),
  };
}

/**
 * ¿El error dice «la 156 no está»? La lista pide columnas que solo trae la 156: Postgres dice 42703 (columna que no
 * existe) y PostgREST PGRST204. Y sin la 153 debajo, los de siempre.
 */
export function faltaLa156(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "42703" || error.code === "PGRST204" || faltaLaBaseDeCompetencia(error);
}

/** El filtro de la pestaña: por tienda (vacío = todas) y por texto en cliente, competidor, # de estimado, nota y quién. */
export function filtraEstimados(lista: readonly EstimadoDeCompetencia[], f: { tienda: string; texto: string }): EstimadoDeCompetencia[] {
  const t = f.texto.trim().toLowerCase();
  return lista.filter((e) => {
    if (f.tienda && (e.store ?? "") !== f.tienda) return false;
    if (!t) return true;
    return [e.customer_name, e.competitor, e.estimate_num, e.note, e.uploaded_by_name, e.file_name]
      .some((v) => (v ?? "").toLowerCase().includes(t));
  });
}

/** De lo más nuevo a lo más viejo, como la pide la pestaña (y la base, por `uploaded_at desc`). */
export function masNuevoPrimero<T extends { uploaded_at: string }>(lista: readonly T[]): T[] {
  return [...lista].sort((a, b) => (a.uploaded_at < b.uploaded_at ? 1 : a.uploaded_at > b.uploaded_at ? -1 : 0));
}

// ---- dónde se guarda -------------------------------------------------------------------------------

export interface AlmacenDeCompetencia {
  /** Si la 153 está: una lectura vacía. Sin ella, `sinTabla`. */
  disponible(): Promise<Resultado<null>>;
  listar(quoteId: string): Promise<Resultado<ArchivoDeCompetencia[]>>;
  subir(quoteId: string, f: File, meta: MetaDeCompetencia): Promise<Resultado<ArchivoDeCompetencia>>;
  /** Una URL para abrir el archivo: firmada y de un minuto en la base; de objeto en el demo. */
  abrir(a: ArchivoDeCompetencia): Promise<Resultado<string>>;
  quitar(a: ArchivoDeCompetencia): Promise<Resultado<null>>;
  /** TODOS los estimados de la competencia, sueltos y pegados (156). Sin la 156, `sinTabla`. */
  /**
   * Con `subidoPor`, solo los que subió esa persona, en la consulta (D-484, la lista de «Mis cotizaciones»); sin él,
   * todos los que la 156 deja ver (la pestaña de la competencia, D-451, y la lista del admin).
   */
  listarTodos(subidoPor?: string | null): Promise<Resultado<EstimadoDeCompetencia[]>>;
  /** Sube uno suelto, sin cotización, a la carpeta de `yoId` (156). */
  subirSuelto(yoId: string, f: File, meta: MetaSuelta): Promise<Resultado<EstimadoDeCompetencia>>;
}

type ErrorDeCompetencia = { code?: string | null; message?: string | null } | null;
function falla<T>(error: ErrorDeCompetencia): Resultado<T> {
  return { ok: false, sinTabla: faltaLaBaseDeCompetencia(error), error: error?.message ?? "error" };
}

const COLUMNAS = "id, quote_id, path, file_name, mime_type, size_bytes, competitor, competitor_total, note, uploaded_by, uploaded_by_name, uploaded_at";
/** Las de la pestaña: las de la 153 más las tres de la 156. La sección de la cotización sigue pidiendo solo `COLUMNAS`. */
export const COLUMNAS_156 = `${COLUMNAS}, customer_name, store, estimate_num`;
/** Una página de la lista: de sobra para hoy (0 archivos el 2026-09-29) y con techo, por si crece. */
export const TOPE_DE_LA_LISTA = 500;

function azar(): string {
  return Math.random().toString(36).slice(2, 8);
}

export function almacenDeCompetenciaDeLaBase(supabase: SupabaseClient): AlmacenDeCompetencia {
  const cubo = () => supabase.storage.from(CUBO_DE_COMPETENCIA);
  return {
    async disponible() {
      const { error } = await supabase.from("estimator_competitor_files").select("id").limit(1);
      if (error) return falla(error);
      return { ok: true, valor: null };
    },

    async listar(quoteId) {
      const { data, error } = await supabase
        .from("estimator_competitor_files").select(COLUMNAS).eq("quote_id", quoteId).order("uploaded_at");
      if (error) return falla(error);
      return { ok: true, valor: (data ?? []) as ArchivoDeCompetencia[] };
    },

    async subir(quoteId, f, meta) {
      const path = rutaDeCompetencia(quoteId, f.name, new Date(), azar());
      const tipo = tipoDeArchivo(f.name, f.type);
      const { error: eSubida } = await cubo().upload(path, f, { contentType: tipo || undefined, upsert: false });
      if (eSubida) return falla(eSubida);
      const { data, error } = await supabase
        .from("estimator_competitor_files").insert(filaDeCompetencia(quoteId, path, f, meta)).select(COLUMNAS);
      const fila = (data as ArchivoDeCompetencia[] | null)?.[0];
      if (error || !fila) {
        // Sin su fila, el archivo no se ve en ningún sitio y solo ocupa cuota: se retira.
        await cubo().remove([path]).catch(() => undefined);
        return error ? falla(error) : { ok: false, sinTabla: false, error: "0 rows" };
      }
      return { ok: true, valor: fila };
    },

    async abrir(a) {
      const { data, error } = await cubo().createSignedUrl(a.path, VALIDEZ_AL_ABRIR);
      if (error || !data?.signedUrl) return falla(error ?? { message: "no url" });
      return { ok: true, valor: data.signedUrl };
    },

    async listarTodos(subidoPor) {
      const base = supabase.from("estimator_competitor_files").select(COLUMNAS_156);
      const q = subidoPor ? base.eq("uploaded_by", subidoPor) : base;
      const { data, error } = await q.order("uploaded_at", { ascending: false }).limit(TOPE_DE_LA_LISTA);
      if (error) return { ok: false, sinTabla: faltaLa156(error), error: error.message ?? "error" };
      return { ok: true, valor: (data ?? []) as EstimadoDeCompetencia[] };
    },

    async subirSuelto(yoId, f, meta) {
      const path = rutaSuelta(yoId, f.name, new Date(), azar());
      const tipo = tipoDeArchivo(f.name, f.type);
      const { error: eSubida } = await cubo().upload(path, f, { contentType: tipo || undefined, upsert: false });
      if (eSubida) return falla(eSubida);
      const { data, error } = await supabase
        .from("estimator_competitor_files").insert(filaSuelta(path, f, meta)).select(COLUMNAS_156);
      const fila = (data as EstimadoDeCompetencia[] | null)?.[0];
      if (error || !fila) {
        // Sin su fila, el archivo no se ve en ningún sitio y solo ocupa cuota: se retira.
        await cubo().remove([path]).catch(() => undefined);
        return error ? { ok: false, sinTabla: faltaLa156(error), error: error.message ?? "error" } : { ok: false, sinTabla: false, error: "0 rows" };
      }
      return { ok: true, valor: fila };
    },

    async quitar(a) {
      // Primero el archivo: si fallara después la fila, queda una fila que no abre; al revés quedaría un
      // archivo invisible gastando cuota. Un `remove` que la política no deja pasar vuelve SIN error y
      // con la lista vacía: eso no es «quitado».
      const { data: quitados, error: eCubo } = await cubo().remove([a.path]);
      if (eCubo) return falla(eCubo);
      if (!quitados?.length) return { ok: false, sinTabla: false, error: "0 files removed" };
      const { data, error } = await supabase.from("estimator_competitor_files").delete().eq("id", a.id).select("id");
      if (error) return falla(error);
      if (!(data as unknown[] | null)?.length) return { ok: false, sinTabla: false, error: "0 rows" };
      return { ok: true, valor: null };
    },
  };
}
