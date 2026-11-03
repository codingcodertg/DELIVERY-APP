import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ESCRITORIO_MINIMO, escritorioDesactualizado, INSTALADOR_ESCRITORIO, versionDeEscritorio, versionMenor } from "./desktop-version";

/**
 * D-813: la app de escritorio vieja (1.1.1, sin actualizador) ve en la web «hay versión nueva» y un botón que baja el
 * instalador de un clic. El dueño: «busca la manera de que mismo sistema se actualice solo» · «sin necesidad de ir».
 */
const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");

describe("qué versión de escritorio es", () => {
  it("la del agente de la app; un navegador no es ninguna", () => {
    expect(versionDeEscritorio(`${CHROME} RTGHub/1.1.1`)).toBe("1.1.1");
    expect(versionDeEscritorio(`${CHROME} RTGHub/1.2.1 Electron/33.4.11`)).toBe("1.2.1");
    // D-827: la app original se llamaba RDZ Hub; su 1.0.0 también es «la app de escritorio» y va por detrás.
    expect(versionDeEscritorio(`${CHROME} rdz-hub-desktop/1.0.0 Electron/33.4.11 Safari/537.36 RDZHub/1.0.0`)).toBe("1.0.0");
    expect(versionDeEscritorio(CHROME)).toBeNull();
    expect(versionDeEscritorio(null)).toBeNull();
  });
  it("compara número a número, no como texto", () => {
    expect(versionMenor("1.2.0", "1.10.0")).toBe(true);
    expect(versionMenor("1.10.0", "1.2.0")).toBe(false);
    expect(versionMenor("1.2.1", "1.2.1")).toBe(false);
    expect(versionMenor("1.2", "1.2.1")).toBe(true);
  });
});

describe("a quién se le enseña el aviso", () => {
  it("a la app más vieja que la mínima; nunca a un navegador ni a la app al día", () => {
    expect(escritorioDesactualizado(`${CHROME} RTGHub/1.1.1`)).toBe(true);
    expect(escritorioDesactualizado(`${CHROME} RTGHub/${ESCRITORIO_MINIMO}`)).toBe(false);
    expect(escritorioDesactualizado(`${CHROME} RTGHub/9.0.0`)).toBe(false);
    expect(escritorioDesactualizado(`${CHROME} RDZHub/1.0.0`)).toBe(true);
    expect(escritorioDesactualizado(CHROME)).toBe(false);
    expect(escritorioDesactualizado(`${CHROME} RTGHub/1.1.1`, "1.1.1")).toBe(false);
  });
  it("la mínima es la versión que compila `desktop/`, y el instalador se llama como ella", () => {
    const pkg = JSON.parse(readFileSync("desktop/package.json", "utf8")) as { version: string; build: { nsis: { oneClick: boolean; runAfterFinish: boolean } } };
    expect(pkg.version).toBe(ESCRITORIO_MINIMO);
    expect(INSTALADOR_ESCRITORIO).toBe(`RTG-Hub-Setup-${pkg.version}.exe`);
    // De un clic y abre la app al acabar: quien pulsa «Actualizar» no ve ningún asistente.
    expect(pkg.build.nsis.oneClick).toBe(true);
    expect(pkg.build.nsis.runAfterFinish).toBe(true);
  });
  it("el aviso vive en el layout raíz, abre el instalador fuera (target _blank) con el id del dispositivo, y la ruta lo acepta en ?d=", () => {
    expect(leer("src/app/layout.tsx")).toContain("<AvisoDeEscritorio />");
    const aviso = leer("src/components/AvisoDeEscritorio.tsx");
    expect(aviso).toContain('target="_blank"');
    expect(aviso).toContain("?d=${encodeURIComponent(id)}");
    expect(aviso).toContain("if (!escritorioDesactualizado(ua)) return;");
    // D-814: tapa toda la pantalla, no se cierra, y el único botón es «Actualizar ahora».
    expect(aviso).toContain(`position: "fixed", inset: 0`);
    expect(aviso).not.toContain("setEstado(null)");
    expect(aviso.match(/<button/g) ?? []).toHaveLength(0);
    expect(leer("src/app/api/desktop-update/[file]/route.ts")).toContain('req.headers.get(CABECERA_DISPOSITIVO) ?? new URL(req.url).searchParams.get("d")');
  });
});
