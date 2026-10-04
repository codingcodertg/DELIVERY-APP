import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cacheEnMemoria } from "@/lib/route-times/tiempos";
import { proveedorEstimado } from "@/lib/route-times/proveedores";
import { esDeSuZona, zonaDeLaRecogida, zonasPorNombre } from "@/lib/zonas";
import { planificaElDia } from "./borrador";
import { entradaDelDia, type DatosDelDia } from "./entrada";

/** Una orden del día tal como la lee el motor, con dónde va hoy en su ruta. */
type FilaDelReparto = DatosDelDia["ordenes"][number] & { delivery_date?: string | null; route_seq?: number | null; load_no?: number | null };

/**
 * La zona de la RECOGIDA, de la base a las tres pantallas que reparten (D-427). El dueño, 2026-09-27: *«no tiene sentido
 * mandar a julio hasta brownsville si ya te dije que ahi esta maximo»*. La zona de la recogida es la ciudad de la
 * dirección de la tienda (Ajustes → tiendas), leída igual que la de una entrega. Nada de aquí es del dueño: «Villa
 * Norte», «Puerto Sur» y «Llano Centro» son inventadas.
 */

const leer = (ruta: string) => readFileSync(join(process.cwd(), ruta), "utf8");
const TIENDA_N = { name: "Tienda Norte", address: "1 Main St, Villa Norte, TX 78500", lat: 26.2, lng: -98.2 };
const TIENDA_S = { name: "Tienda Sur", address: "9 Bay Rd, Puerto Sur, TX 78520", lat: 25.9, lng: -97.5 };
const SIN_PUNTO = { name: "Tienda Vieja", address: "3 Old Rd, Puerto Sur, TX 78520", lat: null, lng: null };

const ordenDe = (id: string, extra: Partial<FilaDelReparto> = {}) => ({
  id, stage: "approved", order_code: id, order_type: "Customer", store: "Tienda Sur", pickup_name: "Tienda Sur", delivery_name: null,
  // Casi al lado de la tienda del Norte, y a ~45 mi de la del Sur.
  delivery_address: "5 Uno St, Llano Centro, TX 78501", delivery_lat: 26.19, delivery_lng: -98.15, delivery_windows: null, est_pallets: 2, actual_pallets: null,
  pickup_duration: null, delivery_duration: null, assigned_driver: null, input_date: null, input_time: null, account: null, customer_type: "counter_sale",
  is_training: false, updated_at: "t", delivery_date: "2026-10-05", route_seq: null, load_no: null, ...extra,   // mostrador: que el builder no decida
}) as FilaDelReparto;
const fila = (id: string, base: string, zonas: string[]) => ({ profile_id: id, base_store: base, capacity_pallets: 10, shift_start: "08:00", shift_end: "17:30", returns_to_base: true, routable: true, preferred_zones: zonas });
const CHOFERES = [{ id: "uj", full_name: "Chofer J", role: "driver" as const }, { id: "um", full_name: "Chofer M", role: "driver" as const }];
const AJUSTES = [fila("uj", "Tienda Norte", ["Villa Norte", "Llano Centro"]), fila("um", "Tienda Sur", ["Puerto Sur"])] as unknown as DatosDelDia["ajustesDeChofer"];
const settings = (tiendas: object[]) => ({ stores: tiendas, accounts: [], order_type_rules: {}, route_buckets: [], driver_capacity: {}, default_truck_capacity: null,
  route_weights: null, route_hard_windows: null, route_late_cap_min: null }) as unknown as DatosDelDia["settings"];
const datos = (ordenes: FilaDelReparto[], tiendas: object[] = [TIENDA_N, TIENDA_S], ajustes = AJUSTES): DatosDelDia =>
  ({ ordenes, choferes: CHOFERES, ajustesDeChofer: ajustes, settings: settings(tiendas), publicadoAntes: [] });
/** Las mismas tiendas, sin ciudad en la dirección: la zona de la recogida no se sabe y el motor hace lo de `motor-5`. */
const SIN_CIUDAD = [{ ...TIENDA_N, address: "1 Main St" }, { ...TIENDA_S, address: "9 Bay Rd" }];
const deps = () => ({ cache: cacheEnMemoria(), proveedores: [proveedorEstimado()], ahoraISO: "2026-09-27T12:00:00.000Z" });

