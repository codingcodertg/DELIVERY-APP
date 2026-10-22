import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parteOrdenesGrandes, type ChoferEntrada, type OrdenEntrada } from "@/lib/route-engine";
import { paradasSinPartes } from "@/lib/route-engine/reparte-entre";
import { avisoDePartirSola, cargasAlGuardar, cargasParaElCamion, parteEnCadena, restosParaPartir, ROLES_QUE_PARTEN, type OrdenAlGuardar } from "./cargas-partidas";
import { capacidadDelChofer } from "./agregar-material-avisos";
import type { Stage } from "./types";

/**
 * Una orden que no cabe en el camión se parte SOLA al guardarla (D-NEXT). Roberto Rodriguez Jr, 2026-10-22, desde el
 * Gestor: «When its over 10 pallets system needs to automatically split it into 2 trips».
 *
 * Primero la causa, medida: FV168 (18 pallets, «Truck capacity» 10) se asignó con «Asignar a…» (D-474; su historial en
 * producción dice «Assigned to Ernesto Castillo by “Assign to…” (engine)»). Ese motor parte en cargas VIRTUALES y
 * `paradasSinPartes` las junta en UNA recogida y UNA entrega antes de escribir: una fila, un viaje de 18.
 */

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").replace(/\r\n/g, "\n");
// Los choferes de Ajustes como en producción (2026-10-22): los cuatro en 10, sin capacidad de flota.
const ajustes = { driver_capacity: { "Ernesto Castillo": 10, Steven: 10 }, default_truck_capacity: null } as unknown as Parameters<typeof capacidadDelChofer>[1];
const capacidad = (c: string) => capacidadDelChofer(c, ajustes);
const fv168 = (extra: Partial<OrdenAlGuardar> = {}): OrdenAlGuardar => ({ assigned_driver: null, stage: "ready", est_pallets: 18, actual_pallets: 18, ...extra });

describe("HOY (medido): «Asignar a…» junta las cargas del motor en una sola parada", () => {
  it("el motor parte 18 en un camión de 10 en dos cargas, y `paradasSinPartes` las vuelve UNA P y UNA D", () => {
    const o: OrdenEntrada = { id: "fv168", codigo: "FV168", entrada: "2026-10-21 1521", origen: "0,0", destino: "1,0", pallets: 18, ventana: null, servicioRecogidaMin: 5, servicioEntregaMin: 10 };
    const c: ChoferEntrada = { id: "e", nombre: "Ernesto Castillo", base: "0,0", capacidad: 10, entrada: 480, salida: 1050, vuelveABase: true };
    const { partes } = parteOrdenesGrandes([o], [c]);
    expect(partes.fv168).toEqual(["fv168#a", "fv168#b"]);
    const paradas = partes.fv168.flatMap((id) => [{ orden: id, tipo: "P" as const }, { orden: id, tipo: "D" as const }]);
    expect(paradasSinPartes(paradas)).toEqual([{ orden: "fv168", tipo: "P" }, { orden: "fv168", tipo: "D" }]);
  });
});

describe("en cuántas cargas: llena camiones y la última lleva el resto (la regla del motor)", () => {
  it("18 en 10 → 10 + 8; 25 en 10 → 10 + 10 + 5; 20 en 10 → 10 + 10; 15.3 en 10 → 10 + 5.3 sin cola", () => {
    expect(cargasParaElCamion(18, 10)).toEqual([10, 8]);
    expect(cargasParaElCamion(25, 10)).toEqual([10, 10, 5]);
    expect(cargasParaElCamion(20, 10)).toEqual([10, 10]);
    expect(cargasParaElCamion(15.3, 10)).toEqual([10, 5.3]);
  });
  it("una que cabe no se parte: 10 en 10, 4 en 10; sin pallets o sin camión, tampoco", () => {
    expect(cargasParaElCamion(10, 10)).toEqual([]);
    expect(cargasParaElCamion(4, 10)).toEqual([]);
    expect(cargasParaElCamion(0, 10)).toEqual([]);
    expect(cargasParaElCamion(18, 0)).toEqual([]);
  });
  it("son las MISMAS partes que `parteOrdenesGrandes` para el mismo camión", () => {
    for (const total of [10.5, 18, 20, 25, 31.7]) {
      const o: OrdenEntrada = { id: "x", codigo: "X", entrada: null, origen: "0,0", destino: "1,0", pallets: total, ventana: null, servicioRecogidaMin: 0, servicioEntregaMin: 0 };
      const c: ChoferEntrada = { id: "c", nombre: "C", base: "0,0", capacidad: 10, entrada: 480, salida: 1050, vuelveABase: true };
      const { ordenes } = parteOrdenesGrandes([o], [c]);
      expect(cargasParaElCamion(total, 10)).toEqual(ordenes.map((p) => p.pallets));
    }
  });
});

