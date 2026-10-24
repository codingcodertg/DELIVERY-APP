/**
 * Los archivos de un cliente (D-NEXT, migración 195). Roberto Rodriguez Jr (admin), 2026-10-24: «Need to be able to attach
 * files like No Sales Tax Form» y «it can vary by store bc each store needs the form signed if they want to apply».
 *
 * Cada archivo es de una FILA (una tienda, D-633): el formulario firmado para Pharr no vale para McAllen. Viven en el cubo
 * privado `customer-files`, en `<id de la fila>/<sello>-<nombre>`, y su fila en `erp.customer_files`. Se abren con un
 * enlace firmado de una hora. Puro, sin navegador: lo prueba `archivos.test.ts`.
 */
export const CUBO_DE_ARCHIVOS = "customer-files";
/** El tope del cubo (la 195): 25 MB. Se dice antes de subir, no después de esperar. */
export const MAX_BYTES_DE_ARCHIVO = 25 * 1024 * 1024;

export const CLASES_DE_ARCHIVO = ["no_sales_tax", "other"] as const;
export type ClaseDeArchivo = (typeof CLASES_DE_ARCHIVO)[number];

export interface ArchivoDeCliente {
  id: number;
  customer_id: number;
  kind: ClaseDeArchivo;
  name: string;
  path: string;
  size_bytes: number | null;
  content_type: string | null;
  uploaded_at: string | null;
}

type T = (en: string, es: string) => string;

export function claseDeArchivoLabel(k: string, t: T): string {
  return k === "no_sales_tax" ? t("No sales tax form", "Formulario de exención de impuesto") : t("Other", "Otro");
}

/** El nombre del archivo tal y como se guarda en el cubo: sin carpetas, sin espacios ni acentos raros, y no más de 100. */
export function nombreSeguro(nombre: string): string {
  const base = (nombre.split(/[\\/]/).pop() ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "");
  const limpio = base.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/_+/g, "_").replace(/^[._]+/, "");
  return (limpio || "archivo").slice(-100);
}

/** Dónde va en el cubo: la carpeta de su fila, con un sello para que dos archivos con el mismo nombre no se pisen. */
export function rutaDeArchivo(clienteId: number, nombre: string, ahora: Date, azar: string): string {
  const sello = ahora.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  return `${clienteId}/${sello}-${azar.slice(0, 8)}-${nombreSeguro(nombre)}`;
}

/** Lo de la base, con la forma de la pantalla. Una clase que no es de las dos, «Otro». */
export function archivoDeLaBase(f: Record<string, unknown>): ArchivoDeCliente {
  const kind = String(f.kind ?? "");
  return {
    id: Number(f.id), customer_id: Number(f.customer_id),
    kind: (CLASES_DE_ARCHIVO as readonly string[]).includes(kind) ? (kind as ClaseDeArchivo) : "other",
    name: String(f.name ?? ""), path: String(f.path ?? ""),
    size_bytes: typeof f.size_bytes === "number" ? f.size_bytes : f.size_bytes != null && f.size_bytes !== "" ? Number(f.size_bytes) : null,
    content_type: typeof f.content_type === "string" ? f.content_type : null,
    uploaded_at: typeof f.uploaded_at === "string" ? f.uploaded_at : null,
  };
}

/**
 * ¿Falta el formulario? Una tienda marcada «exenta» sin un «Formulario de exención» adjunto en ESA fila. El dueño: cada
 * tienda necesita el suyo firmado para que aplique.
 */
export function faltaElFormulario(fila: { id: number; tax_terms?: string | null }, archivos: readonly Pick<ArchivoDeCliente, "customer_id" | "kind">[]): boolean {
  return fila.tax_terms === "exempt" && !archivos.some((a) => a.customer_id === fila.id && a.kind === "no_sales_tax");
}

/** «1.2 MB», «340 KB». */
export function tamanoLegible(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
