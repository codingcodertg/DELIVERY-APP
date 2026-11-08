import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CLASES_DE_EQUIPO, PLANTILLAS, bajoMinimo, duracionDeUso, equipoEnBlanco, equipoParaEditar, estadoTrasLaLista, etiquetaDeEquipoDelReporte,
  filtrarPiezas, gestionaAlguna, huecosDeLaLista, idDeEquipoElegido, listaCompleta, listaDelDia, nombreDePunto, numeroDelCampo, opcionesDeEquipo,
  ordenarEquipo, ordenarPiezas, puedeCerrarUso, puedeEmpezarUso, puedeGestionar, puedeOperar, puntosDeLaFila, puntosParaEnviar, resultadoDeLaLista,
  transicionesDePieza, usoAbierto, validarEquipo, veMantenimiento, type Equipo, type EstadoDePieza, type Uso,
} from "./mantenimiento";
import { PASOS, pasoCompleto, primerHueco, respuestasParaGuardar } from "./pasos";
import { vistaPermitida } from "./puerta";
import type { Quien } from "./visibilidad";

/**
 * 273: Mantenimiento (fase 1 de los KPI de almacén). La plantilla de la lista diaria, las transiciones de las
 * refacciones, el uso del equipo y los permisos; y que el SQL diga lo mismo que esto.
 */
const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").replace(/\r\n/g, "\n");
const SQL = leer("supabase/migrations/273_mantenimiento_de_equipo.sql");

const admin: Quien = { id: "a", role: "admin", module_access: [] };
const francis: Quien = { id: "francis", role: "manager", store: "RDZ Pharr", visible_stores: ["RDZ Pharr"], module_access: ["warehouse_ops"], warehouse_ops_role: "store_admin" };
const gerente: Quien = { id: "g", role: "manager", store: "RDZ Edinburg", module_access: ["warehouse_ops"] };
const supervisor: Quien = { id: "s", role: "warehouse", store: "RDZ McAllen", module_access: ["warehouse_ops"], warehouse_ops_role: "full", permissions: ["warehouse_ops_supervisor"] };
const almacen: Quien = { id: "w1", role: "warehouse", store: "RDZ McAllen", module_access: ["warehouse_ops"] }; // scrap_only por defecto
const ventas: Quien = { id: "v", role: "sales", store: "RDZ Pharr", module_access: ["warehouse_ops"] }; // full, pero no gerente
const sinModulo: Quien = { id: "x", role: "warehouse", store: "RDZ Pharr", module_access: ["deliveries"] };

