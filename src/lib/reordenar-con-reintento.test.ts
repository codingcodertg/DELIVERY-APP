import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const proveedor = readFileSync("src/lib/data-provider.tsx", "utf8").replace(/\r\n/g, "\n");
const reorden = proveedor.slice(proveedor.indexOf("const reorderStops = useCallback"), proveedor.indexOf("// ---- Las cargas de una orden"));

describe("reorderStops reintenta la red y, si no se puede, deja la base como estaba", () => {
  it("usa el reintento de la red", () => {
    expect(proveedor).toContain('from "@/lib/reintenta-la-red"');
  });
  it("cada escritura y cada compensación pasan por el reintento", () => {
    expect(reorden.split("conReintentosDeRed(").length - 1).toBeGreaterThanOrEqual(2);
  });
  it("los dos mensajes en español están", () => {
    expect(reorden).toContain("No se pudo guardar el nuevo orden: falló la conexión. No se movió nada: inténtelo de nuevo.");
    expect(reorden).toContain("La conexión se cayó mientras se guardaba el nuevo orden. La lista se volvió a cargar del servidor: revísela antes de mover algo más.");
  });
  it("los mensajes en inglés están", () => {
    expect(reorden).toContain("Could not save the new order: the connection failed. Nothing was moved — try again.");
    expect(reorden).toContain("The connection dropped while saving the new order. The list was reloaded from the server — check it before moving anything else.");
  });
  it("las tandas de 6 siguen", () => {
    expect(proveedor).toContain("export const ESCRITURAS_A_LA_VEZ = 6;");
  });
});
