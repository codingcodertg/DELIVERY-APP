/**
 * Adjuntos de una orden (migración 204). Carlos Fuentes (oficina): «you can't copy and paste...example, i tried copying
 * an invoice on quickbooks and attach it on the app». La orden lleva documentos (la factura en PDF, una captura) que se
 * pegan (Ctrl+V / Cmd+V), se arrastran o se eligen. Viven en el cubo privado `delivery-files`, en
 * `<id de la orden>/<sello>-<azar>-<nombre>`, con su fila en `public.delivery_files`; se abren con un enlace firmado.
 *
 * Lo puro (qué trae el portapapeles, si el pegado es nuestro, si el fichero vale) lo prueba `adjuntos-de-orden.test.ts`.
 */
import { nombreSeguro, tamanoLegible } from "@/lib/customers/archivos";

export { tamanoLegible };
export const CUBO_DE_ADJUNTOS = "delivery-files";
/** El tope del cubo (la 204): 25 MB, como los archivos de Clientes. */
export const MAX_BYTES_DE_ADJUNTO = 25 * 1024 * 1024;
/** PDF, imágenes y los documentos de oficina de siempre (la lista de la ayuda, LIMITES_DE_ADJUNTOS). La 204 la impone. */
export const TIPOS_DE_ADJUNTO = [
  "application/pdf",
  "image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv", "text/plain",
] as const;
const EXTENSIONES = ["pdf", "jpg", "jpeg", "png", "webp", "gif", "heic", "heif", "doc", "docx", "xls", "xlsx", "csv", "txt"];

export interface AdjuntoDeOrden {
  id: string;
  delivery_id: string;
  name: string;
  path: string;
  size: number | null;
  content_type: string | null;
  created_at: string | null;
}

type T = (en: string, es: string) => string;
type FicheroMin = { name: string; size: number; type: string };

/** Lo que el portapapeles o el arrastre traen, con la forma mínima de un DataTransfer. */
export interface TransferenciaMin {
  files?: ArrayLike<File> | null;
  items?: ArrayLike<{ kind: string; type: string; getAsFile(): File | null }> | null;
  types?: ArrayLike<string> | null;
}

/**
 * Los ficheros de un pegado o un arrastre. `files` trae lo copiado en el Explorador/Finder; una captura de pantalla llega
 * solo como `items` de clase «file» en algunos navegadores. Se juntan sin repetir (el mismo objeto puede venir por los dos).
 * Una captura pegada se llama «image.png» en todos: se renombra con la hora para que dos no se confundan en la lista.
 */
export function ficherosDeLaTransferencia(dt: TransferenciaMin | null | undefined, ahora: Date = new Date()): File[] {
  if (!dt) return [];
  const salida: File[] = [];
  const visto = (f: File) => salida.some((x) => x === f || (x.name === f.name && x.size === f.size && x.type === f.type));
  for (const f of Array.from(dt.files ?? [])) if (f && !visto(f)) salida.push(f);
  for (const it of Array.from(dt.items ?? [])) {
    if (it.kind !== "file") continue;
    const f = it.getAsFile();
    if (f && !visto(f)) salida.push(f);
  }
  return salida.map((f) => (esCapturaSinNombre(f) ? renombra(f, nombreDeCaptura(f.type, ahora)) : f));
}

function esCapturaSinNombre(f: FicheroMin): boolean {
  return f.type.startsWith("image/") && (!f.name || /^image\.(png|jpe?g|gif|webp)$/i.test(f.name));
}
function renombra(f: File, nombre: string): File {
  try { return new File([f], nombre, { type: f.type, lastModified: f.lastModified }); } catch { return f; }
}
/** «screenshot-20261026-143005.png». */
export function nombreDeCaptura(tipo: string, ahora: Date): string {
  const ext = tipo === "image/jpeg" ? "jpg" : (tipo.split("/")[1] || "png").replace(/[^a-z0-9]/gi, "") || "png";
  const p = (n: number) => String(n).padStart(2, "0");
  return `screenshot-${ahora.getFullYear()}${p(ahora.getMonth() + 1)}${p(ahora.getDate())}-${p(ahora.getHours())}${p(ahora.getMinutes())}${p(ahora.getSeconds())}.${ext}`;
}

/** ¿El foco está donde se escribe? Ahí el pegado de texto es del campo, no nuestro. */
export function esCampoDeTexto(el: { tagName?: string; isContentEditable?: boolean; type?: string } | null | undefined): boolean {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = (el.tagName ?? "").toUpperCase();
  if (tag === "TEXTAREA") return true;
  if (tag !== "INPUT") return false;
  const tipo = (el.type ?? "text").toLowerCase();
  return !["button", "checkbox", "radio", "file", "submit", "reset", "range", "color", "image"].includes(tipo);
}

/**
 * Qué hacer con un pegado. Sin ficheros, nada: el texto va donde vaya (un campo, o a ningún sitio). Con ficheros, se
 * adjuntan siempre; y solo se cancela el pegado normal si el foco NO está en un campo de texto (en un campo, se deja
 * pasar: si el portapapeles trae además texto, el campo lo recibe — no se le quita a nadie lo que esperaba pegar).
 */
