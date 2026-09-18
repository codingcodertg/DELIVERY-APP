import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Dónde se ve «Cambiar a otro usuario» (D-NEXT): dentro del aviso naranja, junto a «Volver a mi
 * cuenta», en todas las apps, y montando el MISMO panel de D-247/D-306 por props.
 *
 * Lo que decide algo —a quién se puede saltar, qué hace la ruta— se prueba importado en
 * `impersonation-switch.test.ts` y `impersonation-candidates.test.ts`. Aquí, el cableado: que el botón
 * exista, que los candidatos se pidan al pulsar y no al montar, y que el panel en modo «saltar» vaya a
 * la ruta de saltar y recargue cuando la ruta dice que el admin ya está restaurado.
 */

const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const banner = sinComentarios(leer("src/components/ImpersonationBanner.tsx"));
const panel = sinComentarios(leer("src/components/SwitchUserPanel.tsx"));

describe("el aviso naranja", () => {
  it("tiene el botón junto a «Volver a mi cuenta», y sigue en el layout raíz para las cinco apps", () => {
    expect(banner).toContain("Cambiar a otro usuario / Switch to another user");
    expect(banner.indexOf("Volver a mi cuenta / Back to my account")).toBeLessThan(banner.indexOf("Cambiar a otro usuario"));
    expect(leer("src/app/layout.tsx")).toContain("<ImpersonationBanner />");
  });

  it("pide los candidatos al pulsar, no al montar: una carga normal sigue costando una petición", () => {
    const montaje = banner.slice(banner.indexOf("useEffect(() => {"), banner.indexOf("const volver = useCallback"));
    expect(montaje).toContain('fetch("/api/impersonate/state")');
    expect(montaje).not.toContain("candidates");
    const abrir = banner.slice(banner.indexOf("const abrirSalto = useCallback"), banner.indexOf("const volver = useCallback"));
    expect(abrir).toContain('fetch("/api/impersonate/switch/candidates")');
    expect(abrir).toContain("if (candidatos) return;");
  });

  it("monta el mismo panel, por props y en modo «saltar»", () => {
    expect(banner).toContain('import { SwitchUserPanel } from "@/components/SwitchUserPanel";');
    expect(banner).toContain('<SwitchUserPanel users={candidatos.users} tiendas={candidatos.stores} modo="saltar" onClose={() => setSaltando(false)} />');
    // Sin proveedor de datos: el banner no monta `DataProvider` ni lee `useData`.
    expect(banner).not.toContain("DataProvider");
    expect(banner).not.toContain("useData");
  });
});

describe("el panel en modo «saltar»", () => {
  it("va a la ruta de saltar, y en el modo de siempre a la de entrar", () => {
    expect(panel).toContain('const ruta = modo === "saltar" ? "/api/impersonate/switch" : "/api/impersonate";');
    expect(panel).toContain('modo?: "entrar" | "saltar";');
  });

  it("si la ruta dice que el admin ya está restaurado (o hay que ir al login), recarga en vez de dejar el banner pintado", () => {
    expect(panel).toContain('if (cuerpo?.salida === "admin" || cuerpo?.salida === "login") { window.location.href = "/"; return; }');
    // Y esa lectura va ANTES del error genérico, que se queda para los fallos sin salida.
    expect(panel.indexOf('cuerpo?.salida === "admin"')).toBeLessThan(panel.indexOf('setError(t("Could not sign in as this user."'));
  });

  it("la confirmación dice lo que pasa al saltar: la sesión actual se cierra y el reloj sigue corriendo", () => {
    expect(panel).toContain("Se cierra la sesión actual, y el reloj de 60 minutos sigue corriendo.");
  });
});
