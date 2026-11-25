import { describe, expect, it } from "vitest";
import { evaluaPlan } from "./evalua";
import { PARAMETROS_POR_DEFECTO, planifica, type ChoferEntrada, type Entrada, type Matriz, type OrdenEntrada, type ParadaRef } from "./index";
import { validaLaRuta } from "./validador";

/**
 * Una sola visita por tienda cuando cabe, y la excepción del dueño (2026-11-25): «no regresar a la tienda, la opción b, aquí
 * es importante el ahorro». Si volver a una tienda ya visitada solo se evita dejando tarde a una entrega de ventana estrecha,
 * el camión NO vuelve: la entrega llega tarde, y el plan lo marca (violación y `tardeMin`), no lo esconde.
 *
 * La forma del caso del 2026-10-02, en abstracto: la base B está lejos (60 min) de M, E y P; el resto está a 10–15 min unos de otros.
 */
const MINUTOS: Record<string, number> = {
  "B-M": 60, "B-E": 60, "B-P": 60, "B-C1": 60, "B-C2": 60,
  "M-E": 10, "M-P": 12, "E-P": 10, "M-C1": 12, "E-C1": 10, "P-C1": 15,
  "C2-M": 10, "C2-E": 15, "C2-P": 12, "C2-C1": 12,
};
const minutosEntre = (a: string, b: string): number => {
  if (a === b) return 0;
  return MINUTOS[`${a}-${b}`] ?? MINUTOS[`${b}-${a}`];
};
function matrizDe(puntos: string[]): Matriz {
  const m: Matriz = {};
  for (const a of puntos) {
    m[a] = {};
    for (const b of puntos) if (a !== b) m[a][b] = { minutos: minutosEntre(a, b), millas: minutosEntre(a, b) * 0.6 };
  }
  return m;
}
const orden = (id: string, origen: string, destino: string, pallets: number, extra: Partial<OrdenEntrada> = {}): OrdenEntrada => ({
  id, codigo: id, entrada: "2026-10-02 0800", origen, destino, pallets, ventana: null,
  servicioRecogidaMin: 10, servicioEntregaMin: 5, ...extra,
});
const chofer: ChoferEntrada = { id: "A", nombre: "Chofer A", base: "B", capacidad: 10, entrada: 480, salida: 1050, vuelveABase: false };

/** Las siete órdenes: cuatro (y dos más) se cargan en B; la de M para C2 tiene ventana estrecha, que solo cumple si el camión sale rápido. */
const ordenes = (ventanaC2: [number, number]): OrdenEntrada[] => [
  orden("o1", "B", "C1", 1),
  orden("o2", "B", "E", 1),
  orden("o3", "B", "M", 1),
  orden("o4", "B", "P", 2),
  orden("o5", "M", "C2", 1, { ventana: ventanaC2, estrecha: true }),
  orden("o6", "B", "P", 0.15),
  orden("o7", "B", "P", 3),
];
const entradaDe = (os: OrdenEntrada[]): Entrada => ({ ordenes: os, choferes: [chofer], matriz: matrizDe(["B", "M", "E", "P", "C1", "C2"]) });

describe("una sola visita por tienda cuando cabe · la entrega tarde se marca, no se esconde", () => {
  it("el plan hace UNA visita a B, deja a C2 tarde y marcada, y no sale un regreso a la misma tienda", () => {
    const plan = planifica(entradaDe(ordenes([590, 615])), PARAMETROS_POR_DEFECTO);
    expect(plan.sinAsignar).toEqual([]);
    const ruta = plan.rutas[0];
    const visitasAB = new Set(ruta.paradas.filter((p) => p.punto === "B").map((p) => p.visita));
    expect(visitasAB.size).toBe(1);
    const c2 = ruta.paradas.find((p) => p.tipo === "D" && p.orden === "o5")!;
    expect(c2.tardeMin).toBeGreaterThan(0);
    expect(plan.violaciones.map((v) => `${v.tipo}:${v.orden}`)).toContain("ventana_estrecha:o5");
    expect(plan.uniones?.[0]?.tarde).toEqual([{ orden: "o5", tardeMin: c2.tardeMin }]);
    expect(plan.uniones?.[0]?.millasAhorradas).toBeGreaterThan(0);
  });

  it("la ruta sin juntar (con la vuelta a B) hace más millas que la que sale", () => {
    const os = ordenes([590, 615]);
    const P = (orden: string): ParadaRef => ({ orden, tipo: "P" });
    const D = (orden: string): ParadaRef => ({ orden, tipo: "D" });
    // B (o1–o4), C1, E, M (entrega o3 y recoge o5), C2, otra vez B (o6, o7) y P.
    const conVuelta = [P("o1"), P("o2"), P("o3"), P("o4"), D("o1"), D("o2"), D("o3"), P("o5"), D("o5"), P("o6"), P("o7"), D("o4"), D("o6"), D("o7")];
    const sinJuntar = evaluaPlan({ secuencias: { A: conVuelta }, ordenes: os, choferes: [chofer], matriz: matrizDe(["B", "M", "E", "P", "C1", "C2"]) }).rutas[0];
    const plan = planifica(entradaDe(os), PARAMETROS_POR_DEFECTO);
    expect(plan.rutas[0].millas).toBeLessThan(sinJuntar.millas);
  });

  it("la regla 7 del validador marca la llegada tarde de la ruta juntada; la regla 3 no marca regreso", () => {
    const os = ordenes([590, 615]);
    const plan = planifica(entradaDe(os), PARAMETROS_POR_DEFECTO);
    const ruta = plan.rutas[0];
    const r = validaLaRuta({
      chofer: { nombre: "Chofer A", capacidad: 10 },
      ordenes: os,
      secuencia: ruta.paradas.map((p) => ({ orden: p.orden, tipo: p.tipo })),
      llegadas: ruta.paradas.map((p) => p.llegada),
    });
    expect(r.violaciones.map((x) => x.clave)).toContain("fuera_de_ventana_estrecha");
    expect(r.violaciones.map((x) => x.clave)).not.toContain("regreso_a_la_misma_tienda");
  });
});