describe("la zona de la recogida es la ciudad de la tienda de origen", () => {
  it("la de `pickup_name` y, si no está o no tiene punto, la de `store`; «» si ninguna", () => {
    const tiendas = [TIENDA_N, TIENDA_S, SIN_PUNTO];
    expect(zonaDeLaRecogida({ pickup_name: "tienda sur ", store: "Tienda Norte" }, tiendas)).toBe("Puerto Sur");
    expect(zonaDeLaRecogida({ pickup_name: "Tienda Vieja", store: "Tienda Norte" }, tiendas)).toBe("Villa Norte");
    expect(zonaDeLaRecogida({ pickup_name: null, store: "Tienda Norte" }, tiendas)).toBe("Villa Norte");
    expect(zonaDeLaRecogida({ pickup_name: "Otra", store: "Otra" }, tiendas)).toBe("");
    expect(zonaDeLaRecogida({ store: "Tienda Sur" }, [])).toBe("");
  });

  it("entradaDelDia la apunta en cada orden, solo con zonas; sin zonas, la entrada es la de siempre, sin una clave de más", () => {
    const con = entradaDelDia(datos([ordenDe("o1"), ordenDe("o2", { pickup_name: "Tienda Norte" })])).entrada;
    expect(con.ordenes.map((o) => [o.id, o.zona, o.zonaRecogida])).toEqual([["o1", "Llano Centro", "Puerto Sur"], ["o2", "Llano Centro", "Villa Norte"]]);
    const sinZonas = [fila("uj", "Tienda Norte", []), fila("um", "Tienda Sur", [])] as unknown as DatosDelDia["ajustesDeChofer"];
    const sin = entradaDelDia(datos([ordenDe("o1")], [TIENDA_N, TIENDA_S], sinZonas)).entrada;
    expect(JSON.stringify(sin)).not.toMatch(/"zonaRecogida"/);
    expect(entradaDelDia(datos([ordenDe("o1")], SIN_CIUDAD)).entrada.ordenes[0]).not.toHaveProperty("zonaRecogida");
  });
});

describe("Ajustes lo dice", () => {
  it("la etiqueta del peso 5 es «por punta», y la ayuda explica que la tienda de la recogida también cuenta", () => {
    const s = leer("src/components/RouteEngineSettings.tsx");
    expect(s).toContain("5 · Zona preferida (por punta fuera de ella: tienda o entrega)");
    expect(s).toContain("Recoger en la tienda de la zona de otro chofer también cuenta");
    expect(s).not.toContain("por entrega fuera de ella");
    expect(s).toContain("Una entrega a una ciudad que no es zona de nadie va al chofer más eficiente");
  });
});

describe("las pantallas que reparten heredan la regla (eran tres; Auto-asignar se quitó en D-437)", () => {
  it("«Planificar el día»: lo que sale de la tienda de M hacia la zona de J va con M (sin la ciudad de la tienda, con J)", async () => {
    const con = await planificaElDia(datos([ordenDe("o1")]), "2026-10-05", "America/Chicago", deps());
    const sin = await planificaElDia(datos([ordenDe("o1")], SIN_CIUDAD), "2026-10-05", "America/Chicago", deps());
    expect(con.plan.algorithm_version).toBe("motor-7");
    expect(con.paradas.filter((p) => p.kind === "D").map((p) => p.driver_id)).toEqual(["um"]);
    expect(sin.paradas.filter((p) => p.kind === "D").map((p) => p.driver_id)).toEqual(["uj"]);
  });

  // «✨ Auto-asignar» (el mismo motor, D-419) tenía aquí su prueba; se fue con él en D-437.

  it("«📍 Mejor lugar» (solo sugerencia): con las tiendas, la orden también es «de su zona» para M, por su tienda", () => {
    const zonas = zonasPorNombre(AJUSTES, CHOFERES);
    const o = ordenDe("o1");
    expect(esDeSuZona("Chofer J", [o], zonas, [TIENDA_N, TIENDA_S])).toBe(true);   // por la entrega, como antes
    expect(esDeSuZona("Chofer M", [o], zonas, [TIENDA_N, TIENDA_S])).toBe(true);   // por la tienda
    expect(esDeSuZona("Chofer M", [o], zonas)).toBe(false);                       // sin tiendas, solo la entrega
    // A una ciudad que no es zona de nadie, la tienda no cuenta (como en el motor): va por eficiencia.
    expect(esDeSuZona("Chofer M", [{ ...o, delivery_address: "5 Uno St, Pueblo Lejos, TX 78501" }], zonas, [TIENDA_N, TIENDA_S])).toBe(false);
    expect(esDeSuZona("Chofer M", [{ ...o, pickup_name: "Tienda Norte", store: "Tienda Norte" }], zonas, [TIENDA_N, TIENDA_S])).toBe(false);
    // Y el Gestor le pasa las tiendas de Ajustes.
    // Puesto al día por D-462: lo marcado son las filas sin chofer de la tabla que se ve (`filasAsignables`; antes `filasDelChip`).
    expect(leer("src/app/(app)/routes/page.tsx").replace(/\s+/g, " ")).toContain("esDeSuZona(k, filasAsignables.filter((d) => selectedOrders.has(d.id)), zonasDeChofer, settings.stores ?? [])");
  });
});
