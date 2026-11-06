import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { eligeRastro, estancias, limpiaRastro, millasDelRastro, posicionEn, trazosParaElMapa, type PuntoDeRastro, type Rastro } from "./rastro";
import { permanenciaS, vale, visitasA, RADIO_DE_PARADA_M, PERMANENCIA_MIN_S } from "./visitas";
import { comparaOrden } from "./orden";
import { informeDelDia, type EntradaDelDia, type OrdenDelDia } from "./dia";
import { aCsv, celdaCsv, difDe, esFiable, estimadoContraReal, marcaAtipicas, tarjetasDeChoferes, tiempoPorParada, visitasDe, MINIMO_DE_CASOS } from "./metricas";
import { armaDias, sitioDeRecogida, type DatosCrudos, type FilaDeEntrega } from "./arma";
import { puedeVerReportesDeChoferes, rangoDeReportes } from "./permiso";

/**
 * «Reportes de choferes» (D-907): lo que decide cada número.
 *
 * Los rastros son sintéticos, con las dos formas que se midieron el 2026-11-06 en los datos de verdad: el CAMIÓN manda un
 * punto cada 10 s en marcha y calla parado; el TELÉFONO manda uno cada 30 s y, cuando calla, no se sabe qué pasó.
 */

const T0 = Date.parse("2026-11-05T14:00:00Z");           // 08:00 en Texas
const min = (n: number) => T0 + n * 60_000;
const TIENDA = { lat: 26.2041, lng: -98.1686 }, CLIENTE = { lat: 26.2500, lng: -98.2000 }, OTRO = { lat: 26.3000, lng: -98.1000 };
/** ~111 m por milésima de grado de latitud. */
const norte = (p: { lat: number; lng: number }, m: number) => ({ lat: p.lat + m / 111_320, lng: p.lng });

/** Viaje en línea recta de `a` a `b`, un punto cada `pasoS` segundos, entre los minutos `m0` y `m1`. */
function viaje(a: { lat: number; lng: number }, b: { lat: number; lng: number }, m0: number, m1: number, pasoS = 10): PuntoDeRastro[] {
  const n = Math.max(1, Math.round(((m1 - m0) * 60) / pasoS));
  return Array.from({ length: n + 1 }, (_, i) => ({ t: min(m0) + i * pasoS * 1000, lat: a.lat + ((b.lat - a.lat) * i) / n, lng: a.lng + ((b.lng - a.lng) * i) / n }));
}
/** Parado en un sitio, un punto cada `pasoS` segundos. */
const parado = (p: { lat: number; lng: number }, m0: number, m1: number, pasoS = 30): PuntoDeRastro[] => viaje(p, p, m0, m1, pasoS);
const camion = (...trozos: PuntoDeRastro[][]): Rastro => ({ fuente: "camion", puntos: limpiaRastro(trozos.flat()) });
const telefono = (...trozos: PuntoDeRastro[][]): Rastro => ({ fuente: "telefono", puntos: limpiaRastro(trozos.flat()) });

describe("llegada y salida, del rastro", () => {
  it("el camión llega, calla 25 minutos con el motor apagado y se va: UNA visita de 25 minutos", () => {
    const r = camion(viaje(OTRO, TIENDA, 0, 20), viaje(TIENDA, CLIENTE, 45, 60));
    const [v, ...mas] = visitasA(r, TIENDA);
    expect(mas).toHaveLength(0);
    expect(v.salida).toBeGreaterThanOrEqual(min(45));
    expect(v.llegada).toBeLessThanOrEqual(min(20));
    expect(permanenciaS(v) / 60).toBeGreaterThan(25);
    expect(permanenciaS(v) / 60).toBeLessThan(27);          // lo que tarda en cruzar los 150 m de cada lado
    expect(v.yaEstaba).toBe(false); expect(v.seQuedo).toBe(false);
    expect(vale(v)).toBe(true);
  });

  it("pasar por delante no es una visita: menos de 2 minutos dentro del círculo no vale", () => {
    const r = camion(viaje(norte(TIENDA, -3000), norte(TIENDA, 3000), 0, 6));   // ~37 mph, pasa por la puerta
    const vs = visitasA(r, TIENDA);
    expect(vs).toHaveLength(1);
    expect(permanenciaS(vs[0])).toBeLessThan(PERMANENCIA_MIN_S);
    expect(vale(vs[0])).toBe(false);
  });

  it("una parada corta SÍ vale si el chofer tocó en la app durante ella", () => {
    const r = camion(viaje(OTRO, CLIENTE, 0, 10), parado(CLIENTE, 10, 11), viaje(CLIENTE, OTRO, 11, 20));
    const [v] = visitasA(r, CLIENTE);
    expect(permanenciaS(v)).toBeLessThan(PERMANENCIA_MIN_S);
    expect(vale(v)).toBe(false);
    expect(vale(v, [min(10.5)])).toBe(true);
    expect(vale(v, [min(40)])).toBe(false);                 // un toque media hora después no la confirma
  });

  it("salir del círculo y volver en menos de 3 minutos es la misma visita; volver una hora después, otra", () => {
    const fuera = norte(TIENDA, 400);
    const r = camion(parado(TIENDA, 0, 10), viaje(TIENDA, fuera, 10, 11), viaje(fuera, TIENDA, 11, 12), parado(TIENDA, 12, 20), viaje(TIENDA, OTRO, 20, 40), viaje(OTRO, TIENDA, 80, 100), parado(TIENDA, 100, 110));
    const vs = visitasA(r, TIENDA);
    expect(vs).toHaveLength(2);
    expect(vs[0].yaEstaba).toBe(true);                      // el rastro EMPIEZA en la tienda: no se vio llegar
    expect(vs[1].seQuedo).toBe(true);                       // y acaba en ella: no se vio irse
  });

  it("con el TELÉFONO, dos puntos en el sitio separados 40 minutos son dos visitas: en medio no se sabe", () => {
    const r = telefono(parado(TIENDA, 0, 5), parado(TIENDA, 45, 50));
    expect(visitasA(r, TIENDA)).toHaveLength(2);
    expect(visitasA({ ...r, fuente: "camion" }, TIENDA)).toHaveLength(1);
  });

  it("el radio es 150 m: a 140 m está, a 200 m no", () => {
    expect(RADIO_DE_PARADA_M).toBe(150);
    expect(visitasA(camion(parado(norte(CLIENTE, 140), 0, 10)), CLIENTE)).toHaveLength(1);
    expect(visitasA(camion(parado(norte(CLIENTE, 200), 0, 10)), CLIENTE)).toHaveLength(0);
  });
});

