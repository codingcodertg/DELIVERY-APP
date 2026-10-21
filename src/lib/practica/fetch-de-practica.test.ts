import { describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { aplicaDiario, fetchDePractica, libretaEn, olvidaPractica, quienEs, type Libreta } from "./fetch-de-practica";
import { cumpleConsulta, ordena, type Fila } from "./postgrest";
import { RUTAS_CON_EFECTO_QUE_SIGUEN, RUTAS_QUE_NO_SE_PRACTICAN, apiQueNoSePractica } from "@/lib/ensenanza-general";

// D-628 (2026-10-21) · el dueño: «yo pueda usar el app normal sin restricciones y cuando le quito el modo de enseñanza,
// pum, vuelva a como estaba antes […] en HR estoy viendo algo y simplemente no me deja hacer varias cosas y no se
// registran los cambios». Y: «que se puedan hacer cambios pero cuando se quite todo vuelva a la normalidad».

const SB = "https://abc.supabase.co";
const leer = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

/** Un PostgREST de mentira con dos tablas, que apunta toda petición que le llega. */
function base() {
  const tablas: Record<string, Fila[]> = {
    "recruiting.candidates": [
      { id: "a", name: "Ana", status: "new", archived: false, created_at: "2026-10-01T10:00:00Z" },
      { id: "b", name: "Beto", status: "inperson", archived: false, created_at: "2026-10-05T10:00:00Z" },
    ],
    "public.settings": [{ id: 1, help_phone: "956", updated_at: "2026-10-01T00:00:00Z" }],
  };
  const llamadas: { metodo: string; url: string; init?: RequestInit }[] = [];
  const fetchReal = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const metodo = (init?.method ?? "GET").toUpperCase();
    llamadas.push({ metodo, url, init });
    const u = new URL(url);
    const tabla = u.pathname.split("/rest/v1/")[1];
    const h = new Headers(init?.headers);
    const esquema = h.get("accept-profile") || h.get("content-profile") || "public";
    if (metodo === "GET" && tabla && !tabla.startsWith("rpc/")) {
      const filas = (tablas[`${esquema}.${tabla}`] ?? []).filter((f) => cumpleConsulta(f, u.searchParams) !== false);
      let out = ordena(filas, u.searchParams.get("order"));
      const lim = u.searchParams.get("limit");
      if (lim) out = out.slice(0, Number(lim));
      return new Response(JSON.stringify(out), { status: 200, headers: { "content-range": `0-${out.length - 1}/${out.length}` } });
    }
    return new Response("[]", { status: metodo === "POST" ? 201 : 200 });
  });
  return { tablas, llamadas, fetchReal };
}

function memoria() {
  const m = new Map<string, string>();
  return {
    m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  };
}

function montaje(encendido = true) {
  const b = base();
  const almacen = memoria();
  const avisos: string[] = [];
  let ids = 0;
  const estado = { idioma: encendido ? ("es" as const) : null };
  const f = fetchDePractica(b.fetchReal, {
    activa: () => estado.idioma,
    libreta: (h): Libreta | null => (h.get("authorization") ? libretaEn(almacen, "yo") : null),
    avisa: (m) => avisos.push(m),
    ahora: () => new Date("2026-10-21T12:00:00Z"),
    nuevoId: () => `nuevo-${++ids}`,
  });
  const cab = (extra: Record<string, string> = {}) => ({ apikey: "k", authorization: "Bearer t", "accept-profile": "recruiting", ...extra });
  const lista = async (q: string, extra: Record<string, string> = {}) => (await (await f(`${SB}/rest/v1/candidates?${q}`, { method: "GET", headers: cab(extra) })).json()) as Fila[];
  const escrituras = () => b.llamadas.filter((l) => l.metodo !== "GET");
  return { ...b, f, almacen, avisos, estado, cab, lista, escrituras };
}

