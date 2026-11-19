import { describe, expect, it } from "vitest";
import { MAX_FOTOS_EN_ZIP, extensionDeFoto, juntarFotosEnZip, nombreDeFotoEnZip, nombreDelZip, planDeFotos, reportesConFotos, sanitizaParaZip, type ReporteConFotos } from "./fotos-en-zip";

const r1: ReporteConFotos = { id: "3f2a9c1e-0000-4000-8000-000000000001", created_at: "2026-11-18T15:00:00Z", product_sku: "PORC-2448-GRY", photos: ["u/a.jpg", "u/b.JPG"] };
const r2: ReporteConFotos = { id: "9b8c7d6e-0000-4000-8000-000000000002", created_at: "2026-11-17T23:30:00Z", product_sku: null, photos: [] };
const r3: ReporteConFotos = { id: "aaaaaaaa-0000-4000-8000-000000000003", created_at: "2026-11-16T12:00:00Z", product_sku: "  mosaico / 2 ñ  ", photos: ["u/c.png"] };

describe("nombre de cada foto dentro del zip", () => {
  it("fecha_código_folio_n.ext, con el día en Texas y el folio de 8 caracteres", () => {
    expect(nombreDeFotoEnZip(r1, 1, "u/a.jpg")).toBe("2026-11-18_PORC-2448-GRY_3F2A9C1E_1.jpg");
  });
  it("sin código de producto dice no-code", () => {
    expect(nombreDeFotoEnZip(r2, 2, "u/x.png")).toBe("2026-11-17_no-code_9B8C7D6E_2.png");
  });
  it("sanea espacios, barras, acentos y símbolos a «-» (solo queda [A-Za-z0-9._-])", () => {
    const n = nombreDeFotoEnZip(r3, 1, "u/c.png");
    expect(n).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(n).toBe("2026-11-16_mosaico---2--_AAAAAAAA_1.png");
    expect(sanitizaParaZip("a b/c?d")).toBe("a-b-c-d");
  });
  it("la extensión va en minúscula; las desconocidas pasan a jpg", () => {
    expect(extensionDeFoto("u/b.JPG")).toBe("jpg");
    expect(extensionDeFoto("u/hoja.PDF")).toBe("pdf");
    expect(extensionDeFoto("u/sinextension")).toBe("jpg");
    expect(extensionDeFoto("u/raro.tiff")).toBe("jpg");
  });
});

describe("plan de fotos", () => {
  it("junta todas las fotos en su orden, con su número dentro del reporte", () => {
    const plan = planDeFotos([r1, r2, r3]);
    expect(plan.map((p) => p.ruta)).toEqual(["u/a.jpg", "u/b.JPG", "u/c.png"]);
    expect(plan[1].nombre).toBe("2026-11-18_PORC-2448-GRY_3F2A9C1E_2.jpg");
  });
  it("cuenta los reportes con al menos una foto (el N del botón)", () => {
    expect(reportesConFotos([r1, r2, r3])).toBe(2);
    expect(reportesConFotos([r2])).toBe(0);
  });
  it("el nombre del zip lleva la fecha de hoy", () => {
    expect(nombreDelZip("2026-11-18")).toBe("scrap-photos-2026-11-18.zip");
  });
  it("el límite de fotos está en 300", () => {
    expect(MAX_FOTOS_EN_ZIP).toBe(300);
  });
});

describe("juntarFotosEnZip", () => {
  const bytes = (s: string) => new TextEncoder().encode(s);
  const respuesta = (datos: Uint8Array, ok = true) => new Response(Uint8Array.from(datos), { status: ok ? 200 : 500 });

  it("sin fotos no arma nada", async () => {
    const res = await juntarFotosEnZip({ reportes: [r2], firmar: async () => ({}), hoy: "2026-11-18" });
    expect(res.estado).toBe("sin-fotos");
  });

  it("más de 300 fotos: para antes de bajar y lo dice", async () => {
    const muchas: ReporteConFotos = { ...r1, photos: Array.from({ length: 301 }, (_, i) => `u/${i}.jpg`) };
    let bajo = false;
    const res = await juntarFotosEnZip({ reportes: [muchas], firmar: async () => { bajo = true; return {}; }, hoy: "2026-11-18" });
    expect(res).toEqual({ estado: "demasiadas", total: 301 });
    expect(bajo).toBe(false);
  });

  it("una foto que falla se omite y no tumba la descarga; el zip trae las demás", async () => {
    const firmas: string[][] = [];
    const res = await juntarFotosEnZip({
      reportes: [r1, r3],
      firmar: async (rutas) => { firmas.push(rutas); return { "u/a.jpg": "https://x/a", "u/b.JPG": "https://x/b", "u/c.png": "https://x/c" }; },
      bajar: async (url) => (url === "https://x/b" ? respuesta(bytes(""), false) : respuesta(bytes("contenido " + url))),
      hoy: "2026-11-18",
    });
    expect(firmas[0]).toEqual(["u/a.jpg", "u/b.JPG", "u/c.png"]);
    expect(res.estado).toBe("ok");
    if (res.estado !== "ok") return;
    expect(res.incluidas).toBe(2);
    expect(res.omitidas).toBe(1);
    expect(res.nombre).toBe("scrap-photos-2026-11-18.zip");
    // Sin enlace firmado también cuenta como omitida.
    expect(new TextDecoder().decode(res.zip.subarray(0, 4))).toBe("PK\x03\x04");
  });

  it("si la suma de bytes pasa del tope, se detiene y lo dice", async () => {
    const res = await juntarFotosEnZip({
      reportes: [r1],
      firmar: async () => ({ "u/a.jpg": "https://x/a", "u/b.JPG": "https://x/b" }),
      bajar: async () => respuesta(new Uint8Array(100)),
      hoy: "2026-11-18",
      maxBytes: 150,
    });
    expect(res.estado).toBe("demasiado-pesado");
  });

  it("avisa el progreso por cada foto terminada", async () => {
    const avisos: [number, number][] = [];
    await juntarFotosEnZip({
      reportes: [r1, r3],
      firmar: async () => ({ "u/a.jpg": "https://x/a", "u/b.JPG": "https://x/b", "u/c.png": "https://x/c" }),
      bajar: async () => respuesta(bytes("x")),
      onProgreso: (h, t) => avisos.push([h, t]),
      hoy: "2026-11-18",
    });
    expect(avisos.length).toBe(3);
    expect(avisos[avisos.length - 1]).toEqual([3, 3]);
  });
});