describe("el rastro: cuál se usa, millas, dónde estaba", () => {
  it("el del camión si sirve; si no, el del teléfono; si no, ninguno", () => {
    const largo = viaje(TIENDA, CLIENTE, 0, 60), corto = viaje(TIENDA, CLIENTE, 0, 2);
    expect(eligeRastro(largo, largo)?.fuente).toBe("camion");
    expect(eligeRastro(corto, largo)?.fuente).toBe("telefono");
    expect(eligeRastro([], largo)?.fuente).toBe("telefono");
    expect(eligeRastro(corto, corto)).toBeNull();
    expect(eligeRastro(null, null)).toBeNull();
  });

  it("las millas no cuentan una recta por un hueco del teléfono, ni el temblor del GPS parado", () => {
    const ida = viaje(TIENDA, CLIENTE, 0, 15, 30);
    const seguido = telefono(ida);
    const conHueco = telefono(ida, parado(OTRO, 60, 70));   // 45 minutos callado y aparece en otra ciudad
    expect(millasDelRastro(conHueco)).toBe(millasDelRastro(seguido));
    const temblando = telefono(Array.from({ length: 200 }, (_, i) => ({ t: min(0) + i * 30_000, lat: TIENDA.lat + (i % 2) * 0.00005, lng: TIENDA.lng })));
    expect(millasDelRastro(temblando)).toBe(0);
    expect(millasDelRastro(seguido)).toBeGreaterThan(3.5);
    expect(millasDelRastro(seguido)).toBeLessThan(4.5);
  });

  it("un salto imposible se tira, y el mapa corta la línea en los huecos", () => {
    const r = limpiaRastro([...viaje(TIENDA, norte(TIENDA, 500), 0, 1), { t: min(1.2), lat: 30, lng: -90 }, ...viaje(norte(TIENDA, 500), norte(TIENDA, 900), 2, 3)]);
    expect(r.some((p) => p.lat === 30)).toBe(false);
    expect(trazosParaElMapa(telefono(viaje(TIENDA, CLIENTE, 0, 10, 30), viaje(OTRO, CLIENTE, 60, 70, 30)))).toHaveLength(2);
  });

  it("dónde estaba a una hora: con el camión apagado sigue ahí; en mitad de un hueco con movimiento, no se sabe", () => {
    const r = camion(viaje(OTRO, TIENDA, 0, 20), viaje(TIENDA, CLIENTE, 60, 80));
    expect(posicionEn(r, min(40))?.lat).toBeCloseTo(TIENDA.lat, 3);
    const t = telefono(viaje(OTRO, TIENDA, 0, 20, 30), parado(CLIENTE, 60, 70));
    expect(posicionEn(t, min(40))).toBeNull();
    expect(posicionEn(t, min(300))).toBeNull();
  });

  it("los ratos parado: 5 minutos o más sin salir de 60 m", () => {
    const r = camion(viaje(TIENDA, OTRO, 0, 20), viaje(OTRO, CLIENTE, 32, 50), parado(CLIENTE, 50, 53), viaje(CLIENTE, TIENDA, 53, 70));
    const es = estancias(r);
    expect(es).toHaveLength(1);
    expect((es[0].hasta - es[0].desde) / 60_000).toBeGreaterThanOrEqual(12);
  });
});

