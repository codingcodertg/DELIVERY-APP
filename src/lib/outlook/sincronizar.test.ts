import { describe, expect, it } from "vitest";
import { desdeParaLeer, nuevoCursor } from "./sincronizar";
import { MARGEN_CURSOR_MS, VENTANA_INICIAL_MS } from "./config";

const ahora = new Date("2026-11-13T15:00:00Z");

describe("cursor de la revisión", () => {
  it("con el lote sin llenar, el cursor llega hasta ahora menos el margen", () => {
    const c = nuevoCursor({ cursorAnterior: new Date("2026-11-13T10:00:00Z"), ultimoRecibido: "2026-11-13T14:00:00Z", ahora, llenoElLote: false });
    expect(c.toISOString()).toBe(new Date(ahora.getTime() - MARGEN_CURSOR_MS).toISOString());
  });

  it("con el lote lleno, el cursor va hasta el último correo leído (el resto sale después)", () => {
    const c = nuevoCursor({ cursorAnterior: new Date("2026-11-13T10:00:00Z"), ultimoRecibido: "2026-11-13T12:30:00Z", ahora, llenoElLote: true });
    expect(c.toISOString()).toBe("2026-11-13T12:30:00.000Z");
  });

  it("nunca retrocede", () => {
    const c = nuevoCursor({ cursorAnterior: new Date("2026-11-13T14:50:00Z"), ultimoRecibido: "2026-11-13T09:00:00Z", ahora, llenoElLote: true });
    expect(c.toISOString()).toBe("2026-11-13T14:50:00.000Z");
  });

  it("primera corrida: lee desde la ventana inicial menos el margen", () => {
    const d = desdeParaLeer(null, ahora);
    expect(d.getTime()).toBe(ahora.getTime() - VENTANA_INICIAL_MS - MARGEN_CURSOR_MS);
  });
});
