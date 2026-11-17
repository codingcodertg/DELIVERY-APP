/**
 * Relleno, vista previa e impresión de los documentos de ingreso, en el NAVEGADOR.
 *
 * Orden del relleno: primero los marcadores {{...}} (camino secundario, con docxtemplater), luego los campos amarillos
 * (camino principal, `campos-de-documento.ts`). Un archivo sin ninguno sale igual, byte a byte.
 *
 * Solo para uso en cliente: `docx-preview` pinta en el DOM y la impresión abre un iframe. La lógica pura está en
 * `campos-de-documento.ts` y `plantillas-de-documentos.ts`, que es lo que se prueba.
 */

import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import { renderAsync } from "docx-preview";
import { contieneMarcadores } from "./plantillas-de-documentos";
import { extensionDe, mimePorNombre } from "./plantillas-de-documentos";
import { aplicaValoresADocx } from "./campos-de-documento";

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

/** Pinta un .docx en un contenedor (vista previa o impresión). */
export async function pintaDocx(bytes: Uint8Array, cuerpo: HTMLElement, cabeza?: HTMLElement): Promise<void> {
  await renderAsync(new Blob([bytes as BlobPart], { type: mimePorNombre("x.docx") }), cuerpo, cabeza, {
    inWrapper: true,
    breakPages: true,
  });
  limpiaHtmlPintado(cuerpo);
}

/**
 * Un .docx lo sube un HR manager, pero se pinta en el mismo origen que la app: después de pintarlo se quitan scripts,
 * marcos y atributos on*, y los enlaces que no sean http(s) o mailto (p. ej. «javascript:»).
 */
export function limpiaHtmlPintado(raiz: HTMLElement): void {
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
 * Abre el diálogo de impresión del archivo, sin salir de la pantalla y sin abrir Word:
 *   · .docx → se pinta en un iframe oculto con docx-preview y se imprime ese iframe;
 *   · PDF y imagen → se cargan en un iframe oculto y se imprimen.
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

  if (ext === "docx") {
    doc.open();
    doc.write("<!doctype html><html><head><meta charset=\"utf-8\"></head><body style=\"margin:0\"></body></html>");
    doc.close();
    await pintaDocx(bytes, doc.body, doc.head);
  } else {
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
  }
  await new Promise((r) => setTimeout(r, 250));
  win.focus();
  win.print();
  setTimeout(() => iframe.remove(), 60000);
}