describe("la plantilla de la lista diaria", () => {
  it("hay plantilla para cada clase, con los puntos pedidos por el dueño", () => {
    for (const k of CLASES_DE_EQUIPO) expect(PLANTILLAS[k].length).toBeGreaterThan(0);
    const montacargas = PLANTILLAS.forklift.map((p) => p.id);
    for (const id of ["tires", "forks_chains", "mast_hydraulics", "brakes", "horn_lights_alarm", "seat_belt", "battery_fuel", "fluids", "overhead_guard", "fire_extinguisher", "damage_cleanliness"]) {
      expect(montacargas).toContain(id);
    }
    expect(PLANTILLAS.pallet_jack.map((p) => p.id)).toEqual(["wheels", "forks", "pump_leaks", "handle_controls"]);
    // Sin ids repetidos dentro de una plantilla, y todos con texto en los dos idiomas.
    for (const k of CLASES_DE_EQUIPO) {
      const ids = PLANTILLAS[k].map((p) => p.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const p of PLANTILLAS[k]) { expect(p.en).toBeTruthy(); expect(p.es).toBeTruthy(); }
    }
    expect(nombreDePunto("forklift", "brakes", "es")).toBe("Frenos");
    expect(nombreDePunto("forklift", "no-existe", "en")).toBe("no-existe");
  });
  it("la lista está completa cuando todos los puntos tienen respuesta y cada falla lleva nota", () => {
    const c: Record<string, { result?: "ok" | "fail" | "na"; note?: string }> = {};
    expect(listaCompleta("pallet_jack", c)).toBe(false);
    expect(huecosDeLaLista("pallet_jack", c).sinContestar).toHaveLength(4);
    for (const p of PLANTILLAS.pallet_jack) c[p.id] = { result: "ok" };
    expect(listaCompleta("pallet_jack", c)).toBe(true);
    c.forks = { result: "fail" };
    expect(listaCompleta("pallet_jack", c)).toBe(false);
    expect(huecosDeLaLista("pallet_jack", c)).toEqual({ sinContestar: [], sinNota: ["forks"] });
    c.forks = { result: "fail", note: "   " };
    expect(listaCompleta("pallet_jack", c)).toBe(false);
    c.forks = { result: "fail", note: "Bent fork" };
    expect(listaCompleta("pallet_jack", c)).toBe(true);
  });
  it("lo que se envía va en el orden de la plantilla, con la nota recortada; el resultado y el estado del equipo salen de las fallas", () => {
    const items = puntosParaEnviar("pallet_jack", { wheels: { result: "ok" }, forks: { result: "fail", note: "  Bent fork " }, pump_leaks: { result: "na" }, handle_controls: { result: "ok" } });
    expect(items).toEqual([{ id: "wheels", result: "ok" }, { id: "forks", result: "fail", note: "Bent fork" }, { id: "pump_leaks", result: "na" }, { id: "handle_controls", result: "ok" }]);
    expect(resultadoDeLaLista(items)).toBe("fail");
    expect(estadoTrasLaLista("in_service", "fail")).toBe("needs_repair");
    expect(estadoTrasLaLista("in_service", "ok")).toBe("in_service");
    // Un equipo fuera de servicio no «mejora» a needs_repair por una lista; y una lista buena no lo arregla sola.
    expect(estadoTrasLaLista("out_of_service", "fail")).toBe("out_of_service");
    expect(estadoTrasLaLista("needs_repair", "ok")).toBe("needs_repair");
    expect(resultadoDeLaLista(puntosParaEnviar("pallet_jack", { wheels: { result: "ok" }, forks: { result: "ok" }, pump_leaks: { result: "na" }, handle_controls: { result: "ok" } }))).toBe("ok");
  });
  it("los items de la base se leen con tolerancia (basura fuera)", () => {
    expect(puntosDeLaFila([{ id: "tires", result: "ok" }, { id: "x", result: "meh" }, "no", null, { id: "brakes", result: "fail", note: "soft" }]))
      .toEqual([{ id: "tires", result: "ok" }, { id: "brakes", result: "fail", note: "soft" }]);
    expect(puntosDeLaFila("nada")).toEqual([]);
  });
  it("«hecha hoy»: una lista del mismo equipo y día", () => {
    const listas = [{ equipment_id: "e1", shift_date: "2026-11-09" }];
    expect(listaDelDia(listas, "e1", "2026-11-09")).toBe(true);
    expect(listaDelDia(listas, "e1", "2026-11-08")).toBe(false);
    expect(listaDelDia(listas, "e2", "2026-11-09")).toBe(false);
  });
});

describe("el equipo", () => {
  it("se valida antes de guardar: nombre, año y horómetro", () => {
    const e = equipoEnBlanco("RDZ Pharr");
    expect(validarEquipo(e)).toEqual({ ok: false, motivo: "nombre" });
    expect(validarEquipo({ ...e, name: "Forklift #1" })).toEqual({ ok: true });
    expect(validarEquipo({ ...e, name: "Forklift #1", year: "1800" })).toEqual({ ok: false, motivo: "anio" });
    expect(validarEquipo({ ...e, name: "Forklift #1", year: "2019", hour_meter: "12.34" })).toEqual({ ok: false, motivo: "horometro" });
    expect(validarEquipo({ ...e, name: "Forklift #1", hour_meter: "4312.5" })).toEqual({ ok: true });
    expect(validarEquipo({ ...e, store: "", name: "Forklift #1" })).toEqual({ ok: false, motivo: "tienda" });
  });
  it("numeroDelCampo: vacío = null, mal escrito = NaN", () => {
    expect(numeroDelCampo("")).toBeNull();
    expect(numeroDelCampo("  ")).toBeNull();
    expect(numeroDelCampo("12")).toBe(12);
    expect(numeroDelCampo("12.5", 1)).toBe(12.5);
    expect(Number.isNaN(numeroDelCampo("12.55", 1))).toBe(true);
    expect(Number.isNaN(numeroDelCampo("abc"))).toBe(true);
    expect(Number.isNaN(numeroDelCampo("2019.0", 0))).toBe(true);
  });
  it("ida y vuelta a la edición", () => {
    const e: Equipo = { id: "e1", store: "RDZ Pharr", kind: "forklift", name: "F1", brand: null, model: "8FGU25", serial: null, year: 2019, status: "in_service", hour_meter: 10.5, notes: null, photos: ["a/b.jpg"], active: true, created_by: null, created_at: "", updated_by: null, updated_at: "" };
    const ed = equipoParaEditar(e);
    expect(ed).toMatchObject({ id: "e1", brand: "", model: "8FGU25", year: "2019", hour_meter: "10.5", photos: ["a/b.jpg"] });
    expect(validarEquipo(ed)).toEqual({ ok: true });
  });
  it("el orden: lo que necesita atención primero, lo dado de baja al final", () => {
    const l = ordenarEquipo([
      { name: "B", status: "in_service", active: true }, { name: "A", status: "in_service", active: true },
      { name: "Z", status: "needs_repair", active: true }, { name: "Y", status: "out_of_service", active: true }, { name: "0", status: "needs_repair", active: false },
    ]);
    expect(l.map((x) => x.name)).toEqual(["Z", "Y", "A", "B", "0"]);
  });
});

