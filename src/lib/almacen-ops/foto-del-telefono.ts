/**
 * D-917: leer la foto que da el teléfono (cámara o galería) sin que falle en silencio.
 *
 * Roberto, 2026-11-07, tras la primera merma de Baudelio con el formulario nuevo (D-914): «cuando la estaba haciendo,
 * no lo deja poner la foto. La tiene que [escoger] del carrete». La cámara del asistente no servía; la galería sí.
 * Lo que había: UN `<input capture="environment">` y `createImageBitmap(file)` a secas. Si la cámara no abría (la app
 * de Android sin el permiso de cámara), o el fichero llegaba vacío, o el navegador no decodificaba la foto (HEIC de
 * iPhone, foto enorme), no se veía nada o salía «no se pudo leer» sin decir por qué.
 *
 * Aquí está lo que no necesita React y se prueba en Node:
 *   1. `leerFotoDelTelefono`: lee los BYTES primero (`arrayBuffer`), antes de que se vacíe el `<input>` o se vuelva a
 *      pintar la pantalla; descarta el fichero vacío; adivina el tipo por los bytes (HEIC tiene aviso propio); decodifica
 *      con `createImageBitmap` y, si falla, con `<img>`; comprime a JPEG con `jpegComprimido` y saca la huella SHA-256.
 *   2. `mensajeDeFotoFallida`: el aviso que se enseña, por motivo y en los dos idiomas.
 *   3. `detalleParaConsola`: una línea para `console.error` con el aparato (user agent), para saber qué falló la próxima.
 *   4. `AVISO_SI_NO_ABRIO_LA_CAMARA`: el aviso cuando el `<input>` de la cámara se cierra sin foto (`cancel`), que en la
 *      app de Android es lo que pasa si negaron el permiso de cámara.
 *
 * Los componentes: `BotonesDeFoto` (`src/app/operaciones/BotonesDeFoto.tsx`), dos botones —«📷 Tomar foto» con `capture`
 * y «🖼 Elegir de la galería» sin él— que llaman al mismo `agrega(file)`.
 */
import { jpegComprimido } from "@/lib/camara-de-varias-fotos";
import { hashDeDataUrl } from "./fotos";

export type Lang = "en" | "es";

/**
 * Reunión 12 nov («en Android la cámara no abre»). La causa: la cáscara de Android (APK ≤ 8, `targetSdk` 34) no declara
 * `<queries>` para `android.media.action.IMAGE_CAPTURE`, así que en Android 11+ Capacitor pregunta «¿hay app de
 * cámara?» (`resolveActivity`), el sistema contesta que no (visibilidad de paquetes) y cae, SIN AVISAR, al selector de
 * archivos: «📷 Tomar foto» abría la galería. El permiso de cámara (D-917, D-923) no tenía que ver.
 *
 * El manifiesto ya lleva el `<queries>` y sale en la APK 9. Mientras tanto —y en los teléfonos que tarden en
 * actualizar— dentro de una APK anterior «Tomar foto» abre la cámara DENTRO de la app (`getUserMedia`), que sí funciona.
 */
export const APK_CON_CAMARA_DEL_FORMULARIO = 9;

/** ¿«Tomar foto» debe abrir la cámara de dentro de la app en vez del `<input capture>`? Solo en una APK vieja. */
export function usaCamaraDentroDeLaApp(userAgent: string | null | undefined, hayCamaraEnVivo: boolean): boolean {
  const m = /RDZDeliveries\/(\d+)/.exec(userAgent ?? "");
  if (!m) return false;
  return Number(m[1]) < APK_CON_CAMARA_DEL_FORMULARIO && hayCamaraEnVivo;
}

/** Una foto `data:image/jpeg;base64,…` (la de la cámara de dentro de la app) como `File`, para el mismo camino que el `<input>`. */
export function ficheroDeDataUrl(dataUrl: string, nombre = "camara.jpg"): File | null {
  const m = /^data:([^;,]+);base64,(.+)$/.exec(dataUrl);
  if (!m) return null;
  try {
    const crudo = atob(m[2]);
    const bytes = new Uint8Array(crudo.length);
    for (let i = 0; i < crudo.length; i++) bytes[i] = crudo.charCodeAt(i);
    return new File([bytes], nombre, { type: m[1] });
  } catch { return null; }
}

