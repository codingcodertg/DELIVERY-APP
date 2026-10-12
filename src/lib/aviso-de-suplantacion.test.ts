import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { empaquetar } from "@/lib/impersonation-cookie";
import { idiomaDelAviso, traduce } from "@/lib/aviso-de-suplantacion";
import { AvisoDeSuplantacion } from "@/components/ImpersonationBanner";
import { SwitchUserPanel } from "@/components/SwitchUserPanel";
import { PrefsConIdioma } from "@/lib/prefs";
import { ConfirmProvider } from "@/lib/confirm";
import type { Idioma } from "@/lib/idioma";
import type { Profile } from "@/lib/types";

/**
 * El aviso amarillo de «Entrar como» (D-243) habla el idioma del admin y lleva el botón de vista (D-516).
 *
 * El dueño, 2026-10-11: «For some reason when i switch users the switch back language is spanish even though
 * the language is set to ENG». Y, con la vista móvil abierta: «EN ESE MISMO AMARILLO QUIERO QUE ESTE PARA
 * CMABIAR DE DESKTOP VIEW A MOBILE VIEW».
 *
 * Se PINTA el aviso (su parte sin estado) en los dos idiomas: una prueba de texto sobre el fuente pasaría
 * igual con los textos fijos en español, que es justo el fallo que se arregla.
 */

const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");
const banner = leer("src/components/ImpersonationBanner.tsx");

const pinta = (o: Partial<Parameters<typeof AvisoDeSuplantacion>[0]> = {}) =>
  renderToStaticMarkup(createElement(AvisoDeSuplantacion, {
    como: "Ernesto Castillo", idioma: "en", cambiaContrasena: false, volviendo: false,
    onVolver: () => {}, saltando: false, onSalto: () => {}, vista: "movil", onVista: () => {},
    ...o,
  }));

const INGLES = ["👤 Signed in as", "↩ Back to my account", "⇄ Switch user"];
const ESPANOL = ["👤 Estás como", "↩ Volver a mi cuenta", "⇄ Cambiar usuario"];

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

describe("el aviso pintado, en los dos idiomas", () => {
  it("en inglés, todo en inglés: nada en español", () => {
    const html = pinta({ idioma: "en" });
    for (const s of INGLES) expect(html, s).toContain(s);
    expect(html).toContain("Ernesto Castillo");
    expect(html).toContain('aria-label="Mobile view"');
    expect(html).toContain('<span class="aviso-vista-texto" aria-hidden="true"> Mobile view</span>');
    for (const s of [...ESPANOL, "Vista móvil"]) expect(html, s).not.toContain(s);
  });

  it("en español, todo en español: nada en inglés", () => {
    const html = pinta({ idioma: "es" });
    for (const s of ESPANOL) expect(html, s).toContain(s);
    expect(html).toContain('aria-label="Vista móvil"');
    expect(html).toContain('<span class="aviso-vista-texto" aria-hidden="true"> Vista móvil</span>');
    for (const s of [...INGLES, "Mobile view"]) expect(html, s).not.toContain(s);
  });

  it("la frase de la contraseña temporal (D-486) y el «volviendo», también", () => {
    expect(pinta({ idioma: "en", cambiaContrasena: true })).toContain("🔑 Temporary password");
    expect(pinta({ idioma: "es", cambiaContrasena: true })).toContain("🔑 Contraseña temporal");
    expect(pinta({ idioma: "en", cambiaContrasena: false })).not.toContain("🔑");
    expect(pinta({ idioma: "en", volviendo: true })).toContain("Going back…");
    expect(pinta({ idioma: "es", volviendo: true })).toContain("Volviendo…");
  });
});

describe("el botón de vista: «Vista móvil» fuera del marco, «Vista de escritorio» dentro", () => {
  it("fuera del marco ofrece la vista móvil", () => {
    const html = pinta({ vista: "movil" });
    expect(html).toContain('data-cambia-vista="movil"');
    expect(html).toContain('<span aria-hidden="true">📱</span>');
    expect(html).toContain('aria-label="Mobile view"');
    expect(html).not.toContain("Desktop view");
    expect(html).not.toContain("🖥");
  });

  it("dentro ofrece salir a tamaño normal, en los dos idiomas", () => {
    const en = pinta({ vista: "escritorio", idioma: "en" });
    expect(en).toContain('data-cambia-vista="escritorio"');
    // Con el selector de variante (U+FE0F), como «🖥️» en Ayuda: sin él, Chrome lo pinta como glifo de texto.
    expect(en).toContain('<span aria-hidden="true">🖥️</span>');
    expect(en).toContain('aria-label="Desktop view"');
    expect(en).not.toContain("Mobile view");
    expect(en).not.toContain("📱");
    expect(pinta({ vista: "escritorio", idioma: "es" })).toContain('aria-label="Vista de escritorio"');
  });

  it("en un ancho de teléfono (y en el marco) solo el icono: el texto se esconde por CSS, el nombre queda en aria-label", () => {
    // Medido en el demo a 390 px: con el texto, el aviso pasaba de 71 a 113 px (de dos filas a tres).
    expect(leer("src/app/globals.css")).toContain("@media (max-width: 640px) { .aviso-vista-texto { display: none; } }");
    const html = pinta({ vista: "escritorio" });
    expect(html.match(/class="aviso-vista-texto"/g)).toHaveLength(1);
  });

  it("cuatro cosas cortas y nada más: tres botones pequeños en la misma fila que el nombre (D-483)", () => {
    const html = pinta();
    expect(html.match(/<button/g)).toHaveLength(3);
    expect(html.match(/class="btn[^"]*btn-sm"/g)).toHaveLength(3);
    expect(html).toContain("flex-wrap:wrap");
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

describe("el banner le pasa al aviso lo que toca (el cableado)", () => {
  it("el idioma sale de lo que dice el servidor del admin, con la copia de pantalla de respaldo", () => {
    expect(banner).toContain("idioma: idiomaDelAviso({ delAdmin: d.idioma, copiaLocal: leeCopiaLocal() }),");
    expect(banner).toContain("idioma={estado.idioma}");
    expect(banner).toContain("<PrefsConIdioma lang={estado.idioma}>");
    // El aviso traduce con el idioma que recibe, no con uno puesto.
    expect(banner).toContain("const t = traduce(p.idioma);");
  });

  it("el botón: el texto según el marco y la ruta; al pulsar, se decide de nuevo y se navega la pestaña de arriba", () => {
    expect(banner).toContain("setEnMarco(estaEnUnMarco(window));");
    expect(banner).toContain('vista={botonDeVista({ enMarco, pathname: pathname || "/" }).vista}');
    const pulsar = banner.slice(banner.indexOf("const cambiarDeVista = useCallback"), banner.indexOf("if (!estado) return null;"));
    expect(pulsar).toContain("enMarco: estaEnUnMarco(window),");
    expect(pulsar).toContain("rutaDelMarco: rutaDelMarcoAbierto(),");
    expect(pulsar).toContain("irArriba(b.destino);");
    expect(banner).toContain("(window.top ?? window).location.assign(destino);");
    expect(banner).toContain("onVista={cambiarDeVista}");
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
