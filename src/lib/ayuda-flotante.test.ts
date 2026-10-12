import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextResponse } from "next/server";
import { DEFAULT_HELP_EMAIL } from "./constants";
import { RUTAS_SIN_AYUDA, ayudaEnLaRuta, destinoDeAyuda } from "./ayuda-flotante";
import { pideContactoDeAyuda, rolDeQuienEscribe } from "./help-send";
import { PrefsConIdioma } from "./prefs";

/**
 * La burbuja de Ayuda, la misma en todas las apps (D-530).
 *
 * El dueño, el 2026-10-11: «the help buttom bubble should be evene thoguht all the apps». Hasta ese día solo la
 * montaba Entregas. Lo que se prueba aquí, por lo que rompería:
 * - que la monta UN sitio, el layout raíz, y nadie más (no hay copias que se separen);
 * - dónde no sale (las pantallas sin sesión) y que en todas las demás sale IGUAL — el mismo HTML, byte a byte;
 * - que ya no depende de Entregas: quién escribe y el teléfono los da `/api/help`, y el destino lo pone el servidor;
 * - que no tapa lo que las apps pegan al fondo, y que lo último de cada página puede subir por encima de ella.
 */

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const sinComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .split("\n").map((l) => (/^\s*\/\//.test(l) ? "" : l.replace(/\s\/\/.*$/, ""))).join("\n");

function ficheros(dir: string, re: RegExp): string[] {
  const out: string[] = [];
  const recorre = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) recorre(p);
      else if (re.test(f)) out.push(p.split("\\").join("/"));
    }
  };
  recorre(dir);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Dónde sale
// ---------------------------------------------------------------------------------------------------------------

