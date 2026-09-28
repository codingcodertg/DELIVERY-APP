import type { SupabaseClient } from "@supabase/supabase-js";
import { nombreSaneado } from "@/lib/help-attachments";
import { faltaLaTabla, type Resultado } from "./almacen";

/**
 * El estimado de la competencia (D-NEXT, hija de T-0408): el vendedor sube el PDF o la foto del
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
  /** PDF y fotos. La lista que manda es la del cubo; esta es la misma, para avisar antes. */
  tipos: ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"] as string[],
} as const;

/** Lo que acepta el `<input type="file">`: las extensiones de HEIC van aparte porque Windows no les da tipo. */
export const ACCEPT_DE_COMPETENCIA = "application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,.pdf,.jpg,.jpeg,.png,.webp,.heic,.heif";

export const TOPES_DE_TEXTO = { competidor: 120, nota: 500 } as const;

export interface ArchivoDeCompetencia {
  id: string;
  quote_id: string;
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

// ---- dónde se guarda -------------------------------------------------------------------------------

export interface AlmacenDeCompetencia {
  /** Si la 153 está: una lectura vacía. Sin ella, `sinTabla`. */
  disponible(): Promise<Resultado<null>>;
  listar(quoteId: string): Promise<Resultado<ArchivoDeCompetencia[]>>;
  subir(quoteId: string, f: File, meta: MetaDeCompetencia): Promise<Resultado<ArchivoDeCompetencia>>;
  /** Una URL para abrir el archivo: firmada y de un minuto en la base; de objeto en el demo. */
  abrir(a: ArchivoDeCompetencia): Promise<Resultado<string>>;
  quitar(a: ArchivoDeCompetencia): Promise<Resultado<null>>;
}

type ErrorDeCompetencia = { code?: string | null; message?: string | null } | null;
function falla<T>(error: ErrorDeCompetencia): Resultado<T> {
  return { ok: false, sinTabla: faltaLaBaseDeCompetencia(error), error: error?.message ?? "error" };
}

const COLUMNAS = "id, quote_id, path, file_name, mime_type, size_bytes, competitor, competitor_total, note, uploaded_by, uploaded_by_name, uploaded_at";

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
