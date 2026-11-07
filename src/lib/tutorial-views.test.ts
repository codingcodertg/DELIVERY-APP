import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  CLAVE_APLAZADO, CLAVE_DESCARTADO, CLAVE_VISTO_EN_SESION, PARTE_VISTA,
  avanceDeYouTube, cuentaSinVer, debeAvisar, esTablaAusente, leeEstadisticas, leeVistos, marcaVisto, proximoAviso,
  sabeAvisarAvance, seDioPorVisto, sigueAplazado, srcConApiDeYouTube, textoDeEstadistica, tutorialesPendientes,
  type ClienteDeVistas, type EstadoDelAviso,
} from "./tutorial-views";
import { RUTA_TUTORIALES, opcionesDelBotonGeneral } from "./boton-general";
import type { Tutorial } from "./types";

// D-913 (2026-11-06) · el dueño y Roberto: «Implement tutorial link: add pop-up notifications or a help menu entry for
// accessing training resources» y «require users to view new videos upon signing in».

const videos: Tutorial[] = [
  { id: "v0", title: "Login y preferencias", url: "https://youtu.be/aaa" },
  { id: "v1", title: "Hacer una orden", url: "https://youtu.be/bbb", app: "deliveries", roles: ["sales"] },
  { id: "v2", title: "Almacén", url: "https://youtu.be/ccc", app: "deliveries", roles: ["warehouse"] },
  { id: "v3", title: "Choferes", url: "https://youtu.be/ddd", app: "deliveries", roles: ["driver"] },
  { id: "v4", title: "HOW TO CREATE CUSTOMERS", url: "https://youtu.be/eee", app: "deliveries", roles: ["sales"] },
];

/** Lo que `public.tutorials()` (115) le devuelve a cada rol: el admin todo; los demás los sin audiencia y los de su rol. */
const loQueVe = (rol: string) => (rol === "admin" ? videos : videos.filter((v) => !v.roles?.length || v.roles.includes(rol)));

describe("quién tiene qué pendiente, por rol", () => {
  it("un vendedor sin nada visto: los de todos y los de ventas; el admin: los cinco", () => {
    expect(tutorialesPendientes(loQueVe("sales"), new Set()).map((v) => v.id)).toEqual(["v0", "v1", "v4"]);
    expect(tutorialesPendientes(loQueVe("driver"), new Set()).map((v) => v.id)).toEqual(["v0", "v3"]);
    expect(tutorialesPendientes(loQueVe("warehouse"), new Set()).map((v) => v.id)).toEqual(["v0", "v2"]);
    expect(tutorialesPendientes(loQueVe("admin"), new Set()).map((v) => v.id)).toEqual(["v0", "v1", "v2", "v3", "v4"]);
  });

  it("lo visto se resta, en el orden de la lista, y acepta filas de la base o un Set", () => {
    expect(tutorialesPendientes(loQueVe("sales"), [{ tutorial_id: "v0" }, { tutorial_id: "v1" }]).map((v) => v.id)).toEqual(["v4"]);
    expect(tutorialesPendientes(loQueVe("sales"), new Set(["v0", "v1", "v4"]))).toEqual([]);
    // Un visto de un video que ya no existe (o que no es de su rol) no molesta.
    expect(cuentaSinVer(loQueVe("driver"), new Set(["v1", "zzz"]))).toBe(2);
  });

  it("la insignia: cuántos faltan", () => {
    expect(cuentaSinVer(loQueVe("sales"), new Set())).toBe(3);
    expect(cuentaSinVer(loQueVe("sales"), new Set(["v4"]))).toBe(2);
    expect(cuentaSinVer([], new Set())).toBe(0);
  });
});

