import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// D-1209: en la vista compacta del Gestor no sale el ⓘ, y la fila de arriba solo aparece si trae el aviso de expiradas.
const pagina = readFileSync("src/app/(app)/routes/page.tsx", "utf8").split("\r\n").join("\n");

describe("Gestor compacto sin espacios muertos (D-1209)", () => {
  it("el ⓘ solo en la expandida", () => {
    expect(pagina).toContain('{!eficiente && <span className="hint" data-ayuda-del-mapa');
  });
  it("la fila de arriba, en la compacta, solo con el aviso de expiradas", () => {
    expect(pagina).toContain("{(!eficiente || (!soloPendientes && !soloLectura && (pendientes.atrasadas.length + pendientes.sinFecha.length > 0) && !oculto(AVISOS_DEL_GESTOR.atrasadas))) && (\n      <div data-barra-de-arriba");
  });
});
