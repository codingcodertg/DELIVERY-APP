import { describe, expect, it } from "vitest";
import { HUB_TOOLS, herramientasDelLanzador } from "./constants";

// 2026-11-11 (el dueño): «Vista móvil» y «Cambiar de usuario» ya están en el botón «?»: salen del inicio, no de la app.
describe("el lanzador del hub sin lo que vive en el «?»", () => {
  it("quita Vista móvil y Cambiar de usuario, y deja lo demás", () => {
    const admin = HUB_TOOLS.filter((t) => t.visible({ role: "admin", module_access: [], suplantando: false } as never));
    const keys = herramientasDelLanzador(admin).map((t) => t.key);
    expect(keys).not.toContain("vista-movil");
    expect(keys).not.toContain("switch-user");
    expect(keys.length).toBe(admin.length - 2);
  });
  it("las dos siguen siendo herramientas con su ruta (el «?» las abre)", () => {
    expect(HUB_TOOLS.find((t) => t.key === "vista-movil")?.href).toBe("/home/vista-movil");
    expect(HUB_TOOLS.find((t) => t.key === "switch-user")?.href).toBe("/home/switch-user");
  });
});
