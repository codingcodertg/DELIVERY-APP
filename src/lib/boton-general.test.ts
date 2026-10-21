import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  CLAVE_ENSENANZA, EVENTO_ABRIR_AYUDA, EVENTO_ABRIR_CHAT, EVENTO_CHAT_SIN_LEER, EVENTO_ENSENANZA,
  destinoDeLaApp, escribeEnsenanza, leeEnsenanza, opcionesDelBotonGeneral,
} from "./boton-general";

// D-623 (2026-10-21) · el dueño: «Switch User, Mobile View y Teaching Mode solo para administradores. […] el de ayuda se
// ha transformado en un bobo que va a ser general, que cuando se abra […] van a salir […] las cinco […] en todas las apps.
// […] si dice cambio usuario, él cambia a la app en la que ya está. Pero si ese usuario no tiene acceso a eso, pues cae al
// hub. […] si está en el delivery sub, cae al delivery sub. O en el HR, cae el HR, pero no que siempre esté cayendo el
// delivery sub».

const leer = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, "");

describe("las opciones de la burbuja general", () => {
  it("todos: Ayuda y Chat; el admin real: además Cambiar usuario (si está encendido), Vista móvil y Modo enseñanza", () => {
    expect(opcionesDelBotonGeneral({ adminReal: false, switchHabilitado: false })).toEqual(["ayuda", "chat"]);
    expect(opcionesDelBotonGeneral({ adminReal: false, switchHabilitado: true })).toEqual(["ayuda", "chat"]);
    expect(opcionesDelBotonGeneral({ adminReal: true, switchHabilitado: false })).toEqual(["ayuda", "chat", "movil", "ensenanza"]);
    expect(opcionesDelBotonGeneral({ adminReal: true, switchHabilitado: true })).toEqual(["ayuda", "chat", "usuario", "movil", "ensenanza"]);
  });
});

describe("a dónde se cae al cambiar de usuario o al volver: la portada de la app en la que se está", () => {
  it("Entregas a Entregas, RR. HH. a RR. HH., Inventario a Inventario, el hub al hub", () => {
    expect(destinoDeLaApp("/")).toBe("/");
    expect(destinoDeLaApp("/routes")).toBe("/");
    expect(destinoDeLaApp("/my-route")).toBe("/");
    expect(destinoDeLaApp("/recruiting/candidates/abc")).toBe("/recruiting");
    expect(destinoDeLaApp("/erp/purchasing/orders")).toBe("/erp/catalog");
    expect(destinoDeLaApp("/timetracker/week")).toBe("/timetracker");
    expect(destinoDeLaApp("/timetracker/clock-in")).toBe("/timetracker");
    expect(destinoDeLaApp("/customers/1")).toBe("/customers");
    expect(destinoDeLaApp("/home")).toBe("/home");
    expect(destinoDeLaApp("/home/switch-user")).toBe("/home");
    expect(destinoDeLaApp(null)).toBe("/");
    expect(destinoDeLaApp("")).toBe("/");
  });
});

describe("la señal de enseñanza, compartida con Entregas", () => {
  it("lee y escribe la misma clave que data-provider usaba, y aguanta sin almacenamiento", () => {
    expect(CLAVE_ENSENANZA).toBe("rtg_teaching");
    const m = new Map<string, string>();
    const almacen = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } };
    expect(leeEnsenanza(almacen)).toBe(false);
    escribeEnsenanza(almacen, true);
    expect(m.get("rtg_teaching")).toBe("1");
    expect(leeEnsenanza(almacen)).toBe(true);
    escribeEnsenanza(almacen, false);
    expect(m.has("rtg_teaching")).toBe(false);
    expect(leeEnsenanza(null)).toBe(false);
    const roto = { getItem: () => { throw new Error("bloqueado"); }, setItem: () => { throw new Error("bloqueado"); }, removeItem: () => {} };
    expect(leeEnsenanza(roto)).toBe(false);
    expect(() => escribeEnsenanza(roto, true)).not.toThrow();
  });

  it("puerta: Entregas escucha el evento y escribe con el mismo helper; ya no toca localStorage a mano", () => {
    const dp = sinComentarios(leer("src/lib/data-provider.tsx"));
    expect(dp).toContain('import { EVENTO_ENSENANZA, escribeEnsenanza, leeEnsenanza } from "@/lib/boton-general";');
    expect(dp).toContain("window.addEventListener(EVENTO_ENSENANZA, alCambiar);");
    expect(dp).toContain("escribeEnsenanza(localStorage, v);");
    expect(dp).not.toContain('localStorage.getItem("rtg_teaching")');
    expect(dp).not.toContain('localStorage.setItem("rtg_teaching"');
  });
});

