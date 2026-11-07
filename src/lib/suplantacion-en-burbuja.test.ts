import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  RUTA_DE_VUELTA, RUTA_DEL_ESTADO, burbujaEnLaRuta, colorDeLaBurbuja, suplantacionDelEstado, textosDeSuplantacion,
  tocaVolverSolo, volverAMiCuenta, type Suplantacion,
} from "@/lib/suplantacion-en-burbuja";
import { opcionesDelBotonGeneral } from "@/lib/boton-general";
import { IMPERSONACION_MINUTOS } from "@/lib/impersonation";

/**
 * D-859 (2026-11-04). El dueño: «cuando haces el switch user, el tag verde de arriba estorba y quita mucho espacio
 * […] la burbuja simplemente se pone naranja y le dice "oye, estás en otro usuario". Encima de la burbuja naranja hay
 * otro botón rojo que dice "volver a mi usuario". Si vuelvo a pulsar la burbuja naranja, me salen las opciones de
 * seguir cambiando a otro usuario o a la vista móvil».
 *
 * Lo que decide, importado: cuándo es naranja, qué dice, en qué rutas sale, qué opciones lleva, y que la vuelta es LA
 * MISMA de la franja (la misma ruta, el mismo cuerpo, la misma recarga a la portada de la app).
 */

const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");
const ernesto: Suplantacion = { como: "Ernesto Castillo", inicio: 1_000_000, cambiaContrasena: false, idioma: "en" };

describe("cuándo es naranja", () => {
  it("naranja solo dentro de una suplantación; fuera, la burbuja de siempre", () => {
    expect(colorDeLaBurbuja(ernesto)).toBe("naranja");
    expect(colorDeLaBurbuja(null)).toBe("normal");
  });

  it("la respuesta del servidor se lee igual que la leía la franja: sin nombre o sin hora, no hay suplantación", () => {
    expect(suplantacionDelEstado({}, null)).toBeNull();               // el caso de casi todas las cargas
    expect(suplantacionDelEstado(null, null)).toBeNull();
    expect(suplantacionDelEstado({ como: "Ernesto" }, null)).toBeNull();
    expect(suplantacionDelEstado({ como: "", inicio: 5 }, null)).toBeNull();
    expect(suplantacionDelEstado({ como: "Ernesto", inicio: "5" }, null)).toBeNull();
    expect(suplantacionDelEstado({ como: "Ernesto", inicio: 5, cambiaContrasena: true, idioma: "es" }, null))
      .toEqual({ como: "Ernesto", inicio: 5, cambiaContrasena: true, idioma: "es" });
    // `cambiaContrasena` solo con `true` de verdad.
    expect(suplantacionDelEstado({ como: "E", inicio: 5, cambiaContrasena: "yes" }, null)?.cambiaContrasena).toBe(false);
  });

  it("el idioma es el del admin (D-516), con la copia de pantalla de este equipo de respaldo", () => {
    expect(suplantacionDelEstado({ como: "E", inicio: 5, idioma: "en" }, JSON.stringify({ lang: "es" }))?.idioma).toBe("en");
    expect(suplantacionDelEstado({ como: "E", inicio: 5, idioma: null }, JSON.stringify({ lang: "es" }))?.idioma).toBe("es");
    expect(suplantacionDelEstado({ como: "E", inicio: 5 }, null)?.idioma).toBe("en");
  });
});