describe("dónde sale la burbuja", () => {
  it("en todas las apps: Entregas, el hub, Time Tracker, RR. HH., el ERP, Quote Builder, Leads, Encuestas y Promociones", () => {
    for (const ruta of [
      "/", "/my-route", "/my-route/mapa", "/routes", "/driver", "/warehouse", "/settings",
      "/home", "/home/personalizar", "/home/ayuda",
      "/timetracker", "/timetracker/week", "/timetracker/payroll",
      "/recruiting", "/recruiting/board", "/erp/dashboard", "/erp/catalog",
      "/estimator", "/leads", "/surveys", "/promos", "/promos/ronda-1",
    ]) expect(ayudaEnLaRuta(ruta), ruta).toBe(true);
  });

  it("«Rastreo» de Entregas (/track) sí; el enlace del CLIENTE (/track/<id>) no", () => {
    expect(ayudaEnLaRuta("/track")).toBe(true);
    expect(ayudaEnLaRuta("/track/abc123")).toBe(false);
  });

  it("no en las pantallas de antes (o de fuera) de las apps", () => {
    for (const ruta of [
      "/login", "/login/otra", "/auth/callback", "/reset-password", "/change-password", "/no-access",
      "/unsubscribe/token-1",
    ]) expect(ayudaEnLaRuta(ruta), ruta).toBe(false);
  });

  it("el separador importa: /loginx o /trackers no son el login ni el enlace del cliente", () => {
    expect(ayudaEnLaRuta("/loginx")).toBe(true);
    expect(ayudaEnLaRuta("/trackers")).toBe(true);
    expect(ayudaEnLaRuta(null)).toBe(true);
  });

  it("recorriendo TODAS las páginas de src/app: solo las de antes de las apps se quedan sin burbuja", () => {
    // Una página nueva sin sesión (como /track/<id>) obliga a decidir aquí; una app nueva la tiene sola.
    const urls = ficheros("src/app", /^page\.tsx$/).map((f) => {
      const segmentos = f.replace(/^src\/app\//, "").replace(/\/?page\.tsx$/, "").split("/")
        .filter((s) => s && !/^\(.*\)$/.test(s))
        .map((s) => (/^\[.*\]$/.test(s) ? "x" : s));
      return "/" + segmentos.join("/");
    });
    expect(urls.length).toBeGreaterThan(80);
    const sinBurbuja = urls.filter((u) => !ayudaEnLaRuta(u)).sort();
    expect(sinBurbuja).toEqual(["/change-password", "/login", "/no-access", "/reset-password", "/track/x", "/unsubscribe/x"]);
    // Y cada ruta de la lista lleva su porqué.
    for (const r of RUTAS_SIN_AYUDA) expect(r.porque.length, r.ruta).toBeGreaterThan(10);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Un componente, un sitio
// ---------------------------------------------------------------------------------------------------------------

describe("un componente, montado una vez, en el layout raíz", () => {
  it("el layout raíz monta <HelpButton /> dentro de PrefsProvider (habla el idioma de la persona)", () => {
    const layout = sinComentarios(leer("src/app/layout.tsx"));
    expect(layout).toContain('import { HelpButton } from "@/components/HelpButton";');
    const dentro = layout.slice(layout.indexOf("<PrefsProvider>"), layout.indexOf("</PrefsProvider>"));
    expect(dentro).toContain("<HelpButton />");
  });

  it("nadie más la monta: ni Entregas, ni el demo, ni ninguna app (no hay copias)", () => {
    const montan = ficheros("src", /\.tsx$/).filter((f) => sinComentarios(readFileSync(f, "utf8")).includes("<HelpButton"));
    expect(montan).toEqual(["src/app/layout.tsx"]);
    expect(sinComentarios(leer("src/app/(app)/layout.tsx"))).not.toContain("HelpButton");
    expect(sinComentarios(leer("src/components/LocalApp.tsx"))).not.toContain("HelpButton");
  });

  it("ya no depende de Entregas: ni su DataProvider ni un `me` que solo Entregas tiene", () => {
    const boton = sinComentarios(leer("src/components/HelpButton.tsx"));
    expect(boton).not.toContain("@/lib/data-provider");
    expect(boton).not.toContain("useData");
    expect(boton).toContain("export function HelpButton() {");
  });

  it("decide dónde no sale con ayudaEnLaRuta, antes de pintar nada", () => {
    const boton = sinComentarios(leer("src/components/HelpButton.tsx"));
    const corte = boton.indexOf("if (!ayudaEnLaRuta(pathname)) return null;");
    expect(corte).toBeGreaterThan(-1);
    expect(boton.indexOf("\n  return (\n")).toBeGreaterThan(corte);
  });

  it("manda la versión de la app en la que está, no siempre la de Entregas", () => {
    const boton = sinComentarios(leer("src/components/HelpButton.tsx"));
    expect(boton).toContain("appVersion: APP_VERSIONS[appForPath(pathname)],");
    expect(boton).not.toContain("APP_VERSIONS.deliveries");
  });

  it("quién escribe sale de la sesión (/api/help) y sin ella no se manda", () => {
    const boton = sinComentarios(leer("src/components/HelpButton.tsx"));
    const envio = boton.slice(boton.indexOf("const send = async"), boton.indexOf("await enviaSolicitudDeAyuda({"));
    expect(envio).toContain("const quien = await traeContacto();");
    expect(envio).toMatch(/if \(!quien\) \{[\s\S]*?return;\n\s*\}/);
    expect(boton).toContain("const c = await pideContactoDeAyuda();");
    expect(boton).toContain("userId: quien.id, message, ficheros, page: pathname, senderName: quien.nombre,");
    expect(boton).toContain("role: rolDeQuienEscribe(quien.rol, lang),");
  });

  it("el «📞 Llámanos» sale del teléfono que contesta /api/help, no de los ajustes de Entregas", () => {
    const boton = sinComentarios(leer("src/components/HelpButton.tsx"));
    expect(boton).toContain("{contacto?.telefono && (");
    expect(boton).toContain("href={`tel:${telClean(contacto.telefono)}`}");
    expect(boton).not.toContain("settings.help_phone");
  });
});

// ---------------------------------------------------------------------------------------------------------------
// La misma en todas: lo que se pinta
// ---------------------------------------------------------------------------------------------------------------

const navegacion = vi.hoisted(() => ({ ruta: "/" }));
vi.mock("next/navigation", () => ({
  usePathname: () => navegacion.ruta,
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
}));

import { HelpButton } from "@/components/HelpButton";

function pinta(ruta: string, lang: "es" | "en" = "es"): string {
  navegacion.ruta = ruta;
  return renderToStaticMarkup(createElement(PrefsConIdioma, { lang } as Parameters<typeof PrefsConIdioma>[0], createElement(HelpButton)));
}

describe("lo que se pinta: la misma burbuja en cada app", () => {
  const RAICES = ["/", "/my-route", "/home", "/timetracker", "/recruiting", "/erp/dashboard", "/estimator", "/leads", "/surveys", "/promos/x"];

  it("en cada app sale la burbuja «? Ayuda», cerrada", () => {
    for (const ruta of RAICES) {
      const html = pinta(ruta);
      expect(html, ruta).toContain('class="help-fab no-print"');
      expect(html, ruta).toContain(">Ayuda<");
      expect(html, ruta).toContain('aria-label="¿Necesita ayuda?"');
      // Cerrada: ni el panel ni el aviso hasta que se pulsa.
      expect(html, ruta).not.toContain('class="overlay"');
      expect(html, ruta).not.toContain('class="toast');
    }
  });

  it("y es EXACTAMENTE el mismo HTML en todas: mismo botón, misma forma, mismo texto", () => {
    const entregas = pinta("/");
    for (const ruta of RAICES) expect(pinta(ruta), ruta).toBe(entregas);
    expect(pinta("/timetracker", "en")).toContain(">Help<");
  });

  it("en el login y en el enlace del cliente no se pinta nada", () => {
    expect(pinta("/login")).toBe("");
    expect(pinta("/track/abc123")).toBe("");
    expect(pinta("/change-password")).toBe("");
    expect(pinta("/track")).toContain('class="help-fab no-print"');
  });
});

// ---------------------------------------------------------------------------------------------------------------
// El sitio: no tapa lo que las apps pegan abajo, y deja subir lo último
// ---------------------------------------------------------------------------------------------------------------

describe("el sitio de la burbuja", () => {
  const css = leer("src/app/globals.css");
  const regla = css.slice(css.indexOf(".help-fab {"), css.indexOf("}", css.indexOf(".help-fab {")));
  const zDeLaBurbuja = Number(/z-index:\s*(\d+)/.exec(sinComentarios(regla))?.[1]);

  it("abajo a la derecha, fija, y solo globals.css la pinta: ninguna hoja de una app la redefine", () => {
    expect(regla).toContain("position: fixed; right: 20px; bottom: 20px;");
    expect(css).toContain(".help-fab { right: 14px; bottom: 14px; padding: 12px; }");
    for (const f of ficheros("src", /\.css$/).filter((f) => f !== "src/app/globals.css")) {
      expect(readFileSync(f, "utf8"), f).not.toContain("help-fab");
    }
  });

  it("va POR DEBAJO de lo que las apps pegan al fondo, para no tapar sus botones", () => {
    expect(zDeLaBurbuja).toBe(5);
    // «Elige conductor» y el reparto del Gestor (pegados abajo, `sticky`).
    const gestor = leer("src/app/(app)/routes/page.tsx");
    const pegados = [...gestor.matchAll(/position: "sticky", bottom: 8, zIndex: (\d+)/g)].map((m) => Number(m[1]));
    expect(pegados.length).toBe(3);
    for (const z of pegados) expect(zDeLaBurbuja).toBeLessThan(z);
    // La barra de seleccionados del ERP y la de comparar de RR. HH.
    expect(leer("src/components/erp/bulk-bar.tsx")).toContain('className="fixed inset-x-0 bottom-4 z-40');
    expect(zDeLaBurbuja).toBeLessThan(40);
    expect(leer("src/app/recruiting/recruiting.css")).toMatch(/\.compare-bar \{ position: fixed; bottom: 0;[^}]*z-index: 60;/);
    // Y los avisos de abajo de cada app.
    expect(css).toMatch(/\.toast \{ position: fixed; bottom: 20px;[^}]*z-index: 99; \}/);
  });

  it("deja un hueco al final de cada app para que lo último suba por encima de ella", () => {
    // La burbuja ocupa 14 + 44 = 58 px en el teléfono y 20 + 42 = 62 px en el ordenador.
    expect(css).toContain(":root { --hueco-de-ayuda: 80px; }");
    expect(css).toContain("@media (max-width: 640px) { :root { --hueco-de-ayuda: 72px; } }");
    // Time Tracker (12 px abajo antes de esto) y Promociones (24 px) no lo dejaban.
    expect(css).toContain("body .timetracker-module .wrap { padding-bottom: var(--hueco-de-ayuda); }");
    const promos = leer("src/app/promos/[id]/page.tsx");
    expect((promos.match(/padding: "24px 16px var\(--hueco-de-ayuda\)"/g) ?? []).length).toBe(2);
    expect(promos).not.toContain('padding: "24px 16px" }');
    // Las que ya lo dejaban siguen dejándolo: el `.wrap` de Entregas, el hub y RR. HH., y Leads.
    expect(css).toContain(".wrap { max-width: 1180px; margin: 0 auto; padding: 20px 16px 80px; }");
    expect(css).toContain(".wrap { padding: 14px 12px 72px; }");
    expect(leer("src/app/recruiting/recruiting.css")).toContain(".recruiting-module .wrap { max-width: 1100px; margin: 0 auto; padding: 20px 16px 80px; }");
    expect(leer("src/app/leads/leads.css")).toContain(".ld-wrap { max-width: 900px; margin: 0 auto; padding: 16px 12px 96px; }");
  });
});

// ---------------------------------------------------------------------------------------------------------------
// /api/help: quién escribe, el teléfono y el destino, igual desde cualquier app
// ---------------------------------------------------------------------------------------------------------------

const falso = vi.hoisted(() => ({
  sesion: true,
  perfil: { full_name: "Carla Brownsville", role: "sales" } as Record<string, unknown> | null,
  ajustes: { help_email: "soporte@rdz.test", help_phone: " (956) 555-0100 " } as Record<string, unknown> | null,
  ajustesFallan: false,
  enviados: [] as { url: string; cuerpo: Record<string, unknown> }[],
  guardado: null as Record<string, unknown> | null,
}));

vi.mock("@/lib/api-auth", () => ({
  requireUser: async () =>
    falso.sesion
      ? {
          ok: true,
          user: { id: "u-7", email: "carla@empresa.test" },
          supabase: {
            from: (tabla: string) =>
              tabla === "profiles"
                ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: falso.perfil, error: null }) }) }) }
                : {
                    insert: (v: Record<string, unknown>) => {
                      falso.guardado = v;
                      return { select: () => ({ maybeSingle: async () => ({ data: { id: "fila-1" }, error: null }) }) };
                    },
                  },
          },
        }
      : { ok: false, response: NextResponse.json({ error: "Not signed in." }, { status: 401 }) },
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (tabla: string) =>
      tabla === "settings"
        ? {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => {
                  if (falso.ajustesFallan) throw new Error("sin red");
                  return { data: falso.ajustes, error: null };
                },
              }),
            }),
          }
        : { update: () => ({ eq: async () => ({ error: null }) }) },
    storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: "https://firmado.example/x" } }) }) },
  }),
}));

