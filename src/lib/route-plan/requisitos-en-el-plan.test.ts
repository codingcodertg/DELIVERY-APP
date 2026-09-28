import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cacheEnMemoria } from "@/lib/route-times/tiempos";
import type { ProveedorDeTiempos } from "@/lib/route-times/proveedores";
import { leeConOpcionales } from "@/lib/columnas-opcionales";
import { planificaElDia } from "./borrador";
import { COLUMNAS_DE_ORDEN, entradaDelDia, leeOrdenesDelDia, type DatosDelDia } from "./entrada";
import { fraseDeRequisitoConOtro, fraseDeRequisitoFuera, fueraConPorque, porQueDelPlan } from "./porque";

/**
 * Requisitos del camión, de la base a la pantalla de «Planificar el día» (D-418, 151): la consulta que sobrevive a una
 * base sin la 151, lo que entra al motor (solo lo del catálogo), y lo que dicen «Fuera de este plan» y «¿Por qué aquí?».
 * Tiendas y choferes inventados.
 */

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const plano = (s: string) => s.replace(/\s+/g, " ");
const AHORA = "2026-03-02T12:00:00.000Z";
const proveedor: ProveedorDeTiempos = {
  nombre: "osrm", conTrafico: false,
  async matriz(os, ds) { return os.map(() => ds.map(() => ({ minutos: 10, millas: 5 }))); },
  async tramo() { return { minutos: 10, millas: 5 }; },
};
type O = DatosDelDia["ordenes"][number];
const orden = (id: string, k: number, extra: Partial<O> = {}): O => ({
  id, stage: "approved", order_code: id.toUpperCase(), order_type: "ACliente", store: "Tienda Norte", pickup_name: null, delivery_name: null,
  delivery_lat: 26.35 + k / 100, delivery_lng: -98.25, delivery_windows: "0830-1730", est_pallets: 2, actual_pallets: null,
  pickup_duration: "8 min", delivery_duration: "10 min", assigned_driver: null, input_date: "2026-03-03", input_time: `090${k}`, account: null, customer_type: null,
  is_training: false, updated_at: `2026-03-03T15:00:0${k}.000000+00:00`, ...extra,
});
const fila = (id: string, features?: string[]) => ({
  profile_id: id, base_store: "Tienda Norte", capacity_pallets: 10, shift_start: "08:00", shift_end: "17:00", returns_to_base: true, routable: true,
  ...(features ? { features } : {}),
});
const datos = (ordenes: O[], catalogo: string[] | undefined, features: Record<string, string[] | undefined> = {}): DatosDelDia => ({
  ordenes,
  choferes: [{ id: "c1", full_name: "Chofer Uno", role: "driver" as const }, { id: "c2", full_name: "Chofer Dos", role: "driver" as const }],
  ajustesDeChofer: [fila("c1", features.c1), fila("c2", features.c2)],
  settings: {
    stores: [{ name: "Tienda Norte", address: "1 Calle", lat: 26.3, lng: -98.2 }], order_type_rules: { ACliente: { storeToStore: false } },
    ...(catalogo ? { delivery_requirements: catalogo } : {}),
  },
});
const planifica = (d: DatosDelDia) => planificaElDia(d, "2026-03-04", "America/Chicago", { cache: cacheEnMemoria(), proveedores: [proveedor], ahoraISO: AHORA });

