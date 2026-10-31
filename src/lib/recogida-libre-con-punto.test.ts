import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { opcionesDeRecogidaLibre, parcheDePuntoDeRecogida, puntoDeRecogidaLibre, recogidaLibreDeLaOrden } from "./recogida-libre";
import { recogidaParaElChofer } from "./recogida-y-ruta-del-dia";
import { zonaDeLaRecogida } from "./zonas";
import { direccionesARevisar } from "./direccion-completa";
import { entradaDelDia, filasDeParadas, puntoDeRecogida, type DatosDelDia } from "./route-plan/entrada";
import { puntosDelTrazoPublicado } from "./route-plan/trazo-del-plan";
import type { NamedLocation, OrderTypeRule } from "./types";

/**
 * Una recogida LIBRE (Otro, Proveedor) no es una tienda: tiene su punto, su ciudad y su nombre (D-NEXT, 223).
 * Roberto, con FV594: «Pickup is in harlingen but it put weslaco» · «the store sold from does not apply and also pickup is not a store».
 */

const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");
const sinComentarios = (s: string) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const TIENDAS: NamedLocation[] = [
  { name: "RDZ Weslaco", address: "1102 W Expressway 83, Weslaco, TX 78596", lat: 26.17, lng: -98.0 },
  { name: "RDZ Pharr", address: "1120 E Expressway 83, Pharr, TX 78577", lat: 26.2, lng: -98.17 },
];
const REGLAS: Record<string, OrderTypeRule> = {
  Other: { docRef: "none", anyOrigin: true },
  Proveedor: { docRef: "hidden", hasCustomer: false, storeToStore: false },
  Customer: { docRef: "invoice", storeToStore: false },
};
// FV594 tal como quedó guardada: tipo Otro, recogida con el NOMBRE de una tienda y la dirección de otro sitio.
const FV594 = { id: "fv594", order_type: "Other", store: "RDZ Pharr", pickup_name: "RDZ Weslaco", pickup_address: "Harlingen, TX, USA", pickup_point_lat: 26.19, pickup_point_lng: -97.69 };

describe("la regla desde la orden", () => {
  it("Otro y Proveedor recogen libre; Customer no; sin reglas, no", () => {
    expect(recogidaLibreDeLaOrden({ order_type: "Other" }, REGLAS)).toBe(true);
    expect(recogidaLibreDeLaOrden({ order_type: "Proveedor" }, REGLAS)).toBe(true);
    expect(recogidaLibreDeLaOrden({ order_type: "Customer" }, REGLAS)).toBe(false);
    expect(recogidaLibreDeLaOrden({ order_type: "Other" }, undefined)).toBe(false);
  });
  it("el punto: solo números finitos y no 0,0; el parche escribe el punto o nulos", () => {
    expect(puntoDeRecogidaLibre(FV594)).toEqual({ lat: 26.19, lng: -97.69 });
    expect(puntoDeRecogidaLibre({ pickup_point_lat: 0, pickup_point_lng: 0 })).toBeNull();
    expect(puntoDeRecogidaLibre({ pickup_point_lat: null, pickup_point_lng: -97 })).toBeNull();
    expect(puntoDeRecogidaLibre({})).toBeNull();
    expect(parcheDePuntoDeRecogida({ lat: 1, lng: 2 })).toEqual({ pickup_point_lat: 1, pickup_point_lng: 2 });
    expect(parcheDePuntoDeRecogida(null)).toEqual({ pickup_point_lat: null, pickup_point_lng: null });
  });
  it("el desplegable con recogida libre: los puntos guardados que no son tienda, sin repetir", () => {
    const guardados: NamedLocation[] = [{ name: "Dal-Tile Pharr", address: "1 Industrial" }, { name: "rdz weslaco", address: "x" }, { name: "Dal-Tile Pharr", address: "1 Industrial" }, { name: "", address: "y" }];
    expect(opcionesDeRecogidaLibre(TIENDAS, guardados).map((l) => l.name)).toEqual(["Dal-Tile Pharr"]);
    expect(opcionesDeRecogidaLibre(TIENDAS, undefined)).toEqual([]);
  });
});

describe("FV594: con el nombre de una tienda y la dirección de Harlingen", () => {
  it("para el chofer: con las reglas NO es tienda (nombre y dirección); sin reglas, como antes (tienda)", () => {
    expect(recogidaParaElChofer(FV594, TIENDAS, REGLAS)).toEqual({ enTienda: false, nombre: "RDZ Weslaco", direccion: "Harlingen, TX, USA" });
    expect(recogidaParaElChofer(FV594, TIENDAS)).toEqual({ enTienda: true, tienda: "RDZ Weslaco" });
    expect(recogidaParaElChofer({ ...FV594, order_type: "Customer" }, TIENDAS, REGLAS)).toEqual({ enTienda: true, tienda: "RDZ Weslaco" });
  });
  it("la ciudad de recogida: Harlingen, no Weslaco; en una Customer sigue la tienda", () => {
    expect(zonaDeLaRecogida(FV594, TIENDAS, ["Harlingen", "Weslaco"], REGLAS)).toBe("Harlingen");
    expect(zonaDeLaRecogida(FV594, TIENDAS, ["Harlingen", "Weslaco"])).toBe("Weslaco");
    expect(zonaDeLaRecogida({ ...FV594, order_type: "Customer" }, TIENDAS, ["Harlingen", "Weslaco"], REGLAS)).toBe("Weslaco");
  });
  it("antes de guardar, la recogida libre se revisa y se geocodifica aunque el nombre sea el de una tienda", () => {
    const r = direccionesARevisar({ ...FV594, delivery_address: "" }, null, TIENDAS, REGLAS);
    expect(r).toEqual([{ que: "recogida", texto: "Harlingen, TX, USA", punto: null, geocodificar: true }]);
    expect(direccionesARevisar({ ...FV594, order_type: "Customer", delivery_address: "" }, null, TIENDAS, REGLAS)).toEqual([]);
  });
});

