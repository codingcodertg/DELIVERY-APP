import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  COLUMNAS_DEL_GESTOR, COLUMNAS_DEL_GESTOR_POR_DEFECTO, MARCA_V5, MARCA_V6, VISTAS_EN_EL_PLAN, columnasDeLaTabla, columnasDePlantillaDelGestor,
  columnasDelSelector, mueveEnElGestor, ordenDeLaTabla, preferenciasDelGestorAlLeer, seVeEnLaRecogida,
} from "@/lib/routes-columns";
import { celdaPropiaDelPlan, claseDeLaOrden, type ContextoDelPlan } from "./celdas-del-plan";

/**
 * D-434: la tabla del plan con las columnas que pidió el dueño, 2026-09-28, sobre la captura del plan publicado: «quiero que
 * haya una columna solo para el id, lueg osi es builder, inter tienda o vventa al mostrador, luego la ciudad donde se recoje,
 * y el invoice number, quitame el pocolum, siguiente etapa, y a donde entrega, fecha de enterea, pallets, quita choffer, deja
 * direcion de entrega y ventana».
 */

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n").replace(/\s+/g, " ");
const claves = (elegidas: readonly string[], orden: readonly string[] | null = null) => columnasDeLaTabla("plan", elegidas, orden).map((c) => c.key);

describe("las columnas de partida del plan, en el orden del dueño", () => {
  it("tras el ID fijo: tipo de cliente, ciudad de recogida, (D-NEXT: ciudad de entrega,) factura, dirección de entrega y ventanas — y nada más", () => {
    expect([...VISTAS_EN_EL_PLAN]).toEqual(["pl_clase", "pl_ciudad_recogida", "pl_ciudad_entrega", "pl_invoice", "pl_address", "pl_windows"]);
    expect(claves(COLUMNAS_DEL_GESTOR_POR_DEFECTO)).toEqual([...VISTAS_EN_EL_PLAN]);
  });

  it("lo que pidió quitar sigue en el ⚙, escondido: PO, Etapa, Fecha, Pallets, Chofer, Tienda, Cuenta y el Tipo de orden", () => {
    const enElSelector = columnasDelSelector("plan", null).map((c) => c.key);
    for (const k of ["pl_po", "pl_stage", "pl_date", "pl_pallets", "pl_driver", "pl_store", "pl_account", "pl_type"]) {
      expect(enElSelector, k).toContain(k);
      expect(COLUMNAS_DEL_GESTOR.find((c) => c.key === k)?.oculta, k).toBe(true);
    }
  });

  it("el nombre de la nueva no choca con el «Tipo» de Órdenes (el tipo de orden)", () => {
    const col = (k: string) => COLUMNAS_DEL_GESTOR.find((c) => c.key === k);
    expect(col("pl_clase")).toMatchObject({ es: "Plan: Tipo de cliente", en: "Plan: Customer type" });
    expect(col("pl_type")).toMatchObject({ es: "Plan: Tipo", en: "Plan: Type" });
    expect(col("pl_ciudad_recogida")).toMatchObject({ es: "Plan: Ciudad de recogida", en: "Plan: Pickup city" });
  });

  it("fila P: la ciudad de recogida y el tipo de cliente se ven; la dirección de entrega y las ventanas, no (son de la entrega)", () => {
    const col = (k: string) => COLUMNAS_DEL_GESTOR.find((c) => c.key === k)!;
    expect(seVeEnLaRecogida(col("pl_ciudad_recogida"))).toBe(true);
    expect(seVeEnLaRecogida(col("pl_clase"))).toBe(true);
    expect(seVeEnLaRecogida(col("pl_invoice"))).toBe(true);
    expect(seVeEnLaRecogida(col("pl_address"))).toBe(false);
    expect(seVeEnLaRecogida(col("pl_windows"))).toBe(false);
  });
});