describe("de la base al motor: solo cuenta lo que está en el catálogo", () => {
  it("la orden lleva sus requisitos y el chofer lo que tiene, con la grafía del catálogo; sin nada, ni la clave", () => {
    const e = entradaDelDia(datos(
      [orden("a", 0, { requirements: ["liftgate", "Algo que ya no existe"] }), orden("b", 1, { requirements: [] }), orden("c", 2)],
      ["Liftgate", "Montacargas"], { c1: [" LIFTGATE"], c2: [] },
    ));
    expect(e.entrada.ordenes.map((o) => o.requisitos)).toEqual([["Liftgate"], undefined, undefined]);
    expect(e.entrada.ordenes.map((o) => "requisitos" in o)).toEqual([true, false, false]);
    expect(e.entrada.choferes.map((c) => [c.id, c.habilidades])).toEqual([["c1", ["Liftgate"]], ["c2", undefined]]);
    expect(e.entrada.choferes.map((c) => "habilidades" in c)).toEqual([true, false]);
  });

  it("sin catálogo (una base sin la 151, o vacío), nadie pide nada aunque la orden diga algo", () => {
    for (const cat of [undefined, []]) {
      const e = entradaDelDia(datos([orden("a", 0, { requirements: ["Liftgate"] })], cat, { c1: ["Liftgate"] }));
      expect("requisitos" in e.entrada.ordenes[0]).toBe(false);
      expect(e.entrada.choferes.every((c) => !("habilidades" in c))).toBe(true);
    }
  });

  it("de punta a punta: la de liftgate va con el del liftgate; «Por qué» del otro dice lo que le falta", async () => {
    const b = await planifica(datos([orden("a", 0, { requirements: ["Liftgate"] })], ["Liftgate"], { c2: ["Liftgate"] }));
    expect(b.plan.writes.map((w) => [w.id, w.assigned_driver])).toEqual([["a", "Chofer Dos"]]);
    const q = porQueDelPlan(b.plan.result, b.plan.input.entrada.choferes, b.paradas, b.plan.input.entrada.ordenes);
    const conUno = q.a.otras.find((o) => o.choferId === "c1")!;
    expect(conUno).toMatchObject({ noPuede: "falta_requisito", faltan: ["Liftgate"] });
    expect(fraseDeRequisitoConOtro(conUno, "es")).toBe("falta Liftgate");
    expect(fraseDeRequisitoConOtro(conUno, "en")).toBe("missing Liftgate");
  });

  it("de punta a punta: si ninguno lo tiene, «Fuera de este plan» dice qué falta y qué hacer", async () => {
    const b = await planifica(datos([orden("a", 0, { requirements: ["Liftgate", "Montacargas"] })], ["Liftgate", "Montacargas"], { c1: ["Liftgate"] }));
    expect(b.plan.writes).toEqual([]);
    const fuera = fueraConPorque(b.plan.result.sinAsignar, b.plan.result.fuera, b.plan.input.entrada.ordenes);
    expect(fuera).toEqual([{ id: "a", orden: "a", motivo: "falta_requisito", remedio: "dar_requisito", laDejoFuera: "motor", faltan: ["Montacargas"] }]);
    expect(fraseDeRequisitoFuera(fuera[0], "es")).toBe("falta Montacargas: ningún chofer que rutea hoy lo tiene todo");
    expect(fraseDeRequisitoFuera({ motivo: "falta_requisito", faltan: ["A", "B"] }, "es")).toBe("faltan A y B: ningún chofer que rutea hoy lo tiene todo");
    expect(fraseDeRequisitoFuera({ motivo: "no_cabe_con_el_resto" }, "es")).toBeNull();
  });
});

describe("la consulta del servidor, con y sin la 151 aplicada", () => {
  it("pide `requirements`; si la base no la tiene, vuelve a leer sin ella y sin perder `priority`", async () => {
    const pedidas: string[] = [];
    const sinLa151 = async (cols: string) => {
      pedidas.push(cols);
      return cols.includes("requirements")
        ? { data: null, error: { code: "PGRST204", message: "Could not find the 'requirements' column of 'deliveries' in the schema cache" } }
        : { data: [{ id: "a" }], error: null };
    };
    expect(await leeOrdenesDelDia(sinLa151)).toEqual({ data: [{ id: "a" }], error: null });
    expect(pedidas).toEqual([`${COLUMNAS_DE_ORDEN}, priority, requirements`, `${COLUMNAS_DE_ORDEN}, priority`]);
  });

  it("sin ninguna de las dos, tres lecturas y ninguna más; un error que nombra otra columna no se toca", async () => {
    const pedidas: string[] = [];
    const sinNada = async (cols: string) => {
      pedidas.push(cols);
      const falta = ["priority", "requirements"].find((c) => cols.split(", ").includes(c));
      return falta ? { data: null, error: { code: "42703", message: `column deliveries.${falta} does not exist` } } : { data: [], error: null };
    };
    await leeOrdenesDelDia(sinNada);
    expect(pedidas).toEqual([`${COLUMNAS_DE_ORDEN}, priority, requirements`, `${COLUMNAS_DE_ORDEN}, requirements`, COLUMNAS_DE_ORDEN]);
    // «morning_priority» no es «priority»: no se quita nada.
    let n = 0;
    const otra = { code: "42703", message: "column deliveries.morning_priority does not exist" };
    expect((await leeConOpcionales(async () => { n++; return { data: null, error: otra }; }, "id", ["priority"])).error).toBe(otra);
    expect(n).toBe(1);
  });

  it("la ruta de «Planificar el día» lee así el catálogo y lo que tiene cada camión", () => {
    const ruta = plano(leer("src/app/api/route-plan/route.ts"));
    expect(ruta).toContain('leeConOpcionales((columnas) => supabase.from("settings").select(columnas).eq("id", 1).maybeSingle(), COLUMNAS_DE_AJUSTES, ["delivery_requirements"])');
    expect(ruta).toContain('leeConOpcionales((columnas) => supabase.from("driver_settings").select(columnas), COLUMNAS_DE_CHOFER, COLUMNAS_OPCIONALES_DE_CHOFER)');
  });
});

describe("las pantallas del plan dicen el motivo con estas frases", () => {
  it("«Fuera de este plan» y «¿Por qué aquí?» usan las funciones; el remedio tiene su frase", () => {
    const panel = plano(leer("src/components/PlanDelDia.tsx"));
    expect(panel).toContain("<b>{nombreDeOrden(x.id)}</b> — {fraseDeRequisitoFuera(x, lang) ?? motivo(x.motivo)}.");
    expect(panel).toContain("dar_requisito: [");
    // «¿Por qué aquí?» ya no se enseña (D-424): la frase de requisito con otro chofer queda solo en la librería.
  });
});
