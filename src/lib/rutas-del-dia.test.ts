import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  COLUMNAS_DE_RUTAS_DEL_DIA, faltaLaFuncion, leeRutasDelDia, paradaDeLaFila, paradasDeLasOrdenes, pendientesDelDia, pestanaDelAvisoSinChofer,
  rangoDeRutasDelDia, rotuloDeLaParada, type ParadaDelDia,
} from "@/lib/rutas-del-dia";
import { carrilesDelDia, cargaDelPanel, enAbanico, encuadreDeLasRutas, lineasDeLasRutas, puntosDeLasRutas, rutaDeLaLinea, rutasPorChofer } from "@/lib/mapa-de-rutas";
import { firmaDeLaForma, mideLaLista } from "@/lib/usa-medida-de-rutas";
import { lecturaConLoHecho } from "@/lib/route-plan/lectura-del-gestor";
import { hechasQueSePintan } from "@/lib/hechas-del-gestor";
import { TABS, canOpenTab } from "@/lib/constants";
import type { UserRole } from "@/lib/types";

// ============================================================
// «Ruta de hoy» (D-467). El dueño, 2026-10-04: «este mapa lo quiero en el map view que ya esta y que todos los puedan
// ver y se lo cambias de map a today's route», y «si rutas completas pero solo ver nada mas».
// ============================================================

const leer = (ruta: string) => readFileSync(join(process.cwd(), ruta), "utf8").split("\r\n").join("\n");
const plano = (s: string) => s.replace(/\s+/g, " ");
const sinComentarios = (s: string) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const t = (en: string) => en;
const es = (_en: string, s: string) => s;

const pagina = plano(leer("src/app/(app)/map/page.tsx"));
const codigoDePagina = plano(sinComentarios(leer("src/app/(app)/map/page.tsx")));
const gestor = plano(leer("src/app/(app)/routes/page.tsx"));
const migracion = leer("supabase/migrations/160_rutas_del_dia.sql");

const parada = (x: Partial<ParadaDelDia> & { id: string }): ParadaDelDia => ({
  order_no: 1, order_code: null, order_suffix: null, stage: "approved", assigned_driver: null, route_seq: null, pickup_seq: null, load_no: null,
  actual_pallets: null, est_pallets: 2, store: "Pharr", store_lat: 26.19, store_lng: -98.18, delivery_lat: 26.3, delivery_lng: -98.2,
  delivery_city: "Edinburg", delivery_windows: "0900-1200", delivery_date: "2026-10-05", delivery_duration: null, pickup_duration: null,
  pod_delivered_at: null, pickup_gps_at: null, ...x,
});

// Lo que NO puede salir nunca de la función ni pintarse en la pantalla.
const PRIVADAS = ["account", "contact", "phone", "email", "invoice_num", "invoices_extra", "po2", "so_num", "estimate_num", "delivery_fee",
  "notes", "delivery_address", "pickup_address", "delivery_name", "created_by", "sales_rep"];

describe("1 · la pestaña: «Today's route» / «Ruta de hoy», para todos los roles de entregas", () => {
  const tab = TABS.find((x) => x.id === "map")!;
  it("cambia de nombre y conserva su ruta `/map` (los enlaces no se rompen)", () => {
    expect(tab.label).toBe("🗺 Today's route");
    expect(tab.label_es).toBe("🗺 Ruta de hoy");
    expect(tab.href).toBe("/map");
  });
  it("la abren los siete roles; antes, solo admin, gerente, ventas y logística", () => {
    const roles: UserRole[] = ["admin", "logistics", "manager", "accounting", "sales", "warehouse", "driver"];
    for (const role of roles) expect(canOpenTab("map", { role, permissions: [] } as never), role).toBe(true);
    expect([...(tab.roles ?? [])].sort()).toEqual([...roles].sort());
  });
  it("el título de la página es el de la pestaña", () => {
    // Puesto al día por D-NEXT: «Ruta de hoy» es la página del Gestor en solo lectura; el título lo pone ella.
    expect(gestor).toContain('<h2>{soloLectura ? t("Today\'s route", "Ruta de hoy") : t("Routes Manager", "Gestor de Rutas")}');
  });
  it("el aviso «N sin chofer» va donde se asigna: el Gestor para quien lo tiene; si no, «Ruta de hoy»", () => {
    expect(pestanaDelAvisoSinChofer(["board", "map", "routes"])).toBe("routes");
    expect(pestanaDelAvisoSinChofer(["board", "dashboard", "map"])).toBe("map");
    expect(pestanaDelAvisoSinChofer(["warehouse"])).toBeNull();
    const barra = plano(leer("src/components/TopBar.tsx"));
    expect(barra).toContain("const pestanaDelAviso = pestanaDelAvisoSinChofer(mainTabs.map((tb) => tb.id));");
    expect(barra).toContain("{tb.id === pestanaDelAviso && unassignedDue > 0 && (");
    expect(barra).not.toContain('tb.id === "map" && unassignedDue');
  });
});

