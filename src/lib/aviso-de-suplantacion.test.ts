import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { empaquetar } from "@/lib/impersonation-cookie";
import { idiomaDelAviso, traduce } from "@/lib/aviso-de-suplantacion";
import { BotonVolverAMiUsuario, EtiquetaDeSuplantacion } from "@/components/SuplantacionEnBurbuja";
import { SwitchUserPanel } from "@/components/SwitchUserPanel";
import { PrefsConIdioma } from "@/lib/prefs";
import { ConfirmProvider } from "@/lib/confirm";
import type { Idioma } from "@/lib/idioma";
import type { Profile } from "@/lib/types";
import type { Suplantacion } from "@/lib/suplantacion-en-burbuja";

/**
 * El aviso de «Entrar como» (D-243) habla el idioma del admin y lleva el botón de vista (D-516).
 *
 * El dueño, 2026-10-11: «For some reason when i switch users the switch back language is spanish even though
 * the language is set to ENG». Y, con la vista móvil abierta: «EN ESE MISMO AMARILLO QUIERO QUE ESTE PARA
 * CMABIAR DE DESKTOP VIEW A MOBILE VIEW».
 *
 * Desde D-NEXT el aviso no es una franja arriba: es la burbuja naranja («Estás como…») con el botón rojo encima, y
 * «Cambiar usuario» y la vista van en su menú. Se PINTAN sus piezas sin estado en los dos idiomas: una prueba de texto
 * sobre el fuente pasaría igual con los textos fijos en español, que es justo el fallo que D-516 arregló.
 */

const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");
const burbuja = leer("src/components/BotonGeneral.tsx");
const sup = leer("src/components/SuplantacionEnBurbuja.tsx");

const ernesto = (o: Partial<Suplantacion> = {}): Suplantacion =>
  ({ como: "Ernesto Castillo", inicio: Date.now(), cambiaContrasena: false, idioma: "en", ...o });
const pinta = (o: Partial<Suplantacion> = {}, volviendo = false) =>
  renderToStaticMarkup(createElement("div", null,
    createElement(EtiquetaDeSuplantacion, { suplantacion: ernesto(o) }),
    createElement(BotonVolverAMiUsuario, { suplantacion: ernesto(o), volviendo, onVolver: () => {} })));

const INGLES = ["You're viewing as", "↩ Back to my user"];
const ESPANOL = ["Estás como", "↩ Volver a mi usuario"];

describe("en qué idioma habla el aviso", () => {
  it("el del admin que entró, si lo eligió: aunque la pantalla de este equipo diga otro", () => {
    expect(idiomaDelAviso({ delAdmin: "en", copiaLocal: JSON.stringify({ lang: "es" }) })).toBe("en");
    expect(idiomaDelAviso({ delAdmin: "es", copiaLocal: JSON.stringify({ lang: "en" }) })).toBe("es");
  });

  it("si nunca eligió, la copia de pantalla de este equipo; y si no hay, inglés", () => {
    expect(idiomaDelAviso({ delAdmin: null, copiaLocal: JSON.stringify({ lang: "es", theme: "dark" }) })).toBe("es");
    expect(idiomaDelAviso({ delAdmin: "fr", copiaLocal: "no-es-json" })).toBe("en");
    expect(idiomaDelAviso({ delAdmin: undefined, copiaLocal: null })).toBe("en");
  });

  it("`traduce` elige por el idioma, en los dos sentidos", () => {
    expect(traduce("en")("Back", "Volver")).toBe("Back");
    expect(traduce("es")("Back", "Volver")).toBe("Volver");
  });
});

