/**
 * Relleno, vista y impresión de los documentos de ingreso, en el NAVEGADOR.
 *
 * Orden del relleno: primero los marcadores {{...}} (camino secundario, con docxtemplater), luego los campos amarillos
 * (camino principal, `campos-de-documento.ts`). Un archivo sin ninguno sale igual, byte a byte.
 *
 * La vista de revisión NO pinta el .docx con su formato de Word: lo convierte a HTML limpio con `mammoth` (títulos,
 * listas, negritas, tablas) y lo presenta como una hoja propia de la app, igual que la cotización (ver `estimator.css`).
 * Los campos amarillos viajan como marcadores ⟦Fn⟧ durante la conversión y luego son chips (`vista-de-documento.ts`).
 *
 * Solo para uso en cliente: el HTML se mete en el DOM y la impresión usa `window.print()` sobre la hoja. La lógica pura
 * está en `campos-de-documento.ts`, `vista-de-documento.ts` y `plantillas-de-documentos.ts`, que es lo que se prueba.
 */

import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import mammoth from "mammoth";
import { contieneMarcadores } from "./plantillas-de-documentos";
import { extensionDe, mimePorNombre } from "./plantillas-de-documentos";
import { aplicaValoresADocx, marcaCamposDocx } from "./campos-de-documento";

/** Sustituye los {{marcadores}} de un .docx. Sin marcadores, devuelve los mismos bytes. */
export function rellenaMarcadores(bytes: Uint8Array, mapa: Record<string, string>): Uint8Array {
  const zip = new PizZip(bytes);
  const xml = zip.file("word/document.xml")?.asText() ?? "";
  if (!contieneMarcadores(xml)) return bytes;
  const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, nullGetter: () => "" });
  doc.render(mapa);
  return doc.getZip().generate({ type: "uint8array", compression: "DEFLATE" });
}

/** El documento listo para imprimir o bajar: marcadores y luego campos amarillos. */
export function preparaDocumento(bytes: Uint8Array, valores: Record<string, string>, mapa: Record<string, string>): Uint8Array {
  return aplicaValoresADocx(rellenaMarcadores(bytes, mapa), valores);
}

function aArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/**
 * El .docx convertido a HTML, con sus campos amarillos todavía como marcadores ⟦Fn⟧ (el orden es el de `camposDeDocx`).
 * Los {{marcadores}} ya van rellenos con `mapa`. Los valores de los campos se ponen después, con `sustituyeMarcadores`,
 * así que cambiar un valor no vuelve a convertir el documento.
 */
export async function htmlDeDocx(bytes: Uint8Array, mapa: Record<string, string>): Promise<string> {
  const marcado = marcaCamposDocx(bytes);
  const relleno = rellenaMarcadores(marcado, mapa);
  // `ignoreEmptyParagraphs: false`: los párrafos vacíos del documento son espacio en blanco, y se conservan.
  // En el navegador mammoth lee un ArrayBuffer; en Node (pruebas) lee un Buffer.
  const origen = typeof window === "undefined" ? { buffer: Buffer.from(relleno) } : { arrayBuffer: aArrayBuffer(relleno) };
  const { value } = await mammoth.convertToHtml(origen, { ignoreEmptyParagraphs: false });
  return value;
}

/**
 * Un HTML que viene de un .docx se pinta en el mismo origen que la app: se quitan scripts, marcos y atributos on*, y los
 * enlaces que no sean http(s), mailto o ancla (p. ej. «javascript:»). `mammoth` ya escapa el texto; esto es la segunda
 * barrera, sobre el DOM real.
 */
export function limpiaHtmlPintado(raiz: ParentNode): void {
  raiz.querySelectorAll("script, iframe, object, embed").forEach((el) => el.remove());
  raiz.querySelectorAll("*").forEach((el) => {
    for (const a of Array.from(el.attributes)) {
      const n = a.name.toLowerCase();
      if (n.startsWith("on")) el.removeAttribute(a.name);
      else if ((n === "href" || n === "src" || n === "xlink:href") && !/^(https?:|mailto:|#|data:image\/|blob:)/i.test(a.value.trim())) el.removeAttribute(a.name);
    }
  });
}

/** Baja el archivo con su nombre. */
export function descargaArchivo(bytes: Uint8Array, nombre: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mimePorNombre(nombre) }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function esperaCarga(iframe: HTMLIFrameElement): Promise<void> {
  return new Promise((resolve) => {
    iframe.onload = () => resolve();
    // Un PDF que el navegador no pinta en iframe no dispara «load» en algunos casos: no se espera para siempre.
    setTimeout(resolve, 4000);
  });
}

/**
 * Abre el diálogo de impresión de un archivo que NO es .docx (PDF o imagen), sin salir de la pantalla: se carga en un
 * iframe oculto y se imprime ese iframe. Los .docx se imprimen desde su hoja en la propia pantalla (`window.print()`).
 */
export async function imprimeArchivo(bytes: Uint8Array, nombre: string): Promise<void> {
  const ext = extensionDe(nombre);
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  document.body.appendChild(iframe);
  const win = iframe.contentWindow;
  const doc = iframe.contentDocument;
  if (!win || !doc) { iframe.remove(); throw new Error("No se pudo preparar la impresión."); }

  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mimePorNombre(nombre) }));
  if (ext === "pdf") {
    iframe.src = url;
    await esperaCarga(iframe);
  } else {
    doc.open();
    doc.write(`<!doctype html><html><body style="margin:0"><img src="${url}" style="width:100%"></body></html>`);
    doc.close();
    await new Promise((r) => setTimeout(r, 400));
  }
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  await new Promise((r) => setTimeout(r, 250));
  win.focus();
  win.print();
  setTimeout(() => iframe.remove(), 60000);
}
