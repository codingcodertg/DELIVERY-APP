import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { decide, isApiPath, isPublicPath, isStaticFile, skipsSession } from "./route-guard";
import { updateSession } from "./supabase/middleware";

// G-29 (D-NEXT). El guard de rutas se conecta por primera vez, así que aquí está la tabla que
// pidió el orquestador: ruta × sesión → sirve / rebota con `next` exacto / redirige desde el
// login. Y las rutas que NO deben rebotar nunca: ficheros de public/, rutas de datos (los crons
// de Vercel y el de GitHub entran por ahí con su secreto), /track del cliente, /auth, etc.

type Fila = [ruta: string, sinSesion: string, conSesion: string];
const sirve = "sirve";
const rebota = (a: string) => "rebota→/login?next=" + encodeURIComponent(a);

const tabla: Fila[] = [
  // ruta                                          sin sesión                                   con sesión
  ["/",                                             rebota("/"),                                 sirve],
  ["/home",                                         rebota("/home"),                             sirve],
  ["/erp",                                          rebota("/erp"),                              sirve],
  ["/erp/review?issue=BELOW%20COST",                rebota("/erp/review?issue=BELOW%20COST"),    sirve],
  ["/timetracker",                                  rebota("/timetracker"),                      sirve],
  ["/recruiting/board",                             rebota("/recruiting/board"),                 sirve],
  ["/users",                                        rebota("/users"),                            sirve],
  // públicas: se sirven tal cual, con o sin sesión
  ["/track/abc",                                    sirve,                                       sirve],
  ["/track",                                        sirve,                                       sirve],
  ["/auth/callback?code=x",                         sirve,                                       sirve],
  ["/auth/signout",                                 sirve,                                       sirve],
  ["/reset-password",                               sirve,                                       sirve],
  ["/no-access",                                    sirve,                                       sirve],
  // rutas de datos: nunca rebotan (se autentican solas; una llamada sin sesión debe dar 401)
  ["/api/notion-summary",                           sirve,                                       sirve],
  ["/api/version",                                  sirve,                                       sirve],
  ["/api/track/abc",                                sirve,                                       sirve],
  ["/timetracker/api/close-orphan-sessions",        sirve,                                       sirve],
  ["/timetracker/clock-in/api/roll-schedules",      sirve,                                       sirve],
  ["/timetracker/clock-in/api/roll-schedules?verify=1", sirve,                                   sirve],
  ["/timetracker/clock-in/api/cron",                sirve,                                       sirve],
  // los 6 ficheros de public/ (las imágenes las excluye ya el matcher; la regla las cubre igual)
  ["/clockin-sw.js",                                sirve,                                       sirve],
  ["/manifest.webmanifest",                         sirve,                                       sirve],
  ["/clockin-icon-192.png",                         sirve,                                       sirve],
  ["/clockin-icon-512.png",                         sirve,                                       sirve],
  ["/icon-maskable.svg",                            sirve,                                       sirve],
  ["/icon.svg",                                     sirve,                                       sirve],
  ["/favicon.ico",                                  sirve,                                       sirve],
  ["/_next/static/chunks/x.js",                     sirve,                                       sirve],
  ["/monitoring",                                   sirve,                                       sirve],
];

function resultado(d: ReturnType<typeof decide>): string {
  return d.kind === "next" ? sirve : "rebota→" + d.to;
}

describe("tabla del guard: ruta × sesión", () => {
  for (const [ruta, sin, con] of tabla) {
    it(`${ruta} · sin sesión → ${sin}`, () => {
      expect(resultado(decide(ruta, null, false))).toBe(sin);
    });
    it(`${ruta} · con sesión → ${con}`, () => {
      expect(resultado(decide(ruta, null, true))).toBe(con);
    });
  }
});

