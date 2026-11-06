import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cantidadesValidas, enteroDelCampo, perdida, piezasPorCajaInicial, piezasTotales, totalesPorTienda } from "./perdida";
import { puedeVerReporte, veLosReportes, type Quien } from "./visibilidad";
import { empleadosDelReporte, pasoCompleto, pasosVisibles, PASOS, primerHueco, respuestasParaGuardar } from "./pasos";
import { esDeRrhh, TIPOS } from "./tipos";
import { accessibleModules, knownModules, MODULES, MODULE_ACCESS } from "@/lib/constants";
import { appForPath } from "@/lib/app-for-path";
import { APP_VERSIONS } from "@/lib/app-versions";
import { KINDS } from "@/lib/recruiting/historial";

const SQL = readFileSync(join(process.cwd(), "supabase/migrations/247_operaciones_de_almacen.sql"), "utf8").replace(/\r\n/g, "\n");

describe("la merma: costo por pieza", () => {
  it("piezas = cajas × piezas por caja + sueltas", () => {
    expect(piezasTotales({ boxes: 3, piecesPerBox: 8, loosePieces: 2 })).toBe(26);
  });
  it("pérdida a centavos; sin costo, null", () => {
    expect(perdida(1.15, 26)).toBe(29.9);
    expect(perdida(null, 26)).toBeNull();
  });
  it("cantidades: enteros, sin negativos, al menos una pieza", () => {
    expect(cantidadesValidas({ boxes: 0, piecesPerBox: 8, loosePieces: 1 })).toBe(true);
    expect(cantidadesValidas({ boxes: 0, piecesPerBox: 8, loosePieces: 0 })).toBe(false);
    expect(cantidadesValidas({ boxes: 1, piecesPerBox: 0, loosePieces: 0 })).toBe(false);
    expect(cantidadesValidas({ boxes: -1, piecesPerBox: 8, loosePieces: 5 })).toBe(false);
    expect(cantidadesValidas({ boxes: 1.5, piecesPerBox: 8, loosePieces: 0 })).toBe(false);
  });
  it("campo numérico y piezas por caja de partida", () => {
    expect(enteroDelCampo("")).toBe(0);
    expect(enteroDelCampo(" 12 ")).toBe(12);
    expect(enteroDelCampo("1.5")).toBeNaN();
    expect(piezasPorCajaInicial(null)).toBe(1);
    expect(piezasPorCajaInicial(6)).toBe(6);
  });
  it("totales por tienda: semana desde el domingo, mes, siempre", () => {
    const ahora = new Date(2026, 10, 5, 12); // jueves 5 nov 2026
    const t = totalesPorTienda([
      { created_at: new Date(2026, 10, 2).toISOString(), store: "A", total_loss: 10 },
      { created_at: new Date(2026, 10, 1, 1).toISOString(), store: "B", total_loss: 5.5 },
      { created_at: new Date(2026, 9, 30).toISOString(), store: "A", total_loss: 100 },
      { created_at: new Date(2026, 10, 3).toISOString(), store: "A", total_loss: null },
    ], ahora);
    expect(t["*"]).toEqual({ semana: 15.5, mes: 15.5, todo: 115.5 });
    expect(t.A).toEqual({ semana: 10, mes: 10, todo: 110 });
  });
  it("la base hace la misma cuenta", () => {
    expect(SQL).toContain("v_total := v_boxes * v_ppb + v_loose;");
    expect(SQL).toContain("round(prod.cost * v_total, 2)");
  });
});

describe("quién ve qué (y la 247 dice lo mismo)", () => {
  const base: Quien = { id: "u1", role: "warehouse", store: "McAllen", module_access: ["warehouse_ops"] };
  const propio = { kind: "scrap" as const, store: "McAllen", author_id: "u1" };
  const ajeno = { kind: "safety" as const, store: "McAllen", author_id: "u2" };
  const rrhh = { kind: "insubordination" as const, store: "McAllen", author_id: "u1" };
  it("el personal ve solo lo suyo, y nunca uno de RR. HH. (ni el que llenó)", () => {
    expect(puedeVerReporte(base, propio)).toBe(true);
    expect(puedeVerReporte(base, ajeno)).toBe(false);
    expect(puedeVerReporte(base, rrhh)).toBe(false);
    expect(veLosReportes(base)).toBe(false);
  });
  it("el supervisor ve lo de su tienda, no lo de RR. HH.", () => {
    const sup = { ...base, permissions: ["warehouse_ops_supervisor"] };
    expect(puedeVerReporte(sup, ajeno)).toBe(true);
    expect(puedeVerReporte(sup, { ...ajeno, store: "Edinburg" })).toBe(false);
    expect(puedeVerReporte(sup, rrhh)).toBe(false);
    expect(veLosReportes(sup)).toBe(true);
  });
  it("el gerente de tienda ve todo lo de su tienda, también RR. HH.", () => {
    const g = { ...base, id: "g", role: "manager" };
    expect(puedeVerReporte(g, rrhh)).toBe(true);
    expect(puedeVerReporte(g, { ...rrhh, store: "Edinburg" })).toBe(false);
    expect(puedeVerReporte({ ...g, visible_stores: ["Edinburg"] }, { ...rrhh, store: "Edinburg" })).toBe(true);
  });
  it("RR. HH. (admin/gerente) ve los de RR. HH. de todas; el admin todo", () => {
    const hr: Quien = { id: "h", role: "sales", recruiting_role: "manager" };
    expect(puedeVerReporte(hr, { ...rrhh, store: "Edinburg" })).toBe(true);
    expect(puedeVerReporte(hr, ajeno)).toBe(false);
    expect(puedeVerReporte({ id: "a", role: "admin" }, ajeno)).toBe(true);
  });
  it("la política de la 247 es de solo lectura y usa la misma función", () => {
    expect(SQL).toContain("using (public.warehouse_ops_can_see(kind, store, author_id))");
    expect(SQL).toContain("r_kind in ('zone', 'insubordination', 'positive')");
    expect(SQL).toContain("'warehouse_ops_supervisor' = any");
    expect(SQL).not.toMatch(/create policy [^;]*on public\.warehouse_reports\s+for (insert|update|delete|all)/);
    for (const k of TIPOS) expect(SQL).toContain(`'${k}'`);
    expect(TIPOS.filter(esDeRrhh)).toEqual(["zone", "insubordination", "positive"]);
  });
  it("el cubo de fotos es privado", () => {
    expect(SQL).toContain("values ('warehouse-ops', 'warehouse-ops', false,");
  });
});

