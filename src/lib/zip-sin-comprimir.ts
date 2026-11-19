/**
 * ZIP «stored» (sin comprimir), escrito a mano y sin dependencias. Lo usa la descarga de fotos de merma: las fotos ya
 * vienen comprimidas (JPEG), así que comprimirlas otra vez no ahorra nada y el método 0 es el más simple y rápido.
 *
 * Formato: por archivo, cabecera local + nombre + datos; luego el directorio central (un registro por archivo) y el
 * registro de fin (EOCD). Nombres en UTF-8 (bandera 0x0800). CRC-32 calculado aquí (polinomio 0xEDB88320).
 */

export interface EntradaDeZip {
  /** Nombre dentro del zip (con «/» si hay carpetas). Se guarda en UTF-8. */
  nombre: string;
  datos: Uint8Array;
}

const TABLA_CRC: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32 (el de ZIP, PNG, gzip). `crc32("123456789")` = 0xCBF43926. */
export function crc32(datos: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < datos.length; i++) c = TABLA_CRC[(c ^ datos[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Fecha y hora en el formato MS-DOS que usa ZIP. */
function fechaYHoraDos(d: Date): { fecha: number; hora: number } {
  const hora = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const fecha = ((Math.max(d.getFullYear(), 1980) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { fecha, hora };
}

const MAX_ENTRADAS = 0xffff;

/** Arma el zip completo en memoria. Lanza si hay demasiadas entradas o si el tamaño no cabe en el formato clásico. */
export function zipSinComprimir(entradas: readonly EntradaDeZip[], ahora: Date = new Date()): Uint8Array {
  if (entradas.length > MAX_ENTRADAS) throw new Error("zip: demasiados archivos");
  const enc = new TextEncoder();
  const { fecha, hora } = fechaYHoraDos(ahora);
  const locales: Uint8Array[] = [];
  const centrales: Uint8Array[] = [];
  let offset = 0;
  for (const e of entradas) {
    const nombre = enc.encode(e.nombre);
    const tam = e.datos.length;
    const crc = crc32(e.datos);
    if (tam > 0xffffffff || offset > 0xffffffff) throw new Error("zip: demasiado grande para el formato clásico");

    const cab = new DataView(new ArrayBuffer(30));
    cab.setUint32(0, 0x04034b50, true); // firma de cabecera local
    cab.setUint16(4, 20, true);         // versión necesaria
    cab.setUint16(6, 0x0800, true);     // bandera: nombre en UTF-8
    cab.setUint16(8, 0, true);          // método 0 = sin comprimir
    cab.setUint16(10, hora, true);
    cab.setUint16(12, fecha, true);
    cab.setUint32(14, crc, true);
    cab.setUint32(18, tam, true);       // tamaño comprimido (= original)
    cab.setUint32(22, tam, true);       // tamaño original
    cab.setUint16(26, nombre.length, true);
    cab.setUint16(28, 0, true);         // sin campo extra
    locales.push(new Uint8Array(cab.buffer), nombre, e.datos);

    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true); // firma del directorio central
    cen.setUint16(4, 20, true);         // versión con la que se creó
    cen.setUint16(6, 20, true);         // versión necesaria
    cen.setUint16(8, 0x0800, true);
    cen.setUint16(10, 0, true);         // método 0
    cen.setUint16(12, hora, true);
    cen.setUint16(14, fecha, true);
    cen.setUint32(16, crc, true);
    cen.setUint32(20, tam, true);
    cen.setUint32(24, tam, true);
    cen.setUint16(28, nombre.length, true);
    cen.setUint16(30, 0, true);         // extra
    cen.setUint16(32, 0, true);         // comentario
    cen.setUint16(34, 0, true);         // disco
    cen.setUint16(36, 0, true);         // atributos internos
    cen.setUint32(38, 0, true);         // atributos externos
    cen.setUint32(42, offset, true);    // dónde empieza su cabecera local
    centrales.push(new Uint8Array(cen.buffer), nombre);

    offset += 30 + nombre.length + tam;
  }

  const tamCentral = centrales.reduce((s, p) => s + p.length, 0);
  if (offset > 0xffffffff || tamCentral > 0xffffffff) throw new Error("zip: demasiado grande para el formato clásico");
  const fin = new DataView(new ArrayBuffer(22));
  fin.setUint32(0, 0x06054b50, true);   // firma del registro de fin
  fin.setUint16(4, 0, true);
  fin.setUint16(6, 0, true);
  fin.setUint16(8, entradas.length, true);
  fin.setUint16(10, entradas.length, true);
  fin.setUint32(12, tamCentral, true);
  fin.setUint32(16, offset, true);      // dónde empieza el directorio central
  fin.setUint16(20, 0, true);           // sin comentario

  const partes = [...locales, ...centrales, new Uint8Array(fin.buffer)];
  const total = partes.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of partes) { out.set(p, pos); pos += p.length; }
  return out;
}
