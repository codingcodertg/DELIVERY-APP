/**
 * La tarjeta de contacto (.vcf) que se guarda en el teléfono. Todo texto pasa por `escapaVcard`, y cada línea se
 * parte a 75 octetos como pide el formato (RFC 6350), para que la foto en base64 no rompa el archivo.
 */

export interface DatosDeVcard {
  nombre: string;
  rolEs: string;
  rolEn: string;
  idioma: "es" | "en";
  marca: string;
  tienda: { ciudad: string; direccion: string } | null;
  celular: string | null;
  trabajo: string | null;
  correo: string | null;
  url: string;
  /** La foto ya recortada y codificada en base64 (JPEG), o null. */
  fotoBase64?: string | null;
}

/** Escapa un valor de texto de vCard: barra invertida, punto y coma, coma y saltos de línea. */
export function escapaVcard(texto: string): string {
  return texto
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/** Parte una línea en trozos de como mucho 75 octetos UTF-8; los trozos siguientes empiezan con un espacio. */
export function plegaLinea(linea: string): string {
  const enc = new TextEncoder();
  const partes: string[] = [];
  let actual = "";
  let bytes = 0;
  let limite = 75;
  for (const ch of linea) {
    const n = enc.encode(ch).length;
    if (bytes + n > limite) {
      partes.push(actual);
      actual = "";
      bytes = 0;
      limite = 74; // el espacio de continuación cuenta
    }
    actual += ch;
    bytes += n;
  }
  partes.push(actual);
  return partes.join("\r\n ");
}

function nombreYApellido(nombre: string): { nombre: string; apellido: string } {
  const partes = nombre.trim().split(/\s+/);
  return { nombre: partes[0] ?? "", apellido: partes.slice(1).join(" ") };
}

export function construyeVcard(d: DatosDeVcard): string {
  const { nombre, apellido } = nombreYApellido(d.nombre);
  const rol = d.idioma === "en" ? d.rolEn || d.rolEs : d.rolEs || d.rolEn;
  const lineas: string[] = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `N:${escapaVcard(apellido)};${escapaVcard(nombre)};;;`,
    `FN:${escapaVcard(d.nombre.trim())}`,
    `ORG:${escapaVcard(d.marca)}${d.tienda ? ` — ${escapaVcard(d.tienda.ciudad)}` : ""}`,
    `TITLE:${escapaVcard(rol)}`,
  ];
  if (d.celular) lineas.push(`TEL;TYPE=CELL:${d.celular}`);
  if (d.trabajo && d.trabajo !== d.celular) lineas.push(`TEL;TYPE=WORK:${d.trabajo}`);
  if (d.correo) lineas.push(`EMAIL;TYPE=WORK:${d.correo}`);
  if (d.tienda) lineas.push(`ADR;TYPE=WORK:;;${escapaVcard(d.tienda.direccion)};;;;`);
  lineas.push(`URL:${d.url}`);
  if (d.fotoBase64) lineas.push(`PHOTO;ENCODING=b;TYPE=JPEG:${d.fotoBase64}`);
  lineas.push("END:VCARD");
  return lineas.map(plegaLinea).join("\r\n") + "\r\n";
}

/** El nombre del archivo que se descarga: el nombre con guiones bajos y sin caracteres raros. */
export function nombreDeArchivoVcard(nombre: string): string {
  const limpio = nombre.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return `${limpio || "contacto"}.vcf`;
}
