import { describe, expect, it } from "vitest";
import { presetInicialDe } from "./preset-inicial";
import { ROLE_ORDER } from "./constants";

/** D-507 · Ventas nace en «Todas»; el resto sigue naciendo en «Reciente» (D-350). */
describe("con qué pestaña nace Órdenes", () => {
  it("ventas en «Todas»", () => {
    expect(presetInicialDe("sales")).toBe("all");
  });
  it("todos los demás roles del hub siguen en «Reciente» — se recorre la lista, no se escribe a mano", () => {
    for (const rol of ROLE_ORDER.filter((r) => r !== "sales")) {
      expect([rol, presetInicialDe(rol)]).toEqual([rol, "recent"]);
    }
  });
  it("sin rol todavía, «Reciente»: el lado que menos carga", () => {
    expect(presetInicialDe(null)).toBe("recent");
    expect(presetInicialDe(undefined)).toBe("recent");
  });
});

describe("la pantalla de Órdenes lo aplica una sola vez", () => {
  it("usa la función probada y la aplica al llegar el perfil, no al montar", async () => {
    const { readFileSync } = await import("node:fs");
    const p = readFileSync("src/app/(app)/page.tsx", "utf8");
    const i = p.indexOf("const presetPuesto = useRef(false);");
    expect(i).toBeGreaterThan(-1);
    const tramo = p.slice(i, i + 400);
    expect(tramo).toContain("if (presetPuesto.current || !me) return;");
    expect(tramo).toContain("setPreset(presetInicialDe(me.role));");
    // Y el estado inicial sigue siendo «recent»: ventas lo cambia al llegar su perfil, no antes.
    expect(p).toContain('const [preset, setPreset] = useState<Preset>("recent");');
  });
});
