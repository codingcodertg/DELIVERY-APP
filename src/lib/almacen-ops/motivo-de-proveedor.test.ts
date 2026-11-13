import { describe, expect, it } from "vitest";
import { MOTIVOS_DE_MERMA, etiquetaDeOpcion, motivosDeMerma, pasoCompleto, pasosVisibles } from "./pasos";

/** Ayuda 88364dac (Roberto, 12 nov): «Supplier just needs one saying Transportation». */
describe("motivo de una merma de proveedor", () => {
  it("con proveedor hay UN solo «Transporte», en el sitio de los dos de antes", () => {
    expect(motivosDeMerma("supplier").map((m) => m.v)).toEqual(["fell", "strap", "forklift", "transportation", "other"]);
    expect(etiquetaDeOpcion("scrap", "reason", "transportation", "en")).toBe("Transportation");
    expect(etiquetaDeOpcion("scrap", "reason", "transportation", "es")).toBe("Transporte");
  });
  it("interno y devolución de cliente siguen con los dos transportes", () => {
    expect(motivosDeMerma("internal")).toBe(MOTIVOS_DE_MERMA);
    expect(motivosDeMerma("customer_return")).toBe(MOTIVOS_DE_MERMA);
    expect(motivosDeMerma(undefined).some((m) => m.v === "transportation")).toBe(false);
  });
  it("el paso «Motivo» del asistente ofrece los del origen, y un motivo de otro origen deja el paso incompleto", () => {
    const paso = (r: Record<string, unknown>) => pasosVisibles("scrap", r).find((p) => p.id === "reason")!;
    const prov = { return_type: "supplier", reason: "transportation" };
    expect(pasoCompleto(paso(prov), prov)).toBe(true);
    const cambiado = { return_type: "internal", reason: "transportation" };
    expect(pasoCompleto(paso(cambiado), cambiado)).toBe(false);
    const alReves = { return_type: "supplier", reason: "transportation_delivery" };
    expect(pasoCompleto(paso(alReves), alReves)).toBe(false);
  });
});
