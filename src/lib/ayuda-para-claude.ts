import { textoDelDispositivo, ubicacionDeSolicitud } from "@/lib/ayuda-ubicacion";
import type { FicheroAdjunto } from "./help-attachments";
import type { SolicitudDeAyuda } from "./help-requests";
import type { MensajeDeAyuda } from "./help-thread";
import { RUTA_SOLICITUDES_ADMIN } from "./help-thread";
import { formateadorDeFecha } from "./formateador";

/**
 * «Copiar para Claude»: una solicitud de ayuda lista para pegarla en Claude (D-844).
 *
 * El dueño, sobre el correo de ayuda con la captura: lo necesita mandar a Claude para arreglar el problema, y quiere
 * que copiar el texto y la imagen sea UNA acción y pegar no pida pasos de más, y que la foto se descargue sola.
 *
 * Aquí vive lo que se decide sin navegador —el texto, el HTML, los nombres de descarga, qué adjunto es imagen, el
 * enlace del correo—, para que se pueda probar. El portapapeles, el lienzo y la descarga viven en la pantalla
 * (`src/app/home/solicitudes-de-ayuda/[id]/copiar/page.tsx`), que es lo que no se puede medir en vitest.
 *
 * **El texto va en español** (el dueño le escribe a Claude en español); **el mensaje va tal cual** lo escribió la
 * persona, sin traducir ni arreglar.
 */

/** La pantalla de copiar, relativa: el admin la abre desde el correo o desde la bandeja. */
export function rutaParaCopiar(id: string): string {
  return `${RUTA_SOLICITUDES_ADMIN}/${encodeURIComponent(id)}/copiar`;
}

