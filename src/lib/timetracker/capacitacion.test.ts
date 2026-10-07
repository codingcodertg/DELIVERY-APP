import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import {
  COOKIE_CAPACITACION, RUTA_DE_LA_COOKIE, capacitacionDeLasCookies, cookieDeCapacitacion, diaConPractica,
  esEscrituraBloqueada, esIdDePractica, fetchConCorte, mensajeDeCapacitacion, practicaGuardada, practicaVacia,
  valorDeCapacitacion, viajeConPractica, type EventoDeFichar,
} from "./capacitacion";

/**
 * El modo capacitación de Time Tracker (D-490): la cookie, el corte del navegador y la capa de práctica
 * del día y del viaje. Las acciones y el proveedor tienen sus pruebas al lado
 * (`capacitacion-fichar.test.ts`, `capacitacion-datos.test.ts`, `capacitacion-acciones.test.ts`).
 */

const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");

describe("la cookie", () => {
  it("encendida lleva el idioma y la ruta de Time Tracker; apagada caduca", () => {
    expect(RUTA_DE_LA_COOKIE).toBe("/timetracker");
    expect(cookieDeCapacitacion("es")).toBe(`${COOKIE_CAPACITACION}=es; Path=/timetracker; SameSite=Lax`);
    expect(cookieDeCapacitacion("en")).toBe(`${COOKIE_CAPACITACION}=en; Path=/timetracker; SameSite=Lax`);
    expect(cookieDeCapacitacion(null)).toBe(`${COOKIE_CAPACITACION}=; Path=/timetracker; SameSite=Lax; Max-Age=0`);
  });

  it("se lee de document.cookie entre otras, con el idioma", () => {
    expect(capacitacionDeLasCookies(`a=1; ${COOKIE_CAPACITACION}=es; b=2`)).toBe("es");
    expect(capacitacionDeLasCookies(`${COOKIE_CAPACITACION}=en`)).toBe("en");
    expect(capacitacionDeLasCookies("a=1; b=2")).toBeNull();
    expect(capacitacionDeLasCookies(`${COOKIE_CAPACITACION}=`)).toBeNull();
    expect(capacitacionDeLasCookies("")).toBeNull();
    // Otra cookie que solo EMPIEZA igual no cuenta.
    expect(capacitacionDeLasCookies(`${COOKIE_CAPACITACION}_x=es`)).toBeNull();
  });

  it("cualquier valor no vacío cuenta como encendida —en la duda, no se guarda—; el idioma raro es inglés", () => {
    expect(valorDeCapacitacion("1")).toBe("en");
    expect(valorDeCapacitacion(" es ")).toBe("es");
    expect(valorDeCapacitacion("")).toBeNull();
    expect(valorDeCapacitacion("   ")).toBeNull();
    expect(valorDeCapacitacion(undefined)).toBeNull();
  });

  it("el mensaje sale en el idioma de la persona", () => {
    expect(mensajeDeCapacitacion("es")).toMatch(/^Modo capacitación: esto no se guardó/);
    expect(mensajeDeCapacitacion("en")).toMatch(/^Training mode: this was not saved/);
  });
});

describe("qué peticiones escriben", () => {
  const U = "https://x.supabase.co";
  const casos: [string, string, boolean][] = [
    ["GET", `${U}/rest/v1/sessions?select=*`, false],
    ["HEAD", `${U}/rest/v1/sessions?select=*`, false],
    ["OPTIONS", `${U}/rest/v1/sessions`, false],
    ["POST", `${U}/rest/v1/sessions`, true],
    ["PATCH", `${U}/rest/v1/sessions?id=eq.1`, true],
    ["PUT", `${U}/rest/v1/sessions`, true],
    ["DELETE", `${U}/rest/v1/screenshots?id=eq.1`, true],
    ["POST", `${U}/rest/v1/rpc/cualquiera`, true],
    ["post", `${U}/rest/v1/requests`, true],
    ["POST", `${U}/storage/v1/object/exception-photos/c/u/1.jpg`, true],
    ["PUT", `${U}/storage/v1/object/exception-photos/c/u/1.jpg`, true],
    ["DELETE", `${U}/storage/v1/object/timetracker-screenshots`, true],
    ["POST", `${U}/storage/v1/object/move`, true],
    ["POST", `${U}/storage/v1/object/upload/sign/b/p`, true],
    ["POST", `${U}/storage/v1/object/sign/timetracker-screenshots/a.jpg`, false],
    ["POST", `${U}/storage/v1/object/list/timetracker-screenshots`, false],
    ["GET", `${U}/storage/v1/object/public/b/a.jpg`, false],
    ["POST", `${U}/auth/v1/token?grant_type=refresh_token`, false],
    ["POST", `${U}/auth/v1/logout`, false],
    ["POST", `/timetracker/api/heartbeat`, false],
  ];
  for (const [m, url, sale] of casos) {
    it(`${m} ${url.replace(U, "")} → ${sale ? "bloqueada" : "pasa"}`, () => {
      expect(esEscrituraBloqueada(m, url)).toBe(sale);
    });
  }
  it("sin método es un GET", () => {
    expect(esEscrituraBloqueada(undefined, `${U}/rest/v1/sessions`)).toBe(false);
  });
});

