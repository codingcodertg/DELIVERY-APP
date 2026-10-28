import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { recorteDeLaVista } from "@/lib/recorte-de-la-vista";

describe("recorteDeLaVista (D-NEXT): la foto entera se recorta por donde está la ventana", () => {
  it("con la ventana bajada 549 px, el recorte empieza en 549 y mide lo que mide la ventana", () => {
    const r = recorteDeLaVista({ width: 1440, height: 1600 }, { left: 0, top: -549, width: 1440 }, { innerWidth: 1440, innerHeight: 420 });
    expect(r).toEqual({ sx: 0, sy: 549, sw: 1440, sh: 420, ancho: 1440, alto: 420 });
  });
  it("sin scroll, empieza en 0", () => {
    const r = recorteDeLaVista({ width: 1440, height: 1600 }, { left: 0, top: 0, width: 1440 }, { innerWidth: 1440, innerHeight: 900 });
    expect(r?.sx).toBe(0); expect(r?.sy).toBe(0);
  });
  it("a 2× (el lienzo mide el doble que el body), el recorte va en píxeles del lienzo y el tamaño vuelve a CSS", () => {
    const r = recorteDeLaVista({ width: 2880, height: 3200 }, { left: 0, top: -100, width: 1440 }, { innerWidth: 1440, innerHeight: 420 });
    expect(r).toEqual({ sx: 0, sy: 200, sw: 2880, sh: 840, ancho: 1440, alto: 420 });
  });
  it("al final de la página el recorte no se sale del lienzo", () => {
    const r = recorteDeLaVista({ width: 1440, height: 1000 }, { left: 0, top: -800, width: 1440 }, { innerWidth: 1440, innerHeight: 420 });
    expect(r?.sh).toBe(200);
  });
  it("un body con margen (rect.top positivo) no da coordenadas negativas", () => {
    const r = recorteDeLaVista({ width: 1440, height: 1000 }, { left: 8, top: 8, width: 1424 }, { innerWidth: 1440, innerHeight: 420 });
    expect(r?.sx).toBe(0); expect(r?.sy).toBe(0);
  });
  it("sin medidas no hay recorte", () => {
    expect(recorteDeLaVista({ width: 0, height: 0 }, { left: 0, top: 0, width: 1440 }, { innerWidth: 1440, innerHeight: 420 })).toBeNull();
  });
  it("la foto rápida la usa: página entera sin clip, y el recorte después", () => {
    const captura = readFileSync(join(process.cwd(), "src/components/CapturaDeAyuda.tsx"), "utf8");
    expect(captura).not.toContain('clip: "viewport"');
    const cuerpo = captura.slice(captura.indexOf("export async function tomaFotogramaDeLaPagina"), captura.indexOf("export async function tomaFotograma(): Promise"));
    expect(cuerpo).toContain("recorteDeLaVista(lienzo, document.body.getBoundingClientRect(), window)");
    expect(cuerpo).toContain("ctx.drawImage(lienzo, r.sx, r.sy, r.sw, r.sh, 0, 0, r.ancho, r.alto)");
  });
});