import { GET as contactoDeAyuda, POST as pideAyuda } from "@/app/api/help/route";

describe("/api/help", () => {
  beforeEach(() => {
    falso.sesion = true;
    falso.perfil = { full_name: "Carla Brownsville", role: "sales" };
    falso.ajustes = { help_email: "soporte@rdz.test", help_phone: " (956) 555-0100 " };
    falso.ajustesFallan = false;
    falso.enviados = [];
    falso.guardado = null;
    process.env.RESEND_API_KEY = "llave-de-prueba";
    process.env.NOTIFY_FROM_EMAIL = "Soporte <soporte@example.test>";
    // Aquí muere cualquier intento de mandar un correo de verdad.
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: { body: string }) => {
      falso.enviados.push({ url: String(url), cuerpo: JSON.parse(init.body) });
      return { ok: true, json: async () => ({ id: "correo-1" }), text: async () => "" } as unknown as Response;
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("GET da quién escribe y el teléfono de ayuda, leído con la llave de servicio (también sin Entregas)", async () => {
    const res = await contactoDeAyuda();
    const j = await res.json();
    expect(j).toEqual({ id: "u-7", telefono: "(956) 555-0100", nombre: "Carla Brownsville", rol: "sales" });
    // Solo eso: el correo de ayuda no sale al navegador.
    expect(Object.keys(j).sort()).toEqual(["id", "nombre", "rol", "telefono"]);
  });

  it("GET sin teléfono en Ajustes, o si no se pudieron leer, no inventa uno", async () => {
    falso.ajustes = { help_email: null, help_phone: "  " };
    expect((await (await contactoDeAyuda()).json()).telefono).toBeNull();
    falso.ajustesFallan = true;
    expect((await (await contactoDeAyuda()).json()).telefono).toBeNull();
  });

  it("GET sin sesión: 401, y la burbuja no puede mandar nada", async () => {
    falso.sesion = false;
    expect((await contactoDeAyuda()).status).toBe(401);
  });

  const pide = (cuerpo: unknown) => pideAyuda(new Request("http://localhost/api/help", { method: "POST", body: JSON.stringify(cuerpo) }));
  const destino = () => (falso.enviados[0]?.cuerpo as { to?: string })?.to;

  it("POST manda a la dirección de Ajustes e IGNORA el `to` que diga el navegador", async () => {
    await pide({ message: "No carga", to: "otra-persona@fuera.test" });
    expect(destino()).toBe("soporte@rdz.test");
    expect(falso.guardado?.email_to).toBe("soporte@rdz.test");
  });

  it("POST sin dirección válida en Ajustes, o si no se pudieron leer, va a la de siempre", async () => {
    falso.ajustes = { help_email: "no-es-un-correo", help_phone: null };
    await pide({ message: "a" });
    expect(destino()).toBe(DEFAULT_HELP_EMAIL);
    falso.enviados = [];
    falso.ajustesFallan = true;
    const res = await pide({ message: "b" });
    expect(res.status).toBe(200);
    expect(destino()).toBe(DEFAULT_HELP_EMAIL);
  });
});

describe("destinoDeAyuda", () => {
  it("la de Ajustes si es una dirección; si no, la de siempre", () => {
    expect(destinoDeAyuda(" soporte@rdz.test ")).toBe("soporte@rdz.test");
    for (const v of [null, undefined, "", "   ", "no-es-un-correo", "a@b"]) expect(destinoDeAyuda(v), String(v)).toBe(DEFAULT_HELP_EMAIL);
  });
});

describe("lo que la burbuja pide antes de mandar", () => {
  afterEach(() => vi.unstubAllGlobals());
  const contesta = (status: number, cuerpo: unknown) =>
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: status < 400, status, json: async () => cuerpo }) as unknown as Response));

  it("con sesión, quién es y el teléfono", async () => {
    contesta(200, { id: "u-7", telefono: "956", nombre: "Carla", rol: "sales" });
    expect(await pideContactoDeAyuda()).toEqual({ id: "u-7", telefono: "956", nombre: "Carla", rol: "sales" });
  });

  it("sin sesión (401, sin id) o sin red: null — nunca una solicitud sin dueño", async () => {
    contesta(401, { error: "Not signed in." });
    expect(await pideContactoDeAyuda()).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("sin red"); }));
    expect(await pideContactoDeAyuda()).toBeNull();
  });

  it("el rol en palabras; uno que el app no conoce va tal cual, sin romper", () => {
    expect(rolDeQuienEscribe("sales", "es")).not.toBe("sales");
    expect(rolDeQuienEscribe("rol-raro", "es")).toBe("rol-raro");
    expect(rolDeQuienEscribe(null, "en")).toBe("");
  });

  it("«Mis solicitudes» del hub ya no lee `settings` para el destino: lo pone el servidor", () => {
    const hub = sinComentarios(leer("src/app/home/ayuda/page.tsx"));
    expect(hub).not.toContain('from("settings")');
    expect(sinComentarios(leer("src/lib/help-send.ts"))).not.toMatch(/\bto: args\.to\b/);
  });
});