describe("las refacciones: transiciones y filtros", () => {
  it("el personal solo marca «se necesita»; el gerente la mueve por el camino", () => {
    expect(transicionesDePieza("ok", false)).toEqual(["needed"]);
    expect(transicionesDePieza("needed", false)).toEqual([]);
    expect(transicionesDePieza("ordered", false)).toEqual(["needed"]);
    expect(transicionesDePieza("ok", true)).toEqual(["needed"]);
    expect(transicionesDePieza("needed", true)).toEqual(["ordered", "ok"]);
    expect(transicionesDePieza("ordered", true)).toEqual(["received", "needed"]);
    expect(transicionesDePieza("received", true)).toEqual(["ok", "needed"]);
    // Nadie se queda en el mismo estado.
    for (const s of ["ok", "needed", "ordered", "received"] as EstadoDePieza[]) {
      expect(transicionesDePieza(s, true)).not.toContain(s);
      expect(transicionesDePieza(s, false)).not.toContain(s);
    }
  });
  it("bajo mínimo y el filtro «atención»", () => {
    const piezas = [
      { status: "ok" as const, qty_on_hand: 5, min_qty: 2, name: "a" }, { status: "ok" as const, qty_on_hand: 1, min_qty: 2, name: "b" },
      { status: "needed" as const, qty_on_hand: 0, min_qty: 0, name: "c" }, { status: "ordered" as const, qty_on_hand: 0, min_qty: 0, name: "d" },
      { status: "received" as const, qty_on_hand: 3, min_qty: 0, name: "e" },
    ];
    expect(bajoMinimo(piezas[0])).toBe(false);
    expect(bajoMinimo(piezas[1])).toBe(true);
    expect(bajoMinimo({ qty_on_hand: 0, min_qty: 0 })).toBe(false);
    expect(filtrarPiezas(piezas, "atencion").map((p) => p.name)).toEqual(["b", "c", "d"]);
    expect(filtrarPiezas(piezas, "needed").map((p) => p.name)).toEqual(["c"]);
    expect(filtrarPiezas(piezas, "todas")).toHaveLength(5);
    expect(ordenarPiezas(piezas).map((p) => p.name)).toEqual(["c", "d", "e", "a", "b"]);
  });
});

describe("el uso del equipo", () => {
  const abierto: Uso = { id: "u1", equipment_id: "e1", user_id: "w1", user_name: "Ana", started_at: "2026-11-08T10:00:00Z", ended_at: null, hour_meter_start: null, hour_meter_end: null, notes: null };
  const cerrado: Uso = { ...abierto, id: "u0", ended_at: "2026-11-08T11:30:00Z" };
  it("un solo uso abierto por equipo; quien lo abrió (o el gerente) lo cierra", () => {
    expect(usoAbierto([cerrado, abierto], "e1")).toBe(abierto);
    expect(usoAbierto([cerrado], "e1")).toBeNull();
    expect(puedeEmpezarUso({ status: "in_service", active: true }, null)).toBe(true);
    expect(puedeEmpezarUso({ status: "needs_repair", active: true }, null)).toBe(true);
    expect(puedeEmpezarUso({ status: "out_of_service", active: true }, null)).toBe(false);
    expect(puedeEmpezarUso({ status: "in_service", active: false }, null)).toBe(false);
    expect(puedeEmpezarUso({ status: "in_service", active: true }, abierto)).toBe(false);
    expect(puedeCerrarUso(abierto, "w1", false)).toBe(true);
    expect(puedeCerrarUso(abierto, "w2", false)).toBe(false);
    expect(puedeCerrarUso(abierto, "w2", true)).toBe(true);
    expect(puedeCerrarUso(cerrado, "w1", true)).toBe(false);
  });
  it("la duración legible", () => {
    expect(duracionDeUso(cerrado, "es")).toBe("1 h 30 min");
    expect(duracionDeUso(abierto, "en", new Date("2026-11-08T10:25:00Z"))).toBe("25 min");
    expect(duracionDeUso(abierto, "en", new Date("2026-11-08T12:00:00Z"))).toBe("2 h");
  });
});