describe("el asistente", () => {
  it("cada tipo tiene preguntas y la foto nunca bloquea", () => {
    for (const k of TIPOS) expect(PASOS[k].length).toBeGreaterThan(2);
    expect(pasoCompleto({ id: "photo", tipo: "foto", en: "", es: "" }, {})).toBe(true);
  });
  it("la lesión solo se pregunta si alguien se lastimó, y entonces es obligatoria", () => {
    expect(pasosVisibles("safety", { injured: "no" }).some((p) => p.id === "injury")).toBe(false);
    const r = { involved: ["x"], safety_type: "ppe", description: "sin casco", injured: "yes" };
    expect(primerHueco("safety", r)).toBe(4);
    expect(primerHueco("safety", { ...r, injury: "corte en la mano" })).toBe(-1);
  });
  it("lo que se guarda no lleva lo oculto ni lo vacío", () => {
    expect(respuestasParaGuardar("safety", { injured: "no", injury: "x", description: "  algo  ", involved: [] }))
      .toEqual({ injured: "no", description: "algo" });
  });
  it("merma: producto y cantidades válidas; quién lo rompió es opcional y, en interno, no hay CRMA", () => {
    const r = { product: { id: 7, sku: "S", name: "N", cost: 1, pieces_per_box: 8 }, split: { damaged: 8, sample: 0 },
      qty: { boxes: 1, piecesPerBox: 8, loosePieces: 0 }, return_type: "internal", reason: "fell" };
    expect(primerHueco("scrap", r)).toBe(-1);
    expect(primerHueco("scrap", { ...r, qty: { boxes: 0, piecesPerBox: 8, loosePieces: 0 } })).toBe(1);
  });
  it("los empleados del reporte", () => {
    expect(empleadosDelReporte("positive", { employee: "e1" })).toEqual(["e1"]);
    expect(empleadosDelReporte("zone", { involved: ["a", "b"] })).toEqual(["a", "b"]);
    expect(empleadosDelReporte("scrap", { broken_by: ["a"] })).toEqual([]);
  });
});

describe("el módulo y el expediente", () => {
  it("tarjeta, casilla, ruta y versión", () => {
    expect(MODULES.find((m) => m.key === "warehouse_ops")?.href).toBe("/operaciones");
    expect(accessibleModules(["warehouse_ops"]).map((m) => m.key)).toEqual(["warehouse_ops"]);
    expect(knownModules(["warehouse_ops"])).toEqual(["warehouse_ops"]);
    expect(MODULE_ACCESS.find((m) => m.key === "warehouse_ops")?.accessColumn).toBe("module_access");
    expect(appForPath("/operaciones/reportes")).toBe("warehouse_ops");
    expect(APP_VERSIONS.warehouse_ops).toMatch(/^\d+\.\d+\.\d+$/);
    expect(SQL).toContain("'customers','warehouse_ops']");
  });
  it("la 247 es la ÚLTIMA que define profiles_module_access_known, y su lista es MODULE_ACCESS entero", () => {
    const definen = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort()
      .filter((f) => readFileSync(`supabase/migrations/${f}`, "utf8").includes("add constraint profiles_module_access_known"));
    expect(definen[definen.length - 1]).toBe("247_operaciones_de_almacen.sql");
    const lista = /module_access <@ array\[([^\]]+)\]\)\n  not valid;/.exec(SQL)![1];
    expect(lista.split(",").sort()).toEqual(MODULE_ACCESS.map((m) => `'${m.key}'`).sort());
  });
  it("los tres tipos del expediente existen en la librería y en el check de la 247", () => {
    for (const k of ["employee_insubordination", "employee_zone_infraction", "employee_positive_observation"] as const) {
      expect(KINDS).toContain(k);
      expect(SQL).toContain(`'${k}'`);
    }
  });
});
