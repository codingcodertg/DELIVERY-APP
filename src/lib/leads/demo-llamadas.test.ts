import { describe, expect, it } from "vitest";
import { almacenDemo, leadsDemo, llamadasDemo, PERSONAS_DEMO, wavSilencioDemo } from "./demo";
import { claveDeTelefono } from "./llamadas-rc";
import { telefonoDeContratista } from "./telefonos";

describe("las llamadas del demo", () => {
  const leads = leadsDemo(new Date("2026-11-19T18:00:00.000Z"));
  const llamadas = llamadasDemo(leads, new Date("2026-11-19T18:00:00.000Z"));

  it("hay llamadas, y cada una es de un teléfono del contratista de SU lead", () => {
    expect(llamadas.length).toBeGreaterThan(0);
    for (const c of llamadas) {
      const lead = leads.find((l) => l.id === c.lead_id);
      expect(lead).toBeDefined();
      expect(claveDeTelefono(telefonoDeContratista(lead!))).toBe(c.phone_key);
    }
  });

  it("las llamadas son de los dos vendedores del demo, entrantes y salientes", () => {
    expect(new Set(llamadas.map((c) => c.rep_name))).toEqual(new Set([PERSONAS_DEMO[0].name, PERSONAS_DEMO[1].name]));
    expect(new Set(llamadas.map((c) => c.direction))).toEqual(new Set(["in", "out"]));
  });

  it("el lista del demo trae las llamadas de un lead, sin fuga de otros", async () => {
    const alm = almacenDemo(() => PERSONAS_DEMO[2]);
    const primera = llamadas[0]!;
    const r = await alm.llamadasDeLead(primera.lead_id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valor.length).toBeGreaterThan(0);
    expect(r.valor.every((c) => c.phone_key === primera.phone_key)).toBe(true);
  });

  it("una llamada con grabación da un audio; una sin grabación no", async () => {
    const alm = almacenDemo(() => PERSONAS_DEMO[2]);
    const con = llamadas.find((c) => c.has_recording)!;
    const sin = llamadas.find((c) => !c.has_recording);
    const ok = await alm.grabacionDeLlamada(con.lead_id, con.id);
    expect(ok.ok && ok.valor.startsWith("data:audio/wav;base64,")).toBe(true);
    if (sin) expect((await alm.grabacionDeLlamada(sin.lead_id, sin.id)).ok).toBe(false);
  });
});

describe("el audio de silencio del demo es un WAV válido", () => {
  const decodifica = (url: string) => Uint8Array.from(atob(url.split(",")[1]), (c) => c.charCodeAt(0));

  it("empieza con RIFF/WAVE y su tamaño de datos cuadra con el archivo", () => {
    const bytes = decodifica(wavSilencioDemo(2));
    const texto = String.fromCharCode(...bytes.subarray(0, 4)) + String.fromCharCode(...bytes.subarray(8, 12));
    expect(texto).toBe("RIFFWAVE");
    const v = new DataView(bytes.buffer);
    expect(v.getUint32(40, true)).toBe(bytes.length - 44);
    expect(v.getUint32(24, true)).toBe(8000);
  });
  it("la duración se acota entre 1 y 5 segundos", () => {
    expect(decodifica(wavSilencioDemo(0)).length).toBe(44 + 8000);
    expect(decodifica(wavSilencioDemo(99)).length).toBe(44 + 5 * 8000);
  });
});