/** El enlace absoluto que lleva el correo. `origen` es `origenPublico(req.url)`: el dominio de producción en Vercel. */
export function enlaceParaCopiar(origen: string, id: string): string {
  return `${origen.replace(/\/+$/, "")}${rutaParaCopiar(id)}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** ¿Esto puede ser el id de una solicitud? Lo que no lo sea no llega a la base. */
export function esIdDeSolicitud(id: string | null | undefined): id is string {
  return !!id && UUID.test(id);
}

/** Los ocho primeros caracteres del id: bastan para distinguir una descarga de otra. */
export function idCorto(id: string): string {
  return id.replace(/[^0-9a-z]/gi, "").slice(0, 8).toLowerCase() || "solicitud";
}

/** La extensión del nombre (o de la ruta), en minúsculas y sin punto; `""` si no tiene. */
export function extensionDe(nombre: string): string {
  const base = (nombre || "").split(/[\\/]/).pop() ?? "";
  const i = base.lastIndexOf(".");
  if (i <= 0 || i === base.length - 1) return "";
  return base.slice(i + 1).toLowerCase();
}

/** Lo que se considera captura: fotos que un navegador o Claude saben abrir. HEIC entra (se descarga), aunque
 *  Chrome no lo sepa pintar en el lienzo; la pantalla lo dice si no puede copiarlo. */
const EXTENSIONES_DE_IMAGEN = ["png", "jpg", "jpeg", "webp", "gif", "heic", "heif"];

/** ¿Este adjunto es una imagen? Se mira el nombre elegido y, si no dice nada, la clave del cubo. */
export function esImagen(a: Pick<FicheroAdjunto, "path" | "nombre">): boolean {
  const ext = extensionDe(a.nombre) || extensionDe(a.path);
  return EXTENSIONES_DE_IMAGEN.includes(ext);
}

/** Las imágenes del hilo entero, en orden: primero las de la solicitud, después las de cada mensaje. */
export function imagenesDelHilo(hilo: readonly Pick<MensajeDeAyuda, "files">[]): FicheroAdjunto[] {
  const vistas = new Set<string>();
  const fuera: FicheroAdjunto[] = [];
  for (const m of hilo) {
    for (const a of m.files ?? []) {
      if (!a || typeof a.path !== "string" || vistas.has(a.path) || !esImagen(a)) continue;
      vistas.add(a.path);
      fuera.push(a);
    }
  }
  return fuera;
}

/** Los adjuntos que NO son imagen (PDF, Excel…), para enseñarlos aparte con su botón de descargar. */
export function documentosDelHilo(hilo: readonly Pick<MensajeDeAyuda, "files">[]): FicheroAdjunto[] {
  const vistas = new Set<string>();
  const fuera: FicheroAdjunto[] = [];
  for (const m of hilo) {
    for (const a of m.files ?? []) {
      if (!a || typeof a.path !== "string" || vistas.has(a.path) || esImagen(a)) continue;
      vistas.add(a.path);
      fuera.push(a);
    }
  }
  return fuera;
}

/** `ayuda-<id corto>-<n>.<ext>`: el nombre con el que baja la captura número `n` (desde 1). */
export function nombreDeDescarga(id: string, n: number, original: Pick<FicheroAdjunto, "path" | "nombre">): string {
  const ext = (extensionDe(original.nombre) || extensionDe(original.path) || "png").replace(/^jpeg$/, "jpg");
  return `ayuda-${idCorto(id)}-${n}.${ext}`;
}

/** La fecha como la lee el dueño: hora del Centro (la del negocio), y el instante exacto detrás. */
export function fechaParaClaude(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const local = formateadorDeFecha("es-MX", {
    timeZone: "America/Chicago", year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(d);
  return `${local} (hora del Centro; ${d.toISOString()})`;
}

export type DatosParaClaude = {
  solicitud: Pick<SolicitudDeAyuda, "id" | "created_at" | "sender_name" | "sender_email" | "role_label" | "page" | "app_version" | "lang" | "message">
    & Pick<SolicitudDeAyuda, "location_en" | "location_es" | "device">;
  /** Los mensajes del hilo DESPUÉS de la solicitud (sin la original). */
  mensajes: readonly Pick<MensajeDeAyuda, "author_name" | "body" | "created_at">[];
  /** Cuántas capturas hay en total. */
  imagenes: number;
  /** Nombres de los documentos que no son imagen. */
  documentos?: readonly string[];
};

/** Quién la mandó, con su correo si lo hay. */
function remitente(s: DatosParaClaude["solicitud"]): string {
  const nombre = s.sender_name?.trim();
  const correo = s.sender_email?.trim();
  if (nombre && correo) return `${nombre} <${correo}>`;
  return nombre || correo || "(sin nombre)";
}

/** Lo que se dice de las capturas, según cuántas haya. */
function lineaDeCapturas(n: number): string | null {
  if (n <= 0) return null;
  if (n === 1) return "Te pego la captura de pantalla que mandó.";
  return `Mandó ${n} capturas de pantalla: te pego la primera; las demás van aparte o las bajas por el id.`;
}

/**
 * El texto que se pega en Claude. Una instrucción corta, los datos de contexto, el mensaje entero tal cual, la
 * conversación si la hubo, y el id para poder volver a ella.
 */
export function textoParaClaude(d: DatosParaClaude): string {
  const s = d.solicitud;
  const lineas: (string | null)[] = [
    "Arregla este problema que reportaron en RTG Hub con el botón de Ayuda.",
    "",
    `De: ${remitente(s)}`,
    `Rol: ${s.role_label?.trim() || "—"}`,
    // Dónde estaba, con palabras (D-NEXT): la app, la pantalla y lo que tenía abierto. En una solicitud vieja sale de la ruta.
    `Dónde estaba: ${ubicacionDeSolicitud(s, "es")?.texto ?? "—"}`,
    `Página: ${s.page?.trim() || "—"}`,
    textoDelDispositivo(s.device, "es") ? `Dispositivo: ${textoDelDispositivo(s.device, "es")}` : null,
    `Versión de la app: ${s.app_version?.trim() || "—"}`,
    s.lang?.trim() ? `Idioma de la app: ${s.lang.trim()}` : null,
    `Fecha: ${fechaParaClaude(s.created_at)}`,
    `Id de la solicitud: ${s.id}`,
    "",
    "Mensaje (tal cual lo escribió):",
    s.message?.trim() ? s.message.trim() : "(sin texto, solo la captura)",
  ];
  const conversacion = d.mensajes.filter((m) => (m.body ?? "").trim());
  if (conversacion.length) {
    lineas.push("", "Conversación después de la solicitud:");
    for (const m of conversacion) {
      lineas.push(`— ${m.author_name?.trim() || "—"} (${fechaParaClaude(m.created_at)}):`, m.body.trim());
    }
  }
  if (d.documentos?.length) {
    lineas.push("", `Otros adjuntos (no imagen): ${d.documentos.join(", ")}`);
  }
  const capturas = lineaDeCapturas(d.imagenes);
  if (capturas) lineas.push("", capturas);
  return lineas.filter((l) => l !== null).join("\n");
}

/** Escapa lo que va dentro de HTML: el mensaje lo escribió una persona y puede llevar `<` o `&`. */
export function escapaHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** El texto en párrafos HTML: una línea en blanco separa párrafos; un salto suelto es un `<br>`. */
function parrafos(texto: string): string {
  return texto
    .split(/\n{2,}/)
    .map((p) => `<p>${escapaHtml(p).split("\n").join("<br>")}</p>`)
    .join("");
}

/**
 * El mismo texto en HTML, con la captura DENTRO (`data:` URL de un PNG). Es la parte `text/html` del portapapeles:
 * un editor rico que no acepta la imagen suelta se queda al menos con esta.
 */
export function htmlParaClaude(texto: string, imagenDataUrl: string | null): string {
  const imagen = imagenDataUrl && /^data:image\/(png|jpeg|webp|gif);base64,/.test(imagenDataUrl)
    ? `<p><img src="${imagenDataUrl}" alt="captura" style="max-width:100%;height:auto"></p>`
    : "";
  return `<div>${parrafos(texto)}${imagen}</div>`;
}

/**
 * La línea para Claude Code: allí las capturas se bajan por el id, así que no hace falta pegar nada más.
 */
export function textoParaClaudeCode(id: string, imagenes: number): string {
  const capturas = imagenes > 0 ? `; ${imagenes === 1 ? "su captura está" : `sus ${imagenes} capturas están`} en el cubo help-files` : "";
  return `Arregla la solicitud de ayuda ${id} de RTG Hub (léela con ayuda-lee.mjs${capturas})`;
}

// ---- El correo -------------------------------------------------------------------------------------------------

export type AdjuntoDelCorreo = { nombre: string; url: string | null };

/**
 * La parte HTML del correo de ayuda. Dice lo mismo que la de texto —el mensaje, quién, dónde, versión, enlaces— y
 * añade dos cosas que el texto no puede: el botón «📋 Copy for Claude» arriba, y las fotos adjuntas pintadas dentro
 * (con el mismo enlace firmado de 30 días que ya llevaba el texto; el cubo sigue privado).
 *
 * Sin colores a pelo: el botón es un borde del color del texto, que sale bien en claro y en oscuro.
 */
export function htmlDelCorreoDeAyuda(c: {
  mensaje: string;
  /** Dónde estaba quien escribe, con palabras (D-NEXT): va ARRIBA y en negrita, antes del mensaje. */
  ubicacion?: string | null;
  /** Las líneas de contexto, ya compuestas («From: …», «Page: …»…). */
  contexto: string[];
  adjuntos: AdjuntoDelCorreo[];
  enlaceParaCopiar: string | null;
}): string {
  const boton = c.enlaceParaCopiar
    ? `<p><a href="${escapaHtml(c.enlaceParaCopiar)}" style="display:inline-block;padding:10px 18px;border:2px solid;border-radius:8px;font-weight:bold;font-size:16px;text-decoration:none">📋 Copy for Claude</a></p>`
    : "";
  const donde = c.ubicacion?.trim() ? `<p><b>Where: ${escapaHtml(c.ubicacion.trim())}</b></p>` : "";
  const mensaje = `${donde}<div style="white-space:pre-wrap">${escapaHtml(c.mensaje)}</div>`;
  const contexto = `<hr><p>${c.contexto.map(escapaHtml).join("<br>")}</p>`;
  const adjuntos = c.adjuntos.length
    ? `<p><b>Attachments (${c.adjuntos.length}):</b></p>` + c.adjuntos.map((a) => {
      if (!a.url) return `<p>• ${escapaHtml(a.nombre)}: (link could not be created)</p>`;
      const url = escapaHtml(a.url);
      const foto = esImagen({ path: "", nombre: a.nombre })
        ? `<a href="${url}"><img src="${url}" alt="${escapaHtml(a.nombre)}" style="max-width:100%;height:auto"></a><br>`
        : "";
      return `<p>${foto}• <a href="${url}">${escapaHtml(a.nombre)}</a></p>`;
    }).join("")
    : "";
  return `<div>${boton}${mensaje}${contexto}${adjuntos}</div>`;
}
