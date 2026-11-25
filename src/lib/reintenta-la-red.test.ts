import { describe, expect, it } from "vitest";
import { ESPERAS_DE_REINTENTO_MS, conReintentosDeRed, esFalloDeRed } from "./reintenta-la-red";

const red = (message: string) => ({ error: { message } });
const ok = () => ({ error: null });
const sinEspera = async () => {};

describe("esFalloDeRed", () => {
  it.each([
    "TypeError: Failed to fetch",
    "NetworkError when attempting to fetch resource.",
    "Network request failed",
    "Load failed",
    "fetch failed",
    "The network connection was lost.",
    "Request timeout",
    "The operation timed out",
    "The user aborted a request",
  ])("«%s» es de red", (message) => {
    expect(esFalloDeRed({ message })).toBe(true);
  });

  it("un error con código NO es de red, aunque el texto lo parezca", () => {
    expect(esFalloDeRed({ message: "Failed to fetch", code: "PGRST301" })).toBe(false);
  });

  it("sin código (null, undefined o vacío) sí puede ser de red", () => {
    expect(esFalloDeRed({ message: "Failed to fetch", code: null })).toBe(true);
    expect(esFalloDeRed({ message: "Failed to fetch", code: undefined })).toBe(true);
    expect(esFalloDeRed({ message: "Failed to fetch", code: "" })).toBe(true);
  });

  it("sin error es false", () => {
    expect(esFalloDeRed(null)).toBe(false);
    expect(esFalloDeRed(undefined)).toBe(false);
  });

  it("un mensaje de la base que no es de red es false", () => {
    expect(esFalloDeRed({ message: "Not allowed to create this split load" })).toBe(false);
  });
});

describe("conReintentosDeRed", () => {
  it("el primer intento sale bien: una sola llamada", async () => {
    let llamadas = 0;
    const r = await conReintentosDeRed(async () => { llamadas++; return ok(); }, { espera: sinEspera });
    expect(llamadas).toBe(1);
    expect(r.error).toBeNull();
  });

  it("dos fallos de red y luego un éxito: tres llamadas y se devuelve el éxito", async () => {
    const respuestas = [red("Failed to fetch"), red("Failed to fetch"), ok()];
    let llamadas = 0;
    const r = await conReintentosDeRed(async () => respuestas[llamadas++], { espera: sinEspera });
    expect(llamadas).toBe(3);
    expect(r.error).toBeNull();
  });

  it("tres fallos de red: tres llamadas y se devuelve el último fallo", async () => {
    let llamadas = 0;
    const r = await conReintentosDeRed(async () => { llamadas++; return red(`Failed to fetch ${llamadas}`); }, { espera: sinEspera });
    expect(llamadas).toBe(3);
    expect(r.error?.message).toBe("Failed to fetch 3");
  });

  it("un error que no es de red no se repite", async () => {
    let llamadas = 0;
    const r = await conReintentosDeRed(async () => {
      llamadas++;
      return { error: { message: "new row violates row-level security", code: "42501" } };
    }, { espera: sinEspera });
    expect(llamadas).toBe(1);
    expect(r.error?.code).toBe("42501");
  });

  it("si escribe lanza un TypeError de red, cuenta como fallo de red y se repite", async () => {
    const respuestas: Array<() => Promise<{ error: null | { message: string } }>> = [
      async () => { throw new TypeError("Failed to fetch"); },
      async () => ok(),
    ];
    let llamadas = 0;
    const r = await conReintentosDeRed(() => respuestas[llamadas++](), { espera: sinEspera });
    expect(llamadas).toBe(2);
    expect(r.error).toBeNull();
  });

  it("las esperas inyectadas son 400 y luego 1200 ms", async () => {
    const esperas: number[] = [];
    await conReintentosDeRed(async () => red("Failed to fetch"), {
      espera: async (ms) => { esperas.push(ms); },
    });
    expect(esperas).toEqual([400, 1200]);
    expect([...ESPERAS_DE_REINTENTO_MS]).toEqual([400, 1200]);
  });
});