describe("el orden planeado contra el real", () => {
  const p = (clave: string, plan: number, real: number) => ({ clave, plan, real });
  it("en el orden del plan: nada fuera", () => {
    expect(comparaOrden([p("a", 1, 10), p("b", 2, 20), p("c", 3, 30)])).toEqual({ comparadas: 3, fueraDeOrden: [] });
  });
  it("hacer primero la ÚLTIMA y luego las demás en orden es UNA fuera de orden, no todas", () => {
    expect(comparaOrden([p("a", 1, 20), p("b", 2, 30), p("c", 3, 40), p("d", 4, 10)]).fueraDeOrden).toEqual(["d"]);
  });
  it("al revés entero: todas menos una", () => {
    expect(comparaOrden([p("a", 1, 40), p("b", 2, 30), p("c", 3, 20), p("d", 4, 10)]).fueraDeOrden).toHaveLength(3);
  });
  it("las que comparten puesto en el plan, o la misma visita, no están desordenadas entre sí", () => {
    expect(comparaOrden([p("a", 1, 10), p("b", 1, 10), p("c", 2, 10), p("d", 3, 20)]).fueraDeOrden).toEqual([]);
  });
  it("sin puesto o sin hora no se comparan", () => {
    expect(comparaOrden([p("a", 1, 10), p("b", NaN, 20), p("c", 3, NaN)])).toEqual({ comparadas: 1, fueraDeOrden: [] });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Un día entero
// ---------------------------------------------------------------------------------------------------------------

const CHOFER = "c1";
const orden = (id: string, entrega: { lat: number; lng: number }, extra: Partial<OrdenDelDia> = {}): OrdenDelDia => ({
  id, codigo: id.toUpperCase(), tipo: "Customer", tienda: "RDZ Pharr", cliente: `Cliente ${id}`, etapa: "delivered",
  recogida: { ...TIENDA, nombre: "RDZ Pharr" }, entrega: { ...entrega, nombre: `Casa ${id}` }, conRecogida: true,
  ventana: "0830-1200", minRecogida: 10, minEntrega: 15, ordenEnLista: null, toques: {}, plan: {}, ...extra,
});
const dia = (ordenes: OrdenDelDia[], rastro: Rastro | null, extra: Partial<EntradaDelDia> = {}) => informeDelDia({
  fecha: "2026-11-05", zona: "America/Chicago", choferId: CHOFER, chofer: "Ana", ordenes, rastro, tiendas: [{ name: "RDZ Pharr", ...TIENDA }],
  tramo: () => ({ millas: 5, minutos: 12, estimado: false }), instante: (m) => Date.parse("2026-11-05T06:00:00Z") + m * 60_000, ...extra,
});
const plan = (eta: number, apuntadaEn = T0 - 3_600_000) => ({ eta, primera: eta, apuntadaEn, rehechaEn: null });
const toque = (m: number, porElChofer = true, donde?: { lat: number; lng: number }) => ({ t: min(m), porElChofer, lat: donde?.lat ?? null, lng: donde?.lng ?? null });

/** Carga en la tienda 08:10–08:30, entrega en CLIENTE 08:50–09:10, entrega en OTRO 09:40–10:00. */
const RUTA = camion(viaje(norte(TIENDA, 2000), TIENDA, 0, 10), viaje(TIENDA, CLIENTE, 30, 50), viaje(CLIENTE, OTRO, 70, 100), viaje(OTRO, norte(OTRO, 3000), 120, 130));

describe("el día de un chofer", () => {
  it("la llegada sale del GPS del camión, con su fuente, y se compara con el plan", () => {
    const d = dia([
      orden("a", CLIENTE, { plan: { P: plan(8 * 60 + 15), D: plan(9 * 60) }, toques: { recogio: toque(28, true, TIENDA), entrego: toque(65, true, CLIENTE) } }),
      orden("b", OTRO, { plan: { P: plan(8 * 60 + 15), D: plan(9 * 60 + 30) }, toques: { recogio: toque(29, true, TIENDA), entrego: toque(118, true, OTRO) } }),
    ], RUTA, { camion: "PETERBILT" });
    expect(d.rastro).toMatchObject({ fuente: "camion", camion: "PETERBILT", escaso: false });
    const da = d.paradas.find((p) => p.clave === "D:a")!, db = d.paradas.find((p) => p.clave === "D:b")!, pa = d.paradas.find((p) => p.clave === "P:a")!;
    expect(da.fuente).toBe("camion"); expect(db.fuente).toBe("camion");
    // Llega a CLIENTE a las 08:50 (min 50), con 09:00 de plan: 10 minutos antes.
    expect(da.difPlan).toBeLessThanOrEqual(-9); expect(da.difPlan).toBeGreaterThanOrEqual(-12);
    expect(db.difPlan).toBeGreaterThanOrEqual(8); expect(db.difPlan).toBeLessThanOrEqual(11);
    expect(da.sobreLaVentana).toBeLessThan(0);
    // Las dos recogidas son UNA visita a la tienda, de ~20 minutos, contra los 20 que supone el plan (10 + 10).
    expect(pa.visita).toBe(d.paradas.find((p) => p.clave === "P:b")!.visita);
    const carga = d.visitas[pa.visita!];
    expect(carga).toMatchObject({ clase: "recogida_tienda", tienda: "RDZ Pharr", ordenes: 2, minPlaneados: 20, truncada: false });
    expect(carga.minutos).toBeGreaterThan(19); expect(carga.minutos).toBeLessThan(23);
    expect(d.visitas.filter((v) => v.clase === "entrega_cliente")).toHaveLength(2);
    expect(d.orden).toEqual({ comparadas: 4, fueraDeOrden: 0 });
    expect(d.toques).toEqual({ propios: 4, conPosicion: 4, enLaParada: 4, deOtraPersona: 0 });
    // Plan: tienda → cliente → otro = 2 tramos de la caché. Real: del rastro, entre la primera y la última llegada.
    expect(d.plan).toMatchObject({ millas: 10, minutos: 24, tramos: 2, tramosEstimados: 0 });
    expect(d.real.millasEntreParadas).toBeGreaterThan(8);
  });

  it("hecha en otro orden que el plan: se cuenta, y esa parada no entra en «estimado contra real»", () => {
    // El plan decía primero OTRO (08:45) y luego CLIENTE (09:40); se hizo al revés.
    const d = dia([
      orden("a", CLIENTE, { plan: { P: plan(8 * 60 + 15), D: plan(9 * 60 + 40) } }),
      orden("b", OTRO, { plan: { P: plan(8 * 60 + 15), D: plan(8 * 60 + 45) } }),
    ], RUTA);
    expect(d.orden).toEqual({ comparadas: 4, fueraDeOrden: 1 });
    const fuera = d.paradas.filter((p) => p.fueraDeOrden);
    expect(fuera).toHaveLength(1);
    expect(difDe(fuera[0], "plan")).toEqual({ fuera: "fueraDeOrden" });
    const e = estimadoContraReal(d.paradas, "plan");
    expect(e.n).toBe(3); expect(e.fuera.fueraDeOrden).toBe(1); expect(e.porRastro).toBe(3);
  });

  it("sin GPS: vale el toque del PROPIO chofer, y se dice; el de otra persona no mide nada", () => {
    const d = dia([
      orden("a", CLIENTE, { plan: { D: plan(9 * 60) }, toques: { llegoAEntregar: toque(55), entrego: toque(70) } }),
      orden("b", OTRO, { plan: { D: plan(10 * 60) }, toques: { entrego: toque(125) } }),
      orden("c", norte(OTRO, 5000), { plan: { D: plan(11 * 60) }, toques: { entrego: toque(200, false) } }),
    ], null);
    const de = (k: string) => d.paradas.find((p) => p.clave === k)!;
    expect(de("D:a")).toMatchObject({ fuente: "toque_llegada", llegada: min(55), salida: min(70), difPlan: -5 });
    expect(de("D:b")).toMatchObject({ fuente: "toque_cierre", llegada: min(125), difPlan: 5 });
    expect(de("D:c")).toMatchObject({ fuente: null, llegada: null, motivo: "la_marco_otra_persona", toqueDeOtraPersona: true });
    expect(d.rastro.fuente).toBeNull();
    expect(d.visitas).toHaveLength(0);                       // un toque no dice cuánto se estuvo en la parada
    expect(d.real).toMatchObject({ millasEntreParadas: null, millasDelDia: null, primeraSalida: null });
    expect(d.parado.minutos).toBeNull();
    expect(d.toques).toMatchObject({ propios: 2, conPosicion: 0, deOtraPersona: 1 });
  });

  it("un toque hecho LEJOS de la parada no da hora de llegada, y cuenta contra la disciplina de toques", () => {
    // «Entregada» en OTRO se toca ya de vuelta, a 3 km; y el camión nunca fue a la casa de «c».
    const d = dia([
      orden("b", OTRO, { toques: { entrego: toque(128, true, norte(OTRO, 3000)) } }),
      orden("c", norte(CLIENTE, 9000), { toques: { entrego: toque(60, true, CLIENTE) } }),
    ], RUTA);
    const b = d.paradas.find((p) => p.clave === "D:b")!, c = d.paradas.find((p) => p.clave === "D:c")!;
    expect(b.fuente).toBe("camion");                          // la llegada sale del camión, que SÍ estuvo
    expect(b.toque).toMatchObject({ enLaParada: false, posicion: "toque" });
    expect(c).toMatchObject({ fuente: null, llegada: null, motivo: "toco_lejos" });
    expect(d.toques).toMatchObject({ propios: 2, conPosicion: 2, enLaParada: 0 });
  });

  it("«recogida» tocada en la puerta del cliente: la recogida sigue siendo la visita a la tienda", () => {
    const d = dia([orden("a", CLIENTE, { toques: { recogio: toque(52, true, CLIENTE), entrego: toque(66, true, CLIENTE) } })], RUTA);
    const p = d.paradas.find((x) => x.clave === "P:a")!;
    expect(p.fuente).toBe("camion");
    expect(p.llegada).toBeLessThan(min(12));                 // llegó a la tienda sobre las 08:10
    expect(p.toque).toMatchObject({ enLaParada: false });    // y el toque, a kilómetros
  });

  it("parado lejos de toda parada cuenta como fuera de ruta; una pausa declarada, no", () => {
    const desvio = norte(CLIENTE, 4000);
    const r = camion(viaje(norte(TIENDA, 2000), TIENDA, 0, 10), viaje(TIENDA, CLIENTE, 30, 50), viaje(CLIENTE, desvio, 70, 80), viaje(desvio, OTRO, 100, 120), viaje(OTRO, norte(OTRO, 3000), 140, 150));
    const ordenes = [orden("a", CLIENTE), orden("b", OTRO)];
    const d = dia(ordenes, r);
    expect(d.parado.veces).toBe(1);
    expect(d.parado.minutos).toBeGreaterThanOrEqual(19); expect(d.parado.minutos).toBeLessThanOrEqual(21);
    expect(dia(ordenes, r, { pausas: [{ desde: min(79), hasta: min(101) }] }).parado).toMatchObject({ minutos: 0, veces: 0 });
  });

  it("un rastro de teléfono ESCASO sirve para ver si paró, pero no da millas ni ratos parado", () => {
    const pocos = telefono(parado(TIENDA, 0, 20, 300), parado(CLIENTE, 60, 80, 300), parado(OTRO, 120, 400, 900));
    const d = dia([orden("a", CLIENTE)], pocos);
    expect(d.rastro).toMatchObject({ fuente: "telefono", escaso: true });
    expect(d.paradas.find((p) => p.clave === "D:a")!.fuente).toBe("telefono");
    expect(d.real.millasDelDia).toBeNull(); expect(d.parado.minutos).toBeNull();
  });

  it("una estimación escrita DESPUÉS de hacer la parada no estima nada: no entra", () => {
    const d = dia([orden("a", CLIENTE, { plan: { D: plan(9 * 60, min(300)) } })], RUTA);
    const p = d.paradas.find((x) => x.clave === "D:a")!;
    expect(p.etaPosterior).toBe(true);
    expect(difDe(p, "plan")).toEqual({ fuera: "estimadoDespues" });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Cobertura y justicia
// ---------------------------------------------------------------------------------------------------------------

describe("poco dato no se compara", () => {
  it("fiable = bastantes casos Y al menos la mitad de lo que se podía medir", () => {
    expect(esFiable(MINIMO_DE_CASOS, MINIMO_DE_CASOS)).toBe(true);
    expect(esFiable(MINIMO_DE_CASOS - 1, MINIMO_DE_CASOS - 1)).toBe(false);   // pocos casos
    expect(esFiable(12, 30)).toBe(false);                                     // 12 de 30: menos de la mitad
    expect(esFiable(15, 30)).toBe(true);
    expect(esFiable(3, 4, true)).toBe(true);                                  // por días: 3 bastan
    expect(esFiable(2, 2, true)).toBe(false);
    expect(esFiable(0, 0)).toBe(false);
  });

  /** Un chofer con `n` días iguales al de RUTA (2 órdenes, todo por GPS, toques en la parada). */
  const diasDe = (chofer: string, n: number, tarde = 0) => Array.from({ length: n }, (_, i) => ({
    ...dia([
      orden(`a${i}`, CLIENTE, { plan: { P: plan(8 * 60 + 15), D: plan(9 * 60 - tarde) }, toques: { recogio: toque(28, true, TIENDA), entrego: toque(65, true, CLIENTE) } }),
      orden(`b${i}`, OTRO, { plan: { P: plan(8 * 60 + 15), D: plan(9 * 60 + 30 - tarde) }, toques: { recogio: toque(29, true, TIENDA), entrego: toque(118, true, OTRO) } }),
    ], RUTA),
    chofer, choferId: chofer, fecha: `2026-11-${String(i + 1).padStart(2, "0")}`,
  }));
  const minutoLocal = (ms: number) => Math.round((ms - Date.parse("2026-11-05T06:00:00Z")) / 60_000) % 1440;

  it("con un día (4 paradas) todo sale, pero nada es fiable ni lleva puesto", () => {
    const [t] = tarjetasDeChoferes(diasDe("Ana", 1), minutoLocal);
    expect(t).toMatchObject({ dias: 1, diasConRastro: 1, diasConCamion: 1, paradas: 4, paradasHechas: 4, paradasPorRastro: 4 });
    expect(t.medidas.toquesEnLaParada).toMatchObject({ valor: 100, n: 4, de: 4, fiable: false, puesto: null });
    expect(t.medidas.dentroDe30.fiable).toBe(false);
    expect(t.medidas.paradoMinPorDia.fiable).toBe(false);
  });

  it("solo se ordena entre choferes con dato fiable, y solo si son dos o más", () => {
    const ana = diasDe("Ana", 6), luis = diasDe("Luis", 6, 45), eva = diasDe("Eva", 1);
    const solos = tarjetasDeChoferes([...ana, ...eva], minutoLocal);
    expect(solos.find((t) => t.chofer === "Ana")!.medidas.dentroDe30).toMatchObject({ fiable: true, puesto: null });   // no hay con quién comparar
    const tres = tarjetasDeChoferes([...ana, ...luis, ...eva], minutoLocal);
    const de = (n: string) => tres.find((t) => t.chofer === n)!.medidas;
    expect(de("Ana").dentroDe30).toMatchObject({ valor: 100, fiable: true, puesto: 1 });
    expect(de("Luis").dentroDe30.fiable).toBe(true);
    expect(de("Luis").dentroDe30.puesto).toBe(2);
    expect(de("Eva").dentroDe30).toMatchObject({ fiable: false, puesto: null });                                      // se enseña, no se compara
    expect(de("Ana").primeraSalidaMin.puesto).toBeNull();     // la hora de salida no es ni buena ni mala: nunca se ordena
    expect(de("Ana").millasPorDia.puesto).toBeNull();
  });

  it("tiempo por parada: mediana por grupo, contra lo que supone el plan; las truncadas no cuentan", () => {
    const vs = visitasDe(diasDe("Ana", 6));
    const clases = tiempoPorParada(vs, "clase");
    const entregas = clases.find((c) => c.clave === "entrega_cliente")!;
    expect(entregas).toMatchObject({ n: 12, planeadoMin: 15, fiable: true });
    expect(entregas.medianaMin).toBeGreaterThan(19); expect(entregas.medianaMin).toBeLessThan(23);
    expect(tiempoPorParada(vs, "tienda").map((f) => f.clave)).toEqual(["RDZ Pharr"]);
    expect(tiempoPorParada(vs, "cliente")).toHaveLength(12);           // cada cliente, una visita: todas con poco dato
    expect(tiempoPorParada(vs, "cliente").every((f) => !f.fiable)).toBe(true);
    expect(tiempoPorParada(vs.map((v) => ({ ...v, truncada: true })), "clase")).toEqual([]);
  });

  it("atípica: muy por encima de las de su clase, y nunca con menos de 8 visitas", () => {
    const v = (minutos: number) => ({ lugar: "x", clase: "entrega_cliente" as const, tienda: null, cliente: "c", lat: 0, lng: 0, llegada: 0, salida: 0, minutos, fuente: "camion" as const, paradas: [], ordenes: 1, minPlaneados: 15, truncada: false, fecha: "2026-11-05", chofer: "Ana" });
    expect(marcaAtipicas([10, 12, 90].map(v)).some((x) => x.atipica)).toBe(false);
    const muchas = marcaAtipicas([10, 11, 12, 12, 13, 14, 15, 16, 18, 95].map(v));
    expect(muchas.filter((x) => x.atipica).map((x) => x.minutos)).toEqual([95]);
  });
});

describe("CSV", () => {
  it("escapa comas, comillas y saltos, y desarma lo que Excel tomaría por fórmula", () => {
    expect(celdaCsv('Casa "A", S.A.')).toBe('"Casa ""A"", S.A."');
    expect(celdaCsv("=HYPERLINK(\"http://x\")")).toBe('"\'=HYPERLINK(""http://x"")"');
    expect(celdaCsv("+1 956")).toBe("'+1 956");
    expect(celdaCsv(-5)).toBe("-5");                        // un número negativo es un número
    expect(celdaCsv(null)).toBe("");
    expect(aCsv(["a", "b"], [[1, "x\ny"]])).toBe('a,b\r\n1,"x\ny"\r\n');
  });
});

// ---------------------------------------------------------------------------------------------------------------
// De las filas de la base
// ---------------------------------------------------------------------------------------------------------------

describe("de las filas de la base a los días", () => {
  const fila = (extra: Partial<FilaDeEntrega>): FilaDeEntrega => ({
    id: "o1", order_code: "FW1", order_type: "Customer", store: "RDZ Pharr", account: "Casa Uno", pickup_name: "RDZ Pharr", delivery_name: "Delivery", assigned_driver: "Ana", delivery_date: "2026-11-05",
    stage: "delivered", route_seq: 1, delivery_windows: "0830-1730", pickup_duration: "10 min", delivery_duration: "15 min", delivery_lat: CLIENTE.lat, delivery_lng: CLIENTE.lng,
    pickup_point_lat: null, pickup_point_lng: null, pickup_lat: CLIENTE.lat, pickup_lng: CLIENTE.lng, pod_lat: CLIENTE.lat, pod_lng: CLIENTE.lng,
    pickup_gps_at: new Date(min(52)).toISOString(), pod_delivered_at: new Date(min(66)).toISOString(), ...extra,
  });
  const base: DatosCrudos = {
    zona: "America/Chicago", entregas: [fila({})], choferes: [{ id: CHOFER, full_name: "Ana" }], tiendas: [{ name: "RDZ Pharr", ...TIENDA }],
    eventos: [{ delivery_id: "o1", kind: "picked_up", created_by: CHOFER, created_at: new Date(min(52)).toISOString() }, { delivery_id: "o1", kind: "delivered", created_by: CHOFER, created_at: new Date(min(66)).toISOString() }],
    etas: [{ delivery_id: "o1", plan_date: "2026-11-05", kind: "D", eta: "09:00", first_eta: "08:40", created_at: new Date(T0 - 3_600_000).toISOString() }],
    telefono: [], camiones: [{ choferId: CHOFER, fecha: "2026-11-05", imei: "863240070017882", nombre: "PETERBILT", puntos: RUTA.puntos }], pausas: [], tramos: new Map(),
  };

  it("la recogida está en la TIENDA de la orden: `pickup_lat/lng` es dónde tocó el chofer, no la parada", () => {
    expect(sitioDeRecogida(fila({}), base.tiendas)).toMatchObject({ lat: TIENDA.lat, nombre: "RDZ Pharr" });
    expect(sitioDeRecogida(fila({ pickup_point_lat: 1, pickup_point_lng: 2 }), base.tiendas)).toMatchObject({ lat: 1, lng: 2 });
    expect(sitioDeRecogida(fila({ pickup_name: "Proveedor X", store: "No existe" }), base.tiendas)).toBeNull();
  });

  it("arma el día con el camión, la primera estimación y la del plan, y los toques con su autor", () => {
    const [d] = armaDias(base);
    expect(d.informe).toMatchObject({ fecha: "2026-11-05", chofer: "Ana", choferId: CHOFER });
    expect(d.informe.rastro).toMatchObject({ fuente: "camion", camion: "PETERBILT" });
    const e = d.informe.paradas.find((p) => p.clave === "D:o1")!;
    expect(e).toMatchObject({ eta: 540, primeraEta: 520, fuente: "camion", cliente: "Casa Uno" });
    expect(e.difPrimera! - e.difPlan!).toBe(20);
    expect(d.informe.paradas.find((p) => p.clave === "P:o1")!.toque).toMatchObject({ enLaParada: false });
    expect(d.informe.plan.tramosEstimados).toBe(0);
  });

  it("sin camión usa el teléfono (y tira los puntos imprecisos); sin nada, los toques", () => {
    const tel = RUTA.puntos.map((p) => ({ driver_id: CHOFER, lat: p.lat, lng: p.lng, accuracy_m: 8, recorded_at: new Date(p.t).toISOString() }));
    expect(armaDias({ ...base, camiones: [], telefono: tel })[0].informe.rastro.fuente).toBe("telefono");
    expect(armaDias({ ...base, camiones: [], telefono: tel.map((p) => ({ ...p, accuracy_m: 900 })) })[0].informe.rastro.fuente).toBeNull();
    const sin = armaDias({ ...base, camiones: [] })[0].informe;
    expect(sin.paradas.find((p) => p.clave === "D:o1")!.fuente).toBe("toque_cierre");
  });

  it("una orden marcada desde un escritorio no cuenta como toque del chofer; las canceladas y sin chofer no entran", () => {
    const d = armaDias({ ...base, camiones: [], eventos: base.eventos.map((e) => ({ ...e, created_by: "oficina" })) })[0].informe;
    expect(d.paradas.every((p) => p.toqueDeOtraPersona && p.fuente === null)).toBe(true);
    expect(armaDias({ ...base, entregas: [fila({ stage: "canceled" }), fila({ id: "o2", assigned_driver: null })] })).toHaveLength(0);
  });

  it("una recogida hecha OTRO día no es una parada de este", () => {
    const ayer = new Date(min(-24 * 60)).toISOString();
    const d = armaDias({ ...base, entregas: [fila({ pickup_gps_at: ayer })], eventos: [] })[0].informe;
    expect(d.paradas.map((p) => p.clave)).toEqual(["D:o1"]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Permisos y reglas de la casa
// ---------------------------------------------------------------------------------------------------------------

describe("quién ve los reportes", () => {
  it("admin siempre; logística y gerente, con el módulo de Entregas; nadie más", () => {
    expect(puedeVerReportesDeChoferes({ role: "admin", module_access: [] })).toBe(true);
    expect(puedeVerReportesDeChoferes({ role: "logistics", module_access: ["deliveries"] })).toBe(true);
    expect(puedeVerReportesDeChoferes({ role: "manager", module_access: ["deliveries"] })).toBe(true);
    expect(puedeVerReportesDeChoferes({ role: "manager", module_access: ["timetracker"] })).toBe(false);
    for (const role of ["driver", "sales", "warehouse", "accounting", "office"]) expect(puedeVerReportesDeChoferes({ role, module_access: ["deliveries"] })).toBe(false);
    expect(puedeVerReportesDeChoferes(null)).toBe(false);
    expect(puedeVerReportesDeChoferes({})).toBe(false);
  });
  it("el rango: fechas de verdad, en orden, 31 días como mucho", () => {
    expect(rangoDeReportes("2026-11-01", "2026-11-01")).toBe(true);
    expect(rangoDeReportes("2026-10-06", "2026-11-05")).toBe(true);
    expect(rangoDeReportes("2026-10-05", "2026-11-05")).toBe(false);
    expect(rangoDeReportes("2026-11-05", "2026-11-01")).toBe(false);
    expect(rangoDeReportes("hoy", "2026-11-01")).toBe(false);
  });
});

describe("reglas de la casa", () => {
  const raiz = process.cwd();
  const lee = (ruta: string) => readFileSync(join(raiz, ruta), "utf8");
  it("ningún módulo que importa el servidor usa hooks de React", () => {
    const dir = "src/lib/reportes-choferes";
    for (const f of [...readdirSync(join(raiz, dir)).filter((x) => x.endsWith(".ts") && !x.endsWith(".test.ts")).map((x) => `${dir}/${x}`), "src/lib/tracksolid/historial.ts"]) {
      expect(lee(f), f).not.toMatch(/from "react"|\buse(State|Effect|Memo|Ref|Callback)\b|"use client"/);
    }
  });
  it("la pantalla abre el día en una tarjeta: no navega a ninguna parte ni mete HTML a mano", () => {
    const c = lee("src/components/ReportesDeChoferes.tsx");
    expect(c).not.toMatch(/useRouter|router\.push|window\.location|window\.open|<a\s[^>]*href=|<Link\b/);
    expect(c).not.toMatch(/dangerouslySetInnerHTML|innerHTML|bindTooltip|bindPopup/);
    expect(c).toMatch(/className="overlay" data-dia-del-chofer/);
  });
  it("la ruta comprueba el rol ANTES de crear el cliente de servicio", () => {
    const r = lee("src/app/api/driver-reports/route.ts");
    const cuerpo = r.slice(r.indexOf("export async function GET"));
    expect(cuerpo.indexOf("puedeVerReportesDeChoferes(")).toBeGreaterThan(0);
    // D-910: la lectura (y con ella la llave de servicio) vive en `carga.ts`; la ruta la llama DESPUÉS del rol.
    expect(cuerpo.indexOf("cargaDias(")).toBeGreaterThan(0);
    expect(cuerpo.indexOf("puedeVerReportesDeChoferes(")).toBeLessThan(cuerpo.indexOf("cargaDias("));
    const carga = lee("src/lib/reportes-choferes/carga.ts");
    expect(carga).not.toMatch(/access_token|accessToken|appSecret/);
    expect(r).not.toMatch(/access_token|accessToken|appSecret/);
  });
  it("la 264: registrada, sin D-907, con RLS y sin permisos para el navegador", () => {
    const m = lee("supabase/migrations/264_rastro_de_camiones.sql");
    expect(m).toMatch(/-- @ledger-below\r?\ninsert into public\.schema_migrations \(name, checksum\) values \('264_rastro_de_camiones\.sql', '[0-9a-f]{64}'\)/);
    expect(m).not.toMatch(/D-907/);
    expect(m).toMatch(/create table if not exists public\.truck_track_days/);
    expect(m).toMatch(/enable row level security/);
    expect(m).toMatch(/revoke all on public\.truck_track_days from public, anon, authenticated/);
    expect(m).not.toMatch(/create policy|alter table public\.(deliveries|profiles)|drop table public/);
  });
  it("el cron del rastro está programado, una vez al día", () => {
    const v = JSON.parse(lee("vercel.json")) as { crons: { path: string; schedule: string }[] };
    expect(v.crons.filter((c) => c.path === "/api/cron/truck-tracks").map((c) => c.schedule)).toEqual(["30 9 * * *"]);
  });
});