describe("la celda: builder, intertienda o mostrador; y la ciudad de la tienda donde se recoge", () => {
  const tiendas = [
    { name: "Tienda Norte", address: "1 Calle Uno, Ciudad Norte, TX 78500, USA", lat: 26.1, lng: -98.1 },
    { name: "Tienda Sur", address: "2 Calle Dos, Ciudad Sur, TX 78520, USA", lat: 25.9, lng: -97.5 },
    { name: "Tienda Sin Punto", address: "3 Calle Tres, Ciudad Oeste, TX 78501, USA", lat: null, lng: null },
  ];
  const ctx = (es = true): ContextoDelPlan => ({ reglas: { Traslado: { storeToStore: true, docRef: "none" } }, tiendas, conocidas: [], es });

  it("la clase sale de las reglas de siempre: tipo guardado, si no la cuenta; tienda a tienda es Intertienda; sin tipo, nada", () => {
    const r = ctx().reglas;
    expect(claseDeLaOrden({ order_type: "Customer", account: "Constructora X", customer_type: null }, r)).toBe("builder");
    expect(claseDeLaOrden({ order_type: "Customer", account: "Venta al mostrador", customer_type: null }, r)).toBe("counter_sale");
    // Lo guardado en la orden le gana a la cuenta (D-316/D-337).
    expect(claseDeLaOrden({ order_type: "Customer", account: "Venta al mostrador", customer_type: "builder" }, r)).toBe("builder");
    expect(claseDeLaOrden({ order_type: "Intertienda", account: "", customer_type: null }, r)).toBe("intertienda");
    // Un tipo que Ajustes marca de tienda a tienda, aunque no se llame así.
    expect(claseDeLaOrden({ order_type: "Traslado", account: "Constructora X", customer_type: "builder" }, r)).toBe("intertienda");
    expect(claseDeLaOrden({ order_type: "", account: "Constructora X", customer_type: null }, r)).toBeNull();
  });

  it("el texto, en el idioma de quien mira; y «—» cuando no se sabe", () => {
    const d = (order_type: string, account: string) => ({ order_type, account, customer_type: null, pickup_name: "Tienda Norte", store: null });
    expect(celdaPropiaDelPlan("pl_clase", d("Customer", "Constructora X"), ctx())).toBe("Builder");
    expect(celdaPropiaDelPlan("pl_clase", d("Customer", "Venta al mostrador"), ctx())).toBe("Venta al mostrador");
    expect(celdaPropiaDelPlan("pl_clase", d("Customer", "Venta al mostrador"), ctx(false))).toBe("Counter sale");
    expect(celdaPropiaDelPlan("pl_clase", d("Intertienda", ""), ctx())).toBe("Intertienda");
    expect(celdaPropiaDelPlan("pl_clase", d("", ""), ctx())).toBe("—");
  });

  it("la ciudad de recogida: la de la tienda de pickup_name; si no está o no tiene punto, la de store; si ninguna, «—»", () => {
    const d = (pickup_name: string | null, store: string | null) => ({ order_type: "Customer", account: "", customer_type: null, pickup_name, store });
    expect(celdaPropiaDelPlan("pl_ciudad_recogida", d("Tienda Norte", "Tienda Sur"), ctx())).toBe("Ciudad Norte");
    expect(celdaPropiaDelPlan("pl_ciudad_recogida", d("Almacén que no existe", "Tienda Sur"), ctx())).toBe("Ciudad Sur");
    expect(celdaPropiaDelPlan("pl_ciudad_recogida", d("Tienda Sin Punto", "Tienda Sur"), ctx())).toBe("Ciudad Sur");
    expect(celdaPropiaDelPlan("pl_ciudad_recogida", d(null, null), ctx())).toBe("—");
  });

  it("cualquier otra columna no es suya: la pinta la celda de Órdenes", () => {
    const d = { order_type: "Customer", account: "", customer_type: null, pickup_name: "Tienda Norte", store: null };
    expect(celdaPropiaDelPlan("pl_invoice", d, ctx())).toBeUndefined();
    expect(celdaPropiaDelPlan("pl_address", d, ctx())).toBeUndefined();
  });

  it("la página pinta la tabla del plan con estas celdas, con las tiendas, las reglas y las ciudades del resto del Gestor", () => {
    const pagina = leer("src/app/(app)/routes/page.tsx");
    expect(pagina).toContain('const celdaDelPlan = (clave: string, d: Delivery) => celdaPropiaDelPlan(clave, d, { reglas: settings.order_type_rules, tiendas: settings.stores ?? [], conocidas: ciudadesQueSeConocen, es: lang === "es" }) ?? celdaDeOrdenes(clave, d);');
    expect(pagina).toContain('lista: columnasDeLaTabla("plan", colsGestor, ordenGestor), celda: celdaDelPlan,');
  });
});

