import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { MOLDE_DEL_TELEFONO, conTelefonoEstandar, telefonoAlEscribir, telefonoParaVer } from "./telefono-de-la-orden";

// D-630 (2026-10-21) · el dueño: «Permite que solo el usuario solo pueda poner números y tú lo vas poniendo como en el
// código de área […] que solo esa parte solo acepte números, nada más, no acepte símbolos ni nada».

const leer = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

describe("mientras se escribe", () => {
  it("se va formando según entran los dígitos", () => {
    expect(telefonoAlEscribir("")).toBe("");
    expect(telefonoAlEscribir("9")).toBe("(9");
    expect(telefonoAlEscribir("956")).toBe("(956");
    expect(telefonoAlEscribir("9563")).toBe("(956) 3");
    expect(telefonoAlEscribir("956340")).toBe("(956) 340");
    expect(telefonoAlEscribir("9563405")).toBe("(956) 340-5");
    expect(telefonoAlEscribir("9563405910")).toBe("(956) 340-5910");
  });

  it("solo números: el «+1», los puntos, asteriscos, letras y espacios no entran; más de 10 no caben", () => {
    expect(telefonoAlEscribir("+1 956.340.5910")).toBe("(956) 340-5910");
    expect(telefonoAlEscribir("956*340*5910")).toBe("(956) 340-5910");
    expect(telefonoAlEscribir("(956) 340-5910a")).toBe("(956) 340-5910");
    expect(telefonoAlEscribir("(956) 340-59101")).toBe("(956) 340-5910");
    expect(telefonoAlEscribir("abc")).toBe("");
    expect(telefonoAlEscribir("+")).toBe("");
  });

  it("borrar no se traba: quitar el último símbolo quita el dígito de antes de él", () => {
    expect(telefonoAlEscribir("(956) 340-")).toBe("(956) 340");
    expect(telefonoAlEscribir("(956) ")).toBe("(956");
    expect(telefonoAlEscribir("(95")).toBe("(95");
  });

  it("el molde enseña los paréntesis y el guion", () => {
    expect(MOLDE_DEL_TELEFONO).toBe("(___) ___-____");
  });
});

describe("al ver y al guardar", () => {
  it("un número completo se ve y se guarda con formato; lo demás, tal cual", () => {
    expect(telefonoParaVer("956*340*5910")).toBe("(956) 340-5910");
    expect(telefonoParaVer("956-340-5910 / 956-555-1234")).toBe("956-340-5910 / 956-555-1234");
    expect(telefonoParaVer(null)).toBe("");
    expect(conTelefonoEstandar({ delivery_phone: "1-956-340-5910", x: 1 })).toEqual({ delivery_phone: "(956) 340-5910", x: 1 });
    expect(conTelefonoEstandar({ delivery_phone: "340-5910" })).toEqual({ delivery_phone: "340-5910" });
    expect(conTelefonoEstandar({ delivery_phone: "   " })).toEqual({ delivery_phone: null });
    const sinTelefono: { account: string; delivery_phone?: string | null } = { account: "Acme" };
    expect(conTelefonoEstandar(sinTelefono)).toBe(sinTelefono);
    expect(conTelefonoEstandar({ delivery_phone: null })).toEqual({ delivery_phone: null });
  });
});

describe("puertas", () => {
  it("el campo de la orden solo deja números y enseña el molde", () => {
    const m = leer("src/components/OrderModal.tsx");
    expect(m).toContain('val={telefonoParaVer(d.delivery_phone)} on={(v) => set("delivery_phone", telefonoAlEscribir(v))}');
    expect(m).toContain('type="tel" inputMode="numeric" placeholder={MOLDE_DEL_TELEFONO} />');
    expect(m).toContain("min={min} inputMode={inputMode}");
  });

  it("los dos proveedores guardan con el formato al crear y al editar", () => {
    const dp = leer("src/lib/data-provider.tsx");
    expect(dp).toContain("async (dIn) => {\n      // El teléfono, siempre «(956) 340-5910» al guardar, venga de donde venga (D-630).\n      const d = conTelefonoEstandar(dIn);");
    expect(dp).toContain("async (id, patchCrudo, opts) => {\n      // El teléfono, siempre «(956) 340-5910» al guardar (D-630).\n      const patchIn = conTelefonoEstandar(patchCrudo);");
    const local = leer("src/lib/local-data-provider.tsx");
    expect(local).toContain("const d = conTelefonoEstandar(dIn);");
    expect(local).toContain("const patch = conTelefonoEstandar(patchCrudo);");
  });

  it("RR. HH.: solo el proveedor escribe candidatos, y ahí se estandarizan (D-610): no hay otro camino", () => {
    const archivos: string[] = [];
    const anda = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) anda(p); else if (/\.(ts|tsx)$/.test(f) && !/\.test\./.test(f)) archivos.push(p); } };
    anda("src");
    const escriben = archivos.filter((p) => /from\(\s*"candidates"\s*\)\s*\.\s*(insert|update|upsert)\(/.test(readFileSync(p, "utf8")))
      .map((p) => p.replace(/\\/g, "/"));
    expect(escriben).toEqual(["src/lib/recruiting-data-provider.tsx"]);
  });
});
