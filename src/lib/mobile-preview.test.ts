import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { ANCHO_POR_DEFECTO, RUTA_VISTA_MOVIL, TAMANOS_MOVIL, anchoElegido, botonDeVista, enlaceAVistaMovil, esLaVistaMovil, estaEnUnMarco, rutaParaElMarco } from "./mobile-preview";

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
  it("la puerta es del servidor: el admin por el rol de la sesión, o un admin suplantando (D-NEXT)", () => {
    const puerta = leer("src/app/home/vista-movil/layout.tsx");
    expect(leer("src/lib/vista-movil-servidor.ts")).toContain("auth.getUser()");
    expect(puerta).toContain("await perfilDeLaVistaMovil()");
    // La regla entera vive en `puedeAbrirLaVistaMovil` (probada con datos en vista-movil-acceso.test.ts).
    expect(puerta).toContain("if (!puedeAbrirLaVistaMovil({ rolDeLaSesion: perfil.role, usuarioId: user.id, suplantacion, ahora: Date.now() })) {");
    expect(puerta).toContain("redirect(landingRoute(perfil));");
    expect(puerta.indexOf("puedeAbrirLaVistaMovil({")).toBeLessThan(puerta.indexOf("redirect(landingRoute(perfil))"));
    expect(puerta.indexOf("redirect(landingRoute(perfil))")).toBeLessThan(puerta.indexOf("{children}"));
  });

  it("la página sanea lo que llega por la URL antes de dárselo al marco, y sin ruta abre el inicio del rol (D-NEXT)", () => {
    const pagina = leer("src/app/home/vista-movil/page.tsx");
    expect(pagina).toContain('const inicio = perfil?.role ? roleHome(perfil.role) : "/";');
    expect(pagina).toContain("<VistaMovil rutaInicial={rutaParaElMarco(ruta, inicio)} rutaDeInicio={inicio} anchoInicial={anchoElegido(ancho)} />");
  });

  it("el marco solo carga rutas saneadas, y nada se guarda en localStorage", () => {
    const vista = leer("src/components/VistaMovil.tsx");
    expect(vista).toContain("src={ruta}");
    expect(vista.match(/setRuta\(/g)).toHaveLength(1);
    expect(vista).toContain("const segura = rutaParaElMarco(nuevaRuta, rutaDeInicio);");
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

  it("la barra de Entregas lleva a la vista móvil con un botón junto a «Switch user», no desde el menú (D-483 deshace D-306)", () => {
    const barra = leer("src/components/TopBar.tsx");
    expect(barra).not.toContain('case "vistamovil":');
    expect(barra).toContain("enlaceAVistaMovil(pathname");
    // El enlace sigue existiendo para quien lo necesite (la propia vista móvil lo guarda en la URL).
    expect(enlaceAVistaMovil("/map")).toBe(`${RUTA_VISTA_MOVIL}?ruta=%2Fmap&ancho=${ANCHO_POR_DEFECTO}`);
  });
});

// ---- D-NEXT: el botón del aviso amarillo, y el marco sin ruta -------------------------------------------

describe("sin ruta (o con una que no vale), el marco abre la pantalla de inicio que se le diga", () => {
  it("la de inicio del rol, no siempre la portada", () => {
    expect(rutaParaElMarco(undefined, "/driver")).toBe("/driver");
    expect(rutaParaElMarco("", "/driver")).toBe("/driver");
    expect(rutaParaElMarco("//evil.com", "/driver")).toBe("/driver");
    expect(rutaParaElMarco(RUTA_VISTA_MOVIL, "/driver")).toBe("/driver");
    // Una ruta que vale, tal cual: el marco no fuerza nada (la página de un rol que no es el suyo la decide la app).
    expect(rutaParaElMarco("/", "/driver")).toBe("/");
    expect(rutaParaElMarco("/map", "/driver")).toBe("/map");
  });

  it("y una pantalla de inicio que no vale, o que es la propia vista móvil, cae en la portada", () => {
    expect(rutaParaElMarco(undefined, "//evil.com")).toBe("/");
    expect(rutaParaElMarco(undefined, `${RUTA_VISTA_MOVIL}?ruta=/x`)).toBe("/");
  });
});

describe("el botón de vista del aviso amarillo: qué sale y adónde lleva", () => {
  it("fuera del marco: «Vista móvil», con esta pantalla y su consulta", () => {
    expect(botonDeVista({ enMarco: false, pathname: "/map", search: "?dia=hoy" }))
      .toEqual({ vista: "movil", destino: enlaceAVistaMovil("/map?dia=hoy") });
    expect(botonDeVista({ enMarco: false, pathname: "/driver" }).destino).toBe(`${RUTA_VISTA_MOVIL}?ruta=%2Fdriver&ancho=${ANCHO_POR_DEFECTO}`);
  });

  it("dentro del marco: «Vista de escritorio», con ESTA pantalla, saneada", () => {
    expect(botonDeVista({ enMarco: true, pathname: "/driver", search: "?x=1" })).toEqual({ vista: "escritorio", destino: "/driver?x=1" });
    expect(botonDeVista({ enMarco: true, pathname: "//evil.com" })).toEqual({ vista: "escritorio", destino: "/" });
  });

  it("en la propia página de la vista móvil (fuera del marco): «Vista de escritorio», con lo que hay en el marco", () => {
    const aqui = { enMarco: false, pathname: RUTA_VISTA_MOVIL, search: "?ruta=%2Fmap&ancho=390" };
    // Lo que tiene cargado el marco ahora (se navega dentro y la URL de fuera no se entera)...
    expect(botonDeVista({ ...aqui, rutaDelMarco: "/my-route" })).toEqual({ vista: "escritorio", destino: "/my-route" });
    // ...y si no se puede leer, la ruta de la URL.
    expect(botonDeVista({ ...aqui, rutaDelMarco: null })).toEqual({ vista: "escritorio", destino: "/map" });
    expect(botonDeVista({ ...aqui, rutaDelMarco: "//evil.com" }).destino).toBe("/");
    // Nunca «Vista móvil» de la vista móvil.
    expect(botonDeVista({ enMarco: false, pathname: `${RUTA_VISTA_MOVIL}/x` }).vista).toBe("escritorio");
  });

  it("control: un prefijo parecido no es la vista móvil", () => {
    expect(esLaVistaMovil(`${RUTA_VISTA_MOVIL}-no`)).toBe(false);
    expect(esLaVistaMovil(`${RUTA_VISTA_MOVIL}?ruta=/`)).toBe(true);
    expect(botonDeVista({ enMarco: false, pathname: `${RUTA_VISTA_MOVIL}-no` }).vista).toBe("movil");
  });
});