describe("cuándo se parte sola: el guardado que deja la orden más grande que el camión de su chofer", () => {
  it("FV168: darle chofer a 18 pallets con camión de 10 → 10 + 8, y a `partir_carga` se le piden 8", () => {
    const cargas = cargasAlGuardar(fv168(), { assigned_driver: "Ernesto Castillo" }, capacidad, "admin");
    expect(cargas).toEqual([10, 8]);
    expect(restosParaPartir(cargas.map((pallets) => ({ pallets })))).toEqual([8]);
  });
  it("25 pallets → tres viajes, y los restos en cadena: 15 a la madre y 5 a la recién nacida", () => {
    const cargas = cargasAlGuardar(fv168({ est_pallets: 25, actual_pallets: null }), { assigned_driver: "Steven" }, capacidad, "logistics");
    expect(cargas).toEqual([10, 10, 5]);
    expect(restosParaPartir(cargas.map((pallets) => ({ pallets })))).toEqual([15, 5]);
  });
  it("la capacidad es la del chofer NUEVO: a uno de 20 no se parte, al de 10 sí", () => {
    const grande = (c: string) => (c === "Grande" ? 20 : 10);
    expect(cargasAlGuardar(fv168({ assigned_driver: "Ernesto Castillo" }), { assigned_driver: "Grande" }, grande, "admin")).toEqual([]);
    expect(cargasAlGuardar(fv168({ assigned_driver: "Grande" }), { assigned_driver: "Ernesto Castillo" }, grande, "admin")).toEqual([10, 8]);
  });
  it("subirle los pallets a una ya asignada también la parte; dejar los mismos, no", () => {
    const asignada = fv168({ assigned_driver: "Ernesto Castillo", est_pallets: 8, actual_pallets: null });
    expect(cargasAlGuardar(asignada, { est_pallets: 18 }, capacidad, "manager")).toEqual([10, 8]);
    expect(cargasAlGuardar(asignada, { actual_pallets: 12 }, capacidad, "manager")).toEqual([10, 2]);
    const yaGrande = fv168({ assigned_driver: "Ernesto Castillo" });
    expect(cargasAlGuardar(yaGrande, { actual_pallets: 18 }, capacidad, "admin")).toEqual([]);
  });
  it("un guardado que no le da chofer ni le cambia pallets no parte nada, aunque ya estuviera de más (queda el ✂)", () => {
    const yaGrande = fv168({ assigned_driver: "Ernesto Castillo" });
    expect(cargasAlGuardar(yaGrande, { invoice_num: "147147" } as Partial<OrdenAlGuardar>, capacidad, "admin")).toEqual([]);
    expect(cargasAlGuardar(yaGrande, { assigned_driver: "Ernesto Castillo" }, capacidad, "admin")).toEqual([]);
    expect(cargasAlGuardar(yaGrande, { assigned_driver: " Ernesto Castillo " }, capacidad, "admin")).toEqual([]);
  });
  it("quitarle el chofer, o que quepa, no parte", () => {
    expect(cargasAlGuardar(fv168({ assigned_driver: "Ernesto Castillo" }), { assigned_driver: null }, capacidad, "admin")).toEqual([]);
    expect(cargasAlGuardar(fv168({ est_pallets: 10, actual_pallets: 10 }), { assigned_driver: "Ernesto Castillo" }, capacidad, "admin")).toEqual([]);
  });
  it("solo pendiente de ruta: lo recogido o entregado va entero (es lo que pasó)", () => {
    for (const stage of ["pending", "approved", "fulfilling", "ready"] as Stage[]) expect(cargasAlGuardar(fv168({ stage }), { assigned_driver: "Ernesto Castillo" }, capacidad, "admin")).toEqual([10, 8]);
    for (const stage of ["picked_up", "delivered", "draft", "canceled"] as Stage[]) expect(cargasAlGuardar(fv168({ stage }), { assigned_driver: "Ernesto Castillo" }, capacidad, "admin")).toEqual([]);
  });
  it("solo si quien guarda puede partir (el espejo de `puede_partir_cargas`): ventas, almacén y el chofer no", () => {
    expect([...ROLES_QUE_PARTEN].sort()).toEqual(["accounting", "admin", "logistics", "manager"]);
    for (const rol of ["sales", "warehouse", "driver", null]) expect(cargasAlGuardar(fv168(), { assigned_driver: "Ernesto Castillo" }, capacidad, rol)).toEqual([]);
    expect(cargasAlGuardar(undefined, { assigned_driver: "Ernesto Castillo" }, capacidad, "admin")).toEqual([]);
  });
  it("la lista de roles es la de la 157", () => {
    expect(leer("supabase/migrations/157_partes_de_orden.sql")).toContain("public.current_user_role() in ('admin', 'logistics', 'manager', 'accounting')");
  });
});

