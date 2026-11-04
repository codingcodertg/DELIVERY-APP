import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Dónde se ve «Cambiar a otro usuario» (D-307): dentro de la burbuja naranja (D-859; hasta entonces en el aviso
 * naranja de arriba), con «Volver a mi usuario» encima, en todas las apps, y montando el MISMO panel de D-247/D-306 por props.
 *
 * Lo que decide algo —a quién se puede saltar, qué hace la ruta— se prueba importado en
 * `impersonation-switch.test.ts` y `impersonation-candidates.test.ts`. Aquí, el cableado: que el botón
 * exista, que los candidatos se pidan al pulsar y no al montar, y que el panel en modo «saltar» vaya a
 * la ruta de saltar y recargue cuando la ruta dice que el admin ya está restaurado.
 */

const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
// D-859: la franja se fue; «Cambiar usuario» dentro de una suplantación vive en la burbuja general (naranja), con su
// estado en `useSuplantacion`.
const burbuja = sinComentarios(leer("src/components/BotonGeneral.tsx"));
const sup = sinComentarios(leer("src/components/SuplantacionEnBurbuja.tsx"));
const panel = sinComentarios(leer("src/components/SwitchUserPanel.tsx"));

describe("la burbuja naranja (antes, el aviso naranja de arriba)", () => {
  it("dentro de una suplantación ofrece «Cambiar usuario», y la burbuja sigue en el layout raíz para todas las apps", () => {
    expect(burbuja).toContain('{tAdmin("Switch user", "Cambiar usuario")}');
    expect(leer("src/app/layout.tsx")).toContain("<BotonGeneral />");
  });

  it("pide los candidatos al pulsar, no al montar: una carga normal sigue costando una petición", () => {
    const montaje = sup.slice(sup.indexOf("useEffect(() => {"), sup.indexOf("const volver = useCallback"));
    expect(montaje).toContain("fetch(RUTA_DEL_ESTADO)");
    expect(montaje).not.toContain("candidates");
    const abrir = sup.slice(sup.indexOf("const pideCandidatos = useCallback"), sup.indexOf("const cambiarDeVista = useCallback"));
    expect(abrir).toContain('fetch("/api/impersonate/switch/candidates")');
    expect(abrir).toContain("if (candidatos) return true;");
  });

  it("monta el mismo panel, por props y en modo «saltar»", () => {
    expect(burbuja).toContain('import { SwitchUserPanel } from "@/components/SwitchUserPanel";');
    expect(burbuja).toContain('<SwitchUserPanel users={sup.candidatos.users} tiendas={sup.candidatos.stores} modo="saltar" onClose={() => setCambiando(false)} destino={destinoDeLaApp(pathname)} />');
    // Sin proveedor de datos: la burbuja vive en el layout raíz, sin `DataProvider`.
    for (const f of [burbuja, sup]) {
      expect(f).not.toContain("DataProvider");
      expect(f).not.toContain("useData");
    }
  });
});

describe("el panel en modo «saltar»", () => {
  it("va a la ruta de saltar, y en el modo de siempre a la de entrar", () => {
    expect(panel).toContain('const ruta = modo === "saltar" ? "/api/impersonate/switch" : "/api/impersonate";');
    expect(panel).toContain('modo?: "entrar" | "saltar";');
  });

  it("si la ruta dice que el admin ya está restaurado (o hay que ir al login), recarga en vez de dejar el banner pintado", () => {
    // D-623: a `destino` (la portada de la app en la que se está), no siempre a Entregas.
    expect(panel).toContain('if (cuerpo?.salida === "admin" || cuerpo?.salida === "login") { window.location.href = destino; return; }');
    // Y esa lectura va ANTES del error genérico, que se queda para los fallos sin salida.
    expect(panel.indexOf('cuerpo?.salida === "admin"')).toBeLessThan(panel.indexOf('setError(t("Could not sign in as this user."'));
  });

  it("la confirmación dice lo que pasa al saltar: la sesión actual se cierra y el reloj sigue corriendo", () => {
    expect(panel).toContain("Se cierra la sesión actual, y el reloj de 60 minutos sigue corriendo.");
  });
});
