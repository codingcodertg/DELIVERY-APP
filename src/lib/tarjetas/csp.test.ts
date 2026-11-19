import { describe, it, expect } from "vitest";
import { HOST_DE_TARJETAS } from "./host";
import nextConfig from "../../../next.config.mjs";

type Cabecera = { key: string; value: string };
type Regla = { source: string; has?: { type: string; value: string }[]; headers: Cabecera[] };

async function reglas(): Promise<Regla[]> {
  const cfg = nextConfig as unknown as { headers: () => Promise<Regla[]> };
  return cfg.headers();
}

const reportOnly = (r: Regla) => r.headers.find((h) => h.key === "Content-Security-Policy-Report-Only")?.value ?? "";

describe("CSP: la tarjeta pública pide su miniatura, y el hub no", () => {
  it("el host de la regla de tarjetas es el de HOST_DE_TARJETAS", async () => {
    const dominio = (await reglas()).find((r) => r.has)?.has?.[0]?.value;
    expect(dominio).toBe(HOST_DE_TARJETAS);
  });

  it("la política de tarjetas añade i.ytimg.com a img-src, y el resto es idéntico a la del hub", async () => {
    const todas = await reglas();
    const hub = reportOnly(todas[0]);
    const tarjetas = reportOnly(todas.find((r) => r.has) as Regla);
    const directivas = (csp: string) => new Map(csp.split("; ").map((d) => [d.split(" ")[0], d]));
    const h = directivas(hub);
    const t = directivas(tarjetas);
    expect(t.get("img-src")).toBe(`${h.get("img-src")} https://i.ytimg.com`);
    for (const nombre of h.keys()) if (nombre !== "img-src") expect(t.get(nombre)).toBe(h.get(nombre));
    expect(hub).not.toContain("i.ytimg.com");
  });

  it("el iframe del vídeo (youtube) ya estaba permitido en frame-src para todas las rutas", async () => {
    expect(reportOnly((await reglas())[0])).toContain("frame-src 'self' blob: https://www.youtube.com");
  });

  it("la ruta /tarjeta/... en el dominio del hub lleva la misma política de tarjetas", async () => {
    const tarjeta = (await reglas()).find((r) => r.source === "/tarjeta/:path*");
    expect(tarjeta && reportOnly(tarjeta)).toContain("img-src 'self' data: blob:");
    expect(tarjeta && reportOnly(tarjeta)).toContain("https://i.ytimg.com");
  });
});