describe("la burbuja naranja y el botón rojo, pintados en los dos idiomas", () => {
  it("en inglés, todo en inglés: nada en español", () => {
    const html = pinta({ idioma: "en" });
    for (const s of INGLES) expect(html, s).toContain(s.replace("'", "&#x27;"));
    expect(html).toContain("Ernesto Castillo");
    for (const s of ESPANOL) expect(html, s).not.toContain(s);
  });

  it("en español, todo en español: nada en inglés", () => {
    const html = pinta({ idioma: "es" });
    for (const s of ESPANOL) expect(html, s).toContain(s);
    for (const s of INGLES) expect(html, s).not.toContain(s.replace("'", "&#x27;"));
  });

  it("la contraseña temporal (D-486) pone una 🔑 en la burbuja; y el «volviendo» desactiva el botón rojo", () => {
    expect(pinta({ cambiaContrasena: true })).toContain("🔑");
    expect(pinta({ cambiaContrasena: false })).not.toContain("🔑");
    expect(pinta({ idioma: "en" }, true)).toContain("Going back…");
    expect(pinta({ idioma: "es" }, true)).toContain("Volviendo…");
    expect(pinta({}, true)).toMatch(/<button[^>]*disabled=""/);
    expect(pinta({}, false)).not.toMatch(/disabled=""/);
  });

  it("el botón rojo es el de peligro de la app, del alto de un dedo (clase `.fab-volver`)", () => {
    const html = pinta();
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toContain('class="btn btn-danger fab-volver"');
    expect(leer("src/app/globals.css")).toMatch(/\.fab-volver \{\n\s*min-height: 44px;/);
  });
});

describe("el botón de vista: «Vista móvil» fuera del marco, «Vista de escritorio» dentro (en el menú de la burbuja)", () => {
  it("dentro de una suplantación, el texto lo decide `botonDeVista` con el marco, y habla el idioma del admin", () => {
    expect(burbuja).toContain('const escritorio = botonDeVista({ enMarco: sup.enMarco, pathname: pathname || "/" }).vista === "escritorio";');
    expect(burbuja).toContain('{escritorio ? tAdmin("Desktop view", "Vista de escritorio") : tAdmin("Mobile view", "Vista móvil")}');
    // Con el selector de variante (U+FE0F), como «🖥️» en Ayuda: sin él, Chrome lo pinta como glifo de texto.
    expect(burbuja).toContain('{escritorio ? "🖥️" : "📱"}');
    expect(burbuja).toContain("onClick={() => { cierra(); sup.cambiarDeVista(); }}");
  });

  it("al pulsar se decide de nuevo con la ruta de ese momento y se navega la pestaña de arriba", () => {
    expect(sup).toContain("setEnMarco(estaEnUnMarco(window));");
    const pulsar = sup.slice(sup.indexOf("const cambiarDeVista = useCallback"), sup.indexOf("return { estado"));
    expect(pulsar).toContain("enMarco: estaEnUnMarco(window),");
    expect(pulsar).toContain("rutaDelMarco: rutaDelMarcoAbierto(),");
    expect(pulsar).toContain("irArriba(b.destino);");
    expect(sup).toContain("(window.top ?? window).location.assign(destino);");
  });
});

describe("el panel de «Cambiar usuario» que se abre desde el aviso habla el idioma del aviso", () => {
  const ernesto = { id: "u1", full_name: "Ernesto Castillo", role: "driver", store: null } as unknown as Profile;
  const panel = (lang: Idioma) =>
    renderToStaticMarkup(createElement(PrefsConIdioma, { lang } as Parameters<typeof PrefsConIdioma>[0],
      createElement(ConfirmProvider, null,
        createElement(SwitchUserPanel, { users: [ernesto], tiendas: [], modo: "saltar", onClose: () => {} }))));

  it("en inglés y en español, con el mismo contexto que `usePrefs` (si no, el panel no se montaría)", () => {
    expect(panel("en")).toContain("Search by name…");
    expect(panel("en")).not.toContain("Buscar por nombre…");
    expect(panel("es")).toContain("Buscar por nombre…");
    expect(panel("es")).not.toContain("Search by name…");
  });

  it("`PrefsConIdioma` no lee ni guarda nada: ni la base, ni `localStorage`, ni `<html lang>`", () => {
    const prefs = leer("src/lib/prefs.tsx");
    const fijo = prefs.slice(prefs.indexOf("export function PrefsConIdioma("));
    expect(fijo.length).toBeGreaterThan(100);
    for (const s of ["localStorage", "setAttribute", "createClient", "useEffect"]) expect(fijo, s).not.toContain(s);
  });
});

describe("la burbuja le pasa a sus piezas lo que toca (el cableado)", () => {
  it("el idioma sale de lo que dice el servidor del admin, con la copia de pantalla de respaldo", () => {
    expect(sup).toContain("setEstado(suplantacionDelEstado(d, leeCopiaLocal()));");
    expect(leer("src/lib/suplantacion-en-burbuja.ts")).toContain("idioma: idiomaDelAviso({ delAdmin: r.idioma, copiaLocal }),");
    expect(burbuja).toContain("<PrefsConIdioma lang={sup.estado.idioma}>");
    expect(burbuja).toContain("const tAdmin = sup.estado ? traduce(sup.estado.idioma) : t;");
  });
});

// ---- /api/impersonate/state dice el idioma del ADMIN, no el de la sesión ---------------------------------

const f = vi.hoisted(() => ({
  cookie: null as string | null,
  idiomas: {} as Record<string, string | null>,
  pedidos: [] as string[],
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "rtg_impersonation_return" && f.cookie !== null ? { value: f.cookie } : undefined) }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "chofer-1", email: "e@x", user_metadata: {} } } }) },
    from: () => ({
      select: (cols: string) => ({
        eq: (_c: string, id: string) => ({
          maybeSingle: async () => {
            f.pedidos.push(`${id}:${cols}`);
            return { data: { full_name: id === "chofer-1" ? "Ernesto Castillo" : "El admin", role: id === "chofer-1" ? "driver" : "admin", language: f.idiomas[id] ?? null }, error: null };
          },
        }),
      }),
    }),
  }),
}));

import { GET as estado } from "@/app/api/impersonate/state/route";

const pide = async () => (await estado(new Request("http://localhost/api/impersonate/state"))).json();

beforeEach(() => {
  f.cookie = null;
  f.idiomas = {};
  f.pedidos = [];
});

describe("GET /api/impersonate/state: el idioma del aviso", () => {
  it("dentro de una suplantación, el idioma del admin de la cookie, aunque la persona tenga otro", async () => {
    f.cookie = empaquetar({ refresh: "rt", adminId: "admin-1", comoId: "chofer-1", inicio: Date.now() });
    f.idiomas = { "admin-1": "en", "chofer-1": "es" };
    expect(await pide()).toMatchObject({ como: "Ernesto Castillo", idioma: "en" });
    expect(f.pedidos).toContain("admin-1:language");
    f.idiomas = { "admin-1": "es", "chofer-1": "en" };
    expect((await pide()).idioma).toBe("es");
  });

  it("si el admin nunca eligió, `null` (y el aviso tira de la copia de pantalla)", async () => {
    f.cookie = empaquetar({ refresh: "rt", adminId: "admin-1", comoId: "chofer-1", inicio: Date.now() });
    expect((await pide()).idioma).toBeNull();
  });

  it("fuera de una suplantación no pregunta nada: la carga de casi todos sigue costando lo mismo", async () => {
    expect(await pide()).toEqual({});
    expect(f.pedidos).toEqual([]);
  });
});