describe("el aviso al entrar: cuándo sale", () => {
  const ahora = new Date(2026, 10, 6, 9, 30); // 6 nov 2026, 09:30 local
  const base: EstadoDelAviso = { pendientes: 2, ensenanza: false, yaAvisadoEnSesion: false, aplazadoHasta: null, descartado: false, esAdmin: false, ahora };

  it("sale con pendientes, limpio", () => {
    expect(debeAvisar(base)).toBe(true);
  });
  it("sin pendientes no sale", () => {
    expect(debeAvisar({ ...base, pendientes: 0 })).toBe(false);
  });
  it("en modo enseñanza nunca", () => {
    expect(debeAvisar({ ...base, ensenanza: true })).toBe(false);
    expect(debeAvisar({ ...base, ensenanza: true, esAdmin: true })).toBe(false);
  });
  it("una vez por sesión del navegador", () => {
    expect(debeAvisar({ ...base, yaAvisadoEnSesion: true })).toBe(false);
  });
  it("«Recordar mañana» aplaza hasta el primer instante del día siguiente, y vuelve al día siguiente", () => {
    const manana = proximoAviso(ahora);
    expect(manana.getFullYear()).toBe(2026);
    expect(manana.getMonth()).toBe(10);
    expect(manana.getDate()).toBe(7);
    expect(manana.getHours()).toBe(0);
    expect(manana.getMinutes()).toBe(0);
    const hasta = manana.toISOString();
    expect(sigueAplazado(hasta, ahora)).toBe(true);
    expect(debeAvisar({ ...base, aplazadoHasta: hasta })).toBe(false);
    // 23:59 del mismo día: sigue aplazado. 00:00 del siguiente: vuelve.
    expect(debeAvisar({ ...base, aplazadoHasta: hasta, ahora: new Date(2026, 10, 6, 23, 59) })).toBe(false);
    expect(debeAvisar({ ...base, aplazadoHasta: hasta, ahora: new Date(2026, 10, 7, 0, 0) })).toBe(true);
    expect(debeAvisar({ ...base, aplazadoHasta: hasta, ahora: new Date(2026, 10, 8, 8, 0) })).toBe(true);
  });
  it("el fin de mes y de año se aplazan bien", () => {
    expect(proximoAviso(new Date(2026, 11, 31, 22, 0)).getTime()).toBe(new Date(2027, 0, 1).getTime());
    expect(proximoAviso(new Date(2026, 1, 28, 12, 0)).getTime()).toBe(new Date(2026, 2, 1).getTime());
  });
  it("un aplazado ilegible no aplaza", () => {
    expect(sigueAplazado("ayer", ahora)).toBe(false);
    expect(sigueAplazado("", ahora)).toBe(false);
    expect(sigueAplazado(undefined, ahora)).toBe(false);
    expect(debeAvisar({ ...base, aplazadoHasta: "basura" })).toBe(true);
  });
  it("solo el admin lo descarta para siempre; a los demás les vuelve", () => {
    expect(debeAvisar({ ...base, descartado: true, esAdmin: true })).toBe(false);
    expect(debeAvisar({ ...base, descartado: true, esAdmin: false })).toBe(true);
  });
  it("las claves del navegador son estables (quien las cambie borra los aplazados de todos)", () => {
    expect(CLAVE_APLAZADO).toBe("rtg_tutoriales_aplazado_hasta");
    expect(CLAVE_DESCARTADO).toBe("rtg_tutoriales_descartado");
    expect(CLAVE_VISTO_EN_SESION).toBe("rtg_tutoriales_avisado");
  });
});