describe("puerta: la burbuja general en el layout raíz, y Ayuda y Chat se abren desde ella", () => {
  const burbuja = sinComentarios(leer("src/components/BotonGeneral.tsx"));
  const ayuda = sinComentarios(leer("src/components/HelpButton.tsx"));
  const chat = sinComentarios(leer("src/components/ChatFlotante.tsx"));

  it("sale donde sale la Ayuda, se pide al servidor una vez, y pinta las opciones de opcionesDelBotonGeneral", () => {
    expect(burbuja).toContain("const sale = ayudaEnLaRuta(pathname);");
    expect(burbuja).toContain("if (!sale) return null;");
    expect(burbuja).toContain("const opciones = opcionesDelBotonGeneral({ adminReal: servidor.adminReal, switchHabilitado: servidor.habilitado });");
    expect(burbuja).toContain("{opciones.map(opcion)}");
    expect(burbuja).toContain('className={"fab-general" + (abierto ? " abierto" : "")}');
  });

  it("Ayuda y Chat se abren por evento y, montados sin burbuja, no pintan la suya", () => {
    expect(EVENTO_ABRIR_AYUDA).toBe("rtg:abrir-ayuda");
    expect(EVENTO_ABRIR_CHAT).toBe("rtg:abrir-chat");
    expect(burbuja).toContain("window.dispatchEvent(new CustomEvent(EVENTO_ABRIR_AYUDA))");
    expect(burbuja).toContain("window.dispatchEvent(new CustomEvent(EVENTO_ABRIR_CHAT))");
    expect(ayuda).toContain("window.addEventListener(EVENTO_ABRIR_AYUDA, abre);");
    expect(ayuda).toContain('{!sinBurbuja && <button\n        className="help-fab no-print"');
    expect(chat).toContain("window.addEventListener(EVENTO_ABRIR_CHAT, abre);");
    expect(chat).toContain('if (sinBurbuja && estado !== "abierta") return null;');
    const layout = sinComentarios(leer("src/app/layout.tsx"));
    expect(layout).toContain("<HelpButton sinBurbuja />");
    expect(layout).toContain("<ChatFlotante sinBurbuja />");
    expect(layout).toContain("<BotonGeneral />");
  });

  it("el chat le manda sus no leídos y la burbuja los enseña cerrada y en la opción", () => {
    expect(EVENTO_CHAT_SIN_LEER).toBe("rtg:chat-sin-leer");
    expect(chat).toContain("window.dispatchEvent(new CustomEvent(EVENTO_CHAT_SIN_LEER, { detail: sinLeer }))");
    expect(burbuja).toContain("window.addEventListener(EVENTO_CHAT_SIN_LEER, alContar);");
    expect(burbuja.split("data-sin-leer={sinLeer}").length - 1).toBe(2);
  });

  it("el modo enseñanza de la burbuja escribe la bandera y avisa a Entregas", () => {
    expect(EVENTO_ENSENANZA).toBe("rtg:ensenanza");
    expect(burbuja).toContain("escribeEnsenanza(localStorage, nuevo);");
    expect(burbuja).toContain("window.dispatchEvent(new CustomEvent(EVENTO_ENSENANZA));");
  });

  it("al volver a la cuenta y al entrar como otro, se cae a destinoDeLaApp; la página del hub, al hub", () => {
    const banner = sinComentarios(leer("src/components/ImpersonationBanner.tsx"));
    expect(banner).toContain("window.location.href = destinoDeLaApp(window.location.pathname);");
    expect(banner).not.toContain('window.location.href = "/";');
    const panel = sinComentarios(leer("src/components/SwitchUserPanel.tsx"));
    expect(panel.split("window.location.href = destino;").length - 1).toBe(2);
    expect(panel).not.toContain('window.location.href = "/"');
    expect(leer("src/app/home/switch-user/page.tsx")).toContain('destino="/home"');
  });

  it("estilos: la burbuja general en el sitio de la Ayuda y por encima de todo, y el panel de usuario sube", () => {
    const css = leer("src/app/globals.css");
    expect(css).toContain(".fab-general-caja { position: fixed; right: 20px; bottom: 20px; z-index: 1000;");
    expect(css).toContain(".fab-menu .switch-panel { top: auto; bottom: calc(100% + 6px); }");
    expect(css).toContain(".fab-general-caja { right: 14px; bottom: 14px; }");
  });
});
