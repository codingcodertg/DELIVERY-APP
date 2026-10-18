import { describe, expect, it } from "vitest";
import { PRESETS_DE_FECHAS, PRESET_RETIRADO, presetDeFechasLeido, presetInicialDe } from "./preset-inicial";
import { PRESETS_GUARDABLES, filtrosGuardadosValidos } from "./user-prefs";
import { ROLE_ORDER } from "./constants";

/** D-NEXT · El chip es «Todas · Hoy · Mañana»; «Reciente» (D-350) se quitó. Ventas sigue naciendo en «Todas» (D-507). */
describe("con qué pestaña nace Órdenes", () => {
  it("ventas en «Todas» (D-507, no cambia)", () => {
    expect(presetInicialDe("sales")).toBe("all");
  });
  it("todos los demás roles del hub nacen en «Hoy» — el que sustituye a «Reciente»; se recorre la lista, no se escribe a mano", () => {
    for (const rol of ROLE_ORDER.filter((r) => r !== "sales")) {
      expect([rol, presetInicialDe(rol)]).toEqual([rol, "today"]);
    }
  });
  it("sin rol todavía, «Hoy»: el lado que menos carga", () => {
    expect(presetInicialDe(null)).toBe("today");
    expect(presetInicialDe(undefined)).toBe("today");
  });
  it("ningún rol nace en un chip que la pantalla no enseña", () => {
    for (const rol of ROLE_ORDER) expect(PRESETS_DE_FECHAS, rol).toContain(presetInicialDe(rol));
  });
});

describe("el chip guardado antes como «recent» se lee como el nuevo defecto, «Hoy»", () => {
  it("«recent» → «today»; los tres de ahora, tal cual; cualquier otra cosa, nada", () => {
    expect(PRESET_RETIRADO).toBe("recent");
    expect(presetDeFechasLeido("recent")).toBe("today");
    expect(presetDeFechasLeido("all")).toBe("all");
    expect(presetDeFechasLeido("today")).toBe("today");
    expect(presetDeFechasLeido("tomorrow")).toBe("tomorrow");
    for (const x of ["overdue", "mine", "", "Recent", null, undefined, 1, {}]) expect(presetDeFechasLeido(x), String(x)).toBeNull();
  });
  it("los que se pueden guardar son exactamente los tres que la pantalla enseña, sin «recent»", () => {
    expect([...PRESETS_GUARDABLES]).toEqual(["all", "today", "tomorrow"]);
    expect(PRESETS_GUARDABLES).not.toContain("recent");
  });
  it("un filtro guardado (D-440) con «p: recent» en la base o en el navegador sale saneado con «today»; uno con «tomorrow» se conserva", () => {
    const [viejo, nuevo, raro] = filtrosGuardadosValidos([
      { n: "Mis Brownsville", f: "approved", p: "recent" },
      { n: "Las de mañana", p: "tomorrow" },
      { n: "Sin chip", p: "mine" },
    ]);
    expect(viejo).toEqual({ n: "Mis Brownsville", f: "approved", p: "today" });
    expect(nuevo).toEqual({ n: "Las de mañana", p: "tomorrow" });
    expect(raro).toEqual({ n: "Sin chip" });
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
    // Y el estado inicial es «today»: ventas lo cambia a «Todas» al llegar su perfil, no antes.
    expect(p).toContain('const [preset, setPreset] = useState<Preset>("today");');
  });
});