describe("ya dentro y pisando el login: a su next, saneado por safeNext (D-193)", () => {
  const casos: [next: string | null, destino: string][] = [
    ["/erp/review?issue=X", "/erp/review?issue=X"],
    ["/timetracker", "/timetracker"],
    [null, "/home"],
    ["", "/home"],
    ["/login", "/home"],           // bucle
    ["/login?next=/x", "/home"],   // bucle
    ["//evil.com", "/home"],       // protocol-relative: el navegador la lee como externa
    ["/\\evil.com", "/home"],
    ["https://evil.com/", "/home"],
    ["/%09/evil.com", "/%09/evil.com"], // codificado no es control: safeNext lo deja (D-193 miró el descodificado)
    ["/\t/evil.com", "/home"],     // control real
  ];
  for (const [next, destino] of casos) {
    it(`next=${JSON.stringify(next)} → ${destino}`, () => {
      expect(decide("/login", next, true)).toEqual({ kind: "redirect", to: destino });
    });
  }
  it("sin sesión, /login se sirve aunque traiga next", () => {
    expect(decide("/login?next=//evil.com", "//evil.com", false)).toEqual({ kind: "next" });
  });
});

describe("las 31 rutas de datos del repo caen bajo isApiPath o /auth", () => {
  it("cada route.ts de src/app", async () => {
    const { readdirSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (f === "route.ts") out.push(p);
      }
    };
    walk(join(process.cwd(), "src/app"));
    expect(out.length).toBeGreaterThanOrEqual(31);
    for (const p of out) {
      const ruta = "/" + p.replace(/\\/g, "/").split("src/app/")[1].replace(/\/route\.ts$/, "").replace(/\[[^\]]+\]/g, "x");
      expect(isApiPath(ruta) || ruta.startsWith("/auth/"), ruta).toBe(true);
      expect(isPublicPath(ruta), ruta).toBe(true);
    }
  });
});

describe("ficheros estáticos: regla de extensión", () => {
  it("public/ entero se sirve", () => {
    for (const f of ["/clockin-sw.js", "/clockin-icon-192.png", "/icon-maskable.svg", "/manifest.webmanifest", "/favicon.ico"]) {
      expect(isStaticFile(f), f).toBe(true);
      expect(skipsSession(f), f).toBe(true);
    }
  });
  it("y ninguna página de la app cae en la regla", () => {
    for (const p of ["/", "/erp/product/123", "/track/abc-def", "/recruiting/board", "/timetracker/clock-in", "/home/users", "/erp/review"]) {
      expect(isStaticFile(p), p).toBe(false);
    }
  });
});

describe("updateSession sobre NextRequest, con getUser stubbeado (sin red)", () => {
  const req = (url: string) => new NextRequest(new URL(url, "http://localhost"));
  it("sin sesión en /erp/review?issue=X: 307 a /login con next exacto (ruta y query)", async () => {
    const res = await updateSession(req("/erp/review?issue=X"), { getUser: async () => false });
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost/login?next=" + encodeURIComponent("/erp/review?issue=X"));
  });
  it("con sesión en /home: sirve (no redirige)", async () => {
    const res = await updateSession(req("/home"), { getUser: async () => true });
    expect(res.headers.get("location")).toBeNull();
  });
  it("con sesión pisando /login?next=//evil.com: a /home, nunca fuera", async () => {
    const res = await updateSession(req("/login?next=//evil.com"), { getUser: async () => true });
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost/home");
  });
  it("con sesión pisando /login?next=/timetracker: a /timetracker, sin arrastrar la query", async () => {
    const res = await updateSession(req("/login?next=%2Ftimetracker"), { getUser: async () => true });
    expect(res.headers.get("location")).toBe("http://localhost/timetracker");
  });
  it("las rutas de datos y los ficheros ni preguntan por la sesión", async () => {
    let preguntas = 0;
    const getUser = async () => { preguntas++; return false; };
    for (const u of ["/api/notion-summary", "/timetracker/clock-in/api/roll-schedules?verify=1", "/timetracker/clock-in/api/cron", "/clockin-sw.js"]) {
      const res = await updateSession(req(u), { getUser });
      expect(res.headers.get("location"), u).toBeNull();
    }
    expect(preguntas).toBe(0);
  });
  it("/track/abc sin sesión se sirve (el cliente no tiene cuenta)", async () => {
    const res = await updateSession(req("/track/abc"), { getUser: async () => false });
    expect(res.headers.get("location")).toBeNull();
  });
});