describe("qué dice", () => {
  it("la burbuja: «Estás como {nombre}», en el idioma del admin", () => {
    expect(textosDeSuplantacion({ como: "Ernesto", idioma: "en" }).etiqueta).toBe("You're viewing as Ernesto");
    expect(textosDeSuplantacion({ como: "Ernesto", idioma: "es" }).etiqueta).toBe("Estás como Ernesto");
  });

  it("el globo/nombre accesible dice además qué pasa al pulsarla", () => {
    expect(textosDeSuplantacion({ como: "Ernesto", idioma: "en" }).titulo).toMatch(/^You're viewing as Ernesto\. Tap for options: switch user, mobile view/);
    expect(textosDeSuplantacion({ como: "Ernesto", idioma: "es" }).titulo).toMatch(/^Estás como Ernesto\. Pulsa para ver las opciones: cambiar usuario, vista móvil/);
  });

  it("el botón rojo: «↩ Volver a mi usuario», y «Volviendo…» mientras vuelve", () => {
    expect(textosDeSuplantacion({ como: "E", idioma: "en" }).volver).toBe("↩ Back to my user");
    expect(textosDeSuplantacion({ como: "E", idioma: "es" }).volver).toBe("↩ Volver a mi usuario");
    expect(textosDeSuplantacion({ como: "E", idioma: "en", volviendo: true }).volver).toBe("Going back…");
    expect(textosDeSuplantacion({ como: "E", idioma: "es", volviendo: true }).volver).toBe("Volviendo…");
  });

  it("la frase de la contraseña temporal (D-486) solo si toca", () => {
    expect(textosDeSuplantacion({ como: "E", idioma: "en" }).contrasena).toBeNull();
    expect(textosDeSuplantacion({ como: "E", idioma: "en", cambiaContrasena: true }).contrasena).toContain("🔑 Temporary password");
    expect(textosDeSuplantacion({ como: "E", idioma: "es", cambiaContrasena: true }).contrasena).toContain("🔑 Contraseña temporal");
  });
});

describe("dónde sale y qué lleva", () => {
  it("fuera de una suplantación, donde la Ayuda (igual que hoy); dentro, en TODAS las rutas (D-243: el aviso no falta nunca)", () => {
    expect(burbujaEnLaRuta("/", false)).toBe(true);
    expect(burbujaEnLaRuta("/login", false)).toBe(false);
    expect(burbujaEnLaRuta("/no-access", false)).toBe(false);
    expect(burbujaEnLaRuta("/no-access", true)).toBe(true);      // entrar como alguien sin apps cae aquí
    expect(burbujaEnLaRuta("/track/abc", true)).toBe(true);
    expect(burbujaEnLaRuta("/recruiting", true)).toBe(true);
  });

  it("fuera de una suplantación, las opciones de siempre", () => {
    // D-913: «Tutoriales» para todos, después del Chat.
    expect(opcionesDelBotonGeneral({ adminReal: false, switchHabilitado: false })).toEqual(["ayuda", "chat", "tutoriales", "ensenanza"]);
    expect(opcionesDelBotonGeneral({ adminReal: true, switchHabilitado: true })).toEqual(["ayuda", "chat", "tutoriales", "usuario", "movil", "ensenanza"]);
    expect(opcionesDelBotonGeneral({ adminReal: true, switchHabilitado: false })).toEqual(["ayuda", "chat", "tutoriales", "movil", "ensenanza"]);
    // Con `suplantando: false` explícito, lo mismo.
    expect(opcionesDelBotonGeneral({ adminReal: true, switchHabilitado: true, suplantando: false, ayudaAqui: true }))
      .toEqual(["ayuda", "chat", "tutoriales", "usuario", "movil", "ensenanza"]);
  });

  it("dentro: siguen «Cambiar usuario» y «Vista móvil» aunque el servidor diga que no es admin real (lo que llevaba la franja)", () => {
    expect(opcionesDelBotonGeneral({ adminReal: false, switchHabilitado: false, suplantando: true, ayudaAqui: true }))
      .toEqual(["ayuda", "chat", "tutoriales", "usuario", "movil", "ensenanza"]);
  });

  it("dentro y en una pantalla sin Ayuda: solo las dos de la suplantación", () => {
    expect(opcionesDelBotonGeneral({ adminReal: false, switchHabilitado: false, suplantando: true, ayudaAqui: false }))
      .toEqual(["usuario", "movil"]);
  });
});

describe("la vuelta: la misma de la franja", () => {
  const navFalso = (pathname: string, falla = false) => {
    const llamadas: { url: string; init?: RequestInit }[] = [];
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      llamadas.push({ url, init });
      if (falla) throw new Error("sin red");
      return new Response("{}");
    }) as unknown as typeof globalThis.fetch;
    const ubicacion = { pathname, href: `https://x${pathname}` };
    return { llamadas, fetch, ubicacion };
  };

  it("POST a /api/impersonate/return con el motivo, y recarga a la portada de la app en la que se está (D-623)", async () => {
    const n = navFalso("/recruiting/candidatos/7");
    await volverAMiCuenta("manual", n);
    expect(n.llamadas).toHaveLength(1);
    expect(n.llamadas[0].url).toBe("/api/impersonate/return");
    expect(n.llamadas[0].init?.method).toBe("POST");
    expect(JSON.parse(String(n.llamadas[0].init?.body))).toEqual({ motivo: "manual" });
    expect(n.ubicacion.href).toBe("/recruiting");
  });

  it("la de la hora manda «expired»; desde Entregas cae en Entregas y desde el hub en el hub", async () => {
    const e = navFalso("/orders/123");
    await volverAMiCuenta("expired", e);
    expect(JSON.parse(String(e.llamadas[0].init?.body))).toEqual({ motivo: "expired" });
    expect(e.ubicacion.href).toBe("/");
    const h = navFalso("/home/users");
    await volverAMiCuenta("manual", h);
    expect(h.ubicacion.href).toBe("/home");
  });

  it("un fallo de red no la para: recarga igual y el servidor decide", async () => {
    const n = navFalso("/timetracker", true);
    await volverAMiCuenta("manual", n);
    expect(n.ubicacion.href).toBe("/timetracker");
  });

  it("las rutas son las de siempre, sin bandera (D-243)", () => {
    expect(RUTA_DE_VUELTA).toBe("/api/impersonate/return");
    expect(RUTA_DEL_ESTADO).toBe("/api/impersonate/state");
  });

  it("vuelve sola al cumplirse la hora, con la misma cuenta que el servidor", () => {
    const ahora = ernesto.inicio + IMPERSONACION_MINUTOS * 60_000;
    expect(tocaVolverSolo(ernesto, ahora - 1)).toBe(false);
    expect(tocaVolverSolo(ernesto, ahora)).toBe(true);
    expect(tocaVolverSolo(null, ahora * 2)).toBe(false);
  });

  it("el botón rojo y la hora llaman a ESA vuelta, y no hay otra: nadie más hace POST a la ruta de volver", () => {
    const sup = leer("src/components/SuplantacionEnBurbuja.tsx");
    expect(sup).toContain("await volverAMiCuenta(motivo, { fetch: window.fetch.bind(window), ubicacion: window.location });");
    expect(leer("src/components/BotonGeneral.tsx")).toContain('onVolver={() => void sup.volver("manual")}');
    expect(sup).toContain('void volver("expired")');
    for (const f of ["src/components/BotonGeneral.tsx", "src/components/SuplantacionEnBurbuja.tsx"]) {
      expect(leer(f), f).not.toContain("/api/impersonate/return");
    }
  });
});