describe("2 · lo mínimo de cada parada: la lista blanca", () => {
  it("la lista de la app es la del `returns table` de la función, en el mismo orden, y la de su autocomprobación", () => {
    const tabla = /create or replace function public\.rutas_del_dia\(p_fecha date\)\s+returns table \(([\s\S]*?)\n  \)/.exec(migracion)![1];
    const columnas = tabla.split(",").map((l) => l.trim().split(/\s+/)[0]);
    expect(columnas).toEqual([...COLUMNAS_DE_RUTAS_DEL_DIA]);
    const esperadas = /esperadas text\[\] := array\[([\s\S]*?)\];/.exec(migracion)![1].replace(/['\s]/g, "").split(",");
    expect(esperadas).toEqual([...COLUMNAS_DE_RUTAS_DEL_DIA]);
    expect(COLUMNAS_DE_RUTAS_DEL_DIA).toHaveLength(23);
  });
  it("ninguna columna privada está en la lista, ni la función la lee de la tabla", () => {
    for (const c of PRIVADAS) expect(COLUMNAS_DE_RUTAS_DEL_DIA as readonly string[], c).not.toContain(c);
    const consulta = /return query\s+select ([\s\S]*?)\n\s+from public\.deliveries d/.exec(migracion)![1];
    // La dirección se lee SOLO para sacar su ciudad; nada más de lo privado se toca.
    expect(consulta).toContain("public.ciudad_de_la_direccion(d.delivery_address)");
    for (const c of PRIVADAS.filter((x) => x !== "delivery_address")) expect(consulta, c).not.toMatch(new RegExp(`\\bd\\.${c}\\b`));
    expect(consulta.split("d.delivery_address").length - 1).toBe(1);
  });
  it("la función: `security definer`, con el módulo, hoy±7, sin canceladas/rechazadas/borradores ni enseñanza; `anon` no la ejecuta", () => {
    const sql = migracion.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(sql).toContain("language plpgsql stable security definer set search_path = public, pg_temp as $$");
    expect(sql).toContain("if not coalesce((select public.has_deliveries_access()), false) then");
    expect(sql).toContain("using errcode = '42501'");
    expect(sql).toContain("if p_fecha is null or p_fecha < hoy - 7 or p_fecha > hoy + 7 then");
    expect(sql).toContain("where d.delivery_date = p_fecha\n       and not d.is_training\n       and d.stage not in ('draft', 'rejected', 'canceled')");
    expect(sql).toContain("revoke execute on function public.rutas_del_dia(date) from public, anon;");
    expect(sql).toContain("grant execute on function public.rutas_del_dia(date) to authenticated;");
    // No toca ninguna política, y no lleva transacción propia (la pone quien aplica).
    expect(sql).not.toMatch(/\b(create|alter|drop) policy\b/i);
    expect(sql).not.toMatch(/^\s*(begin|commit)\s*;/im);
  });
  it("la migración lleva su registro, con la suma de lo que hay encima del marcador", () => {
    const [cuerpo, registro] = migracion.split("-- @ledger-below");
    const sha = createHash("sha256").update(cuerpo, "utf8").digest("hex");
    expect(registro.trim()).toBe(`insert into public.schema_migrations (name, checksum) values ('160_rutas_del_dia.sql', '${sha}') on conflict (name) do nothing;`);
  });
  it("`paradaDeLaFila` tira lo que no esté en la lista, aunque llegue", () => {
    const p = paradaDeLaFila({ id: "a", order_no: "7", stage: "approved", pickup_seq: "1.5", delivery_city: "Pharr", delivery_date: "2026-10-05T00:00:00",
      account: "ACME", phone: "956-000-0000", delivery_address: "1 Main St, Pharr, TX", invoice_num: "F-1", delivery_fee: 99 });
    expect(Object.keys(p).sort()).toEqual([...COLUMNAS_DE_RUTAS_DEL_DIA].sort());
    expect(p.order_no).toBe(7);
    expect(p.pickup_seq).toBe(1.5);
    expect(p.delivery_date).toBe("2026-10-05");
    expect(JSON.stringify(p)).not.toMatch(/ACME|956-000|Main St|F-1|99/);
  });
});

describe("3 · sin la función (o en el demo): la misma proyección sobre lo que ya se podía leer", () => {
  const tiendas = [{ name: "Pharr", lat: 26.19, lng: -98.18 }];
  const orden = (x: Record<string, unknown>) => ({ id: "x", order_no: 1, stage: "approved", is_training: false, store: "pharr ", delivery_date: "2026-10-05",
    delivery_address: "4500 N 23rd St, McAllen, TX 78504", account: "ACME", phone: "956-000-0000", ...x }) as never;
  it("solo ese día, sin enseñanza, sin borradores, rechazadas ni anuladas", () => {
    const r = paradasDeLasOrdenes([
      orden({ id: "a" }), orden({ id: "otro-dia", delivery_date: "2026-10-06" }), orden({ id: "ensayo", is_training: true }),
      orden({ id: "borrador", stage: "draft" }), orden({ id: "rechazada", stage: "rejected" }), orden({ id: "anulada", stage: "canceled" }),
      orden({ id: "entregada", stage: "delivered" }), orden({ id: "pendiente", stage: "pending" }),
    ], "2026-10-05", tiendas);
    expect(r.map((p) => p.id)).toEqual(["a", "entregada", "pendiente"]);
  });
  it("de la dirección, solo la ciudad; y el punto de la tienda, de Ajustes", () => {
    const [p] = paradasDeLasOrdenes([orden({ id: "a" })], "2026-10-05", tiendas);
    expect(p.delivery_city).toBe("McAllen");
    expect([p.store_lat, p.store_lng]).toEqual([26.19, -98.18]);
    expect(Object.keys(p).sort()).toEqual([...COLUMNAS_DE_RUTAS_DEL_DIA].sort());
    expect(JSON.stringify(p)).not.toMatch(/ACME|956-000|23rd/);
  });
  it("lo pendiente es lo que el Gestor asigna y mueve; lo recogido y entregado va aparte", () => {
    const ps = ["pending", "approved", "fulfilling", "ready", "picked_up", "delivered"].map((stage, i) => parada({ id: String(i), stage }));
    expect(pendientesDelDia(ps).map((p) => p.stage)).toEqual(["pending", "approved", "fulfilling", "ready"]);
    expect(leer("src/app/(app)/routes/page.tsx")).toContain('const ROUTE_STAGES: Delivery["stage"][] = ["pending", "approved", "fulfilling", "ready"];');
  });
  it("el rango del selector es el ±7 de la función", () => {
    expect(rangoDeRutasDelDia("2026-10-04")).toEqual({ min: "2026-09-27", max: "2026-10-11" });
  });
});

describe("4 · leer las rutas: una consulta, y qué pasa si la función no está", () => {
  const cliente = (r: { data?: unknown; error?: { code?: string; message?: string } | null }) => {
    const llamadas: [string, Record<string, unknown>][] = [];
    return { llamadas, rpc: (fn: string, args: Record<string, unknown>) => { llamadas.push([fn, args]); return Promise.resolve({ data: r.data ?? null, error: r.error ?? null }); } };
  };
  it("llama UNA vez a `rutas_del_dia` con la fecha y devuelve las paradas saneadas", async () => {
    const c = cliente({ data: [{ id: "a", order_no: 3, stage: "ready", delivery_city: "Pharr", account: "ACME" }] });
    const r = await leeRutasDelDia(c, "2026-10-05");
    expect(c.llamadas).toEqual([["rutas_del_dia", { p_fecha: "2026-10-05" }]]);
    expect(r.origen).toBe("funcion");
    expect(r.origen === "funcion" && r.paradas[0]).toMatchObject({ id: "a", order_no: 3, delivery_city: "Pharr" });
    expect(JSON.stringify(r)).not.toContain("ACME");
  });
  it("sin la migración 160 dice «sin_funcion»; otro fallo, «error»; y si revienta, también", async () => {
    expect((await leeRutasDelDia(cliente({ error: { code: "PGRST202", message: "Could not find the function public.rutas_del_dia(p_fecha) in the schema cache" } }), "2026-10-05")).origen).toBe("sin_funcion");
    expect((await leeRutasDelDia(cliente({ error: { code: "42883" } }), "2026-10-05")).origen).toBe("sin_funcion");
    expect((await leeRutasDelDia(cliente({ error: { code: "42501", message: "rutas_del_dia: requires the deliveries module" } }), "2026-10-05")).origen).toBe("error");
    expect((await leeRutasDelDia({ rpc: () => Promise.reject(new Error("sin red")) }, "2026-10-05")).origen).toBe("error");
    expect(faltaLaFuncion(null)).toBe(false);
  });
  it("el gancho: demo → las órdenes del demo; función → lo suyo; sin función → lo que la persona ya leía, por la misma proyección", () => {
    const gancho = plano(leer("src/lib/usa-rutas-del-dia.ts"));
    expect(gancho).toContain('if (SIN_BASE) return { paradas: deLoQueLee, origen: "demo" };');
    expect(gancho).toContain('if (leido.origen === "funcion") return { paradas: leido.paradas, origen: "funcion" };');
    expect(gancho).toContain("return { paradas: deLoQueLee, origen: leido.origen };");
    // Puesto al día por D-NEXT: con `activo: false` (el Gestor que asigna) el gancho no consulta ni proyecta nada.
    expect(gancho).toContain("() => (activo ? paradasDeLasOrdenes(deliveries, fecha, settings.stores ?? [],");
    expect(gancho).toContain("if (SIN_BASE || !activo) return; let vivo = true;");
    expect(gancho).toContain("if (!activo) return { paradas: deLoQueLee, origen: null };");
    // Releer lo mismo no cambia la lista: nada de lo que cuelga de ella se vuelve a calcular ni a pedir.
    expect(gancho).toContain("JSON.stringify(antes.paradas) === JSON.stringify(paradas) ? antes : { fecha, origen: r.origen, paradas }");
  });
  it("al admin se le dice que falta la 160; a los demás no", () => {
    expect(gestor).toContain('{soloLectura && (origenDeHoy === "sin_funcion" || origenDeHoy === "error") && me.role === "admin" && ( <div className="hint" data-aviso-sin-160');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// El mapa y el panel: las mismas funciones que el Gestor.
const ana = [
  parada({ id: "a1", order_no: 1, order_code: "FA1", assigned_driver: "Ana", route_seq: 0, pickup_seq: -0.5, est_pallets: 4, delivery_lat: 26.30, delivery_lng: -98.16 }),
  parada({ id: "a2", order_no: 2, order_code: "FA2", assigned_driver: "Ana", route_seq: 1, pickup_seq: -0.25, est_pallets: 3, delivery_lat: 26.25, delivery_lng: -98.20, delivery_city: "McAllen" }),
];
const beto = [parada({ id: "b1", order_no: 3, order_code: "FA3", assigned_driver: "Beto", route_seq: 0, pickup_seq: -0.5, est_pallets: 11, delivery_lat: 26.10, delivery_lng: -98.25 })];
const hecha = parada({ id: "h1", order_no: 4, order_code: "FA4", assigned_driver: "Ana", stage: "delivered", route_seq: 0, pod_delivered_at: "2026-10-05T15:42:00Z", delivery_lat: 26.2, delivery_lng: -98.1 });
const suelta = parada({ id: "s1", order_no: 5, order_code: "FA5", delivery_lat: 26.4, delivery_lng: -98.3 });
const todas = [...ana, ...beto, hecha, suelta];
const pendientes = pendientesDelDia(todas);
const hechas = hechasQueSePintan(todas, "2026-10-05", "dia");
const choferes = [{ id: "u-ana", full_name: "Ana", store: "Pharr" }, { id: "u-beto", full_name: "Beto", store: "Pharr" }, { id: "u-caro", full_name: "Caro", store: null }];
const carriles = carrilesDelDia(choferes, ["Ruta 1"], pendientes, hechas.keys());
const porChofer = rutasPorChofer(pendientes);
const lecturaDe = (_clave: string, stops: ParadaDelDia[]) => lecturaConLoHecho(stops, 10, null, []);
const coordsDeTienda = (n: string | null) => ((n ?? "").trim().toLowerCase() === "pharr" ? { lat: 26.19, lng: -98.18 } : null);
const puntos = (marcados: Set<string> = new Set(), detalleDe?: (d: ParadaDelDia) => string) => puntosDeLasRutas<ParadaDelDia>({
  carriles, porChofer, delDia: pendientes, hechas, pasaFiltro: () => true, soloUnChofer: false,
  enfocado: marcados.size > 0, atenuada: (k) => marcados.size > 0 && !!k && !marcados.has(k),
  colorDe: (c) => (c === "Ana" ? "rojo" : c === "Beto" ? "verde" : "otro"), colorSinChofer: "gris",
  baseDe: () => ({ coords: [26.19, -98.18], direccion: "Pharr" }), lecturaDe, coordsDeTienda, t, detalleDe,
});

describe("5 · el panel «Choferes y rutas» y el mapa, con la misma lectura que el Gestor", () => {
  it("una ruta por chofer y por ruta temporal, también los que no tienen paradas", () => {
    expect(carriles.map((c) => c.key)).toEqual(["Ana", "Beto", "Caro", "Ruta 1"]);
    expect(carriles.find((c) => c.key === "Ruta 1")!.isBucket).toBe(true);
    // Quien ya no es chofer pero tiene órdenes, o ya lo entregó todo, conserva su ruta.
    expect(carrilesDelDia([], [], [{ assigned_driver: "Zoe" }], ["Yuri"]).map((c) => c.id)).toEqual(["orphan:Zoe", "orphan:Yuri"]);
  });
  it("las paradas de cada chofer, en su orden guardado; las sin puesto, detrás", () => {
    expect(porChofer.get("Ana")!.map((p) => p.id)).toEqual(["a1", "a2"]);
    const desorden = rutasPorChofer([parada({ id: "z", assigned_driver: "Ana", order_no: 9 }), parada({ id: "y", assigned_driver: "Ana", route_seq: 2 }), parada({ id: "x", assigned_driver: "Ana", route_seq: 1 }), parada({ id: "sin" })]);
    expect(desorden.get("Ana")!.map((p) => p.id)).toEqual(["x", "y", "z"]);
    expect(desorden.size).toBe(1);
  });
  it("la barra de carga: la carga MÁXIMA de la lista contra el camión; rojo si se pasa", () => {
    expect(cargaDelPanel(lecturaDe("Ana", porChofer.get("Ana")!), 10)).toEqual({ pallets: 7, cap: 10, pct: 70, over: false });
    expect(cargaDelPanel(lecturaDe("Beto", porChofer.get("Beto")!), 10)).toEqual({ pallets: 11, cap: 10, pct: 100, over: true });
    expect(cargaDelPanel(lecturaDe("Caro", []), 10)).toEqual({ pallets: 0, cap: 10, pct: 0, over: false });
  });
  it("los pines: la base, las recogidas P y las entregas D en el orden de la lista, cada una del color de su chofer", () => {
    const pts = puntos();
    const de = (id: string) => pts.find((p) => p.id === id)!;
    expect(de("__depot__u-ana")).toMatchObject({ badge: "P", color: "rojo", lat: 26.19 });
    // Caro no tiene paradas: sin base en el mapa.
    expect(pts.some((p) => p.id === "__depot__u-caro")).toBe(false);
    expect(de("a1")).toMatchObject({ badge: "D1", color: "rojo", dimmed: false });
    expect(de("a2")).toMatchObject({ badge: "D2", color: "rojo" });
    expect(de("b1")).toMatchObject({ badge: "D1", color: "verde" });
    expect(pts.filter((p) => p.id.startsWith("__pd__Ana__")).map((p) => p.badge)).toEqual(["P1", "P2"]);
    // Puesto al día por D-NEXT (a): el pin nombra la orden por su FACTURA; sin ella, por su ID y «sin factura».
    expect(de("a1").label).toBe("#FA1 (no invoice) — Ana (Stop D1)");
  });
  it("lo ya entregado sigue en el mapa con ✓ y apagado (D-459); lo sin chofer, en gris y sin etiqueta", () => {
    const pts = puntos();
    expect(pts.find((p) => p.id === "__hecha__h1")).toMatchObject({ badge: "✓", color: "rojo", dimmed: true });
    expect(pts.find((p) => p.id === "__hecha__h1")!.label).toContain("Delivered");
    expect(pts.find((p) => p.id === "s1")).toMatchObject({ color: "gris", badge: undefined, dimmed: false, label: "#FA5 (no invoice) — Unassigned" });
  });
  it("marcar un chofer lo resalta: lo de los demás (y lo sin chofer) se atenúa", () => {
    const pts = puntos(new Set(["Ana"]));
    expect(pts.find((p) => p.id === "a1")!.dimmed).toBe(false);
    expect(pts.find((p) => p.id === "b1")!.dimmed).toBe(true);
    expect(pts.find((p) => p.id === "__depot__u-beto")!.dimmed).toBe(true);
    expect(pts.find((p) => p.id === "s1")!.dimmed).toBe(true);
  });
  it("«Ruta de hoy» añade al rótulo la ciudad, los pallets y la llegada — y nada más", () => {
    const pts = puntos(new Set(), (d) => `${d.delivery_city} · ${d.est_pallets} pallets`);
    expect(pts.find((p) => p.id === "a2")!.label).toBe("#FA2 (no invoice) — Ana (Stop D2) · McAllen · 3 pallets");
    // El Gestor no pasa `detalleDe`: sus rótulos son los de siempre.
    expect(puntos().find((p) => p.id === "a2")!.label).toBe("#FA2 (no invoice) — Ana (Stop D2)");
  });
  it("las marcas que caen en el mismo punto se abren en abanico; las demás no se mueven", () => {
    const juntas = enAbanico([{ id: "1", lat: 1, lng: 1, color: "a", label: "" }, { id: "2", lat: 1, lng: 1, color: "b", label: "" }, { id: "3", lat: 2, lng: 2, color: "c", label: "" }]);
    expect(juntas.filter((p) => p.offset).map((p) => p.id)).toEqual(["1", "2"]);
    const sola = [{ id: "1", lat: 1, lng: 1, color: "a", label: "" }];
    expect(enAbanico(sola)).toBe(sola);
  });
  it("las líneas: la medida de cada ruta con paradas, sólida la ida y punteada la vuelta; una ruta vacía no deja línea", () => {
    const ls = lineasDeLasRutas({
      trazos: { Ana: [{ delivery: [[1, 1], [2, 2]], ret: [[2, 2], [1, 1]] }], Caro: [{ delivery: [[5, 5], [6, 6]], ret: [] }] },
      trazosDelPlan: {}, tieneParadas: (k) => (porChofer.get(k)?.length ?? 0) > 0, pasaFiltro: () => true, sigueSuPlan: () => false,
      colorDe: (c) => (c === "Ana" ? "rojo" : "otro"), atenuada: () => false,
    });
    expect(ls.map((l) => l.id)).toEqual(["line:Ana#0", "ret:Ana#0"]);
    expect(ls[0]).toMatchObject({ color: "rojo", dimmed: false });
    expect(ls[1].dashed).toBe(true);
    expect(rutaDeLaLinea("ret:Ana#0")).toBe("Ana");
    expect(rutaDeLaLinea("plan:Ana")).toBeNull();
  });
  it("el encuadre: todo el día, o las paradas y la base de los marcados", () => {
    const pts = puntos();
    expect(encuadreDeLasRutas(pts, new Set(), porChofer, carriles)).toHaveLength(pts.length);
    expect(encuadreDeLasRutas(pts, new Set(["Beto"]), porChofer, carriles)).toEqual([[26.19, -98.18], [26.10, -98.25]]);
  });
});

describe("6 · las millas y las horas: la medida del Gestor, sin una llamada de más", () => {
  const respuesta = { ok: true, json: async () => ({ miles: 12.34, duration_seconds: 1800, legs: [600, 300, 300, 600], geometry: [[-98.18, 26.19], [-98.16, 26.3], [-98.2, 26.25], [-98.18, 26.19]], provider: "google", traffic: true }) };
  it("UNA llamada por ruta, en el orden de la lista y sin optimizar; de ahí salen millas, minutos y la llegada de cada parada", async () => {
    const llamadas: { url: string; cuerpo: Record<string, unknown> }[] = [];
    const lista = lecturaDe("Ana", ana).paradas;
    const r = await mideLaLista({
      lista, ordenes: ana, base: [26.19, -98.18], coordsDeTienda, fecha: "2026-10-05",
      pide: async (url, init) => { llamadas.push({ url, cuerpo: JSON.parse(String(init.body)) }); return respuesta; },
    });
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0].url).toBe("/api/optimize-route");
    expect(llamadas[0].cuerpo).toMatchObject({ optimize: false, roundtrip: true, date: "2026-10-05" });
    expect((llamadas[0].cuerpo.stops as { id: string }[])[0].id).toBe("__depot__");
    expect((llamadas[0].cuerpo.stops as { id: string }[]).filter((s) => !s.id.startsWith("P:") && s.id !== "__depot__").map((s) => s.id)).toEqual(["a1", "a2"]);
    expect(r.medida.miles).toBe(12.3);
    expect(r.medida.seconds).toBe(1800);
    expect(Object.keys(r.medida.etas)).toEqual(expect.arrayContaining(["a1", "a2"]));
    expect(r.medida.etas.a1 < r.medida.etas.a2).toBe(true);
    expect(r.proveedor).toEqual({ provider: "google", traffic: true });
  });
  it("sin nada que medir no llama a nadie", async () => {
    let n = 0;
    const r = await mideLaLista({ lista: [], ordenes: [], base: [26.19, -98.18], coordsDeTienda, fecha: "2026-10-05", pide: async () => { n++; return respuesta; } });
    expect(n).toBe(0);
    expect(r.medida.stat).toBeNull();
  });
  it("la forma de la ruta no cambia al releer lo mismo: no se vuelve a pedir", () => {
    const lista = lecturaDe("Ana", ana).paradas;
    const releida = ana.map((p) => ({ ...p }));
    expect(firmaDeLaForma("2026-10-05", "Ana", releida, lecturaDe("Ana", releida).paradas)).toBe(firmaDeLaForma("2026-10-05", "Ana", ana, lista));
    const movida = [ana[1], ana[0]].map((p, i) => ({ ...p, route_seq: i }));
    expect(firmaDeLaForma("2026-10-05", "Ana", movida, lecturaDe("Ana", movida).paradas)).not.toBe(firmaDeLaForma("2026-10-05", "Ana", ana, lista));
  });
  it("la página mide con el MISMO gancho que el Gestor; no busca la base que ya tiene punto, ni pide el trazo del plan", () => {
    // Puesto al día por D-NEXT: «Ruta de hoy» es la página del Gestor (sección 7); aquí, que la medida es el mismo gancho.
    expect(pagina).toContain("<SoloLectura>");
    expect(gestor).toContain("useMedidaDeRutas<Delivery>({");
    expect(gestor).toContain('...(soloLectura ? { buscaBases: "si_falta" as const } : {}),');
    expect(plano(leer("src/lib/usa-medida-de-rutas.ts"))).toContain('if (e.buscaBases === "si_falta" && baseDeLaRuta(clave)) continue;');
    expect(gestor).toContain("if (!rutasPublicadas || soloLectura) return;");
    // Ni una llamada propia a mapas: todo pasa por el gancho.
    expect(codigoDePagina).not.toContain("fetch(");
    expect(gestor).toContain("useAutoGeocode(soloLectura ? SIN_ORDENES : dayOrders, updateDelivery)");
  });
});

describe("7 · la pantalla: el Gestor de Rutas en solo lectura (D-NEXT)", () => {
  // **Reemplazado por D-NEXT** (2026-10-06). El dueño: «today srotue is an exact duplicate of routes manager but without any
  // actionable buttom or action». Hasta aquí «Ruta de hoy» era su propia página (el panel, el mapa, un rótulo por pin y un
  // resumen) que llamaba a las mismas piezas que el Gestor. Ahora ES el Gestor: `/map` monta `routes/page.tsx` dentro de
  // `<SoloLectura>`, y todo lo que se escribe o se mueve en el Gestor está cerrado con `soloLectura`. Estas pruebas leen el
  // Gestor, que es donde vive ahora lo que «Ruta de hoy» enseña.
  it("las dos pantallas son UNA: /map monta la página del Gestor en solo lectura", () => {
    expect(pagina).toContain('import RoutesPage from "@/app/(app)/routes/page";');
    expect(pagina).toContain("<SoloLectura> <RoutesPage /> </SoloLectura>");
    expect(gestor).toContain("const soloLectura = useSoloLectura();");
  });
  it("lee las paradas de `useRutasDelDia` solo en solo lectura, y las completa con lo que la persona ya lee", () => {
    expect(gestor).toContain("const { paradas: paradasDeHoy, origen: origenDeHoy } = useRutasDelDia(date, soloLectura);");
    expect(gestor).toContain("const deliveries = useMemo(() => (soloLectura ? ordenesDeRutaDeHoy(paradasDeHoy, deliveriesLeidas) : deliveriesLeidas), [soloLectura, paradasDeHoy, deliveriesLeidas]);");
  });
  it("no asigna, no mueve, no optimiza, no vacía, no deshace y no arma rutas: cada acción del Gestor está cerrada con `soloLectura`", () => {
    for (const cierre of [
      "const puedeArmarRutas = !soloLectura && !allDates",
      "const acciones = conAcciones(soloLectura, modoDeTarjeta);",
      "acciones={soloLectura ? undefined : <>",
      "atributosDe={soloLectura ? undefined : (clave) => ({",
      "{!soloLectura && poolSelectedCount > 0 && (",
      "{!soloLectura && poolSelectedCount === 0 && seleccionDelReparto.length > 0 && recuadroDeReparto()}",
      "{!soloLectura && tab === \"routes\" && seleccionDelReparto.length > 0 && recuadroDeReparto()}",
      "const seArrastra = !soloLectura && movible",
      "arrastre={modo === \"dia\" && !soloLectura ?",
      "{!soloLectura && (tab === \"timeline\" || historial.deshacer.length > 0 || historial.rehacer.length > 0) && (",
      "useAutoGeocode(soloLectura ? SIN_ORDENES : dayOrders, updateDelivery)",
      "{hecha || soloLectura ? null : sinChofer ? (",
      "{hayFilas && !soloLectura && (",
      "{!soloLectura && ( <button className={\"vt \" + (tab === \"board\" ? \"on\" : \"\")} data-pestana=\"board\"",
      "{!soloLectura && ( <button className={\"btn btn-sm \" + (incidents.length ? \"btn-amber\" : \"btn-ghost\")} data-abrir-incidencias",
      "if (!soloLectura && !canPlanRoutes(me)) {",
    ]) expect(gestor, cierre).toContain(cierre);
    // Ctrl+Z / Ctrl+Y no se escuchan, y nada se marca para pintar su recogida (eso pide una llamada de mapas por orden).
    expect(gestor).toContain("useEffect(() => { if (soloLectura) return; const tecla = (e: KeyboardEvent) => {");
    expect(gestor).toContain("const toggleOrder = (id: string) => !soloLectura && setSelectedOrders(");
    expect(gestor).toContain("if (!soloLectura) setSelectedOrders(isolated ? new Set() : new Set([d.id]));");
    // Lo único que se guarda desde «Ruta de hoy» es el color de un chofer, como antes, y solo gerente o admin.
    expect(gestor).toContain('const canManageColors = me.role === "manager" || me.role === "admin";');
  });
  it("la orden entera solo se abre si la persona ya puede leerla (y un vendedor, solo las suyas)", () => {
    expect(gestor).toContain("const legible = soloLectura ? ordenLegible(d.id, deliveriesLeidas, me) : d;");
  });
  it("la medida: el MISMO gancho; en solo lectura no busca la base que ya tiene punto, ni pide el trazo del plan", () => {
    expect(gestor).toContain("useMedidaDeRutas<Delivery>({");
    expect(gestor).toContain('...(soloLectura ? { buscaBases: "si_falta" as const } : {}),');
    expect(gestor).toContain("if (!rutasPublicadas || soloLectura) return;");
    expect(gestor).toContain("const base = soloLectura ? baseDeLaRuta(clave) : null;");
  });
  it("lo que se quedó de «Ruta de hoy»: el día acotado, Ayer/Hoy/Mañana, los camiones (no para ventas), la leyenda, el aviso de la 160 y los colores", () => {
    expect(gestor).toContain('const veCamiones = me?.role !== "sales";');
    expect(gestor).toContain("if (!veCamiones) return [];");
    expect(gestor).toContain("{soloLectura && <MapLegend elementos={leyenda} />}");
    expect(gestor).toContain("data-colores-de-chofer");
    expect(gestor).toContain('{t("Driver colors", "Colores de chofer")}');
    expect(gestor).toContain("data-dia-anterior disabled={allDates || (soloLectura && fecha <= primerDia)}");
    expect(gestor).toContain("data-dia-siguiente disabled={allDates || (soloLectura && fecha >= rango.max)}");
    expect(gestor).toContain("data-ayer-hoy-manana");
    expect(gestor).toContain('{soloLectura && (origenDeHoy === "sin_funcion" || origenDeHoy === "error") && me.role === "admin" && ( <div className="hint" data-aviso-sin-160');
    expect(gestor).toContain('<h2>{soloLectura ? t("Today\'s route", "Ruta de hoy") : t("Routes Manager", "Gestor de Rutas")}');
  });
  it("la página no nombra ninguna columna privada de la orden", () => {
    for (const c of ["d.account", ".account ", "delivery_address", "invoice_num", "contact_", "phone", "delivery_fee", ".notes", "so_num", "po2"]) expect(codigoDePagina, c).not.toContain(c);
  });
});