describe("la práctica en RR. HH.: se ve guardado, la base no se entera, y al salir todo vuelve", () => {
  it("apagado, todo sale a la base tal cual", async () => {
    const x = montaje(false);
    await x.f(`${SB}/rest/v1/candidates?id=eq.a`, { method: "PATCH", headers: x.cab({ "content-profile": "recruiting" }), body: JSON.stringify({ status: "hired" }) });
    expect(x.escrituras().length).toBe(1);
  });

  it("cambiar la etapa: contesta como PostgREST, la base solo recibe lecturas, y las listas lo reflejan con sus filtros", async () => {
    const x = montaje();
    const r = await x.f(`${SB}/rest/v1/candidates?id=eq.a`, { method: "PATCH", headers: x.cab({ "content-profile": "recruiting", prefer: "return=minimal" }), body: JSON.stringify({ status: "hired" }) });
    expect(r.status).toBe(204);
    expect(x.escrituras()).toEqual([]);
    const todas = await x.lista("select=*&order=created_at.desc");
    expect(todas.map((c) => `${c.name}:${c.status}`)).toEqual(["Beto:inperson", "Ana:hired"]);
    expect((await x.lista("select=*&status=eq.new")).map((c) => c.name)).toEqual([]);
    // La base no tiene ningún «hired»: la práctica la añade donde su filtro dice.
    expect((await x.lista("select=id,name&status=eq.hired")).map((c) => c.name)).toEqual(["Ana"]);
    expect(x.escrituras()).toEqual([]);
  });

  it("crear: devuelve la fila nueva (con id, fecha y los sí/no de la tabla en falso) y sale en la lista en su sitio", async () => {
    const x = montaje();
    const r = await x.f(`${SB}/rest/v1/candidates?select=*`, {
      method: "POST",
      headers: x.cab({ "content-profile": "recruiting", prefer: "return=representation", accept: "application/vnd.pgrst.object+json" }),
      body: JSON.stringify({ name: "Carla", status: "new" }),
    });
    expect(r.status).toBe(201);
    const nueva = (await r.json()) as Fila;
    expect(nueva).toMatchObject({ id: "nuevo-1", name: "Carla", status: "new", archived: false, created_at: "2026-10-21T12:00:00.000Z" });
    expect((await x.lista("select=*&order=created_at.desc")).map((c) => c.name)).toEqual(["Carla", "Beto", "Ana"]);
    expect((await x.lista("select=*&archived=eq.false&order=created_at.asc")).map((c) => c.name)).toEqual(["Ana", "Beto", "Carla"]);
    expect(x.escrituras()).toEqual([]);
  });

  it("borrar: deja de salir; un .single() de una fila de práctica vuelve como objeto", async () => {
    const x = montaje();
    await x.f(`${SB}/rest/v1/candidates?id=eq.b`, { method: "DELETE", headers: x.cab({ "content-profile": "recruiting" }) });
    expect((await x.lista("select=*")).map((c) => c.name)).toEqual(["Ana"]);
    await x.f(`${SB}/rest/v1/candidates`, { method: "POST", headers: x.cab({ "content-profile": "recruiting" }), body: JSON.stringify({ name: "Dani" }) });
    const r = await x.f(`${SB}/rest/v1/candidates?select=*&name=eq.Dani`, { method: "GET", headers: x.cab({ accept: "application/vnd.pgrst.object+json" }) });
    expect(r.status).toBe(200);
    expect(((await r.json()) as Fila).name).toBe("Dani");
    expect(x.escrituras()).toEqual([]);
  });

  it("upsert sobre una que existe la mezcla; con números de id, la nueva lleva uno negativo", async () => {
    const x = montaje();
    await x.f(`${SB}/rest/v1/settings?on_conflict=id`, {
      method: "POST", headers: { authorization: "Bearer t", "content-profile": "public", prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({ id: 1, help_phone: "111" }),
    });
    const r = await x.f(`${SB}/rest/v1/settings?select=*&id=eq.1`, { method: "GET", headers: { authorization: "Bearer t" } });
    expect(await r.json()).toEqual([{ id: 1, help_phone: "111", updated_at: "2026-10-21T12:00:00.000Z" }]);
    const n = await x.f(`${SB}/rest/v1/settings?select=*`, { method: "POST", headers: { authorization: "Bearer t", prefer: "return=representation" }, body: JSON.stringify({ help_phone: "222" }) });
    expect(((await n.json()) as Fila[])[0].id).toBeLessThan(0);
    expect(x.escrituras()).toEqual([]);
  });

  it("apagar tira la libreta: lo siguiente que se lee es lo real", async () => {
    const x = montaje();
    await x.f(`${SB}/rest/v1/candidates?id=eq.a`, { method: "PATCH", headers: x.cab({ "content-profile": "recruiting" }), body: JSON.stringify({ status: "hired" }) });
    x.almacen.setItem("otra-cosa", "1");
    olvidaPractica(x.almacen);
    expect([...x.almacen.m.keys()]).toEqual(["otra-cosa"]);
    expect((await x.lista("select=*&order=created_at.asc")).map((c) => c.status)).toEqual(["new", "inperson"]);
  });

  it("sin nada apuntado en la tabla, la lectura sale tal cual (con su count)", async () => {
    const x = montaje();
    const init = { method: "GET", headers: x.cab({ prefer: "count=exact" }) };
    await x.f(`${SB}/rest/v1/candidates?select=*`, init);
    expect(x.llamadas.at(-1)?.init).toBe(init);
  });
});

describe("lo que no es una tabla", () => {
  it("una función que escribe, un archivo o una cuenta: no salen y avisan; una que lee y el chat salen", async () => {
    const x = montaje();
    expect((await x.f(`${SB}/rest/v1/rpc/adjust_inventory`, { method: "POST", headers: x.cab() })).status).toBe(403);
    expect((await x.f(`${SB}/storage/v1/object/resumes/cv.pdf`, { method: "POST", headers: x.cab() })).status).toBe(403);
    expect((await x.f(`${SB}/auth/v1/admin/users`, { method: "POST", headers: x.cab() })).status).toBe(403);
    expect(x.avisos.length).toBe(3);
    expect(x.avisos[0]).toContain("Modo enseñanza: esto no se puede practicar");
    expect(x.escrituras()).toEqual([]);
    await x.f(`${SB}/rest/v1/rpc/catalog_facets`, { method: "POST", headers: x.cab() });
    await x.f(`${SB}/rest/v1/chat_messages`, { method: "POST", headers: x.cab(), body: "{}" });
    expect(x.escrituras().map((l) => new URL(l.url).pathname)).toEqual(["/rest/v1/rpc/catalog_facets", "/rest/v1/chat_messages"]);
  });

  it("sin sesión no hay libreta: leer sale, escribir se corta", async () => {
    const x = montaje();
    expect((await x.f(`${SB}/rest/v1/candidates?select=*`, { method: "GET", headers: { apikey: "k" } })).status).toBe(200);
    expect((await x.f(`${SB}/rest/v1/candidates`, { method: "POST", headers: { apikey: "k" }, body: "{}" })).status).toBe(403);
    expect(x.escrituras()).toEqual([]);
  });
});

describe("piezas", () => {
  it("aplicaDiario no añade con offset ni quita por un filtro que no sabe leer", () => {
    const p = new URLSearchParams("select=*&offset=10");
    expect(aplicaDiario([], { x: { id: "x", a: 1 } }, p)).toEqual([]);
    const q = new URLSearchParams("select=*&data->>k=eq.1");
    expect(aplicaDiario([{ id: "x", a: 1 }], { x: { id: "x", a: 2 } }, q)).toEqual([{ id: "x", a: 2 }]);
    expect(aplicaDiario([], { y: { id: "y", a: 2 } }, q)).toEqual([]);
  });

  it("quienEs lee el sub del token", () => {
    const token = ["e30", Buffer.from(JSON.stringify({ sub: "u-1" })).toString("base64url"), "firma"].join(".");
    expect(quienEs(new Headers({ authorization: `Bearer ${token}` }))).toBe("u-1");
    expect(quienEs(new Headers({ authorization: "Bearer basura" }))).toBe(null);
    expect(quienEs(new Headers())).toBe(null);
  });
});

describe("puertas", () => {
  it("los tres clientes del navegador llevan la práctica; los del servidor, el corte", () => {
    for (const p of ["src/lib/supabase/client.ts", "src/lib/erp/supabase/client.ts", "src/lib/recruiting/supabase/client.ts"]) {
      expect(leer(p), p).toContain("global: { fetch: fetchDePracticaDelNavegador() },");
    }
    expect(leer("src/lib/supabase/server.ts")).toContain("fetchDeEnsenanzaConValor(ensenanza)");
  });

  it("encender o apagar tira la libreta; el aviso recarga al salir", () => {
    expect(leer("src/lib/boton-general.ts")).toContain("  olvidaPractica(almacen);\n  if (!galletas?.doc) return;");
    expect(leer("src/components/AvisoDeEnsenanza.tsx")).toContain("    window.location.reload();");
  });

  it("el middleware corta lo que sale al mundo real, y nada más", () => {
    expect(apiQueNoSePractica("POST", "/api/notify")).toBe(true);
    expect(apiQueNoSePractica("DELETE", "/api/call")).toBe(true);
    expect(apiQueNoSePractica("POST", "/api/avisos-cliente/en-camino")).toBe(true);
    expect(apiQueNoSePractica("GET", "/api/call")).toBe(false);
    expect(apiQueNoSePractica("POST", "/api/chat/send")).toBe(false);
    expect(apiQueNoSePractica("POST", "/api/notifyx")).toBe(false);
    const mw = leer("src/middleware.ts");
    expect(mw).toContain("if (idioma && apiQueNoSePractica(request.method, request.nextUrl.pathname)) {");
    expect(mw.indexOf("apiQueNoSePractica(request.method")).toBeLessThan(mw.indexOf("return await updateSession(request);"));
  });

  it("toda ruta /api que habla con Resend, RingCentral, Twilio, FCM o la administración de Auth está clasificada", () => {
    const rutas: string[] = [];
    const anda = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) anda(p); else if (f === "route.ts") rutas.push(p); } };
    anda("src/app/api");
    expect(rutas.length).toBeGreaterThan(30);
    const efecto = /@\/lib\/(fcm|mensajeria|ringcentral|recruiting\/agendas-ringcentral|recruiting\/contacto-ringcentral|impersonation-revoke)|api\.resend\.com|RINGCENTRAL|twilio|auth\.admin/;
    const clasificadas = [...RUTAS_QUE_NO_SE_PRACTICAN, ...Object.keys(RUTAS_CON_EFECTO_QUE_SIGUEN)];
    const conEfecto = rutas.filter((p) => efecto.test(readFileSync(p, "utf8")));
    expect(conEfecto.length).toBeGreaterThan(10);
    for (const p of conEfecto) {
      const ruta = "/" + p.replace(/\\/g, "/").replace(/^src\/app\//, "").replace(/\/route\.ts$/, "");
      expect(clasificadas.some((c) => ruta === c || ruta.startsWith(c + "/")), `${ruta} sin clasificar`).toBe(true);
    }
  });
});