describe("«visto» automático al 90 %", () => {
  it("la regla", () => {
    expect(PARTE_VISTA).toBe(0.9);
    expect(seDioPorVisto(89, 100)).toBe(false);
    expect(seDioPorVisto(90, 100)).toBe(true);
    expect(seDioPorVisto(100, 100)).toBe(true);
    expect(seDioPorVisto(50, 0)).toBe(false);
    expect(seDioPorVisto(50, null)).toBe(false);
    expect(seDioPorVisto(null, 100)).toBe(false);
    expect(seDioPorVisto(NaN, 100)).toBe(false);
    expect(seDioPorVisto(50, Infinity)).toBe(false);
  });

  it("lee los mensajes del reproductor de YouTube y nada más", () => {
    expect(avanceDeYouTube(JSON.stringify({ event: "infoDelivery", info: { currentTime: 95.2, duration: 100 } }))).toEqual({ actual: 95.2, duracion: 100 });
    expect(avanceDeYouTube({ event: "infoDelivery", info: { currentTime: 1, duration: 10 } })).toEqual({ actual: 1, duracion: 10 });
    expect(avanceDeYouTube(JSON.stringify({ event: "onStateChange", info: 1 }))).toBeNull();
    expect(avanceDeYouTube(JSON.stringify({ event: "infoDelivery", info: { playerState: 1 } }))).toBeNull();
    expect(avanceDeYouTube("no es json")).toBeNull();
    expect(avanceDeYouTube(null)).toBeNull();
    expect(avanceDeYouTube(42)).toBeNull();
  });

  it("al iframe de YouTube se le enciende la API con el origen; a los demás no se les toca", () => {
    const s = srcConApiDeYouTube("https://www.youtube.com/embed/abc", "https://hub.example.com");
    const u = new URL(s);
    expect(u.searchParams.get("enablejsapi")).toBe("1");
    expect(u.searchParams.get("origin")).toBe("https://hub.example.com");
    expect(u.pathname).toBe("/embed/abc");
    expect(srcConApiDeYouTube("https://www.loom.com/embed/xyz", "https://hub.example.com")).toBe("https://www.loom.com/embed/xyz");
    expect(srcConApiDeYouTube("no-url", "x")).toBe("no-url");
    expect(sabeAvisarAvance("https://www.youtube.com/embed/abc")).toBe(true);
    expect(sabeAvisarAvance("https://www.youtube-nocookie.com/embed/abc")).toBe(true);
    expect(sabeAvisarAvance("https://player.vimeo.com/video/1")).toBe(false);
    expect(sabeAvisarAvance("https://drive.google.com/file/d/1/preview")).toBe(false);
  });
});

describe("la base, sin la 267 y con ella", () => {
  type Resp<T> = { data: T | null; error: { code?: string; message?: string } | null };
  const cliente = (o: { select?: Resp<{ tutorial_id: string }[]>; upsert?: Resp<unknown>; rpc?: Resp<{ tutorial_id: string; watched: number; total: number }[]> }, escrito: unknown[] = []): ClienteDeVistas => ({
    from: () => ({
      select: () => ({ eq: () => Promise.resolve(o.select ?? { data: [], error: null }) }),
      upsert: (fila) => { escrito.push(fila); return Promise.resolve(o.upsert ?? { data: null, error: null }); },
    }),
    rpc: () => Promise.resolve(o.rpc ?? { data: [], error: null }),
  });

  it("la tabla ausente se reconoce por su código o su mensaje", () => {
    expect(esTablaAusente({ code: "42P01" })).toBe(true);
    expect(esTablaAusente({ code: "PGRST205", message: "Could not find the table 'public.tutorial_views'" })).toBe(true);
    expect(esTablaAusente({ message: "relation \"public.tutorial_views\" does not exist" })).toBe(true);
    expect(esTablaAusente({ code: "42501", message: "permission denied" })).toBe(false);
    expect(esTablaAusente(null)).toBe(false);
  });

  it("leer: con la tabla, lo suyo; sin la tabla, «sin_tabla» (y el aviso no sale); otro fallo, «error»", async () => {
    const con = await leeVistos(cliente({ select: { data: [{ tutorial_id: "v0" }, { tutorial_id: "v4" }], error: null } }), "u1");
    expect(con).toEqual({ ok: true, vistos: new Set(["v0", "v4"]) });
    expect(await leeVistos(cliente({ select: { data: null, error: { code: "42P01" } } }), "u1")).toEqual({ ok: false, motivo: "sin_tabla" });
    expect(await leeVistos(cliente({ select: { data: null, error: { code: "500", message: "boom" } } }), "u1")).toEqual({ ok: false, motivo: "error" });
  });

  it("marcar: una fila por persona y video; en enseñanza la base dice 403 y se dice; sin tabla se dice", async () => {
    const escrito: unknown[] = [];
    const cuando = new Date("2026-11-06T15:00:00.000Z");
    expect(await marcaVisto(cliente({}, escrito), "u1", "v1", cuando)).toEqual({ ok: true });
    expect(escrito).toEqual([{ user_id: "u1", tutorial_id: "v1", watched_at: "2026-11-06T15:00:00.000Z" }]);
    expect(await marcaVisto(cliente({ upsert: { data: null, error: { code: "ENSENANZA", message: "no se guardó" } } }), "u1", "v1", cuando)).toEqual({ ok: false, motivo: "ensenanza" });
    expect(await marcaVisto(cliente({ upsert: { data: null, error: { code: "PGRST205", message: "Could not find the table" } } }), "u1", "v1", cuando)).toEqual({ ok: false, motivo: "sin_tabla" });
    expect(await marcaVisto(cliente({ upsert: { data: null, error: { code: "42501", message: "RLS" } } }), "u1", "v1", cuando)).toEqual({ ok: false, motivo: "error" });
  });

  it("el conteo del admin: un mapa por video; sin permiso o sin la 267, null (no se enseña nada)", async () => {
    const m = await leeEstadisticas(cliente({ rpc: { data: [{ tutorial_id: "v1", watched: 3, total: 12 }], error: null } }));
    expect(m?.get("v1")).toEqual({ tutorial_id: "v1", watched: 3, total: 12 });
    expect(textoDeEstadistica(m?.get("v1"))).toBe("3 / 12");
    expect(textoDeEstadistica(undefined)).toBeNull();
    expect(await leeEstadisticas(cliente({ rpc: { data: null, error: { code: "42501" } } }))).toBeNull();
    expect(await leeEstadisticas(cliente({ rpc: { data: null, error: { code: "PGRST202" } } }))).toBeNull();
  });
});