/** Por qué no se pudo usar la foto. */
export type MotivoDeFoto =
  /** El fichero llegó sin bytes (la cámara de Android a veces devuelve un fichero de 0 bytes). */
  | "vacia"
  /** Los bytes no son de una imagen que el navegador sepa abrir (HEIC/HEIF de iPhone). */
  | "heic"
  /** El navegador no pudo decodificarla (ni `createImageBitmap` ni `<img>`): foto rota, formato raro, o sin memoria. */
  | "no-decodifica"
  /** No se pudo leer el fichero (iOS lo quita del temporal; permiso de lectura). */
  | "no-se-lee";

export type FotoLeida =
  | { ok: true; jpg: string; huella: string; bytes: number; tipo: string; ancho: number; alto: number }
  | { ok: false; motivo: MotivoDeFoto; bytes: number; tipo: string; detalle: string };

/** Una imagen ya decodificada, lista para dibujar en un lienzo; `cerrar` suelta su memoria. */
export interface ImagenDecodificada { fuente: CanvasImageSource; ancho: number; alto: number; cerrar: () => void }

/** Lo que `leerFotoDelTelefono` necesita del navegador; en las pruebas se pasa falso. */
export interface Decodificador {
  decodificar: (blob: Blob) => Promise<ImagenDecodificada>;
  comprimir: (fuente: CanvasImageSource, ancho: number, alto: number) => string;
  huella: (dataUrl: string) => Promise<string>;
}

