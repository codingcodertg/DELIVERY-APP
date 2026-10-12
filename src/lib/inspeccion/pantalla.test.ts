import { beforeEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { canOpenTab, TABS } from "@/lib/constants";
import { pestanasEnOrden } from "@/lib/orden-de-pestanas";
import { todayISO } from "@/lib/utils";
import { AvisoDeInspeccion } from "@/components/inspeccion/AvisoDeInspeccion";
import { FormularioDeInspeccion } from "@/components/inspeccion/FormularioDeInspeccion";
import { InspeccionesDelDia } from "@/components/inspeccion/InspeccionesDelDia";
import InspectionPage from "@/app/(app)/inspection/page";
import { FUNCION_DE_CORREGIDO, FUNCION_DE_VEHICULOS, TABLA_DE_INSPECCIONES, vehiculosDelDemo } from "./almacen";
import { ROLES_QUE_REVISAN, claveDeVehiculo, ordenParaLogistica, type Inspeccion } from "./reglas";
import type { UserRole } from "@/lib/types";

/**
 * Las pantallas de la inspección pre-viaje (D-518) USAN las reglas de `reglas.ts`: se renderizan con los datos que les
 * daría el gancho y se mira lo que pintan. Y la migración 165 dice lo mismo que el código (roles, nombres, la clave de
 * «una por día»).
 */

const estado = vi.hoisted(() => ({
  me: null as null | { id: string; full_name: string; role: string },
  deliveries: [] as { assigned_driver: string; delivery_date: string; stage: string }[],
  lectura: { estado: "listo", filas: [] as unknown[], detalle: undefined as string | undefined },
  vehiculos: null as null | { estado: string; vehiculos: unknown[] },
}));

vi.mock("@/lib/data-provider", () => ({
  useData: () => ({ me: estado.me, deliveries: estado.deliveries, notify: () => {}, teaching: false }),
}));
vi.mock("@/lib/prefs", () => ({ usePrefs: () => ({ t: (_en: string, es: string) => es, lang: "es" }) }));
vi.mock("@/lib/inspeccion/usa-inspecciones", () => ({
  useInspecciones: () => ({ ...estado.lectura, recarga: () => {}, guarda: async () => ({ ok: false, motivo: "error" }), corrige: async () => ({ ok: false, detalle: "" }), local: false }),
  useVehiculos: () => estado.vehiculos,
}));
vi.mock("@/components/PhotoUpload", () => ({
  PhotoUpload: (p: { photos: string[]; disabled?: boolean }) => createElement("div", { "data-fotos": p.photos.length, "data-solo-ver": p.disabled ? "si" : "no" }),
}));
vi.mock("next/link", () => ({ default: (p: { href: string; children: unknown; className?: string }) => createElement("a", { href: p.href, className: p.className }, p.children as never) }));

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const cuenta = (html: string, patron: string) => html.split(patron).length - 1;

const HOY = todayISO();
const fila = (x: Partial<Inspeccion>): Inspeccion => ({
  id: "i", driver_id: "u-drv", driver_name: "Diego Driver", inspection_date: HOY, vehicle_id: "veh-demo-3", vehicle_label: "Camión 3 · TX 4KD-221",
  odometer: 84213, answers: {}, safe: true, notes: null, certified: true, checklist_version: "v", repairs: {}, created_at: `${HOY}T12:41:00.000Z`, ...x,
});

beforeEach(() => {
  estado.me = { id: "u-drv", full_name: "Diego Driver", role: "driver" };
  estado.deliveries = [];
  estado.lectura = { estado: "listo", filas: [], detalle: undefined };
  estado.vehiculos = { estado: "listo", vehiculos: vehiculosDelDemo("u-drv") };
});

describe("la pestaña", () => {
  const barra = (role: UserRole, permissions: string[] = []) => pestanasEnOrden(TABS.filter((tb) => canOpenTab(tb.id, { role, permissions })), role).map((tb) => tb.id);

  it("la tienen el chofer (detrás de «Mi ruta»), logística y el admin", () => {
    expect(barra("driver")).toEqual(["driver", "myroute", "inspection"]);
    expect(barra("logistics")).toContain("inspection");
    expect(barra("admin")).toContain("inspection");
    expect(TABS.find((tb) => tb.id === "inspection")).toMatchObject({ href: "/inspection", label_es: "✅ Inspección pre-viaje", label: "✅ Pre-trip inspection" });
  });

  it("no la tienen ventas, almacén, gerente ni oficina; con el permiso de repartir, sí (salvo oficina, D-480)", () => {
    for (const r of ["sales", "warehouse", "manager", "accounting"] as UserRole[]) expect([r, barra(r).includes("inspection")]).toEqual([r, false]);
    expect(canOpenTab("inspection", { role: "sales", permissions: ["deliver"] })).toBe(true);
    expect(canOpenTab("inspection", { role: "accounting", permissions: ["deliver"] })).toBe(false);
  });
});

describe("la página: el chofer llena la suya; logística y el admin ven las del día", () => {
  it("chofer: el formulario, sin el selector de vista", () => {
    const html = renderToStaticMarkup(createElement(InspectionPage));
    expect(html).toContain("data-progreso");
    expect(html).not.toContain("data-vista-de-inspeccion");
  });
  it("logística y admin: el selector y la lista del día", () => {
    for (const role of ["logistics", "admin"]) {
      estado.me = { id: "u-x", full_name: "Laura", role };
      const html = renderToStaticMarkup(createElement(InspectionPage));
      expect([role, html.includes("data-vista-de-inspeccion"), html.includes("data-resumen"), html.includes("data-progreso")]).toEqual([role, true, true, false]);
    }
  });
});

describe("el formulario del chofer", () => {
  it("34 puntos en 6 secciones; abierta la primera; «0 de 34»; los críticos sin «No aplica»", () => {
    const html = renderToStaticMarkup(createElement(FormularioDeInspeccion));
    expect(cuenta(html, "data-seccion=")).toBe(6);
    expect(html).toContain("0 de 34");
    expect(html).toContain('data-punto="frenos"');
    expect(html).not.toContain('data-punto="plataforma"');
    expect(cuenta(html, "data-punto=")).toBe(10);
    // Cabina: 10 puntos con OK y Defecto; ninguno admite «No aplica».
    expect(cuenta(html, 'data-opcion="ok"')).toBe(10);
    expect(cuenta(html, 'data-opcion="na"')).toBe(0);
    expect(html).toContain("0/10");
    expect(html).toContain('data-veredicto="pendiente"');
    expect(cuenta(html, ">crítico<")).toBe(3);
  });

  it("el vehículo: los de la empresa, el asignado dicho, y «Otro» para escribirlo", () => {
    const html = renderToStaticMarkup(createElement(FormularioDeInspeccion));
    expect(html).toContain("Camión 3 · TX 4KD-221 — el tuyo");
    expect(html).toContain("Otro (escríbelo)");
    expect(html).toContain("data-odometro");
  });

  it("sin vehículos que leer, se escribe a mano", () => {
    estado.vehiculos = { estado: "sin_funcion", vehiculos: [] };
    const html = renderToStaticMarkup(createElement(FormularioDeInspeccion));
    expect(html).not.toContain("data-vehiculo=");
    expect(html).toContain("data-vehiculo-texto");
  });

  it("sin la migración: se recorre, pero dice que aún no se puede guardar y Enviar está apagado", () => {
    estado.lectura = { estado: "sin_tabla", filas: [], detalle: undefined };
    const html = renderToStaticMarkup(createElement(FormularioDeInspeccion));
    expect(html).toContain("data-aun-no-se-guarda");
    expect(html).toMatch(/<button[^>]*data-enviar[^>]*disabled/);
    expect(html).toContain("data-punto=");
  });

  it("con la base lista, Enviar no está apagado", () => {
    const html = renderToStaticMarkup(createElement(FormularioDeInspeccion));
    expect(html).not.toMatch(/<button[^>]*data-enviar[^>]*disabled/);
  });

  it("hecha hoy: se ve hecha con su hora, si es segura y sus defectos, y deja inspeccionar otro vehículo", () => {
    estado.lectura = {
      estado: "listo", detalle: undefined,
      filas: [fila({ safe: false, answers: { inflado: { estado: "defecto", nota: "trasera baja" }, frenos: { estado: "ok" } } })],
    };
    const html = renderToStaticMarkup(createElement(FormularioDeInspeccion));
    expect(html).toContain("data-inspeccion-hecha");
    expect(html).toContain("Hecha a las");
    expect(html).toContain("7:41");
    expect(html).toContain("No es seguro salir");
    expect(html).toContain("Llantas infladas (ninguna baja ni ponchada)");
    expect(html).toContain("trasera baja");
    expect(html).toContain("data-otro-vehiculo");
    expect(html).not.toContain("data-seccion=");
  });

  it("hecha y con el crítico ya corregido por logística: se le dice al chofer, sin el «no salgas»", () => {
    const rep = { at: `${HOY}T15:00:00.000Z`, by: "u-log", by_name: "Laura Logistics", note: null };
    estado.lectura = { estado: "listo", detalle: undefined, filas: [fila({ safe: false, answers: { inflado: { estado: "defecto", nota: "baja" } }, repairs: { inflado: rep } })] };
    const html = renderToStaticMarkup(createElement(FormularioDeInspeccion));
    expect(html).toContain('data-estado="corregida"');
    expect(html).toContain("Logística marcó corregidos los defectos críticos.");
    expect(html).not.toContain("No salgas con este camión");
    expect(html).toContain("Corregido · Laura Logistics");
  });

  it("la de OTRO chofer o de otro día no cuenta como hecha", () => {
    estado.lectura = { estado: "listo", detalle: undefined, filas: [fila({ driver_id: "u-otro" }), fila({ inspection_date: "2000-01-01" })] };
    const html = renderToStaticMarkup(createElement(FormularioDeInspeccion));
    expect(html).not.toContain("data-inspeccion-hecha");
    expect(html).toContain("data-progreso");
  });

  it("lo que guarda, lo que falta y si es seguro salen de reglas.ts", () => {
    const src = sinComentarios(leer("src/components/inspeccion/FormularioDeInspeccion.tsx"));
    expect(src).toContain("const faltas = useMemo(() => faltasParaEnviar(borrador), [borrador]);");
    expect(src).toContain("await guarda(inspeccionParaGuardar(borrador, { id: me.id, nombre: me.full_name }, hoy));");
    expect(src).toContain("const paso = trasContestar(seccion, respuestas);");
    expect(src).toContain("const seguro = esSeguroParaSalir(borrador.respuestas);");
    expect(src).toContain("const repetida = me ? yaHechaConEsteVehiculo(filas, me.id, hoy, borrador.vehiculo) : false;");
    expect(src).toContain("const s = primeraSeccionConFaltas(faltas);");
    expect(src).toContain("const v = vehiculoPorDefecto(vehiculos.vehiculos);");
  });
});

describe("la lista de logística", () => {
  const filas = [
    fila({ id: "limpia", driver_name: "Carlos R.", created_at: `${HOY}T11:00:00.000Z` }),
    fila({
      id: "corregida", driver_name: "Pedro", answers: { bocina: { estado: "defecto", nota: "bajita" } },
      repairs: { bocina: { at: `${HOY}T14:00:00.000Z`, by: "u-log", by_name: "Laura Logistics", note: "cambiada" } },
    }),
    fila({ id: "no-segura", driver_name: "Miguel A.", safe: false, answers: { inflado: { estado: "defecto", nota: "baja", fotos: ["data:a"] } }, created_at: `${HOY}T13:05:00.000Z` }),
  ];
  const ids = (html: string) => [...html.matchAll(/data-inspeccion="([^"]+)"/g)].map((m) => m[1]);

  beforeEach(() => {
    estado.me = { id: "u-log", full_name: "Laura Logistics", role: "logistics" };
    estado.lectura = { estado: "listo", filas, detalle: undefined };
    estado.deliveries = [
      { assigned_driver: "Carlos R.", delivery_date: HOY, stage: "approved" },
      { assigned_driver: "Miguel A.", delivery_date: HOY, stage: "approved" },
      { assigned_driver: "Diego Driver", delivery_date: HOY, stage: "picked_up" },
    ];
  });

  it("en el orden de ordenParaLogistica: la no segura arriba", () => {
    const html = renderToStaticMarkup(createElement(InspeccionesDelDia));
    expect(ids(html)).toEqual(ordenParaLogistica(filas).map((f) => f.id));
    expect(ids(html)[0]).toBe("no-segura");
  });

  it("el resumen y quién con ruta no inspeccionó", () => {
    const html = renderToStaticMarkup(createElement(InspeccionesDelDia));
    expect(html).toContain("3 hechas");
    expect(html).toContain("1 no seguras");
    expect(html).toContain("1 defecto(s) abiertos");
    expect(html).toMatch(/data-sin-inspeccion[^>]*>[^<]*<b>Diego Driver<\/b>/);
  });

  it("el defecto abierto destacado, con su foto y «Marcar corregido»; el corregido dice quién", () => {
    const html = renderToStaticMarkup(createElement(InspeccionesDelDia));
    expect(html).toContain('data-defecto="inflado" data-abierto="si"');
    expect(html).toContain('data-defecto="bocina" data-abierto="no"');
    expect(cuenta(html, "data-marcar-corregido")).toBe(1);
    expect(html).toContain('data-fotos="1" data-solo-ver="si"');
    expect(html).toContain("Corregido · Laura Logistics");
    expect(html).toContain("cambiada");
  });

  it("la no segura con su crítico ya corregido: «Corregido — ya puede salir», y deja de contar como no segura", () => {
    const rep = { at: `${HOY}T15:00:00.000Z`, by: "u-log", by_name: "Laura Logistics", note: null };
    estado.lectura = { estado: "listo", detalle: undefined, filas: [fila({ id: "x", safe: false, answers: { inflado: { estado: "defecto", nota: "baja" } }, repairs: { inflado: rep } })] };
    const html = renderToStaticMarkup(createElement(InspeccionesDelDia));
    expect(html).toContain('data-estado="corregida"');
    expect(html).toContain("Corregido — ya puede salir");
    expect(html).not.toContain("no seguras");
  });

  it("quien no revisa no ve el botón de corregir", () => {
    estado.me = { id: "u-drv", full_name: "Diego", role: "driver" };
    expect(renderToStaticMarkup(createElement(InspeccionesDelDia))).not.toContain("data-marcar-corregido");
  });

  it("sin la migración lo dice, y no pinta una lista vacía como si nadie hubiera inspeccionado", () => {
    estado.lectura = { estado: "sin_tabla", filas: [], detalle: undefined };
    const html = renderToStaticMarkup(createElement(InspeccionesDelDia));
    expect(html).toContain("data-aun-no-se-guarda");
    expect(html).not.toContain("data-resumen");
    expect(html).not.toContain("data-sin-inspeccion");
  });
});

describe("el aviso de «Mi ruta»", () => {
  it("sin inspección hoy: «Haz tu inspección pre-viaje», con el enlace", () => {
    const html = renderToStaticMarkup(createElement(AvisoDeInspeccion));
    expect(html).toContain("data-aviso-inspeccion");
    expect(html).toContain("Haz tu inspección pre-viaje");
    expect(html).toContain('href="/inspection"');
  });
  it("hecha hoy, no sale", () => {
    estado.lectura = { estado: "listo", detalle: undefined, filas: [fila({})] };
    expect(renderToStaticMarkup(createElement(AvisoDeInspeccion))).toBe("");
  });
  it("sin la migración, no sale", () => {
    estado.lectura = { estado: "sin_tabla", detalle: undefined, filas: [] };
    expect(renderToStaticMarkup(createElement(AvisoDeInspeccion))).toBe("");
  });
  it("«Mi ruta» lo monta al principio, solo en la ruta propia, y nada más de ella cambia", () => {
    const src = leer("src/app/(app)/my-route/page.tsx");
    expect(src).toContain('import { AvisoDeInspeccion } from "@/components/inspeccion/AvisoDeInspeccion";');
    const cabecera = src.indexOf('<h2>🧭 {t("My route", "Mi ruta")}</h2>');
    const aviso = src.indexOf("{!ajeno && <AvisoDeInspeccion />}");
    const dias = src.indexOf("data-dia-de-mi-ruta");
    expect(cabecera).toBeGreaterThan(0);
    expect(aviso).toBeGreaterThan(cabecera);
    expect(aviso).toBeLessThan(dias);
    expect(cuenta(src, "AvisoDeInspeccion")).toBe(3);
  });
});

describe("la migración de la inspección (165) dice lo mismo que el código", () => {
  // Por el sufijo y no por el número: otras ramas escribieron también una 165, y si al fusionar se renumera esta, la
  // prueba la sigue encontrando (y los guardas de abajo exigen el checksum nuevo).
  const nombre = readdirSync(join(process.cwd(), "supabase/migrations")).filter((f) => f.endsWith("_inspeccion_pre_viaje.sql"));
  const sql = nombre.length === 1 ? leer(`supabase/migrations/${nombre[0]}`) : "";

  it("hay exactamente una", () => {
    expect(nombre).toHaveLength(1);
  });
  const desnudo = sql.replace(/--.*$/gm, "");

  it("la tabla y las funciones con los nombres y argumentos que llama almacen.ts", () => {
    expect(desnudo).toContain(`create table if not exists public.${TABLA_DE_INSPECCIONES} (`);
    expect(desnudo).toContain(`function public.${FUNCION_DE_CORREGIDO}(p_inspeccion uuid, p_punto text, p_corregido boolean default true, p_nota text default null)`);
    expect(desnudo).toContain(`function public.${FUNCION_DE_VEHICULOS}()`);
    expect(desnudo).toContain("returns table (id uuid, name text, plate text, assigned boolean)");
  });

  it("los roles que revisan son ROLES_QUE_REVISAN, en la política de lectura y en la función", () => {
    const lista = `in (${ROLES_QUE_REVISAN.map((r) => `'${r}'`).join(", ")})`;
    expect(cuenta(desnudo, lista)).toBe(2);
    expect([...desnudo.matchAll(/in \(('[a-z_]+'(?:, '[a-z_]+')*)\)/g)].map((m) => m[1])).toEqual(["'admin', 'logistics'", "'admin', 'logistics'"]);
  });

  it("«una por día» es la misma clave que claveDeVehiculo", () => {
    expect(desnudo).toContain("(coalesce(vehicle_id::text, 'texto:' || lower(regexp_replace(btrim(vehicle_label), '\\s+', ' ', 'g'))))");
    expect(claveDeVehiculo({ vehicle_id: null, vehicle_label: "  Pickup   Roja " })).toBe("texto:pickup roja");
    expect(claveDeVehiculo({ vehicle_id: "uuid-1", vehicle_label: "x" })).toBe("uuid-1");
  });

  it("sin UPDATE ni DELETE para nadie; sin el número de la decisión dentro", () => {
    expect(desnudo).toContain("grant select, insert on public.vehicle_inspections to authenticated;");
    expect(desnudo).not.toMatch(/grant[^;]*(update|delete)[^;]*vehicle_inspections/i);
    expect(sql).not.toContain("D-518");
  });

  it("pasa los guardas de aplica-migracion (sin transacción propia, checksum del cuerpo)", async () => {
    const ledger = await import(pathToFileURL(join(process.cwd(), "scripts/db/ledger.mjs")).href);
    expect(ledger.problemasParaAplicar({ nombre: nombre[0], texto: sql, registradas: new Map() })).toEqual([]);
  });
});
