/**
 * Descargar TODAS las fotos de las mermas marcadas en un solo .zip (pedido del dueño: «click multiple and download all
 * scrap pics at once»). Se divide en:
 *   - funciones PURAS (nombres dentro del zip, plan, límites) — con prueba;
 *   - `juntarFotosEnZip`: baja las fotos (4 a la vez), salta las que fallan y arma el zip. El acceso al almacenamiento
 *     entra como función (`firmar`), así no depende del cliente de Supabase.
 *
 * Nombre dentro del zip: `<fecha reportada YYYY-MM-DD>_<código del producto o no-code>_<folio>_<n>.<ext>`, con todo lo
 * que no sea [A-Za-z0-9._-] convertido en «-».
 */
import { diaEnTexas } from "./fecha-del-dano";
import { folioCorto } from "./etapas";
import { zipSinComprimir } from "../zip-sin-comprimir";

/** Lo que hace falta de cada reporte para nombrar sus fotos. */
export interface ReporteConFotos {
  id: string;
  created_at: string;
  product_sku: string | null;
  photos: readonly string[] | null | undefined;
}

export const MAX_FOTOS_EN_ZIP = 300;
export const MAX_BYTES_EN_ZIP = 400 * 1024 * 1024;
export const CONCURRENCIA_DE_FOTOS = 4;
const EXTENSIONES = ["jpg", "jpeg", "png", "webp", "pdf"] as const;

/** Deja solo [A-Za-z0-9._-]: lo demás (espacios, acentos, barras) pasa a «-». */
export function sanitizaParaZip(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]/g, "-");
}

/** La extensión de la ruta de la foto, en minúscula (solo las conocidas; si no, jpg). */
export function extensionDeFoto(ruta: string): string {
  const m = /\.([A-Za-z0-9]+)$/.exec(ruta);
  const ext = m ? m[1].toLowerCase() : "";
  return (EXTENSIONES as readonly string[]).includes(ext) ? ext : "jpg";
}

/** El nombre de una foto dentro del zip. `n` es su número dentro del reporte (1 = primera). */
export function nombreDeFotoEnZip(r: Pick<ReporteConFotos, "id" | "created_at" | "product_sku">, n: number, ruta: string): string {
  const fecha = diaEnTexas(r.created_at);
  const codigo = r.product_sku?.trim() ? r.product_sku.trim() : "no-code";
  return sanitizaParaZip(`${fecha}_${codigo}_${folioCorto(r.id)}_${n}.${extensionDeFoto(ruta)}`);
}

export interface FotoPlaneada {
  reporteId: string;
  ruta: string;
  nombre: string;
}

/** Todas las fotos de los reportes (en su orden), con su nombre dentro del zip. Los reportes sin fotos no aportan nada. */
export function planDeFotos(reportes: readonly ReporteConFotos[]): FotoPlaneada[] {
  const out: FotoPlaneada[] = [];
  for (const r of reportes) {
    (r.photos ?? []).forEach((ruta, i) => {
      if (!ruta) return;
      out.push({ reporteId: r.id, ruta, nombre: nombreDeFotoEnZip(r, i + 1, ruta) });
    });
  }
  return out;
}

/** Cuántos reportes traen al menos una foto (es el N del botón). */
export function reportesConFotos(reportes: readonly Pick<ReporteConFotos, "photos">[]): number {
  return reportes.filter((r) => (r.photos ?? []).length > 0).length;
}

export type ResultadoDeZip =
  | { estado: "sin-fotos" }
  | { estado: "demasiadas"; total: number }
  | { estado: "demasiado-pesado"; bytes: number }
  | { estado: "ok"; zip: Uint8Array; incluidas: number; omitidas: number; nombre: string };

/** Nombre del archivo que se baja: `scrap-photos-<YYYY-MM-DD>.zip` (día en Texas). */
export function nombreDelZip(hoy: string): string {
  return `scrap-photos-${hoy}.zip`;
}

/**
 * Baja las fotos y arma el zip. Nunca falla por una sola foto: la que no baja (o no tiene enlace) se cuenta como
 * omitida. Si el total pasa de los límites, para antes de bajar (o al pasar los bytes) y lo dice en el resultado.
 */
export async function juntarFotosEnZip(opts: {
  reportes: readonly ReporteConFotos[];
  /** Enlaces temporales por ruta (las que no se pudieron firmar no vienen en el mapa). */
  firmar: (rutas: string[]) => Promise<Record<string, string>>;
  /** Descarga un enlace; por defecto `fetch`. */
  bajar?: (url: string) => Promise<Response>;
  onProgreso?: (hechas: number, total: number) => void;
  hoy: string;
  maxFotos?: number;
  maxBytes?: number;
}): Promise<ResultadoDeZip> {
  const plan = planDeFotos(opts.reportes);
  const maxFotos = opts.maxFotos ?? MAX_FOTOS_EN_ZIP;
  const maxBytes = opts.maxBytes ?? MAX_BYTES_EN_ZIP;
  if (plan.length === 0) return { estado: "sin-fotos" };
  if (plan.length > maxFotos) return { estado: "demasiadas", total: plan.length };

  const enlaces = await opts.firmar([...new Set(plan.map((f) => f.ruta))]);
  const bajar = opts.bajar ?? ((url: string) => fetch(url));
  const bytesPorFoto: (Uint8Array | null)[] = new Array(plan.length).fill(null);
  let hechas = 0;
  let bytes = 0;
  let pasado = false;
  let siguiente = 0;

  const trabajador = async () => {
    while (!pasado) {
      const i = siguiente++;
      if (i >= plan.length) return;
      const f = plan[i];
      const url = enlaces[f.ruta];
      try {
        if (!url) throw new Error("sin enlace");
        const res = await bajar(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const datos = new Uint8Array(await res.arrayBuffer());
        bytes += datos.length;
        if (bytes > maxBytes) { pasado = true; return; }
        bytesPorFoto[i] = datos;
      } catch {
        bytesPorFoto[i] = null; // una foto que falla se omite; no detiene la descarga
      }
      hechas++;
      opts.onProgreso?.(hechas, plan.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCIA_DE_FOTOS, plan.length) }, trabajador));
  if (pasado) return { estado: "demasiado-pesado", bytes };

  const entradas = plan.flatMap((f, i) => {
    const datos = bytesPorFoto[i];
    return datos ? [{ nombre: f.nombre, datos }] : [];
  });
  const omitidas = plan.length - entradas.length;
  if (entradas.length === 0) return { estado: "sin-fotos" };
  return {
    estado: "ok",
    zip: zipSinComprimir(entradas),
    incluidas: entradas.length,
    omitidas,
    nombre: nombreDelZip(opts.hoy),
  };
}