describe("los permisos: la misma regla que la base", () => {
  it("opera (ve, lista, uso, pedir) cualquiera con nivel en SU tienda; el admin en todas", () => {
    expect(puedeOperar(admin, "RDZ Pharr")).toBe(true);
    expect(puedeOperar(almacen, "RDZ McAllen")).toBe(true);
    expect(puedeOperar(almacen, "RDZ Pharr")).toBe(false);
    expect(puedeOperar(francis, "RDZ Pharr")).toBe(true);
    expect(puedeOperar(francis, "RDZ McAllen")).toBe(false);
    expect(puedeOperar(ventas, "RDZ Pharr")).toBe(true);
    expect(puedeOperar(sinModulo, "RDZ Pharr")).toBe(false);
  });
  it("gestiona (alta, edición, mover refacciones) el gerente / supervisor full de la tienda, store_admin en las suyas, admin", () => {
    expect(puedeGestionar(admin, "RDZ Pharr")).toBe(true);
    expect(puedeGestionar(francis, "RDZ Pharr")).toBe(true);
    expect(puedeGestionar(francis, "RDZ McAllen")).toBe(false);
    expect(puedeGestionar(gerente, "RDZ Edinburg")).toBe(true);
    expect(puedeGestionar(gerente, "RDZ Pharr")).toBe(false);
    expect(puedeGestionar(supervisor, "RDZ McAllen")).toBe(true);
    expect(puedeGestionar(almacen, "RDZ McAllen")).toBe(false);
    expect(puedeGestionar(ventas, "RDZ Pharr")).toBe(false);
    expect(puedeGestionar(sinModulo, "RDZ Pharr")).toBe(false);
    expect(gestionaAlguna(francis, ["RDZ McAllen", "RDZ Pharr"])).toBe(true);
    expect(gestionaAlguna(almacen, ["RDZ McAllen"])).toBe(false);
  });
  it("la sección se ofrece a cualquiera con nivel (también «solo merma»), y la ruta lo repite", () => {
    expect(veMantenimiento(almacen)).toBe(true);
    expect(veMantenimiento(sinModulo)).toBe(false);
    expect(vistaPermitida(almacen, { v: "mantenimiento" })).toBe(true);
    expect(vistaPermitida(sinModulo, { v: "mantenimiento" })).toBe(false);
    expect(vistaPermitida(admin, { v: "mantenimiento" })).toBe(true);
  });
  it("el SQL dice lo mismo: lectura por warehouse_ops_in_store, gestión por warehouse_ops_can_manage, un uso abierto, nota al fallar", () => {
    expect(SQL).toContain("create or replace function public.warehouse_ops_in_store(r_store text)");
    expect(SQL).toMatch(/n\.nivel = 'admin'\s+or \(n\.nivel <> '' and \(p\.store = r_store or r_store = any\(coalesce\(p\.visible_stores, '\{\}'\)\)\)\)/);
    for (const tabla of ["warehouse_equipment", "warehouse_checklists", "warehouse_parts"]) {
      expect(SQL).toContain(`create policy ${tabla}_read on public.${tabla} for select to authenticated using (public.warehouse_ops_in_store(store));`);
    }
    expect(SQL).toContain("create unique index if not exists warehouse_equipment_usage_open on public.warehouse_equipment_usage (equipment_id) where ended_at is null;");
    expect(SQL).toContain("if not public.warehouse_ops_can_manage(p_store) then");
    expect(SQL).toContain("if not public.warehouse_ops_can_manage(tienda) then");
    expect(SQL).toContain("if u.user_id <> yo and not public.warehouse_ops_can_manage(tienda) then");
    expect(SQL).toContain("un punto que fallo necesita una nota");
    expect(SQL).toContain("status = case when cardinality(fallos) > 0 and status = 'in_service' then 'needs_repair' else status end");
    expect(SQL).toContain("check (kind in ('forklift', 'pallet_jack', 'electric_jack', 'other'))");
    expect(SQL).toContain("check (status in ('ok', 'needed', 'ordered', 'received'))");
    // El personal pide por request_part (in_store); los cambios de estado completos por save_part (can_manage).
    expect(SQL).toMatch(/create or replace function public\.warehouse_ops_request_part[\s\S]*?warehouse_ops_in_store\(tienda\)/);
  });
  it("la migración está completa: idempotente, deshacer en la cabecera, autocomprobación, línea de registro con su checksum", () => {
    expect(SQL).toContain("create table if not exists public.warehouse_equipment");
    expect(SQL).toContain("Para deshacer:");
    expect(SQL).toContain("drop table if exists public.warehouse_equipment_usage;");
    expect(SQL).toContain("-- @ledger-below");
    const sum = createHash("sha256").update(SQL.split("-- @ledger-below")[0], "utf8").digest("hex");
    expect(SQL).toMatch(new RegExp(`insert into public\\.schema_migrations \\(name, checksum\\) values \\('273_mantenimiento_de_equipo\\.sql', '${sum}'\\) on conflict \\(name\\) do nothing;\\r?\\n?$`));
    expect(SQL).not.toMatch(/^\s*begin;\s*$/m);
    // Las cuatro tablas solo con politica de lectura; nada de escritura directa.
    expect(SQL).toContain("if exists (select 1 from pg_policies where schemaname = 'public' and tablename = tbl and cmd <> 'SELECT') then");
  });
});

