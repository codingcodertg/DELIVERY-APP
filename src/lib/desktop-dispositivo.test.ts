import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { CABECERA_DISPOSITIVO, dispositivoDeLaPeticion, idDeDispositivoValido } from "./security/reglas";

// `desktop/` es CommonJS y vive fuera de `src` (como `desktop-origins.test.ts`).
const requerir = createRequire(import.meta.url);
const { CABECERA, idDeMaquina, salNueva, machineGuidDe } = requerir("../../desktop/dispositivo.js") as {
  CABECERA: string; idDeMaquina: (g: string | null, s: string) => string; salNueva: () => string; machineGuidDe: (s: string) => string | null;
};
const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");

/**
 * D-811: «el bloqueo debe ser único por app downloaded, nadie puede copiar». El id de la app de escritorio sale del
 * MachineGuid de Windows más una sal por instalación, y viaja en una cabecera que solo la app pone.
 */
describe("el id de la instalación", () => {
  it("es sha256 de MachineGuid|sal: 64 letras, válido como id, y el servidor lo lee como ligado", () => {
    const id = idDeMaquina("5B2C0D4E-1F2A-4B3C-9D8E-7F6A5B4C3D2E", "sal1");
    expect(id).toMatch(/^[0-9a-f]{64}$/);
    expect(idDeDispositivoValido(id)).toBe(true);
    expect(dispositivoDeLaPeticion({ cabecera: id, cookie: "rtg_device=otro-id-copiado-1234" })).toEqual({ id, ligado: true });
  });
  it("otra máquina u otra sal dan otro id; mayúsculas del GUID no importan", () => {
    expect(idDeMaquina("guid-a", "sal")).not.toBe(idDeMaquina("guid-b", "sal"));
    expect(idDeMaquina("guid-a", "sal1")).not.toBe(idDeMaquina("guid-a", "sal2"));
    expect(idDeMaquina("GUID-A", "sal")).toBe(idDeMaquina("guid-a", "sal"));
  });
  it("sin MachineGuid sigue habiendo id (solo la sal); sin sal no hay id", () => {
    expect(idDeMaquina(null, "sal")).toMatch(/^[0-9a-f]{64}$/);
    expect(() => idDeMaquina("g", "")).toThrow();
    expect(salNueva()).toMatch(/^[0-9a-f]{64}$/);
    expect(salNueva()).not.toBe(salNueva());
  });
  it("lee el GUID de lo que imprime `reg query`", () => {
    expect(machineGuidDe("\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography\r\n    MachineGuid    REG_SZ    5B2C0D4E-1F2A-4B3C-9D8E-7F6A5B4C3D2E\r\n")).toBe("5b2c0d4e-1f2a-4b3c-9d8e-7f6a5b4c3d2e");
    expect(machineGuidDe("ERROR: The system was unable to find the specified registry key")).toBeNull();
  });
});

describe("la cabecera", () => {
  it("se llama igual en la app y en el servidor", () => {
    expect(CABECERA).toBe(CABECERA_DISPOSITIVO);
    expect(CABECERA).toBe("x-rtg-device");
  });
  it("la app la pone solo hacia nuestro sitio, y la versión es la 1.3.0 (D-813 la subió a 1.2.1; D-NEXT, la vigilancia de red, a 1.3.0)", () => {
    const main = leer("desktop/main.js");
    expect(main).toContain("if (esNuestro(detalles.url)) requestHeaders[CABECERA] = idInstalacion;");
    expect(main).toContain("webRequest.onBeforeSendHeaders(");
    expect(JSON.parse(leer("desktop/package.json")).version).toBe("1.3.0");
  });
  it("sin cabecera, la cookie (no ligada); sin nada, null; basura, null", () => {
    expect(dispositivoDeLaPeticion({ cabecera: null, cookie: "a=1; rtg_device=5b2c0d4e-1f2a-4b3c-9d8e-7f6a5b4c3d2e; b=2" })).toEqual({ id: "5b2c0d4e-1f2a-4b3c-9d8e-7f6a5b4c3d2e", ligado: false });
    expect(dispositivoDeLaPeticion({ cabecera: null, cookie: null })).toBeNull();
    expect(dispositivoDeLaPeticion({ cabecera: "x y", cookie: "rtg_device=ab" })).toBeNull();
  });
  it("el servidor no cree al cuerpo ni al agente para decir «escritorio»: solo a la cabecera", () => {
    const seen = leer("src/app/api/security/seen/route.ts");
    expect(seen).toContain('const kind = d.ligado ? "desktop" : tipoPorAgente(ua) === "phone" ? "phone" : "browser";');
    expect(seen).toContain("p_bound: d.ligado");
    expect(leer("src/lib/supabase/middleware.ts")).toContain("dispositivoDeLaPeticion({ cabecera: request.headers.get(CABECERA_DISPOSITIVO), cookie: request.headers.get(\"cookie\") })");
  });
  it("la solicitud de autorización: botón en la pantalla de bloqueo, ruta con sesión, función que no aprueba", () => {
    expect(leer("src/app/device-blocked/BloqueadoEnDispositivo.tsx")).toContain('data-accion="solicitar-autorizacion"');
    const ruta = leer("src/app/api/security/request/route.ts");
    expect(ruta).toContain("requireUser()");
    expect(ruta).toContain('rpc("security_request_access"');
    const sql = leer("supabase/migrations/229_security_dispositivos.sql");
    expect(sql).toContain("where id = p_device and status <> 'approved'");
    expect(sql).not.toMatch(/security_request_access[\s\S]*set status/);
    expect(leer("src/app/security/PanelDeSeguridad.tsx")).toContain('data-bloque="solicitudes"');
  });
});

describe("se actualiza sola (el dueño: «que se instale como un update normal»)", () => {
  it("la app lleva electron-updater apuntando a nuestro sitio, baja sola e instala al cerrar o al aceptar", () => {
    const pkg = JSON.parse(leer("desktop/package.json"));
    expect(pkg.dependencies["electron-updater"]).toBeTruthy();
    expect(pkg.build.publish).toEqual([{ provider: "generic", url: "https://rtg-hub.vercel.app/api/desktop-update" }]);
    const main = leer("desktop/main.js");
    expect(main).toContain("autoUpdater.autoDownload = true;");
    expect(main).toContain("autoUpdater.autoInstallOnAppQuit = true;");
    expect(main).toContain("autoUpdater.requestHeaders = { [CABECERA]: idInstalacion };");
    expect(main).toContain("autoUpdater.quitAndInstall()");
  });
  it("la ruta sirve latest.yml y el instalador desde Blob, con la cabecera de la app o con sesión; nada más", () => {
    const ruta = leer("src/app/api/desktop-update/[file]/route.ts");
    expect(ruta).toContain('"latest.yml": { blob: "apps/latest.yml"');
    expect(ruta).toContain('{ blob: "apps/RTG-Hub-Setup.exe"');
    expect(ruta).toContain("idDeDispositivoValido(cabecera)");
    expect(ruta).toContain('return NextResponse.json({ error: "Not signed in." }, { status: 401 });');
    expect(ruta).toContain("access: \"private\"");
  });
  it("publicar sube los dos ficheros juntos y con nombre estable", () => {
    const s = leer("scripts/publica-desktop.mjs");
    expect(s).toContain('["apps/RTG-Hub-Setup.exe"');
    expect(s).toContain('["apps/latest.yml"');
    expect(s).toContain("latest.yml no nombra");
  });
});
