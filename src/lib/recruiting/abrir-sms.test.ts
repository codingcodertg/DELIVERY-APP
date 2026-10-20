import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { abrirSmsEnRingCentral, avisoTrasAbrir } from "./abrir-sms";

// D-604 (2026-10-19) · El dueño: «le doy enviar y se abre ring central pero no aparece nada». El texto va en el enlace Y en el
// portapapeles, en el mismo clic.

describe("abrir un texto en RingCentral: en el enlace y en el portapapeles", () => {
  it("copia el texto y abre el enlace, en ese orden, sin esperar a la copia", () => {
    const pasos: string[] = [];
    const r = abrirSmsEnRingCentral("rcapp://r/sms?x", "hola", {
      copiar: (t) => { pasos.push("copiar:" + t); return new Promise(() => {}); },
      abrir: (u) => pasos.push("abrir:" + u),
    });
    expect(pasos).toEqual(["copiar:hola", "abrir:rcapp://r/sms?x"]);
    expect(r).toEqual({ copiado: true });
  });
  it("sin portapapeles (navegador sin permiso o sin API) abre igual y lo dice", () => {
    const pasos: string[] = [];
    const r = abrirSmsEnRingCentral("rcapp://r/sms?x", "hola", { abrir: (u) => pasos.push("abrir:" + u) });
    expect(pasos).toEqual(["abrir:rcapp://r/sms?x"]);
    expect(r).toEqual({ copiado: false });
    const lanza = abrirSmsEnRingCentral("rcapp://r/sms?x", "hola", { copiar: () => { throw new Error("no"); }, abrir: (u) => pasos.push("abrir2:" + u) });
    expect(lanza).toEqual({ copiado: false });
    expect(pasos).toEqual(["abrir:rcapp://r/sms?x", "abrir2:rcapp://r/sms?x"]);
  });
  it("el aviso dice que se copió y que lo pegue si RingCentral sale vacío; sin copia, solo que se abrió", () => {
    expect(avisoTrasAbrir({ copiado: true }, "es")).toBe("Texto abierto en RingCentral y copiado: si RingCentral se abre vacío, pégalo (Ctrl+V)");
    expect(avisoTrasAbrir({ copiado: true }, "en")).toContain("paste it");
    expect(avisoTrasAbrir({ copiado: false }, "es")).toBe("Texto abierto en RingCentral");
  });
  it("puerta: los tres textos de RR. HH. (cita, ¿te puedo llamar?, seguimiento) y el «💬 Mensaje» salen por aquí; ningún `window.location.href = r.enlace` suelto", () => {
    const raiz = new URL("../../components/recruiting/", import.meta.url);
    for (const f of ["InPersonScheduleModal.tsx", "BotonTextoPuedoLlamar.tsx", "ModalHost.tsx"]) {
      const s = readFileSync(new URL(f, raiz), "utf8");
      expect(s, f).toContain('from "@/lib/recruiting/abrir-sms"');
      expect(s, f).toContain("abrirSmsEnRingCentral(");
      expect(s, f).not.toContain("window.location.href = r.enlace;");
      expect(s, f).not.toContain("window.location.href = rcSms(");
    }
  });
});
