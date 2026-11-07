import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { filasQueSePintan, TAMANOS_DE_TABLA, tamanoValido, TODOS } from "./mostrar-n";

describe("mostrar-n", () => {
  // D-NEXT: Roberto, 2026-11-07: «Instead of 1000 do All».
  it("ofrece 10, 50, 100 y Todos (ya no 1000)", () => expect([...TAMANOS_DE_TABLA]).toEqual([10, 50, 100, "todos"]));
  it("acepta los válidos y cae al de por defecto", () => {
    expect(tamanoValido("50")).toBe(50);
    expect(tamanoValido("todos")).toBe(TODOS);
    // Un 1000 guardado en el navegador de antes pasa a «Todos», no al de por defecto.
    expect(tamanoValido("1000")).toBe(TODOS);
    expect(tamanoValido("7")).toBe(100);
    expect(tamanoValido(null, 10)).toBe(10);
  });
  it("«Todos» pinta cada fila; los números recortan", () => {
    expect(filasQueSePintan(TODOS, 324)).toBe(324);
    expect(filasQueSePintan(100, 324)).toBe(100);
    expect(filasQueSePintan(100, 7)).toBe(7);
  });
  it("el selector enseña «All / Todos» y la lista de Clientes recorta sin tope", () => {
    const selector = readFileSync("src/components/MostrarN.tsx", "utf8");
    expect(selector).toContain('x === TODOS ? t("All", "Todos") : x');
    const pantalla = readFileSync("src/app/customers/Clientes.tsx", "utf8");
    expect(pantalla).toContain("visibles.slice(0, filasQueSePintan(cuantos, visibles.length))");
  });
});