describe("fetchConCorte", () => {
  const respuesta = () => new Response("[]", { status: 200 });

  it("encendida, una escritura vuelve con 403 y el mensaje SIN llegar a salir", async () => {
    const real = vi.fn(async () => respuesta());
    const f = fetchConCorte(real, () => "es");
    const r = await f("https://x.supabase.co/rest/v1/sessions", { method: "POST", body: "{}" });
    expect(real).not.toHaveBeenCalled();
    expect(r.status).toBe(403);
    expect((await r.json()).message).toBe(mensajeDeCapacitacion("es"));
  });

  it("encendida, leer sigue saliendo", async () => {
    const real = vi.fn(async () => respuesta());
    await fetchConCorte(real, () => "es")("https://x.supabase.co/rest/v1/sessions?select=*", { method: "GET" });
    expect(real).toHaveBeenCalledTimes(1);
  });

  it("apagada, escribir sale como siempre", async () => {
    const real = vi.fn(async () => respuesta());
    await fetchConCorte(real, () => null)("https://x.supabase.co/rest/v1/sessions", { method: "POST" });
    expect(real).toHaveBeenCalledTimes(1);
  });

  it("pregunta EN CADA petición: encender a media página corta la siguiente", async () => {
    const real = vi.fn(async () => respuesta());
    let activa: "es" | null = null;
    const f = fetchConCorte(real, () => activa);
    await f("https://x.supabase.co/rest/v1/notes_log", { method: "POST" });
    activa = "es";
    await f("https://x.supabase.co/rest/v1/notes_log", { method: "POST" });
    expect(real).toHaveBeenCalledTimes(1);
  });

  it("también con una Request en vez de url + opciones", async () => {
    const real = vi.fn(async () => respuesta());
    const r = await fetchConCorte(real, () => "en")(new Request("https://x.supabase.co/rest/v1/sessions", { method: "DELETE" }));
    expect(real).not.toHaveBeenCalled();
    expect(r.status).toBe(403);
  });

  it("supabase-js lo entrega como error, con el mensaje, en insertar, cambiar, borrar y subir", async () => {
    const real = vi.fn(async () => respuesta());
    const sb = createClient("https://x.supabase.co", "anon", {
      global: { fetch: fetchConCorte(real, () => "es") },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const ins = await sb.from("sessions").insert({ memo: "x" });
    const upd = await sb.from("sessions").update({ memo: "x" }).eq("id", "1");
    const del = await sb.from("screenshots").delete().eq("id", "1");
    const sub = await sb.storage.from("exception-photos").upload("c/u/1.jpg", new Blob(["x"]));
    for (const r of [ins, upd, del]) expect(r.error?.message).toBe(mensajeDeCapacitacion("es"));
    expect(sub.error?.message).toBe(mensajeDeCapacitacion("es"));
    expect(real).not.toHaveBeenCalled();
  });
});

describe("los clientes llevan el corte", () => {
  it("los dos del navegador, Time Tracker y fichaje, preguntando a la cookie en cada petición", () => {
    for (const f of ["src/lib/timetracker/supabase/client.ts", "src/lib/clockin/supabase/client.ts"]) {
      expect(leer(f), f).toContain("global: { fetch: fetchConCorte((i, o) => fetch(i, o), capacitacionDelNavegador) },");
    }
  });
  it("el de servidor de fichaje, cuando la petición trae la cookie", () => {
    const s = leer("src/lib/clockin/supabase/server.ts");
    expect(s).toContain("const practica = valorDeCapacitacion(cookieStore.get(COOKIE_CAPACITACION)?.value);");
    expect(s).toContain("...(practica ? { global: { fetch: fetchConCorte((i, o) => fetch(i, o), () => practica) } } : {}),");
  });
});

// ---------------------------------------------------------------------------------------------------

const H = (h: number, m = 0) => new Date(Date.UTC(2026, 9, 7, h, m, 0)).toISOString();
const AHORA = Date.parse(H(16));

/** Un día real: dentro desde las 8, sin descansos. */
const diaReal = () => ({
  ok: true as const,
  companyId: "c", userId: "u",
  open: { id: "real-1", clockInAt: H(8) } as { id: string; clockInAt: string } | null,
  leave: null as { id: string; reason: string; leftAt: string } | null,
  today: [{ id: "real-1", clockInAt: H(8), clockOutAt: null as string | null, minutes: 450 }],
  breaks: [] as { id: string; reason: string; leftAt: string; returnedAt: string | null; minutes: number }[],
  todayMinutes: 450, weekMinutes: 2000, lunchMinutes: 0, outMinutes: 0,
});
const diaFuera = () => ({ ...diaReal(), open: null, today: [], todayMinutes: 0, weekMinutes: 1500 });

describe("el día en práctica", () => {
  it("sin nada practicado es el mismo objeto real", () => {
    const d = diaReal();
    expect(diaConPractica(d, [], AHORA)).toBe(d);
  });

  it("fichar entrada en práctica abre un turno de práctica y suma desde entonces", () => {
    const d = diaConPractica(diaFuera(), [{ k: "entrada", id: "practica-a", at: H(15) }], AHORA);
    expect(d.open).toEqual({ id: "practica-a", clockInAt: H(15) });
    expect(d.today).toEqual([{ id: "practica-a", clockInAt: H(15), clockOutAt: null, minutes: 60 }]);
    expect(d.todayMinutes).toBe(60);
    expect(d.weekMinutes).toBe(1560);
  });

  it("fichar salida en práctica cierra el turno real EN LA VISTA, y lo cuenta hasta la salida", () => {
    const real = diaReal();
    const d = diaConPractica(real, [{ k: "salida", at: H(12) }], AHORA);
    expect(d.open).toBeNull();
    expect(d.today[0]).toEqual({ id: "real-1", clockInAt: H(8), clockOutAt: H(12), minutes: 240 });
    expect(d.todayMinutes).toBe(240);
    expect(d.weekMinutes).toBe(2000 - 450 + 240);
    // Lo real no se tocó.
    expect(real.open).toEqual({ id: "real-1", clockInAt: H(8) });
    expect(real.today[0].clockOutAt).toBeNull();
  });

  it("un turno que la práctica no tocó se queda con los minutos del servidor (que descuentan el almuerzo)", () => {
    const d = diaConPractica(diaReal(), [{ k: "descanso", id: "practica-l", at: H(12), reason: "lunch" }], AHORA);
    expect(d.today[0].minutes).toBe(450);
    expect(d.todayMinutes).toBe(450);
  });

  it("la comida: empieza y termina, y suma a los minutos de almuerzo", () => {
    const ev: EventoDeFichar[] = [
      { k: "descanso", id: "practica-l", at: H(12), reason: "lunch" },
      { k: "fin-descanso", at: H(13) },
    ];
    const abierta = diaConPractica(diaReal(), ev.slice(0, 1), AHORA);
    expect(abierta.leave).toEqual({ id: "practica-l", reason: "lunch", leftAt: H(12) });
    expect(abierta.lunchMinutes).toBe(240);
    const cerrada = diaConPractica(diaReal(), ev, AHORA);
    expect(cerrada.leave).toBeNull();
    expect(cerrada.breaks).toEqual([{ id: "practica-l", reason: "lunch", leftAt: H(12), returnedAt: H(13), minutes: 60 }]);
    expect(cerrada.lunchMinutes).toBe(60);
    expect(cerrada.outMinutes).toBe(0);
  });

  it("«voy a salir» sin vehículo de la empresa es un descanso que no es comida: suma fuera", () => {
    const d = diaConPractica(diaReal(), [
      { k: "descanso", id: "practica-s", at: H(14), reason: "picking_up_supplies" },
      { k: "fin-descanso", at: H(14, 30) },
    ], AHORA);
    expect(d.outMinutes).toBe(30);
    expect(d.lunchMinutes).toBe(0);
  });

  it("salir del turno cierra también el descanso abierto", () => {
    const d = diaConPractica(diaReal(), [
      { k: "descanso", id: "practica-l", at: H(12), reason: "lunch" },
      { k: "salida", at: H(12, 30) },
    ], AHORA);
    expect(d.leave).toBeNull();
    expect(d.breaks[0].returnedAt).toBe(H(12, 30));
  });

  it("las mismas reglas que la pantalla: no se entra dos veces, no se sale fuera, no se come fuera ni dos veces", () => {
    const dentro = diaConPractica(diaReal(), [{ k: "entrada", id: "practica-b", at: H(9) }], AHORA);
    expect(dentro.open?.id).toBe("real-1");
    expect(dentro.today).toHaveLength(1);
    const fuera = diaConPractica(diaFuera(), [{ k: "salida", at: H(9) }, { k: "descanso", id: "practica-x", at: H(9), reason: "lunch" }], AHORA);
    expect(fuera.open).toBeNull();
    expect(fuera.leave).toBeNull();
    expect(fuera.breaks).toEqual([]);
    const dos = diaConPractica(diaReal(), [
      { k: "descanso", id: "practica-1", at: H(12), reason: "lunch" },
      { k: "descanso", id: "practica-2", at: H(13), reason: "lunch" },
    ], AHORA);
    expect(dos.breaks.map((b) => b.id)).toEqual(["practica-1"]);
  });

  it("los viajes no cambian el día", () => {
    const d = diaConPractica(diaReal(), [{ k: "viaje", id: "practica-v", at: H(10), vehicleId: null }], AHORA);
    expect(d.open).toEqual(diaReal().open);
    expect(d.todayMinutes).toBe(450);
  });
});

const viajeReal = () => ({
  ok: true as const, mode: "sales" as const, vehicles: [], currentVehicleId: null,
  trip: null as { id: string; startedAt: string; vehicleId: string | null; paused: boolean } | null,
  stops: [] as { id: string; label: string | null; arrivedAt: string; departedAt: string | null }[],
  clockedIn: true,
});

describe("el viaje en práctica", () => {
  it("empezar, una parada que se cierra, y volver", () => {
    const ev: EventoDeFichar[] = [
      { k: "viaje", id: "practica-v", at: H(10), vehicleId: "v1" },
      { k: "parada", id: "practica-p", at: H(10, 30), label: "Cliente" },
      { k: "fin-parada", at: H(11) },
    ];
    const v = viajeConPractica(viajeReal(), ev);
    expect(v.trip).toEqual({ id: "practica-v", startedAt: H(10), vehicleId: "v1", paused: false });
    expect(v.stops).toEqual([{ id: "practica-p", label: "Cliente", arrivedAt: H(10, 30), departedAt: H(11) }]);
    const fin = viajeConPractica(viajeReal(), [...ev, { k: "fin-viaje", at: H(12) }]);
    expect(fin.trip).toBeNull();
    expect(fin.stops).toEqual([]);
  });

  it("sin estar dentro no hay viaje, y sin viaje no hay parada", () => {
    const fuera = { ...viajeReal(), clockedIn: false };
    expect(viajeConPractica(fuera, [{ k: "viaje", id: "practica-v", at: H(10), vehicleId: null }]).trip).toBeNull();
    expect(viajeConPractica(viajeReal(), [{ k: "parada", id: "practica-p", at: H(10), label: null }]).stops).toEqual([]);
  });

  it("fichar entrada en práctica deja empezar un viaje; salir del turno lo cierra", () => {
    const fuera = { ...viajeReal(), clockedIn: false };
    const v = viajeConPractica(fuera, [{ k: "entrada", id: "practica-e", at: H(8) }, { k: "viaje", id: "practica-v", at: H(9), vehicleId: null }]);
    expect(v.clockedIn).toBe(true);
    expect(v.trip?.id).toBe("practica-v");
    const s = viajeConPractica(viajeReal(), [{ k: "viaje", id: "practica-v", at: H(9), vehicleId: null }, { k: "salida", at: H(10) }]);
    expect(s.trip).toBeNull();
    expect(s.clockedIn).toBe(false);
  });

  it("volver de un viaje REAL lo esconde en la vista, sin tocarlo", () => {
    const real = { ...viajeReal(), trip: { id: "real-v", startedAt: H(9), vehicleId: null, paused: false } };
    expect(viajeConPractica(real, [{ k: "fin-viaje", at: H(10) }]).trip).toBeNull();
    expect(real.trip?.id).toBe("real-v");
  });
});

describe("lo practicado, guardado", () => {
  it("se lee lo que se guardó", () => {
    const p = { ...practicaVacia(), avisosLeidos: true, notas: [{ id: "practica-n", note: "hola", created_at: H(9) }] };
    expect(practicaGuardada(JSON.stringify(p))).toEqual(p);
  });
  it("roto o vacío, una práctica vacía", () => {
    for (const raw of [null, "", "{", "null", "3", '{"fichar":"x"}']) {
      expect(practicaGuardada(raw), String(raw)).toEqual(practicaVacia());
    }
  });
  it("los ids de práctica se reconocen, los reales no", () => {
    expect(esIdDePractica("practica-123")).toBe(true);
    expect(esIdDePractica("1f0e2d3c-0000-4000-8000-000000000000")).toBe(false);
    expect(esIdDePractica(null)).toBe(false);
  });
});