describe("la entrada en el menú de Ayuda", () => {
  it("«Tutoriales» sale para todos los que ven Ayuda y lleva a la pantalla de Tutoriales", () => {
    expect(opcionesDelBotonGeneral({ adminReal: false, switchHabilitado: false })).toContain("tutoriales");
    expect(opcionesDelBotonGeneral({ adminReal: true, switchHabilitado: true })).toContain("tutoriales");
    expect(opcionesDelBotonGeneral({ adminReal: false, switchHabilitado: false, suplantando: true, ayudaAqui: true })).toContain("tutoriales");
    // En una pantalla sin Ayuda (login, /no-access) tampoco hay Tutoriales.
    expect(opcionesDelBotonGeneral({ adminReal: false, switchHabilitado: false, suplantando: true, ayudaAqui: false })).not.toContain("tutoriales");
    expect(RUTA_TUTORIALES).toBe("/home/tutorials");
  });
});

describe("la migración 267 y lo que la pantalla espera de ella", () => {
  const sql = readFileSync(new URL("../../supabase/migrations/267_tutorial_views.sql", import.meta.url), "utf8");

  it("la tabla, con RLS de lo propio y lectura del admin, y la función del conteo solo para el admin", () => {
    expect(sql).toMatch(/create table if not exists public\.tutorial_views/);
    expect(sql).toMatch(/primary key \(user_id, tutorial_id\)/);
    expect(sql).toMatch(/alter table public\.tutorial_views enable row level security/);
    expect(sql).toMatch(/for select to authenticated\s+using \(\(select auth\.uid\(\)\) = user_id or \(select public\.is_admin\(\)\)\)/);
    expect(sql).toMatch(/for insert to authenticated\s+with check \(\(select auth\.uid\(\)\) = user_id\)/);
    expect(sql).toMatch(/revoke all on public\.tutorial_views from public, anon/);
    expect(sql).toMatch(/create or replace function public\.tutorial_view_stats\(\)/);
    expect(sql).toMatch(/if not coalesce\(public\.is_admin\(\), false\) then\s+raise exception/);
    expect(sql).toMatch(/revoke execute on function public\.tutorial_view_stats\(\) from public, anon/);
    // Sin los admins del hub en el público, y solo gente sin baja.
    expect(sql).toMatch(/p\.left_at is null/);
    expect(sql).toMatch(/coalesce\(p\.role, ''\) <> 'admin'/);
    // Nada de D-913 en el .sql: el checksum congela el cuerpo.
    expect(sql).not.toMatch(/D-913/);
    expect(sql).toMatch(/-- @ledger-below\r?\ninsert into public\.schema_migrations \(name, checksum\) values \('267_tutorial_views\.sql', '[0-9a-f]{64}'\)/);
  });

  it("el conflicto del upsert es la clave primaria de la tabla", () => {
    const codigo = readFileSync(new URL("./tutorial-views.ts", import.meta.url), "utf8");
    expect(codigo).toMatch(/onConflict: "user_id,tutorial_id"/);
  });
});