/** El tipo MIME por los primeros bytes: lo que dice `file.type` a veces viene vacío (la cámara de Android). */
export function tipoPorLosBytes(bytes: Uint8Array): string {
  const b = bytes;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  if (b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return "image/webp";
  if (b.length >= 12 && ascii(b, 4, 4) === "ftyp") {
    const marca = ascii(b, 8, 4);
    if (/^(heic|heix|hevc|hevx|mif1|msf1)$/.test(marca)) return "image/heic";
    if (/^(avif|avis)$/.test(marca)) return "image/avif";
  }
  return "";
}

function ascii(b: Uint8Array, desde: number, n: number): string {
  let s = "";
  for (let i = desde; i < desde + n && i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
}

/** ¿Es HEIC/HEIF (lo que da un iPhone con «Alta eficiencia»)? Por el nombre o por los bytes. */
export function esHeic(nombre: string, tipo: string): boolean {
  return /image\/hei[cf]/i.test(tipo) || /\.hei[cf]$/i.test(nombre);
}

/** `createImageBitmap` y, si no está o falla, `<img>` con un `object URL`. Solo en el navegador. */
export async function decodificarEnElNavegador(blob: Blob): Promise<ImagenDecodificada> {
  if (typeof createImageBitmap === "function") {
    try {
      const img = await createImageBitmap(blob);
      if (img.width > 0 && img.height > 0) return { fuente: img, ancho: img.width, alto: img.height, cerrar: () => img.close() };
      img.close();
    } catch {
      // Sigue con <img>: Safari y los WebView viejos saben abrir fotos que createImageBitmap rechaza.
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    if (typeof img.decode === "function") await img.decode();
    else await new Promise<void>((ok, mal) => { img.onload = () => ok(); img.onerror = () => mal(new Error("img onerror")); });
    if (!(img.naturalWidth > 0 && img.naturalHeight > 0)) throw new Error("img sin medidas");
    return { fuente: img, ancho: img.naturalWidth, alto: img.naturalHeight, cerrar: () => { img.src = ""; URL.revokeObjectURL(url); } };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

const DEL_NAVEGADOR: Decodificador = { decodificar: decodificarEnElNavegador, comprimir: jpegComprimido, huella: hashDeDataUrl };

function texto(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  return String(e);
}

/**
 * Lee la foto del `<input>` hasta dejarla como `data:` JPEG comprimido con su huella. Nunca lanza: devuelve el motivo.
 * Los bytes se leen ANTES de nada (y de que el que llama vacíe el `<input>`): a partir de ahí el fichero ya no hace falta.
 */
export async function leerFotoDelTelefono(f: File, deps: Decodificador = DEL_NAVEGADOR): Promise<FotoLeida> {
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await f.arrayBuffer());
  } catch (e) {
    return { ok: false, motivo: "no-se-lee", bytes: f.size, tipo: f.type, detalle: texto(e) };
  }
  const tipo = tipoPorLosBytes(bytes) || f.type || "";
  if (bytes.length === 0) return { ok: false, motivo: "vacia", bytes: 0, tipo, detalle: "0 bytes" };
  let img: ImagenDecodificada | null = null;
  try {
    img = await deps.decodificar(new Blob([bytes as BlobPart], { type: tipo || "application/octet-stream" }));
    const jpg = deps.comprimir(img.fuente, img.ancho, img.alto);
    const huella = await deps.huella(jpg);
    return { ok: true, jpg, huella, bytes: bytes.length, tipo, ancho: img.ancho, alto: img.alto };
  } catch (e) {
    const heic = esHeic(f.name, tipo) || tipo === "image/heic";
    return { ok: false, motivo: heic ? "heic" : "no-decodifica", bytes: bytes.length, tipo, detalle: texto(e) };
  } finally {
    try { img?.cerrar(); } catch { /* ya cerrada */ }
  }
}

/** El aviso que ve la persona. `puedeSaltar`: cuando la foto no es obligatoria, se dice que puede seguir sin ella. */
export function mensajeDeFotoFallida(motivo: MotivoDeFoto, lang: Lang, puedeSaltar = false): string {
  const es = lang === "es";
  let m: string;
  switch (motivo) {
    case "vacia":
      m = es ? "La foto llegó vacía. Vuelve a tomarla, o elígela de la galería." : "The photo came back empty. Take it again, or choose it from the gallery.";
      break;
    case "heic":
      m = es
        ? "Esa foto está en HEIC (formato de iPhone) y este navegador no la abre. Tómala otra vez con la cámara, o en Ajustes › Cámara › Formatos elige «Más compatible»."
        : "That photo is HEIC (iPhone format) and this browser cannot open it. Take it again with the camera, or set Settings › Camera › Formats to “Most compatible”.";
      break;
    case "no-se-lee":
      m = es ? "No se pudo leer la foto. Vuelve a tomarla." : "Could not read the photo. Take it again.";
      break;
    default:
      m = es ? "No se pudo abrir esa foto. Vuelve a tomarla, o elige otra de la galería." : "Could not open that photo. Take it again, or choose another from the gallery.";
  }
  if (puedeSaltar) m += es ? " O toca Siguiente para saltarla." : " Or tap Next to skip it.";
  return m;
}

/**
 * Cuando el `<input>` de la cámara se cierra sin foto. En un teléfono normal es que cancelaron; en la app de Android es
 * también lo que pasa si negaron el permiso de cámara (la app no abre nada y no dice por qué). Un aviso suave: no bloquea.
 */
export const AVISO_SI_NO_ABRIO_LA_CAMARA = {
  en: "No photo came back. If the camera did not open, allow the camera for this app (Settings › Apps › RTG Hub › Permissions) or choose the photo from the gallery.",
  es: "No llegó ninguna foto. Si la cámara no abrió, permite la cámara a esta app (Ajustes › Aplicaciones › RTG Hub › Permisos) o elige la foto de la galería.",
} as const;

/** Una línea para `console.error`: lo que hace falta para saber qué pasó en ese teléfono, sin la foto. */
export function detalleParaConsola(
  x: { motivo: MotivoDeFoto; bytes: number; tipo: string; detalle: string },
  f: { name: string; size: number; type: string },
  ua: string,
  origen: "camara" | "galeria" | "desconocido" = "desconocido",
): string {
  return `[merma/foto] ${x.motivo} · origen=${origen} · fichero="${f.name}" ${f.size} B type="${f.type}" · bytes=${x.bytes} tipo=${x.tipo || "?"} · ${x.detalle} · ua=${ua}`;
}