export function decisionAlPegar(nFicheros: number, focoEnCampo: boolean): { adjunta: boolean; cancela: boolean } {
  if (nFicheros === 0) return { adjunta: false, cancela: false };
  return { adjunta: true, cancela: !focoEnCampo };
}

/** ¿Vale este fichero? null si sí; si no, el motivo para enseñar. */
export function problemaDeAdjunto(f: FicheroMin, t: T): string | null {
  if (f.size <= 0) return t(`«${f.name}» is empty.`, `«${f.name}» está vacío.`);
  if (f.size > MAX_BYTES_DE_ADJUNTO) return t(`«${f.name}» is over 25 MB.`, `«${f.name}» pasa de 25 MB.`);
  const ext = (f.name.split(".").pop() ?? "").toLowerCase();
  const tipoOk = f.type ? (TIPOS_DE_ADJUNTO as readonly string[]).includes(f.type) : EXTENSIONES.includes(ext);
  if (!tipoOk) return t(`«${f.name}»: only PDF, images and Office documents.`, `«${f.name}»: solo PDF, imágenes y documentos de Office.`);
  return null;
}

/** Dónde va en el cubo: la carpeta de su orden (la política del cubo mira esa carpeta), con sello para no pisarse. */
export function rutaDeAdjunto(deliveryId: string, nombre: string, ahora: Date, azar: string): string {
  const sello = ahora.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  return `${deliveryId}/${sello}-${azar.replace(/[^A-Za-z0-9]/g, "").slice(0, 8)}-${nombreSeguro(nombre)}`;
}

export function adjuntoDeLaBase(f: Record<string, unknown>): AdjuntoDeOrden {
  return {
    id: String(f.id ?? ""), delivery_id: String(f.delivery_id ?? ""),
    name: String(f.name ?? ""), path: String(f.path ?? ""),
    size: f.size == null || f.size === "" ? null : Number(f.size),
    content_type: typeof f.content_type === "string" ? f.content_type : null,
    created_at: typeof f.created_at === "string" ? f.created_at : null,
  };
}

/** Sin la 204 aplicada: la tabla no existe (PostgREST o Postgres). */
export function faltaLaTablaDeAdjuntos(error: { code?: string | null } | null | undefined): boolean {
  const code = error?.code ?? "";
  return code === "PGRST205" || code === "42P01";
}

export type ResAdj<V> = { ok: true; valor: V } | { ok: false; sinTabla: boolean; error: string };

/* eslint-disable @typescript-eslint/no-explicit-any */
/** El almacén contra Supabase. `sb` es el cliente del navegador (`createClient()`), con la sesión de quien mira. */
export function almacenDeAdjuntos(sb: any) {
  const COLS = "id, delivery_id, name, path, size, content_type, created_at";
  const fallo = (error: { code?: string; message: string }): { ok: false; sinTabla: boolean; error: string } =>
    ({ ok: false, sinTabla: faltaLaTablaDeAdjuntos(error), error: error.message });
  return {
    async lista(deliveryId: string): Promise<ResAdj<AdjuntoDeOrden[]>> {
      const { data, error } = await sb.from("delivery_files").select(COLS).eq("delivery_id", deliveryId).order("created_at", { ascending: false }).range(0, 199);
      if (error) return fallo(error);
      return { ok: true, valor: (data ?? []).map((f: Record<string, unknown>) => adjuntoDeLaBase(f)) };
    },
    async sube(deliveryId: string, fichero: File): Promise<ResAdj<AdjuntoDeOrden>> {
      const path = rutaDeAdjunto(deliveryId, fichero.name, new Date(), crypto.randomUUID());
      const cubo = sb.storage.from(CUBO_DE_ADJUNTOS);
      const subido = await cubo.upload(path, fichero, { contentType: fichero.type || undefined, upsert: false });
      if (subido.error) return { ok: false, sinTabla: false, error: subido.error.message };
      const { data, error } = await sb.from("delivery_files")
        .insert({ delivery_id: deliveryId, name: fichero.name, path, size: fichero.size, content_type: fichero.type || null })
        .select(COLS).maybeSingle();
      if (error || !data) {
        await cubo.remove([path]);
        return error ? fallo(error) : { ok: false, sinTabla: false, error: "not saved" };
      }
      return { ok: true, valor: adjuntoDeLaBase(data) };
    },
    async quita(a: AdjuntoDeOrden): Promise<ResAdj<null>> {
      // `.select("id")`: un DELETE de cero filas (RLS) vuelve limpio; sin fila borrada no se toca el cubo.
      const { data, error } = await sb.from("delivery_files").delete().eq("id", a.id).select("id");
      if (error) return fallo(error);
      if (!data?.length) return { ok: false, sinTabla: false, error: "not removed (no permission?)" };
      await sb.storage.from(CUBO_DE_ADJUNTOS).remove([a.path]);
      return { ok: true, valor: null };
    },
    async enlace(a: AdjuntoDeOrden): Promise<ResAdj<string>> {
      const { data, error } = await sb.storage.from(CUBO_DE_ADJUNTOS).createSignedUrl(a.path, 3600);
      if (error || !data?.signedUrl) return { ok: false, sinTabla: false, error: error?.message ?? "no link" };
      return { ok: true, valor: data.signedUrl };
    },
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
