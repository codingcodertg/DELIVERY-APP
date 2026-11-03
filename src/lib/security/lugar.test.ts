import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { entradasDesdeSitioNuevo, lugarDeLaPeticion } from "./lugar";

/**
 * D-822: el dueño, «consígueme el address para saber también, y avísame si ellos quieren ingresar desde otro lado»;
 * «para evitar robo de información sensible… office people… solo desde el rtg desktop app».
 */
const h = (m: Record<string, string>) => ({ get: (k: string) => m[k.toLowerCase()] ?? null });
const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");

describe("desde dónde llega la petición", () => {
  it("la primera IP de x-forwarded-for y la ciudad, región y país que Vercel deduce (la ciudad viene codificada)", () => {
    expect(lugarDeLaPeticion(h({ "x-forwarded-for": "203.0.113.9, 10.0.0.1", "x-vercel-ip-city": "San%20Benito", "x-vercel-ip-country-region": "TX", "x-vercel-ip-country": "US" })))
      .toEqual({ ip: "203.0.113.9", lugar: "San Benito, TX, US" });
    expect(lugarDeLaPeticion(h({}))).toEqual({ ip: null, lugar: null });
    expect(lugarDeLaPeticion(h({ "x-real-ip": "198.51.100.2" }))).toEqual({ ip: "198.51.100.2", lugar: null });
  });
});

describe("entradas desde un sitio nuevo", () => {
  const dia = 24 * 3600 * 1000;
  const ahora = Date.parse("2026-11-03T18:00:00Z");
  const uso = (user_id: string, device_id: string, haceDias: number) => ({ user_id, device_id, first_seen_at: new Date(ahora - haceDias * dia).toISOString() });
  it("solo quien ya tenía un dispositivo y apareció en otro hace poco; el primero de cada persona no es una alarma", () => {
    const usos = [
      uso("ana", "tienda", 60), uso("ana", "casa", 2),      // Ana: la tienda hace dos meses, otro aparato anteayer → alarma
      uso("beto", "telefono", 1),                           // Beto: su primer dispositivo, ayer → no
      uso("carla", "tienda", 40), uso("carla", "laptop", 20), // Carla: el segundo hace 20 días → ya no está en la ventana
    ];
    expect(entradasDesdeSitioNuevo(usos, ahora).map((u) => `${u.user_id}:${u.device_id}`)).toEqual(["ana:casa"]);
    expect(entradasDesdeSitioNuevo(usos, ahora, 30).map((u) => `${u.user_id}:${u.device_id}`)).toEqual(["ana:casa", "carla:laptop"]);
  });
  it("la 234: IP y lugar en las tres tablas, las dos funciones nuevas y las viejas borradas; las rutas los mandan; el panel los enseña y lista a todos los usuarios", () => {
    const sql = leer("supabase/migrations/234_security_lugar.sql");
    expect(sql).toContain("drop function if exists public.security_touch_device(text, text, text, boolean);");
    expect(sql).toContain("p_ip text default null, p_place text default null)");
    expect(sql).toContain("grant  execute on function public.security_touch_device(text, text, text, boolean, text, text) to authenticated");
    expect(sql).toContain("grant  execute on function public.security_note_web_block(text, text, text, text, text) to authenticated");
    expect(sql).not.toMatch(/(^|\s)(begin|commit);/);
    expect(leer("src/app/api/security/seen/route.ts")).toContain("p_ip: ip, p_place: lugar");
    expect(leer("src/app/api/security/blocked/route.ts")).toContain("p_ip: ip, p_place: lugar");
    const panel = leer("src/app/security/PanelDeSeguridad.tsx");
    expect(panel).toContain('<TablaDeSecurity id="usuarios"');
    expect(panel).toContain('data-bloque="sitios-nuevos"');
    expect(panel.match(/key: "lugar"/g)?.length).toBe(4);
    expect(leer("src/app/security/page.tsx")).toContain('from("profiles").select("id, full_name, role, store, username")');
  });
});
