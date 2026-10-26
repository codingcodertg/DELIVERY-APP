import { describe, expect, it } from "vitest";
import {
  decisionAlPegar, esCampoDeTexto, ficherosDeLaTransferencia, nombreDeCaptura, problemaDeAdjunto, rutaDeAdjunto,
  MAX_BYTES_DE_ADJUNTO,
} from "./adjuntos-de-orden";

const t = (en: string) => en;
const item = (f: File | null, kind = "file") => ({ kind, type: f?.type ?? "text/plain", getAsFile: () => f });
const ahora = new Date(2026, 9, 26, 14, 30, 5);

describe("ficherosDeLaTransferencia", () => {
  it("un PDF copiado en el Explorador llega por files y por items: sale una vez, con su nombre", () => {
    const pdf = new File(["%PDF"], "Invoice 1042.pdf", { type: "application/pdf" });
    const r = ficherosDeLaTransferencia({ files: [pdf], items: [item(pdf)] }, ahora);
    expect(r.map((f) => f.name)).toEqual(["Invoice 1042.pdf"]);
  });
  it("una captura solo en items se recoge y se renombra con la hora", () => {
    const cap = new File(["png"], "image.png", { type: "image/png" });
    const r = ficherosDeLaTransferencia({ files: [], items: [item(null, "string"), item(cap)] }, ahora);
    expect(r.map((f) => f.name)).toEqual(["screenshot-20261026-143005.png"]);
  });
  it("texto solo (copiado de la página de QuickBooks): ningún fichero", () => {
    expect(ficherosDeLaTransferencia({ files: [], items: [item(null, "string")] }, ahora)).toEqual([]);
    expect(ficherosDeLaTransferencia(null)).toEqual([]);
  });
  it("dos ficheros distintos salen los dos", () => {
    const a = new File(["a"], "a.pdf", { type: "application/pdf" });
    const b = new File(["bb"], "b.png", { type: "image/png" });
    expect(ficherosDeLaTransferencia({ files: [a, b] }).map((f) => f.name)).toEqual(["a.pdf", "b.png"]);
  });
  it("nombreDeCaptura: jpeg → jpg", () => {
    expect(nombreDeCaptura("image/jpeg", ahora)).toBe("screenshot-20261026-143005.jpg");
  });
});

describe("pegar: de quién es", () => {
  it("campos de texto sí; botones, casillas y el cuerpo no", () => {
    expect(esCampoDeTexto({ tagName: "INPUT", type: "text" })).toBe(true);
    expect(esCampoDeTexto({ tagName: "input" })).toBe(true);
    expect(esCampoDeTexto({ tagName: "TEXTAREA" })).toBe(true);
    expect(esCampoDeTexto({ tagName: "DIV", isContentEditable: true })).toBe(true);
    expect(esCampoDeTexto({ tagName: "INPUT", type: "checkbox" })).toBe(false);
    expect(esCampoDeTexto({ tagName: "BUTTON" })).toBe(false);
    expect(esCampoDeTexto({ tagName: "BODY" })).toBe(false);
    expect(esCampoDeTexto(null)).toBe(false);
  });
  it("sin ficheros no se toca el pegado; con ficheros se adjunta y solo se cancela fuera de un campo", () => {
    expect(decisionAlPegar(0, false)).toEqual({ adjunta: false, cancela: false });
    expect(decisionAlPegar(0, true)).toEqual({ adjunta: false, cancela: false });
    expect(decisionAlPegar(1, false)).toEqual({ adjunta: true, cancela: true });
    expect(decisionAlPegar(2, true)).toEqual({ adjunta: true, cancela: false });
  });
});

describe("problemaDeAdjunto", () => {
  it("PDF e imágenes valen; un ejecutable, vacío o de más de 25 MB no", () => {
    expect(problemaDeAdjunto({ name: "f.pdf", size: 10, type: "application/pdf" }, t)).toBeNull();
    expect(problemaDeAdjunto({ name: "c.png", size: 10, type: "image/png" }, t)).toBeNull();
    expect(problemaDeAdjunto({ name: "f.pdf", size: 10, type: "" }, t)).toBeNull();
    expect(problemaDeAdjunto({ name: "x.exe", size: 10, type: "application/x-msdownload" }, t)).toMatch(/only PDF/);
    expect(problemaDeAdjunto({ name: "x.bin", size: 10, type: "" }, t)).toMatch(/only PDF/);
    expect(problemaDeAdjunto({ name: "f.pdf", size: 0, type: "application/pdf" }, t)).toMatch(/empty/);
    expect(problemaDeAdjunto({ name: "f.pdf", size: MAX_BYTES_DE_ADJUNTO, type: "application/pdf" }, t)).toBeNull();
    expect(problemaDeAdjunto({ name: "f.pdf", size: MAX_BYTES_DE_ADJUNTO + 1, type: "application/pdf" }, t)).toMatch(/25 MB/);
  });
});

describe("rutaDeAdjunto", () => {
  it("la primera carpeta es la orden (la política del cubo la mira) y el nombre va limpio", () => {
    const r = rutaDeAdjunto("0b6f-uuid", "Factura ñ 1/2.pdf", new Date("2026-10-26T14:30:05Z"), "ab-cd-ef12-34");
    expect(r.split("/")[0]).toBe("0b6f-uuid");
    expect(r.split("/")).toHaveLength(2);
    expect(r).toBe("0b6f-uuid/20261026143005-abcdef12-2.pdf");
  });
});