describe("el motor de rutas", () => {
  const datos = (orden: Partial<Record<keyof typeof FV594, unknown>> & { id: string; order_type: string }): DatosDelDia => ({
    settings: { stores: TIENDAS, order_type_rules: REGLAS } as unknown as DatosDelDia["settings"],
    choferes: [], ajustesDeChofer: [], basesDelDia: [], planPublicado: null, bloqueadas: [],
    ordenes: [{ stage: "ready", order_code: "X", store: "RDZ Pharr", pickup_name: "RDZ Weslaco", pickup_address: "Harlingen, TX, USA", delivery_name: null, delivery_address: "Raymondville, TX", delivery_lat: 26.48, delivery_lng: -97.78, delivery_windows: null, est_pallets: 1, actual_pallets: null, pickup_duration: null, delivery_duration: null, assigned_driver: null, input_date: null, input_time: null, account: null, customer_type: null, is_training: false, updated_at: "", ...orden }],
  } as unknown as DatosDelDia);
  it("una recogida libre con punto sale de SU punto (recogida:id), no de la tienda del nombre; sin punto, sin origen", () => {
    const con = entradaDelDia(datos({ ...FV594 }));
    const o = con.entrada.ordenes[0];
    expect(o.origen).toBe(puntoDeRecogida("fv594"));
    expect(con.puntos[puntoDeRecogida("fv594")]).toEqual({ lat: 26.19, lng: -97.69 });
    expect(o.nombreDeRecogida).toBe("RDZ Weslaco");
    const sin = entradaDelDia(datos({ id: "fv594", order_type: "Other", pickup_point_lat: null, pickup_point_lng: null }));
    expect(sin.entrada.ordenes[0].origen).toBeNull();
    // Control: en una Customer con ese nombre, la tienda.
    const cliente = entradaDelDia(datos({ ...FV594, order_type: "Customer" }));
    expect(cliente.entrada.ordenes[0].origen).toBe("tienda:rdz weslaco");
    expect(cliente.entrada.ordenes[0].nombreDeRecogida).toBeUndefined();
  });
  it("la parada P del plan lleva el nombre tecleado y el punto de la orden; el trazo publicado también", () => {
    const filas = filasDeParadas(
      { rutas: [{ chofer: "c1", paradas: [{ tipo: "P", orden: "fv594", punto: puntoDeRecogida("fv594"), etiqueta: "P1", visita: 1, llegada: 0, salida: 0, esperaMin: 0, servicioMin: 0, tardeMin: 0, cargaAlSalir: 1, tramoMin: 0, tramoMillas: 0, fijada: false }] }] } as never,
      { ordenes: [{ id: "fv594", nombreDeRecogida: "RDZ Weslaco" }], choferes: [{ id: "c1", nombre: "Julio" }] } as never,
      { [puntoDeRecogida("fv594")]: { lat: 26.19, lng: -97.69 } },
      TIENDAS,
    );
    expect(filas[0]).toMatchObject({ kind: "P", place: "RDZ Weslaco", lat: 26.19, lng: -97.69 });
    const trazo = puntosDelTrazoPublicado([{ kind: "P", order_ref: "fv594", seq: 0, place: "Harlingen Supply" }], [FV594], TIENDAS);
    expect(trazo).toEqual([{ id: "P:0", lat: 26.19, lng: -97.69 }]);
  });
});

describe("la ficha y las pantallas", () => {
  const modal = sinComentarios(leer("src/components/OrderModal.tsx"));
  it("con recogida libre: sin «Tienda (Vendido desde)» cuando ya tiene tienda, el desplegable sin nuestras tiendas, y el punto se guarda", () => {
    expect(modal.split("{!sinVenta && !(recogidaLibreDelTipo && !!d.store) && (")).toHaveLength(3);
    expect(modal).toContain("options={opcionesDeRecogidaDelTipo}");
    expect(modal).not.toContain("options={pickupOptions}");
    expect(modal).toContain('if (r.que === "recogida" && r.geocodificar && recogidaLibreDelTipo) Object.assign(parche, parcheDePuntoDeRecogida(punto));');
    expect(modal).toContain("recogidaParaElChofer(existing ?? d, settings.stores ?? [], settings.order_type_rules)");
  });
  it("Mi ruta, el Gestor y las celdas del plan pasan las reglas", () => {
    expect(sinComentarios(leer("src/app/(app)/my-route/page.tsx"))).toContain("recogidaParaElChofer(d, settings.stores ?? [], settings.order_type_rules)");
    const rutas = sinComentarios(leer("src/app/(app)/routes/page.tsx"));
    expect(rutas).toContain("zonaDeLaRecogida(d, settings.stores ?? [], ciudadesQueSeConocen, settings.order_type_rules)");
    expect(rutas).toContain("reglas: settings.order_type_rules, llegada: llegadaDeLaOrden");
    expect(sinComentarios(leer("src/lib/route-plan/celdas-del-plan.ts"))).toContain("zonaDeLaRecogida(d, ctx.tiendas, ctx.conocidas, ctx.reglas)");
  });
  it("la 223: dos columnas, sin transacción propia, registro numerado; la lista las pide como opcionales", () => {
    const sql = leer("supabase/migrations/223_recogida_libre_con_punto.sql");
    expect(sql).toContain("add column if not exists pickup_point_lat double precision");
    expect(sql).toContain("add column if not exists pickup_point_lng double precision");
    expect(sql).not.toMatch(/^\s*(begin|commit);/m);
    expect(sql).not.toContain("'PENDIENTE'");
  });
});