describe("lo ya guardado: a quien tenía columnas del plan (D-429) le salen las nuevas UNA vez", () => {
  // Como el dueño: sus columnas de Sin asignar a su gusto, y en el plan las de D-429 con un orden propio.
  const suyas = ["invoice", "account", "pickup", "address", "p_type", "pl_po", "pl_type", "pl_driver", "pl_address", "pl_windows", "_v2", "_v3", "_v4", MARCA_V5];
  const ordenSin = mueveEnElGestor("sinAsignar", null, "account", -1, suyas);
  const ordenAmbos = mueveEnElGestor("plan", mueveEnElGestor("plan", ordenSin, "pl_windows", -1, suyas), "pl_windows", -1, suyas);

  it("el plan vuelve a sus columnas y a su orden de partida; las otras dos tablas se quedan como estaban; y se guarda", () => {
    expect(ordenDeLaTabla("plan", ordenAmbos)).not.toEqual(ordenDeLaTabla("plan", null));   // de verdad lo había movido
    const al = preferenciasDelGestorAlLeer(suyas, ordenAmbos);
    expect(claves(al.columnas!, al.orden)).toEqual([...VISTAS_EN_EL_PLAN]);
    expect(ordenDeLaTabla("plan", al.orden)).toEqual(ordenDeLaTabla("plan", null));
    expect(ordenDeLaTabla("sinAsignar", al.orden)).toEqual(ordenDeLaTabla("sinAsignar", ordenSin));
    expect(columnasDeLaTabla("sinAsignar", al.columnas!).map((c) => c.key)).toEqual(columnasDeLaTabla("sinAsignar", suyas).map((c) => c.key));
    expect(columnasDeLaTabla("paradas", al.columnas!).map((c) => c.key)).toEqual(columnasDeLaTabla("paradas", suyas).map((c) => c.key));
    expect(al.columnas).toContain(MARCA_V6);
    expect(al.escribe).toBe(true);
  });

  it("una vez pasado, no se repite: lo que quite o mueva después se respeta", () => {
    const al = preferenciasDelGestorAlLeer(suyas, ordenAmbos);
    const otra = preferenciasDelGestorAlLeer(al.columnas!, al.orden);
    expect(otra).toEqual({ columnas: al.columnas, orden: al.orden, escribe: false });
    // Quitó la factura y movió las ventanas arriba, ya con la marca: al recargar sigue así.
    const sinFactura = al.columnas!.filter((k) => k !== "pl_invoice");
    const movido = mueveEnElGestor("plan", al.orden, "pl_windows", -1, sinFactura);
    const recarga = preferenciasDelGestorAlLeer(sinFactura, movido);
    expect(claves(recarga.columnas!, recarga.orden)).toEqual(["pl_clase", "pl_ciudad_recogida", "pl_ciudad_entrega", "pl_windows", "pl_address"]);
    expect(recarga.escribe).toBe(false);
  });

  it("sin nada guardado no se escribe nada; con solo un orden guardado, el del plan vuelve a su partida", () => {
    expect(preferenciasDelGestorAlLeer(undefined, null)).toEqual({ columnas: null, orden: null, escribe: false });
    // «Por defecto» (aplicar la plantilla Default) guarda las de partida: ya llevan la marca, y no se vuelve a escribir.
    expect(preferenciasDelGestorAlLeer([...COLUMNAS_DEL_GESTOR_POR_DEFECTO], null).escribe).toBe(false);
    const soloOrden = preferenciasDelGestorAlLeer(undefined, ordenAmbos);
    expect(soloOrden.escribe).toBe(true);
    expect(ordenDeLaTabla("plan", soloOrden.orden)).toEqual(ordenDeLaTabla("plan", null));
    expect(claves(soloOrden.columnas!, soloOrden.orden)).toEqual([...VISTAS_EN_EL_PLAN]);
  });

  it("las plantillas guardadas no se tocan: una de D-429 con PO y Chofer los sigue poniendo", () => {
    expect(claves(columnasDePlantillaDelGestor(["invoice", "pl_po", "pl_driver"]))).toEqual(["pl_po", "pl_driver"]);
  });
});
