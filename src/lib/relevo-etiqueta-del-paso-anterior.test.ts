import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const leer = (ruta: string) => readFileSync(join(process.cwd(), ruta), "utf8");

describe("el chip del paso anterior va junto a la pastilla de relevo, en tabla y en ficha", () => {
  it("OrdersTable pinta el chip en sus dos sitios (teléfono y escritorio) a través de ChipDelPasoDeLaFila, que lee las órdenes de la base", () => {
    const codigo = leer("src/components/OrdersTable.tsx");
    expect(codigo.split("<ChipDelPasoDeLaFila").length - 1).toBe(2);
    expect(codigo.split("<EtiquetaDelPasoAnterior").length - 1).toBe(1);
    expect(codigo).toContain("function ChipDelPasoDeLaFila(");
  });

  it("OrderModal lo pinta junto a la pastilla de la cabecera", () => {
    const codigo = leer("src/components/OrderModal.tsx");
    expect(codigo.split("<EtiquetaDelPasoAnterior").length - 1).toBe(1);
  });

  it("globals.css define los dos colores: verde (entregado) y ámbar (sin entregar)", () => {
    const css = leer("src/app/globals.css");
    expect(css).toContain(".sema.sema-relevo-entregado");
    expect(css).toContain(".sema.sema-relevo-pendiente");
  });
});