describe("el aspecto: naranja con tokens, el rojo encima, del alto de un dedo y sin tapar más de la cuenta", () => {
  const css = leer("src/app/globals.css");
  const burbuja = leer("src/components/BotonGeneral.tsx");

  it("naranja con `--amber` y texto `--ink` (oscuro en los dos temas); nada de colores a pelo", () => {
    expect(css).toMatch(/\.fab-general\.suplantando \{[^}]*background: var\(--amber\); color: var\(--ink\);/);
    const reglas = css.slice(css.indexOf(".fab-general.suplantando {"), css.indexOf(":root:has(.fab-general-caja.suplantando) { --hueco-de-ayuda: 136px; }"));
    expect(reglas).not.toMatch(/#[0-9a-f]{3,6}\b/i);
  });

  it("el botón rojo va ENCIMA de la burbuja en el documento (la caja es una columna que acaba en la burbuja)", () => {
    const rojo = burbuja.indexOf("<BotonVolverAMiUsuario ");
    const boton = burbuja.indexOf('className={"fab-general"');
    expect(rojo).toBeGreaterThan(burbuja.indexOf('<div className="fab-menu"'));
    expect(rojo).toBeLessThan(boton);
    expect(css).toContain(".fab-general-caja { position: fixed; right: 20px; bottom: 20px; z-index: 1000; display: flex; flex-direction: column;");
  });

  it("los dos, de al menos 44 px de alto", () => {
    expect(css).toMatch(/\.fab-volver \{\n\s*min-height: 44px;/);
    expect(css).toContain("width: 46px; height: 46px;");   // la burbuja, que en naranja solo crece a lo ancho
    expect(css).toMatch(/\.fab-general\.suplantando \{\n\s*width: auto;/);
  });

  it("el hueco de abajo crece mientras está el rojo, y solo entonces (D-530)", () => {
    expect(css).toContain(":root:has(.fab-general-caja.suplantando) { --hueco-de-ayuda: 136px; }");
    expect(css).toContain(":root:has(.fab-general-caja.suplantando) .wrap { padding-bottom: var(--hueco-de-ayuda); }");
    expect(css).toContain(":root { --hueco-de-ayuda: 80px; }");
    expect(burbuja).toContain('className={"fab-general-caja no-print" + (naranja ? " suplantando" : "")}');
  });
});
