import { beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import DIAS_REALES from "./dias-reales-anon.json";
import type { Desglose, Explicacion } from "@/lib/route-engine";
import { cacheEnMemoria } from "@/lib/route-times/tiempos";
import { proveedorEstimado } from "@/lib/route-times/proveedores";
import { leeConOpcionales } from "@/lib/columnas-opcionales";
import { COLUMNAS_OPCIONALES_DE_CHOFER, conFilaGuardada, pesoDeZona, pesosDeRuta, PESOS_DE_RUTA_POR_DEFECTO, routeWeightsAlGuardar, umbralDeZonaMi } from "@/lib/route-settings";
import { alternaZona, ciudadesElegibles, esDeSuZona, limpiaZonas, MAX_LARGO_DE_ZONA, MAX_ZONAS, zonaDeLaOrden, zonasDelChofer, zonasPorNombre } from "@/lib/zonas";
import { eleccionVigente, opcionesDeConductor } from "@/lib/elige-conductor";
import { planificaElDia, type Borrador } from "./borrador";
import { COLUMNAS_DE_ORDEN, entradaDelDia, type DatosDelDia } from "./entrada";
import { fraseDeZona, porQueDelPlan, porQueEstaAqui } from "./porque";
import { ordenDeLaParte } from "./publicar";

/**
 * Zonas preferidas por chofer (D-421, T-0412), de la base a la pantalla. El dueño, 2026-09-27: *«ernesto is mcallen
 * mission and julio is phar thats their preferences as well as maximo is brownsville only if possible»*; y *«Preferencia,
 * no regla»*. Ninguna ciudad ni nombre de aquí es del dueño: las zonas de los días reales son «Zona A…G», la tienda más
 * cercana a cada pin del fichero anonimizado, porque el fichero no trae direcciones.
 */

const leer = (ruta: string) => readFileSync(join(process.cwd(), ruta), "utf8");
const plano = (s: string) => s.replace(/\s+/g, " ");

// ---- La librería ---------------------------------------------------------------------------------------------------

describe("las zonas de un chofer", () => {
  it("se limpian: sin vacíos, sin repetidos (sin mayúsculas), con la primera grafía y dentro de los topes de la 152", () => {
    expect(limpiaZonas([" Norte ", "norte", "", 7, "Sur  Este", null])).toEqual(["Norte", "Sur Este"]);
    expect(limpiaZonas("Norte")).toEqual([]);
    expect(limpiaZonas(["x".repeat(MAX_LARGO_DE_ZONA + 1), "Norte"])).toEqual(["Norte"]);
    expect(limpiaZonas(Array.from({ length: MAX_ZONAS + 5 }, (_, k) => `Z${k}`))).toHaveLength(MAX_ZONAS);
    expect(zonasDelChofer({ preferred_zones: ["Norte"] })).toEqual(["Norte"]);
    expect(zonasDelChofer({})).toEqual([]);
    expect(zonasDelChofer(null)).toEqual([]);
  });

  it("marcar y desmarcar una zona compara sin mayúsculas; lo nuevo va al final", () => {
    expect(alternaZona(["Norte"], "Sur")).toEqual(["Norte", "Sur"]);
    expect(alternaZona(["Norte", "Sur"], "NORTE")).toEqual(["Sur"]);
    expect(alternaZona(null, "Norte")).toEqual(["Norte"]);
    expect(alternaZona(["Norte"], "  ")).toEqual(["Norte"]);
  });

  it("la zona de una orden es la ciudad de su dirección, la de la columna «Ciudad de entrega» (D-408)", () => {
    expect(zonaDeLaOrden({ delivery_address: "12 Calle Uno, Villa Norte, TX 78500" })).toBe("Villa Norte");
    expect(zonaDeLaOrden({ delivery_address: "12 Calle Uno" })).toBe("");
    expect(zonaDeLaOrden({})).toBe("");
    expect(leer("src/lib/zonas.ts")).toContain("return ciudadDeEntrega(d?.delivery_address, conocidas);");
    // Sin comas (D-423), con las ciudades conocidas que le pasen.
    expect(zonaDeLaOrden({ delivery_address: "12 Calle Uno VILLA NORTE TX" }, ["Villa Norte"])).toBe("VILLA NORTE");
  });

  it("las ciudades que se ofrecen salen de los datos: órdenes, tiendas y lo ya guardado; la grafía más repetida, la más frecuente primero", () => {
    const ordenes = [
      { delivery_address: "1 A St, Villa Norte, TX" }, { delivery_address: "2 B St, villa norte, TX 78500" }, { delivery_address: "3 C St, Villa Norte" },
      { delivery_address: "4 D St, Puerto Sur, TX" }, { delivery_address: "5 Calle sin coma" }, {},
    ];
    const tiendas = [{ address: "9 Main, Llano Este, TX 78500" }];
    expect(ciudadesElegibles(ordenes, tiendas, ["Monte Oeste", "puerto sur"])).toEqual([
      { nombre: "Villa Norte", n: 3 }, { nombre: "Puerto Sur", n: 1 }, { nombre: "Llano Este", n: 0 }, { nombre: "Monte Oeste", n: 0 },
    ]);
    expect(ciudadesElegibles([])).toEqual([]);
    // Sin comas (D-423): la que cierra la dirección, si sale limpia de otra o ya está guardada; si no, no cuenta.
    expect(ciudadesElegibles([
      { delivery_address: "1 A, Villa Norte, TX" }, { delivery_address: "2 B, Villa Norte, TX" }, { delivery_address: "LOTE #2 9 W Robles VILLA NORTE TX" },
      { delivery_address: "9 W Robles Monte Oeste" }, { delivery_address: "9 W Robles Llano Bajo" },
    ], [], ["Monte Oeste"])).toEqual([{ nombre: "Villa Norte", n: 3 }, { nombre: "Monte Oeste", n: 1 }]);
  });

  it("por nombre, para «Mejor lugar»: solo los choferes con zonas, y «es de su zona» mira las órdenes marcadas", () => {
    const m = zonasPorNombre([{ profile_id: "u1", preferred_zones: ["Villa Norte"] }, { profile_id: "u2", preferred_zones: [] }, { profile_id: "x", preferred_zones: ["Z"] }],
      [{ id: "u1", full_name: "Chofer Uno" }, { id: "u2", full_name: "Chofer Dos" }]);
    expect([...m]).toEqual([["chofer uno", ["Villa Norte"]]]);
    expect(esDeSuZona("Chofer Uno", [{ delivery_address: "1 A, VILLA NORTE, TX" }], m)).toBe(true);
    expect(esDeSuZona("Chofer Uno", [{ delivery_address: "1 A, Puerto Sur, TX" }], m)).toBe(false);
    expect(esDeSuZona("Chofer Dos", [{ delivery_address: "1 A, Villa Norte, TX" }], m)).toBe(false);
    // Sin comas (D-423), con las zonas de todos como ciudades conocidas.
    expect(esDeSuZona("Chofer Uno", [{ delivery_address: "9 W Robles VILLA NORTE TX" }], m)).toBe(true);
  });
});

describe("el peso de las zonas vive en route_weights (sin columna nueva)", () => {
  it("sin guardar, el de por defecto; guardado, el suyo; y los cinco de la 130 salen como siempre", () => {
    expect(pesoDeZona({})).toBe(60);
    expect(pesoDeZona({ route_weights: { zona: 15 } })).toBe(15);
    expect(pesoDeZona({ route_weights: { zona: -1 } })).toBe(60);
    expect(pesoDeZona({ route_weights: { zona: 0 } })).toBe(0);
    expect(pesosDeRuta({})).toEqual(PESOS_DE_RUTA_POR_DEFECTO);
    expect(pesosDeRuta({ route_weights: { zona: 15 } })).toEqual({ ...PESOS_DE_RUTA_POR_DEFECTO, zona: 15 });
  });

  it("el umbral de la zona en millas (D-423), igual: por defecto 5; guardado y válido, el suyo; y llega al motor en los pesos", () => {
    expect(umbralDeZonaMi({})).toBe(5);
    expect(umbralDeZonaMi({ route_weights: { zonaMillas: 8 } })).toBe(8);
    expect(umbralDeZonaMi({ route_weights: { zonaMillas: -1 } })).toBe(5);
    expect(umbralDeZonaMi({ route_weights: { zonaMillas: 0 } })).toBe(0);
    expect(pesosDeRuta({})).not.toHaveProperty("zonaMillas");
    expect(pesosDeRuta({ route_weights: { zonaMillas: 8 } })).toEqual({ ...PESOS_DE_RUTA_POR_DEFECTO, zonaMillas: 8 });
    const d = datosMinimos([fila("u1"), fila("u2")]);
    const e = entradaDelDia({ ...d, settings: { ...d.settings, route_weights: { zonaMillas: 8 } } as DatosDelDia["settings"] });
    expect(e.parametros.pesos.zonaMillas).toBe(8);
    // Guardar otro peso no lo borra.
    expect(routeWeightsAlGuardar({ route_weights: { ...PESOS_DE_RUTA_POR_DEFECTO, zonaMillas: 8 } }, { zona: 30 })).toEqual({ ...PESOS_DE_RUTA_POR_DEFECTO, zona: 30, zonaMillas: 8 });
  });

  it("guardar otro peso u opción no borra el de las zonas, ni al revés", () => {
    const guardado = { route_weights: { ...PESOS_DE_RUTA_POR_DEFECTO, zona: 30, usar_todos: true } };
    expect(routeWeightsAlGuardar(guardado, { manejo: 2 })).toEqual({ ...PESOS_DE_RUTA_POR_DEFECTO, manejo: 2, zona: 30, usar_todos: true });
    expect(routeWeightsAlGuardar({ route_weights: { ...PESOS_DE_RUTA_POR_DEFECTO, balance_por: "ordenes" as const } }, { zona: 5 }))
      .toEqual({ ...PESOS_DE_RUTA_POR_DEFECTO, balance_por: "ordenes", zona: 5 });
  });
});

// ---- De la base al motor -------------------------------------------------------------------------------------------

describe("la consulta, con y sin la 152 aplicada", () => {
  it("las órdenes traen su dirección (de ella sale la ciudad), y de los choferes se piden `features` y `preferred_zones` si existen", () => {
    expect(COLUMNAS_DE_ORDEN.split(", ")).toContain("delivery_address");
    expect([...COLUMNAS_OPCIONALES_DE_CHOFER]).toEqual(["features", "preferred_zones"]);
  });

  it("sin la 152, PostgREST dice que falta `preferred_zones` y se vuelve a leer sin ella (y sin la 151, sin las dos)", async () => {
    const pedidas: string[] = [];
    const falta = new Set(["preferred_zones"]);
    const lee = async (columnas: string) => {
      pedidas.push(columnas);
      const x = columnas.split(", ").find((c) => falta.has(c));
      return x ? { data: null, error: { code: "42703", message: `column driver_settings.${x} does not exist` } } : { data: [], error: null };
    };
    expect((await leeConOpcionales(lee, "profile_id", COLUMNAS_OPCIONALES_DE_CHOFER)).error).toBeNull();
    expect(pedidas).toEqual(["profile_id, features, preferred_zones", "profile_id, features"]);
    falta.add("features");
    pedidas.length = 0;
    await leeConOpcionales(lee, "profile_id", COLUMNAS_OPCIONALES_DE_CHOFER);
    expect(pedidas).toEqual(["profile_id, features, preferred_zones", "profile_id, preferred_zones", "profile_id"]);
  });

  it("la ruta del servidor de «Planificar el día» pide las zonas con esa lista (la de Auto-asignar se quitó en D-437)", () => {
    for (const f of ["src/app/api/route-plan/route.ts"]) {
      expect(plano(leer(f))).toContain('leeConOpcionales((columnas) => supabase.from("driver_settings").select(columnas), COLUMNAS_DE_CHOFER, COLUMNAS_OPCIONALES_DE_CHOFER)');
    }
  });
});

const tiendaP = { name: "Tienda P", address: "1 Main, Villa Norte", lat: 26.2, lng: -98.2 };
const datosMinimos = (ajustes: DatosDelDia["ajustesDeChofer"]): DatosDelDia => ({
  ordenes: [
    { id: "o1", stage: "approved", order_code: "1", order_type: "Customer", store: "Tienda P", pickup_name: "Tienda P", delivery_name: null,
      delivery_address: "5 Uno St, Villa Norte, TX 78500", delivery_lat: 26.3, delivery_lng: -98.2, delivery_windows: null, est_pallets: 1, actual_pallets: null,
      pickup_duration: null, delivery_duration: null, assigned_driver: null, input_date: null, input_time: null, account: null, customer_type: null,
      is_training: false, updated_at: "t" },
    { id: "o2", stage: "approved", order_code: "2", order_type: "Customer", store: "Tienda P", pickup_name: "Tienda P", delivery_name: null,
      delivery_address: "7 Dos St sin coma", delivery_lat: 26.1, delivery_lng: -98.2, delivery_windows: null, est_pallets: 1, actual_pallets: null,
      pickup_duration: null, delivery_duration: null, assigned_driver: null, input_date: null, input_time: null, account: null, customer_type: null,
      is_training: false, updated_at: "t" },
  ],
  choferes: [{ id: "u1", full_name: "Chofer Uno", role: "driver" }, { id: "u2", full_name: "Chofer Dos", role: "driver" }],
  ajustesDeChofer: ajustes,
  settings: { stores: [tiendaP], accounts: [], order_type_rules: {}, route_buckets: [], driver_capacity: {}, default_truck_capacity: null,
    route_weights: null, route_hard_windows: null, route_late_cap_min: null } as unknown as DatosDelDia["settings"],
});
const fila = (id: string, extra: object = {}) => ({ profile_id: id, base_store: "Tienda P", capacity_pallets: 10, shift_start: "08:00", shift_end: "17:30", returns_to_base: true, routable: true, ...extra });

describe("entradaDelDia: de driver_settings y la dirección, al motor", () => {
  it("con zonas, el chofer las lleva y cada entrega su ciudad (la que no tiene ciudad, sin zona)", () => {
    const e = entradaDelDia(datosMinimos([fila("u1", { preferred_zones: [" villa norte ", "Villa Norte"] }), fila("u2")])).entrada;
    expect(e.choferes.map((c) => [c.id, c.zonas])).toEqual([["u1", ["villa norte"]], ["u2", undefined]]);
    expect(e.ordenes.map((o) => [o.id, o.zona])).toEqual([["o1", "Villa Norte"], ["o2", undefined]]);
  });

  it("una dirección escrita sin comas se lee con las zonas de los choferes como ciudades conocidas (D-423)", () => {
    const d0 = datosMinimos([fila("u1", { preferred_zones: ["Puerto Sur"] }), fila("u2")]);
    const d = { ...d0, ordenes: [d0.ordenes[0], { ...d0.ordenes[1], delivery_address: "LOTE #3 7 Dos PUERTO SUR TX" }] };
    expect(entradaDelDia(d).entrada.ordenes.map((o) => [o.id, o.zona])).toEqual([["o1", "Villa Norte"], ["o2", "PUERTO SUR"]]);
  });

  it("sin zonas —columna vacía o una base sin la 152—, la entrada es la de siempre, sin una clave de más", () => {
    const sin152 = entradaDelDia(datosMinimos([fila("u1"), fila("u2")]));
    const vacias = entradaDelDia(datosMinimos([fila("u1", { preferred_zones: [] }), fila("u2", { preferred_zones: [] })]));
    expect(JSON.stringify(vacias)).toBe(JSON.stringify(sin152));
    expect(JSON.stringify(sin152.entrada)).not.toMatch(/"zonas?"/);
  });
});

// ---- Los días reales -------------------------------------------------------------------------------------------------

type Fixture = { settings: DatosDelDia["settings"]; drivers: DatosDelDia["choferes"]; driver_settings: DatosDelDia["ajustesDeChofer"]; orders: Record<string, unknown>[] };
const F = DIAS_REALES as unknown as Fixture;
const ZONA_HORARIA = "America/Chicago";
const deps = () => ({ cache: cacheEnMemoria(), proveedores: [proveedorEstimado()], ahoraISO: "2026-09-27T12:00:00.000Z" });
/** El fichero no trae direcciones: la «ciudad» de cada pin, para esta prueba, es la de la tienda más cercana. */
const zonaDePin = (lat: number, lng: number) => {
  let mejor = "", d = Infinity;
  for (const t of F.settings.stores) { const x = (t.lat! - lat) ** 2 + (t.lng! - lng) ** 2; if (x < d) { d = x; mejor = t.name; } }
  return `Zona ${mejor.slice(-1)}`;
};
/** Las zonas de cada chofer, por su base en el fichero: A sale de la Tienda C; B, de la D (y la E, al lado); C, de la A
 *  (y la G, al lado). B y F no son de nadie. D no rutea. */
const ZONAS: Record<string, string[]> = { "d-1": ["Zona C"], "d-2": ["Zona D", "Zona E"], "d-3": ["Zona A", "Zona G"] };
const conZonas = F.driver_settings.map((s) => ({ ...s, preferred_zones: ZONAS[s.profile_id] ?? [] }));
const ordenesDe = (fecha: string) => F.orders
  .filter((o) => o.delivery_date === fecha && !["canceled", "draft"].includes(String(o.stage)))
  .map((o) => ({
    ...o, stage: "approved", assigned_driver: null, route_seq: null, load_no: null, is_training: false, updated_at: "2026-09-27T00:00:00.000Z",
    order_code: null, delivery_name: null, account: null, invoice_num: null,
    delivery_address: o.delivery_lat != null ? `1 Calle Falsa, ${zonaDePin(Number(o.delivery_lat), Number(o.delivery_lng))}, TX 78500` : null,
  }) as unknown as DatosDelDia["ordenes"][number]);
const DIAS = [...new Set(F.orders.map((o) => String(o.delivery_date)))].sort();

const planDe = (fecha: string, ajustes: DatosDelDia["ajustesDeChofer"]) =>
  planificaElDia({ ordenes: ordenesDe(fecha), choferes: F.drivers, ajustesDeChofer: ajustes, settings: F.settings, publicadoAntes: [] }, fecha, ZONA_HORARIA, deps());
/** De las entregas de una zona que alguien prefiere, cuántas van con un chofer que la prefiere. */
function enSuZona(b: Borrador, fecha: string) {
  const zonaDe = new Map(ordenesDe(fecha).map((o) => [o.id, zonaDeLaOrden(o)]));
  let dentro = 0, deAlguien = 0;
  for (const p of b.paradas.filter((x) => x.kind === "D")) {
    const z = zonaDe.get(ordenDeLaParte(p.order_ref)) ?? "";
    const duenos = Object.keys(ZONAS).filter((id) => ZONAS[id].includes(z));
    if (!duenos.length) continue;
    deAlguien++;
    if (duenos.includes(p.driver_id)) dentro++;
  }
  return { dentro, deAlguien };
}

const ANTES: Record<string, Borrador> = {};
const DESPUES: Record<string, Borrador> = {};
beforeAll(async () => {
  for (const fecha of DIAS) {
    ANTES[fecha] = await planDe(fecha, F.driver_settings);
    DESPUES[fecha] = await planDe(fecha, conZonas);
  }
}, 240_000);
const suma = (m: Record<string, Borrador>, f: (b: Borrador, fecha: string) => number) => DIAS.reduce((n, fecha) => n + f(m[fecha], fecha), 0);

describe("días reales (18–28 sep, anonimizados), con las zonas de cada chofer según su base", () => {
  it("las colocadas NO bajan: 153 de 178 sin zonas, y con zonas al menos las mismas, día a día", () => {
    expect(suma(ANTES, (b) => b.plan.writes.length)).toBe(153);
    for (const fecha of DIAS) expect({ fecha, n: DESPUES[fecha].plan.writes.length >= ANTES[fecha].plan.writes.length }).toEqual({ fecha, n: true });
  });

  it("más entregas en su zona: de 79 de 105 sin zonas a 89 con ellas (medido 2026-09-27)", () => {
    const antes = suma(ANTES, (b, f) => enSuZona(b, f).dentro), despues = suma(DESPUES, (b, f) => enSuZona(b, f).dentro);
    expect(antes).toBe(79);
    expect(despues).toBeGreaterThanOrEqual(89);
    expect(suma(ANTES, (b, f) => enSuZona(b, f).deAlguien)).toBe(105);
  });

  it("y a cambio de pocas millas: 2.560 sin zonas (2.559 antes de D-NEXT: entregar de paso suma una milla en diez días), no más de un 3 % con ellas", () => {
    const antes = suma(ANTES, (b) => Number(b.plan.total_miles)), despues = suma(DESPUES, (b) => Number(b.plan.total_miles));
    expect(Math.round(antes)).toBe(2560);
    expect(despues).toBeLessThanOrEqual(antes * 1.03);
  });

  it("el plan guardado lleva la versión nueva y cuenta las entregas fuera de zona en su coste", () => {
    const b = DESPUES["2026-09-27"];
    expect(b.plan.algorithm_version).toBe("motor-7");
    expect(typeof b.plan.result.coste.fueraDeZona).toBe("number");
    expect("fueraDeZona" in ANTES["2026-09-27"].plan.result.coste).toBe(false);
  });

  it("«¿Por qué aquí?» dice la zona de cada entrega: en su zona, fuera (y de quién es), o sin chofer de zona", () => {
    let vistas = 0;
    const tipos = new Set<string>();
    for (const fecha of DIAS) {
      const b = DESPUES[fecha];
      const porque = porQueDelPlan(b.plan.result, b.plan.input.entrada.choferes, b.paradas, b.plan.input.entrada.ordenes);
      for (const p of b.paradas.filter((x) => x.kind === "D")) {
        const z = porque[p.order_ref]?.zona;
        const ciudad = zonaDeLaOrden(ordenesDe(fecha).find((o) => o.id === ordenDeLaParte(p.order_ref)));
        if (!ciudad) { expect(z).toBeUndefined(); continue; }
        vistas++;
        tipos.add(z!.tipo);
        const duenos = Object.keys(ZONAS).filter((id) => ZONAS[id].includes(ciudad));
        const esperado = !duenos.length ? "sin_chofer" : duenos.includes(p.driver_id) ? "en_su_zona" : "fuera";
        expect({ o: p.order_ref, tipo: z!.tipo }).toEqual({ o: p.order_ref, tipo: esperado });
      }
    }
    expect(vistas).toBeGreaterThan(100);
    expect([...tipos].sort()).toEqual(["en_su_zona", "fuera", "sin_chofer"]);
  });
});

// «Auto-asignar reparte con las mismas zonas» (D-419) se fue con Auto-asignar en D-437: repartir es «Armar rutas».

// ---- Lo que se dice ------------------------------------------------------------------------------------------------

describe("«¿Por qué aquí?», la frase de la zona", () => {
  const d = (total: number): Desglose => ({ builder: 0, manejoMin: 0, millas: 0, tardeMin: 0, balanceMin: 0, total });
  const CHOFERES = [{ id: "n", nombre: "Chofer N", zonas: ["Norte"] }, { id: "s", nombre: "Chofer S", zonas: ["Sur"] }, { id: "l", nombre: "Chofer L" }];
  const ORDENES = [{ id: "a", zona: "Norte" }, { id: "b", zona: "Oeste" }, { id: "c" }];
  const exp = (orden: string, chofer: string, alternativas: Explicacion["alternativas"] = []): Explicacion => ({ orden, chofer, aporta: d(1), alternativas });
  const zona = (e: Explicacion) => porQueEstaAqui([e], CHOFERES, { [e.orden]: e.chofer }, [], ORDENES)[e.orden].zona;

  it("con el chofer de su zona: «En su zona (Norte).»", () => {
    const z = zona(exp("a", "n"));
    expect(z).toEqual({ tipo: "en_su_zona", zona: "Norte" });
    expect(fraseDeZona({ quien: "motor", zona: z }, "es")).toBe("En su zona (Norte).");
    expect(fraseDeZona({ quien: "motor", zona: z }, "en")).toBe("In their zone (Norte).");
  });

  it("con otro porque el suyo iba lleno: «Fuera de su zona (Norte es de Chofer N): su chofer iba lleno.»", () => {
    const z = zona(exp("a", "s", [{ chofer: "n", diferencia: null, motivo: "capacidad" }]));
    expect(z).toEqual({ tipo: "fuera", zona: "Norte", choferDeZona: "Chofer N", por: "capacidad" });
    expect(fraseDeZona({ quien: "motor", zona: z }, "es")).toBe("Fuera de su zona (Norte es de Chofer N): su chofer iba lleno.");
    expect(fraseDeZona({ quien: "motor", zona: z }, "en")).toBe("Outside their zone (Norte belongs to Chofer N): their driver was full.");
  });

  it("con otro porque con el suyo el plan entero salía más caro, porque no tenía turno, o porque hoy no rutea", () => {
    expect(zona(exp("a", "s", [{ chofer: "n", diferencia: d(5) }]))).toMatchObject({ tipo: "fuera", por: "costaba_mas" });
    expect(fraseDeZona({ quien: "motor", zona: zona(exp("a", "s", [{ chofer: "n", diferencia: null, motivo: "fuera_de_turno" }])) }, "es"))
      .toBe("Fuera de su zona (Norte es de Chofer N): a su chofer no le quedaba turno.");
    expect(zona(exp("a", "s", []))).toMatchObject({ tipo: "fuera", por: "no_rutea" });
    expect(zona(exp("a", "s", [{ chofer: "n", diferencia: null }]))).toMatchObject({ tipo: "fuera", por: "no_permitido" });
  });

  it("de una ciudad que nadie prefiere: va por millas; sin ciudad, o sin choferes con zonas, nada", () => {
    const z = zona(exp("b", "l"));
    expect(z).toEqual({ tipo: "sin_chofer", zona: "Oeste" });
    expect(fraseDeZona({ quien: "motor", zona: z }, "es")).toBe("Oeste: ningún chofer la tiene de zona, va por millas.");
    expect(zona(exp("c", "l"))).toBeUndefined();
    expect(porQueEstaAqui([exp("a", "n")], [{ id: "n", nombre: "N" }], { a: "n" }, [], ORDENES).a.zona).toBeUndefined();
    expect(fraseDeZona({ quien: "persona", zona: { tipo: "en_su_zona", zona: "Norte" } }, "es")).toBeNull();
  });

  it("una carga de una orden partida dice la zona de su orden", () => {
    expect(zona(exp("a#b", "n"))).toEqual({ tipo: "en_su_zona", zona: "Norte" });
  });

  it("la pantalla la pinta con `fraseDeZona`, y las rutas le pasan los choferes y órdenes del plan", () => {
    expect(plano(leer("src/components/RutaDelPlan.tsx"))).not.toContain("fraseDeZona"); // D-424: sin «¿Por qué aquí?»
    expect(plano(leer("src/app/api/route-plan/route.ts"))).toContain("porque: porQueDelPlan(borrador.plan.result, borrador.plan.input.entrada.choferes, borrador.paradas, borrador.plan.input.entrada.ordenes)");
  });
});

// ---- Las pantallas -----------------------------------------------------------------------------------------------------

describe("Gestor de Rutas: la ciudad de una dirección sin comas (D-423)", () => {
  const g = plano(leer("src/app/(app)/routes/page.tsx"));
  it("la celda de las dos tablas, el orden y el filtro leen con la MISMA lista de ciudades conocidas", () => {
    expect(g).toContain("() => [...ciudadesConocidas([...deliveries.map((d) => d.delivery_address), ...(settings.stores ?? []).map((s) => s.address)]), ...[...zonasDeChofer.values()].flat()],");
    // Tres sitios desde D-459: la fila de entrega, «Sin asignar» y la fila ya HECHA (que sigue en la lista de su chofer).
    expect(g.split("{ciudadDeEntrega(d.delivery_address, ciudadesQueSeConocen) || \"—\"}").length).toBe(4);
    expect(g).not.toContain("{ciudadDeEntrega(d.delivery_address) ||");
    expect(g).toContain("valorDelGestor(clave, d, deOrdenes, ciudadesQueSeConocen)");
  });
});

describe("Ajustes → Motor de rutas → choferes", () => {
  const c = plano(leer("src/components/RouteEngineSettings.tsx"));

  it("lee `preferred_zones` solo si la base la tiene, y solo entonces enseña la columna", () => {
    expect(c).toContain('}, COLUMNAS_DE_CHOFER, COLUMNAS_OPCIONALES_DE_CHOFER);');
    expect(c).toContain('setHayZonas(pedidas.split(", ").includes("preferred_zones"));');
    expect(c).toContain('{hayZonas && <th>{t("Preferred zones", "Zonas preferidas")}</th>}');
    expect(c).toContain("{hayZonas && ( <td data-zonas-de=");
  });

  it("el umbral de la zona (D-423) sale junto al peso 5, con `umbralDeZonaMi`, y se guarda en `route_weights.zonaMillas`", () => {
    expect(c).toContain("const zonaMillas = umbralDeZonaMi(settings);");
    expect(c).toContain('value={zonaMillas} paso="1" disabled={!hayColumnas} onSave={(v) => guardaPeso("zonaMillas", v)} />');
  });

  it("guardar un chofer vuelve a leer SOLO su fila y conserva lo que se edita en las demás (D-423; antes, `cargar()` las pisaba)", () => {
    const g = c.slice(c.indexOf("const guardaChofer = async"), c.indexOf("return ( <div"));
    expect(g.length).toBeGreaterThan(100);
    expect(g).not.toContain("cargar()");
    expect(g).toContain('supabase.from("driver_settings").select(columnas).eq("profile_id", id), COLUMNAS_DE_CHOFER, COLUMNAS_OPCIONALES_DE_CHOFER);');
    expect(g).toContain("setFilas((actuales) => conFilaGuardada(actuales, id, guardada));");
    // La función: la guardada, como quedó; las demás, con su borrador.
    const antes = { u1: { base_store: "T1", capacity_pallets: 10 }, u2: { base_store: "T2", capacity_pallets: 99 } };
    expect(conFilaGuardada(antes, "u1", { base_store: "T3", capacity_pallets: 12 })).toEqual({ u1: { base_store: "T3", capacity_pallets: 12 }, u2: { base_store: "T2", capacity_pallets: 99 } });
    expect(conFilaGuardada(null, "u1", { base_store: "T3", capacity_pallets: 1 })).toEqual({ u1: { base_store: "T3", capacity_pallets: 1 } });
  });

  it("ofrece las ciudades de los datos (`ciudadesElegibles` con las órdenes y las tiendas) y marca con `alternaZona`", () => {
    expect(c).toContain("ciudadesElegibles(deliveries, settings.stores ?? [], Object.values(filas ?? {}).flatMap((f) => zonasDelChofer(f)))");
    expect(c).toContain("onChange={(e) => { if (e.target.value) edita(u.id, { preferred_zones: alternaZona(f.preferred_zones, e.target.value) }); }}");
    expect(c).toContain("onClick={() => edita(u.id, { preferred_zones: alternaZona(f.preferred_zones, z) })}");
  });

  it("el peso 5 se guarda en route_weights con los demás", () => {
    expect(c).toContain('value={zona} paso="5" disabled={!hayColumnas} onSave={(v) => guardaPeso("zona", v)} />');
    expect(c).toContain("const zona = pesoDeZona(settings);");
  });
});

describe("«📍 Mejor lugar»: los choferes de la zona de lo marcado, primero (solo sugerencia)", () => {
  const ruta = (clave: string, esRuta = false) => ({ clave, etiqueta: clave, esRuta });
  const base = { paradasDe: () => 0, palletsDe: () => 0, capacidadDe: () => 10, noDisponibles: new Set<string>() };

  it("orden: el del filtro, luego los de su zona, luego el resto; no elige a nadie por estar en su zona", () => {
    const op = opcionesDeConductor({ ...base, rutas: [ruta("Ana"), ruta("Beto"), ruta("Ciro"), ruta("Route 1", true)], filtro: "Ciro", enSuZona: (k) => k === "Beto" || k === "Route 1" });
    expect(op.map((o) => [o.clave, o.delFiltro, o.enSuZona])).toEqual([["Ciro", true, false], ["Beto", false, true], ["Ana", false, false], ["Route 1", false, false]]);
    const sinFiltro = opcionesDeConductor({ ...base, rutas: [ruta("Ana"), ruta("Beto")], filtro: "", enSuZona: (k) => k === "Beto" });
    expect(sinFiltro.map((o) => o.clave)).toEqual(["Beto", "Ana"]);
    expect(eleccionVigente(null, sinFiltro)).toBeNull();
  });

  it("sin zonas, el orden de siempre", () => {
    expect(opcionesDeConductor({ ...base, rutas: [ruta("Ana"), ruta("Beto")], filtro: "" }).map((o) => o.clave)).toEqual(["Ana", "Beto"]);
  });

  it("el Gestor le pasa `esDeSuZona` con las órdenes marcadas y las zonas leídas de driver_settings", () => {
    const p = plano(leer("src/app/(app)/routes/page.tsx"));
    // Puesto al día por D-462: lo marcado son las filas sin chofer de la tabla que se ve (`filasAsignables`; antes `filasDelChip`).
    expect(p).toContain("enSuZona: (k) => esDeSuZona(k, filasAsignables.filter((d) => selectedOrders.has(d.id)), zonasDeChofer, settings.stores ?? []),");   // las tiendas: D-427
    expect(p).toContain("const zonasDeChofer = useZonasDeChofer();");
    expect(p).toContain("{o.enSuZona && <span className=\"sema\" data-su-zona");
    expect(plano(leer("src/lib/usa-zonas.ts"))).toContain('createClient().from("driver_settings").select("profile_id, preferred_zones")');
  });
});

// ---- La migración --------------------------------------------------------------------------------------------------

describe("la migración 152", () => {
  const sql = leer("supabase/migrations/152_zonas_preferidas.sql").replace(/\r\n/g, "\n");
  const codigo = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

  it("una columna text[] not null default '{}' con su check de forma, y nada más en driver_settings", () => {
    expect(plano(codigo)).toContain("alter table public.driver_settings add column if not exists preferred_zones text[] not null default '{}'::text[];");
    expect(plano(codigo)).toContain("add constraint driver_settings_preferred_zones_shape check (public.zonas_preferidas_validas(preferred_zones));");
    expect(plano(codigo)).toContain("select cardinality(z) <= 20 and array_position(z, null) is null and not exists (select 1 from unnest(z) as x where btrim(x) = '' or char_length(x) > 60);");
    expect(codigo).not.toMatch(/create policy|drop policy|grant |revoke /i);
  });

  it("los topes de la app son los de la base", () => {
    expect(MAX_ZONAS).toBe(20);
    expect(MAX_LARGO_DE_ZONA).toBe(60);
  });

  it("sin begin/commit propios, sin D-421 dentro (numerar cambiaría el checksum), con reversión y con su fila del registro al día", () => {
    expect(codigo).not.toMatch(/(^|;)\s*(begin|commit|rollback)\s*;/im);
    expect(sql).not.toContain("D-421");
    expect(sql).toContain("--   alter table public.driver_settings drop column if exists preferred_zones;");
    const [cuerpo, registro] = sql.split("-- @ledger-below");
    const sha = createHash("sha256").update(cuerpo, "utf8").digest("hex");
    expect(registro.trim()).toBe(`insert into public.schema_migrations (name, checksum) values ('152_zonas_preferidas.sql', '${sha}') on conflict (name) do nothing;`);
  });
});