describe("partir en cadena y el aviso", () => {
  it("cada resto a la recién nacida; para en el primer fallo y devuelve las que nacieron", async () => {
    const llamadas: [string, number][] = [];
    const partir = async (id: string, resto: number) => { llamadas.push([id, resto]); return `${id}+`; };
    expect(await parteEnCadena(partir, "m", [15, 5])).toEqual(["m+", "m++"]);
    expect(llamadas).toEqual([["m", 15], ["m+", 5]]);
    // Falla la SEGUNDA y la tercera funcionaría: tiene que parar ahí, no saltársela.
    let n = 0;
    const fallaUna = async (id: string) => (++n === 2 ? null : `${id}+`);
    expect(await parteEnCadena(fallaUna, "m", [15, 5, 2])).toEqual(["m+"]);
    expect(n).toBe(2);
    expect(await parteEnCadena(partir, "m", [])).toEqual([]);
  });
  it("dice en cuántos viajes y cuánto lleva cada uno; si no se pudo, que no cabe y que queda el ✂", () => {
    const bien = avisoDePartirSola({ orden: "FV168", chofer: "Ernesto Castillo", capacidad: 10, cargas: [10, 8], nacidas: 1 });
    expect(bien.en).toContain("#FV168 didn't fit in Ernesto Castillo's truck (18 of 10 pallets): split into 2 trips, 10 + 8.");
    expect(bien.es).toContain("#FV168 no cabía en el camión de Ernesto Castillo (18 de 10 pallets): partida en 2 viajes, 10 + 8.");
    const mal = avisoDePartirSola({ orden: "FV168", chofer: "Ernesto Castillo", capacidad: 10, cargas: [10, 10, 5], nacidas: 1 });
    expect(mal.en).toContain("could not be split automatically: use ✂ in Routes.");
    expect(mal.es).toContain("no se pudo partir sola");
  });
});

describe("los proveedores llaman a la regla en el guardado (la prueba se alimenta de quien llama)", () => {
  const real = leer("src/lib/data-provider.tsx");
  const demo = leer("src/lib/local-data-provider.tsx");
  const gestor = leer("src/app/(app)/routes/page.tsx");
  it("el real: tras registrar el guardado, `parteSiNoCabe` con la fila de antes y el parche", () => {
    const i = real.indexOf("const updateDelivery = useCallback");
    const fin = real.indexOf("updateDeliveryRef.current = updateDelivery;");
    expect(i).toBeGreaterThan(0);
    expect(fin).toBeGreaterThan(i);
    const cuerpo = real.slice(i, fin);
    const registro = cuerpo.indexOf("await logEvent(id, \"edited\"");
    const parte = cuerpo.indexOf("await parteSiNoCabe(id, before, patch);");
    expect(registro).toBeGreaterThan(0);
    expect(parte).toBeGreaterThan(registro);
  });
  it("el real: la regla con el rol de verdad y la capacidad del Gestor, y `partir_carga` en cadena", () => {
    expect(real).toContain("const capacidadDe = (chofer: string) => capacidadDelChofer(chofer, settings);");
    expect(real).toContain("const cargas = cargasAlGuardar(before, patch, capacidadDe, realRole);");
    expect(real).toContain("supabase.rpc(\"partir_carga\", { p_id: de, p_resto: resto })");
    expect(real).toContain("}, id, restosParaPartir(cargas.map((pallets) => ({ pallets }))));");
    expect(gestor).toContain("const capacityFor = (driver: string) => settings.driver_capacity?.[driver] ?? settings.default_truck_capacity ?? DEFAULT_CAPACITY;");
  });
  it("el demo: la misma regla con `partirCarga` del demo", () => {
    expect(demo).toContain("await parteSiNoCabeRef.current?.(id, antes as unknown as Delivery | undefined, patch);");
    expect(demo).toContain("const cargas = cargasAlGuardar(antes, patch, capacidadDe, me.role);");
    expect(demo).toContain("const nuevas = await parteEnCadena(partirCarga, id, restosParaPartir(cargas.map((pallets) => ({ pallets }))));");
    expect(demo).toContain("parteSiNoCabeRef.current = parteSiNoCabe;");
  });
});
