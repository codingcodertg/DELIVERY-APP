import { describe, expect, it } from "vitest";
import { crc32, zipSinComprimir } from "./zip-sin-comprimir";

const enc = new TextEncoder();
const dec = new TextDecoder();

/** Lee un u32/u16 little-endian de la vista. */
const u32 = (b: Uint8Array, o: number) => new DataView(b.buffer, b.byteOffset).getUint32(o, true);
const u16 = (b: Uint8Array, o: number) => new DataView(b.buffer, b.byteOffset).getUint16(o, true);

describe("crc32", () => {
  it("coincide con el valor de referencia de CRC-32", () => {
    expect(crc32(enc.encode("123456789"))).toBe(0xcbf43926);
    expect(crc32(enc.encode("hello"))).toBe(0x3610a686);
    expect(crc32(new Uint8Array())).toBe(0);
  });
});

describe("zipSinComprimir", () => {
  const datosA = enc.encode("hello");
  const datosB = enc.encode("mundo, dos");
  const zip = zipSinComprimir([
    { nombre: "a.txt", datos: datosA },
    { nombre: "carpeta/b-ñ.txt", datos: datosB },
  ], new Date(2026, 10, 18, 10, 30, 0));

  it("empieza con la firma de cabecera local y la primera entrada tiene su CRC y tamaños", () => {
    expect(dec.decode(zip.subarray(0, 4))).toBe("PK\x03\x04");
    expect(u16(zip, 8)).toBe(0); // sin comprimir
    expect(u32(zip, 14)).toBe(0x3610a686);
    expect(u32(zip, 18)).toBe(5);
    expect(u32(zip, 22)).toBe(5);
    expect(u16(zip, 26)).toBe("a.txt".length);
    expect(u16(zip, 6) & 0x0800).toBe(0x0800); // nombres en UTF-8
  });

  it("el directorio central tiene una entrada por archivo con firma PK\\x01\\x02 y apunta a la cabecera local", () => {
    const eocd = zip.length - 22;
    expect(dec.decode(zip.subarray(eocd, eocd + 4))).toBe("PK\x05\x06");
    const centralOffset = u32(zip, eocd + 16);
    expect(u16(zip, eocd + 8)).toBe(2);
    expect(u16(zip, eocd + 10)).toBe(2);
    expect(dec.decode(zip.subarray(centralOffset, centralOffset + 4))).toBe("PK\x01\x02");
    // Primera entrada del central apunta a la local en 0.
    expect(u32(zip, centralOffset + 42)).toBe(0);
    // Segunda entrada del central: su cabecera local está justo después de la primera entrada completa.
    const segundaCentral = centralOffset + 46 + "a.txt".length;
    expect(dec.decode(zip.subarray(segundaCentral, segundaCentral + 4))).toBe("PK\x01\x02");
    const segundaLocal = 30 + "a.txt".length + datosA.length;
    expect(u32(zip, segundaCentral + 42)).toBe(segundaLocal);
    expect(dec.decode(zip.subarray(segundaLocal, segundaLocal + 4))).toBe("PK\x03\x04");
    expect(u32(zip, segundaLocal + 14)).toBe(crc32(datosB));
    expect(u32(zip, segundaLocal + 18)).toBe(datosB.length);
    // El directorio central ocupa exactamente lo que el registro de fin dice.
    expect(u32(zip, eocd + 12)).toBe(zip.length - 22 - centralOffset);
  });

  it("los datos van tal cual, sin comprimir, en su sitio", () => {
    const inicioA = 30 + "a.txt".length;
    expect(dec.decode(zip.subarray(inicioA, inicioA + datosA.length))).toBe("hello");
    const inicioB = 30 + "a.txt".length + datosA.length + 30 + enc.encode("carpeta/b-ñ.txt").length;
    expect(dec.decode(zip.subarray(inicioB, inicioB + datosB.length))).toBe("mundo, dos");
  });

  it("un zip vacío sigue siendo válido: solo el registro de fin con cero entradas", () => {
    const vacio = zipSinComprimir([]);
    expect(vacio.length).toBe(22);
    expect(dec.decode(vacio.subarray(0, 4))).toBe("PK\x05\x06");
    expect(u16(vacio, 8)).toBe(0);
  });
});
