/**
 * ¿El adjunto es un CV que se puede guardar? PURO. Solo PDF, DOC y DOCX, de como mucho 10 MB, y con la firma del tipo
 * (no basta con la extensión: un .pdf que no empieza por %PDF se rechaza).
 */
import { MAX_CV_BYTES } from "./config";

export type ValidacionCv = { ok: true; extension: "pdf" | "doc" | "docx" } | { ok: false; motivo: string };

const EXTENSIONES = ["pdf", "doc", "docx"] as const;

export function validaCv(nombreFichero: string, bytes: Buffer): ValidacionCv {
  const ext = /\.([A-Za-z0-9]{1,8})$/.exec(nombreFichero.trim())?.[1]?.toLowerCase() ?? "";
  if (!(EXTENSIONES as readonly string[]).includes(ext)) return { ok: false, motivo: "el adjunto no es PDF, DOC ni DOCX" };
  if (bytes.length === 0) return { ok: false, motivo: "el adjunto está vacío" };
  if (bytes.length > MAX_CV_BYTES) return { ok: false, motivo: "el CV pasa de 10 MB" };

  const cabecera = bytes.subarray(0, 8);
  if (ext === "pdf" && cabecera.subarray(0, 4).toString("latin1") !== "%PDF") {
    return { ok: false, motivo: "el archivo no es un PDF válido" };
  }
  // DOCX es un zip («PK»); DOC es el formato OLE de Word (D0 CF 11 E0).
  if (ext === "docx" && cabecera.subarray(0, 2).toString("latin1") !== "PK") {
    return { ok: false, motivo: "el archivo no es un DOCX válido" };
  }
  if (ext === "doc" && !(cabecera[0] === 0xd0 && cabecera[1] === 0xcf && cabecera[2] === 0x11 && cabecera[3] === 0xe0)) {
    return { ok: false, motivo: "el archivo no es un DOC válido" };
  }
  return { ok: true, extension: ext as "pdf" | "doc" | "docx" };
}