describe("el reporte de mantenimiento elige el equipo del inventario", () => {
  const equipos = [
    { id: "e1", name: "Forklift #2", store: "RDZ Pharr", active: true }, { id: "e2", name: "Forklift #1", store: "RDZ Pharr", active: true },
    { id: "e3", name: "Old one", store: "RDZ Pharr", active: false }, { id: "e4", name: "McAllen jack", store: "RDZ McAllen", active: true },
  ];
  it("las opciones son el equipo activo de la tienda, por nombre, con «Otro» al final; sin equipo, null (opciones fijas)", () => {
    const o = opcionesDeEquipo(equipos, "RDZ Pharr")!;
    expect(o.map((x) => x.v)).toEqual(["eq:e2", "eq:e1", "other"]);
    expect(o[0].en).toBe("Forklift #1");
    expect(opcionesDeEquipo(equipos, "RDZ Edinburg")).toBeNull();
    expect(idDeEquipoElegido("eq:e2")).toBe("e2");
    expect(idDeEquipoElegido("forklift_1")).toBeNull();
    expect(idDeEquipoElegido("eq:")).toBeNull();
  });
  it("el paso fijo acepta el valor del inventario (el resumen no lo da por hueco) y se guarda en answers", () => {
    const paso = PASOS.maintenance.find((p) => p.id === "equipment")!;
    expect(pasoCompleto(paso, { equipment: "eq:e2" })).toBe(true);
    expect(pasoCompleto(paso, { equipment: "forklift_1" })).toBe(true);
    expect(pasoCompleto(paso, { equipment: "eq:" })).toBe(false);
    expect(pasoCompleto(paso, { equipment: "nope" })).toBe(false);
    const r = { equipment: "eq:e2", issue: "repair_needed", description: "Hydraulic leak" };
    expect(primerHueco("maintenance", r)).toBe(-1);
    expect(respuestasParaGuardar("maintenance", r)).toEqual(r);
    // «Otro» sigue pidiendo «¿cuál?».
    expect(primerHueco("maintenance", { equipment: "other", issue: "routine", description: "Check" })).toBe(1);
  });
  it("la etiqueta en las listas: el nombre guardado si vino del inventario; si no, la fija", () => {
    expect(etiquetaDeEquipoDelReporte({ equipment: "eq:e2", equipment_name: "Forklift #1" }, "Forklift #1 (fixed)")).toBe("Forklift #1");
    expect(etiquetaDeEquipoDelReporte({ equipment: "eq:e2" }, "x")).toBe("—");
    expect(etiquetaDeEquipoDelReporte({ equipment: "forklift_1" }, "Forklift #1")).toBe("Forklift #1");
  });
});
