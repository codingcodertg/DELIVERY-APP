import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { ANCHO_POR_DEFECTO, RUTA_VISTA_MOVIL, TAMANOS_MOVIL, anchoElegido, enlaceAVistaMovil, estaEnUnMarco, rutaParaElMarco } from "./mobile-preview";

/** La vista móvil del admin (D-278): qué se carga en el marco, quién entra y cómo se pinta. */

const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");

describe("qué ruta se carga en el marco", () => {
  it("una ruta interna, con su consulta, tal cual", () => {
    expect(rutaParaElMarco("/map")).toBe("/map");
    expect(rutaParaElMarco("/timetracker/payroll?vista=pago")).toBe("/timetracker/payroll?vista=pago");
  });

  it("nada que salga del sitio ni lleve al login: la portada", () => {
    for (const mala of ["//evil.com", "https://evil.com/", "/\\evil.com", "/\t/evil.com", "/login", "/login?next=/", "", null, undefined]) {
      expect(rutaParaElMarco(mala), String(mala)).toBe("/");
    }
  });

  it("nunca la propia vista móvil, que metería un marco dentro de otro", () => {
    expect(rutaParaElMarco(RUTA_VISTA_MOVIL)).toBe("/");
    expect(rutaParaElMarco(`${RUTA_VISTA_MOVIL}?ruta=/map`)).toBe("/");
    expect(rutaParaElMarco(`${RUTA_VISTA_MOVIL}/algo`)).toBe("/");
    // Control: un prefijo parecido no es la vista móvil.
    expect(rutaParaElMarco(`${RUTA_VISTA_MOVIL}-no`)).toBe(`${RUTA_VISTA_MOVIL}-no`);
  });
});

describe("el tamaño", () => {
  it("uno de los tres, o el de por defecto", () => {
    expect(TAMANOS_MOVIL.map((x) => x.ancho)).toEqual([360, 390, 430]);
    expect(anchoElegido("360")).toBe(360);
    expect(anchoElegido(430)).toBe(430);
    expect(anchoElegido("500")).toBe(ANCHO_POR_DEFECTO);
    expect(anchoElegido(undefined)).toBe(390);
  });

  it("el enlace lleva ruta y ancho saneados", () => {
    expect(enlaceAVistaMovil("/map")).toBe(`${RUTA_VISTA_MOVIL}?ruta=%2Fmap&ancho=390`);
    expect(enlaceAVistaMovil("//evil.com", 999)).toBe(`${RUTA_VISTA_MOVIL}?ruta=%2F&ancho=390`);
  });
});

describe("¿dentro de un marco?", () => {
  it("la ventana de arriba es ella misma: no", () => {
    const w = {} as { self: unknown; top: unknown };
    w.self = w; w.top = w;
    expect(estaEnUnMarco(w)).toBe(false);
  });

  it("otra ventana arriba: sí; y si el navegador no deja mirarlo, también", () => {
    expect(estaEnUnMarco({ self: {}, top: {} })).toBe(true);
    const bloqueada = { self: {}, get top(): unknown { throw new Error("SecurityError"); } };
    expect(estaEnUnMarco(bloqueada)).toBe(true);
  });
});

describe("la pantalla", () => {
  it("la puerta es del servidor y solo deja pasar al admin por el rol de la sesión", () => {
    const puerta = leer("src/app/home/vista-movil/layout.tsx");
    expect(puerta).toContain("auth.getUser()");
    expect(puerta).toContain('if (perfil.role !== "admin") redirect(landingRoute(perfil));');
    expect(puerta.indexOf("redirect(landingRoute(perfil))")).toBeLessThan(puerta.indexOf("{children}"));
  });

  it("la página sanea lo que llega por la URL antes de dárselo al marco", () => {
    const pagina = leer("src/app/home/vista-movil/page.tsx");
    expect(pagina).toContain("<VistaMovil rutaInicial={rutaParaElMarco(ruta)} anchoInicial={anchoElegido(ancho)} />");
  });

  it("el marco solo carga rutas saneadas, y nada se guarda en localStorage", () => {
    const vista = leer("src/components/VistaMovil.tsx");
    expect(vista).toContain("src={ruta}");
    expect(vista.match(/setRuta\(/g)).toHaveLength(1);
    expect(vista).toContain("const segura = rutaParaElMarco(nuevaRuta);");
    expect(vista).toContain("setRuta(segura);");
    // Uso, no mención: el comentario explica por qué va en la URL y no ahí.
    expect(vista).not.toMatch(/(local|session)Storage\./);
    expect("window.localStorage.setItem").toMatch(/(local|session)Storage\./); // control
  });

  it("el marco mide lo que dice: content-box, que el reset global es border-box", () => {
    const css = leer("src/app/globals.css");
    const regla = css.slice(css.indexOf(".vista-movil-marco {"), css.indexOf("}", css.indexOf(".vista-movil-marco {")));
    expect(regla).toContain("box-sizing: content-box;");
    expect(css).toContain("* { box-sizing: border-box;"); // control: el reset que obliga a esto
  });

  it("la barra de Entregas ya no lleva a la vista móvil: es una herramienta del hub (D-306)", () => {
    const barra = leer("src/components/TopBar.tsx");
    expect(barra).not.toContain('case "vistamovil":');
    expect(barra).not.toContain("enlaceAVistaMovil(");
    // El enlace sigue existiendo para quien lo necesite (la propia vista móvil lo guarda en la URL).
    expect(enlaceAVistaMovil("/map")).toBe(`${RUTA_VISTA_MOVIL}?ruta=%2Fmap&ancho=${ANCHO_POR_DEFECTO}`);
  });
});
