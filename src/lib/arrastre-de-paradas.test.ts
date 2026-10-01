import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  anota, barrasDeLaRuta, candadoDeja, choquesAlVolver, descartaElDeArriba, escriturasHacia, fotoDe, fotoDeFilas,
  fotoTrasReordenar, HISTORIAL_VACIO, huecoMasCercano, huecosDeLaFila, partePorCapacidad, planDeSoltar, sellosDe,
  textoDeChoques, textoDePrevia, TOPE_DEL_HISTORIAL, trasVolver, viajesSinLaMovida,
  type Foto, type FilaFresca, type Movimiento, type ParadaDelGantt, type RutaDelGantt,
} from "./arrastre-de-paradas";
import { costeDeLaRuta, mejorLugar } from "./mejor-lugar";
import { splitIntoTrips } from "./dispatch";
import type { Delivery } from "./types";

/** Arrastrar paradas en «📅 Horario» del Gestor de Rutas (D-417). */

const BASE = { lat: 29.7, lng: -95.4 };
const INICIO = 480;
let seq = 0;
const p = (id: string, lng: number, extra: Partial<ParadaDelGantt> = {}): ParadaDelGantt => ({
  id, lat: 29.7, lng, pallets: 2, ventana: null, servicioMin: 15, assigned_driver: "Ana", route_seq: seq++, load_no: null, ...extra,
});
const ruta = (clave: string, viajes: ParadaDelGantt[][], extra: Partial<RutaDelGantt> = {}): RutaDelGantt => ({
  clave, viajes: viajes.map((v) => v.map((x) => ({ ...x, assigned_driver: clave }))), manual: false, capacidad: 12, bloqueada: false, base: BASE, ...extra,
});
const ids = (vs: readonly (readonly { id: string }[])[]) => vs.map((v) => v.map((x) => x.id));

describe("soltar dentro de la misma ruta", () => {
  it("reordenar en una ruta que parte sola escribe solo la secuencia (sin viajes), 0..n-1, como las flechas", () => {
    const r = ruta("Ana", [[p("A", -95.3), p("B", -95.2), p("C", -95.1)]]);
    const plan = planDeSoltar([r], "C", { tipo: "hueco", ruta: "Ana", viaje: 0, puesto: 0 }, INICIO);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.ids).toEqual(["C", "A", "B"]);
    expect(plan.loadNoById).toBeUndefined();
    expect(plan.despues.C.route_seq).toBe(0);
    expect(plan.despues.A.route_seq).toBe(1);
    expect(plan.despues.B.route_seq).toBe(2);
    expect(plan.puesto).toBe(0);
  });

  it("pasar la primera parada al segundo viaje en una ruta que parte sola FIJA los viajes (si no, al volver a partirla volvería al primero)", () => {
    const r = ruta("Ana", [[p("A", -95.3, { pallets: 6 }), p("B", -95.2, { pallets: 6 })], [p("C", -95.1, { pallets: 4 })]]);
    const plan = planDeSoltar([r], "A", { tipo: "hueco", ruta: "Ana", viaje: 1, puesto: 1 }, INICIO);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.ids).toEqual(["B", "C", "A"]);
    expect(plan.loadNoById).toEqual({ B: null, C: 2, A: 2 });
    // La foto de «después» (con la que deshacer compara la base) lleva esos mismos viajes.
    expect([plan.despues.B.load_no, plan.despues.C.load_no, plan.despues.A.load_no]).toEqual([null, 2, 2]);
    // Comprobado con la función de verdad: sin fijar, la pantalla lo volvería a partir distinto.
    const sinFijar = splitIntoTrips(plan.ids.map((id) => ({ id, est_pallets: id === "C" ? 4 : 6 }) as unknown as Delivery), 12);
    expect(ids(sinFijar)).not.toEqual([["B"], ["C", "A"]]);
  });

  it("en una ruta con viajes puestos a mano escribe siempre el viaje de cada parada", () => {
    const r = ruta("Ana", [[p("A", -95.3)], [p("B", -95.2, { load_no: 2 })]], { manual: true });
    const plan = planDeSoltar([r], "A", { tipo: "hueco", ruta: "Ana", viaje: 0, puesto: 1 }, INICIO);
    // Sin A, el viaje 1 desaparece: queda [[B]] y A entra detrás de B, en el mismo viaje.
    expect(plan.ok && plan.ids).toEqual(["B", "A"]);
    expect(plan.ok && plan.loadNoById).toEqual({ B: null, A: null });
  });

  it("D-443: soltar A MANO en un hueco no mira la capacidad (sin viajes, la cuenta de la tabla avisa en la parada que se pase)", () => {
    // Hasta D-443 esto era «no cabe: soltar en un viaje que pasaría de la capacidad no escribe nada».
    const r = ruta("Ana", [[p("A", -95.3, { pallets: 10 })], [p("B", -95.2, { pallets: 4 })]]);
    const plan = planDeSoltar([r], "B", { tipo: "hueco", ruta: "Ana", viaje: 0, puesto: 1 }, INICIO);
    expect(plan.ok).toBe(true);
    expect(plan.ok && plan.ids).toEqual(["A", "B"]);
  });
  it("D-443: soltar sobre el NOMBRE («Mejor lugar») sí mira la capacidad, parada a parada, con `admite`", () => {
    // Una sola lista: A, B, C. `admite` solo deja el puesto 3 (al final): ahí va, aunque en línea recta otro fuera mejor.
    const r = ruta("Ana", [[p("A", -95.3), p("B", -95.2), p("C", -95.1)]], { manual: true, admite: (puesto) => puesto === 3 });
    const x = ruta("Beto", [[p("X", -95.25)]]);
    const plan = planDeSoltar([r, x], "X", { tipo: "nombre", ruta: "Ana" }, INICIO);
    expect(plan.ok && plan.ids).toEqual(["A", "B", "C", "X"]);
    const libre = planDeSoltar([ruta("Ana", [[p("A", -95.3), p("B", -95.2), p("C", -95.1)]], { manual: true }), x], "X", { tipo: "nombre", ruta: "Ana" }, INICIO);
    expect(libre.ok && libre.ids).not.toEqual(["A", "B", "C", "X"]);
  });

  it("soltar donde ya estaba no es un movimiento", () => {
    const r = ruta("Ana", [[p("A", -95.3), p("B", -95.2)]]);
    expect(planDeSoltar([r], "B", { tipo: "hueco", ruta: "Ana", viaje: 0, puesto: 1 }, INICIO)).toEqual({ ok: false, motivo: "sin_cambio" });
  });
});

describe("soltar en otro chofer", () => {
  const ana = () => ruta("Ana", [[p("A", -95.3), p("B", -95.2)]]);
  const beto = () => ruta("Beto", [[p("X", -95.25), p("Y", -95.15)]]);

  it("la parada cambia de chofer con su puesto: se le escribe `assigned_driver`, `route_seq` y `load_no`, y la ruta de llegada entera", () => {
    const plan = planDeSoltar([ana(), beto()], "B", { tipo: "hueco", ruta: "Beto", viaje: 0, puesto: 1 }, INICIO);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.origen).toBe("Ana");
    expect(plan.destino).toBe("Beto");
    expect(plan.ids).toEqual(["X", "B", "Y"]);
    expect(plan.parcheDeLaMovida).toEqual({ assigned_driver: "Beto", route_seq: 1, load_no: null });
    expect(plan.despues.B.assigned_driver).toBe("Beto");
    // La ruta de salida no se reescribe: A se queda como estaba.
    expect(plan.despues.A).toEqual(plan.antes.A);
    // La foto cubre las dos rutas (para deshacer y para ver si alguien las tocó).
    expect(Object.keys(plan.antes).sort()).toEqual(["A", "B", "X", "Y"]);
  });

  it("a una ruta vacía: viaje 1, parada 1", () => {
    const plan = planDeSoltar([ana(), ruta("Vacia", [])], "A", { tipo: "hueco", ruta: "Vacia", viaje: 0, puesto: 0 }, INICIO);
    expect(plan.ok && plan.ids).toEqual(["A"]);
    expect(plan.ok && plan.parcheDeLaMovida).toEqual({ assigned_driver: "Vacia", route_seq: 0, load_no: null });
  });

  it("desde un viaje puesto a mano a una ruta que parte sola, la parada pierde su `load_no` (si no, la ruta pasaría a «a mano»)", () => {
    const origen = ruta("Ana", [[p("A", -95.3)], [p("B", -95.2, { load_no: 2 })]], { manual: true });
    const plan = planDeSoltar([origen, beto()], "B", { tipo: "hueco", ruta: "Beto", viaje: 0, puesto: 0 }, INICIO);
    expect(plan.ok && plan.parcheDeLaMovida.load_no).toBeNull();
    expect(plan.ok && plan.despues.B.load_no).toBeNull();
  });

  it("soltar sobre el NOMBRE usa «📍 Mejor lugar»: el mismo hueco que `mejorLugar` sobre la ruta sin ella", () => {
    const b = beto();
    const plan = planDeSoltar([ana(), b], "A", { tipo: "nombre", ruta: "Beto" }, INICIO);
    const directo = mejorLugar({ viajes: b.viajes, nueva: ana().viajes[0][0], base: BASE, capacidad: 12, inicioMin: INICIO });
    expect(plan.ok && directo.ok).toBe(true);
    if (!plan.ok || !directo.ok) return;
    expect(plan.porNombre).toBe(true);
    expect([plan.viaje, plan.puesto]).toEqual([directo.hueco.viaje, directo.hueco.puesto]);
    // A (-95.3) queda antes de X (-95.25), el hueco más barato.
    expect(plan.ids).toEqual(["A", "X", "Y"]);
  });

  it("sobre el nombre, una parada sin pin no se coloca: lo dice", () => {
    const sinPin = ruta("Ana", [[p("A", -95.3, { lat: null, lng: null })]]);
    expect(planDeSoltar([sinPin, beto()], "A", { tipo: "nombre", ruta: "Beto" }, INICIO)).toEqual({ ok: false, motivo: "sin_punto" });
  });
});

describe("el candado 🔒", () => {
  it("arrastrar a mano se deja (como las flechas, D-411); soltar en el nombre (Mejor lugar, automático) no", () => {
    expect(candadoDeja({ bloqueada: true }, "arrastrar_desde")).toBe(true);
    expect(candadoDeja({ bloqueada: true }, "soltar_en_hueco")).toBe(true);
    expect(candadoDeja({ bloqueada: true }, "soltar_en_nombre")).toBe(false);
    expect(candadoDeja({ bloqueada: false }, "soltar_en_nombre")).toBe(true);
  });
  it("una ruta bloqueada no acepta «Mejor lugar» por arrastre, y sí un hueco elegido a mano", () => {
    const ana = ruta("Ana", [[p("A", -95.3)]]);
    const beto = ruta("Beto", [[p("X", -95.25)]], { bloqueada: true });
    expect(planDeSoltar([ana, beto], "A", { tipo: "nombre", ruta: "Beto" }, INICIO)).toEqual({ ok: false, motivo: "bloqueada" });
    expect(planDeSoltar([ana, beto], "A", { tipo: "hueco", ruta: "Beto", viaje: 0, puesto: 1 }, INICIO).ok).toBe(true);
  });
});

describe("la vista previa", () => {
  it("millas de más = coste de la ruta después menos antes (la estimación de «Mejor lugar»)", () => {
    const r = ruta("Ana", [[p("A", -95.3), p("B", -95.2), p("C", -95.1)]]);
    const plan = planDeSoltar([r], "C", { tipo: "hueco", ruta: "Ana", viaje: 0, puesto: 0 }, INICIO);
    if (!plan.ok) throw new Error("no");
    const antes = costeDeLaRuta(r.viajes, BASE, INICIO).millas;
    const despues = costeDeLaRuta([[r.viajes[0][2], r.viajes[0][0], r.viajes[0][1]]], BASE, INICIO).millas;
    expect(plan.previa.millasExtra).toBeCloseTo(despues - antes, 6);
    expect(plan.previa.millasExtra).toBeGreaterThan(1);
  });

  it("entre dos choferes cuenta las dos rutas: lo que se ahorra una y lo que gana la otra", () => {
    const ana = ruta("Ana", [[p("A", -95.3), p("B", -95.0)]]);
    const beto = ruta("Beto", [[p("X", -95.35)]]);
    const plan = planDeSoltar([ana, beto], "B", { tipo: "hueco", ruta: "Beto", viaje: 0, puesto: 1 }, INICIO);
    if (!plan.ok) throw new Error("no");
    const c = (vs: ParadaDelGantt[][]) => costeDeLaRuta(vs, BASE, INICIO).millas;
    const esperado = (c([[beto.viajes[0][0], ana.viajes[0][1]]]) - c(beto.viajes as ParadaDelGantt[][])) + (c([[ana.viajes[0][0]]]) - c(ana.viajes as ParadaDelGantt[][]));
    expect(plan.previa.millasExtra).toBeCloseTo(esperado, 6);
  });

  it("avisa de la ventana que rompe ANTES de soltar: la parada que llega tarde sale en `rotas` y en el texto", () => {
    // B tiene ventana 08:00-08:30; ponerla detrás de C la hace llegar tarde.
    const r = ruta("Ana", [[p("A", -95.3), p("B", -95.2, { ventana: [480, 510] }), p("C", -95.0)]]);
    const plan = planDeSoltar([r], "B", { tipo: "hueco", ruta: "Ana", viaje: 0, puesto: 2 }, INICIO);
    if (!plan.ok) throw new Error("no");
    expect(plan.previa.rotas).toEqual(["B"]);
    expect(plan.previa.tardeExtraMin).toBeGreaterThan(0);
    const texto = textoDePrevia(plan.previa, (id) => `N${id}`);
    expect(texto.es).toContain("⚠ rompe la ventana de #NB");
    expect(texto.en).toContain("breaks the window of #NB");
  });

  it("sin ventanas que se rompan, no hay aviso", () => {
    const r = ruta("Ana", [[p("A", -95.3), p("B", -95.2)]]);
    const plan = planDeSoltar([r], "B", { tipo: "hueco", ruta: "Ana", viaje: 0, puesto: 0 }, INICIO);
    if (!plan.ok) throw new Error("no");
    expect(plan.previa.rotas).toEqual([]);
    expect(textoDePrevia(plan.previa, (id) => id).es).not.toContain("⚠");
  });
});

describe("partir por capacidad", () => {
  it("es lo mismo que `splitIntoTrips` (la que usa la pantalla), en 300 rutas inventadas", () => {
    let semilla = 7;
    const azar = () => { semilla = (semilla * 16807) % 2147483647; return semilla / 2147483647; };
    for (let n = 0; n < 300; n++) {
      const paradas = Array.from({ length: 1 + Math.floor(azar() * 9) }, (_, i) => ({ id: `s${i}`, pallets: Math.floor(azar() * 8) }));
      const cap = 4 + Math.floor(azar() * 10);
      const deVerdad = splitIntoTrips(paradas.map((x) => ({ id: x.id, est_pallets: x.pallets }) as unknown as Delivery), cap);
      expect(ids(partePorCapacidad(paradas, cap))).toEqual(ids(deVerdad));
    }
  });
  it("sin la parada que se arrastra, un viaje vacío desaparece", () => {
    expect(ids(viajesSinLaMovida([[{ id: "A" }], [{ id: "B" }]], "A"))).toEqual([["B"]]);
  });
});

describe("la línea de tiempo", () => {
  it("cada barra va a la llegada estimada de `costeDeLaRuta`, con su descarga, y marca lo tarde", () => {
    const viajes = [[p("A", -95.3), p("B", -95.2, { ventana: [480, 490] })]];
    const barras = barrasDeLaRuta(viajes, BASE, INICIO);
    const c = costeDeLaRuta(viajes, BASE, INICIO);
    expect(barras.map((b) => b.llegadaMin)).toEqual([c.llegadas.get("A"), c.llegadas.get("B")]);
    expect(barras[0].finMin).toBe(barras[0].llegadaMin + 15);
    expect(barras[1].tardeMin).toBeGreaterThan(0);
    expect(barras[0].tardeMin).toBe(0);
  });

  it("los huecos se cuentan SIN la parada que se arrastra, y en el sitio donde se ven", () => {
    const barras = barrasDeLaRuta([[p("A", -95.3), p("B", -95.2), p("C", -95.1)]], BASE, INICIO);
    const huecos = huecosDeLaFila(barras, "B", INICIO);
    expect(huecos.map((h) => [h.viaje, h.puesto])).toEqual([[0, 0], [0, 1], [0, 2]]);
    // El de en medio queda entre el fin de A y la llegada de C, tal como están pintadas.
    expect(huecos[1].min).toBeCloseTo((barras[0].finMin + barras[2].llegadaMin) / 2, 6);
    expect(huecos[0].min).toBeLessThan(barras[0].llegadaMin);
    expect(huecos[2].min).toBeGreaterThan(barras[2].finMin);
  });

  it("si la parada iba sola en su viaje, ese viaje no ofrece hueco y los de detrás se renumeran", () => {
    const barras = barrasDeLaRuta([[p("A", -95.3)], [p("B", -95.2)], [p("C", -95.1)]], BASE, INICIO);
    expect(huecosDeLaFila(barras, "B", INICIO).map((h) => [h.viaje, h.puesto])).toEqual([[0, 0], [0, 1], [1, 0], [1, 1]]);
  });

  it("una fila vacía tiene un hueco, a la hora de salida", () => {
    expect(huecosDeLaFila([], "X", INICIO)).toEqual([{ viaje: 0, puesto: 0, min: INICIO }]);
  });

  it("el hueco más cercano al puntero; a igual distancia, el primero", () => {
    const hs = [{ viaje: 0, puesto: 0, min: 500 }, { viaje: 0, puesto: 1, min: 600 }, { viaje: 0, puesto: 2, min: 700 }];
    expect(huecoMasCercano(hs, 640)).toBe(hs[1]);
    expect(huecoMasCercano(hs, 690)).toBe(hs[2]);
    expect(huecoMasCercano(hs, 550)).toBe(hs[0]);
    expect(huecoMasCercano([], 550)).toBeNull();
  });
});

describe("deshacer y rehacer", () => {
  const antes: Foto = { A: { assigned_driver: "Ana", route_seq: null, load_no: null }, B: { assigned_driver: "Ana", route_seq: null, load_no: null } };
  const despues: Foto = { A: { assigned_driver: "Ana", route_seq: 1, load_no: null }, B: { assigned_driver: "Ana", route_seq: 0, load_no: null } };
  const mov = (extra: Partial<Movimiento> = {}): Movimiento => ({
    etiqueta: { en: "B up", es: "B arriba" }, rutas: ["Ana"], antes, despues, sellos: { A: "t1", B: "t1" }, ...extra,
  });
  const filas = (f: Foto, sello = "t1"): FilaFresca[] => Object.entries(f).map(([id, e]) => ({ id, ...e, updated_at: sello }));

  it("un movimiento nuevo entra en «deshacer» y vacía «rehacer»; se guardan los últimos 50", () => {
    let h = { deshacer: [], rehacer: [mov()] } as typeof HISTORIAL_VACIO;
    h = anota(h, mov());
    expect(h.rehacer).toEqual([]);
    expect(h.deshacer).toHaveLength(1);
    for (let i = 0; i < 60; i++) h = anota(h, mov({ etiqueta: { en: `${i}`, es: `${i}` } }));
    expect(h.deshacer).toHaveLength(TOPE_DEL_HISTORIAL);
    expect(h.deshacer[TOPE_DEL_HISTORIAL - 1].etiqueta.en).toBe("59");
  });

  it("sin cambios de nadie, se puede deshacer", () => {
    expect(choquesAlVolver(mov(), "deshacer", filas(despues), { Ana: ["A", "B"] })).toEqual([]);
  });

  it("si otra persona movió una parada después, NO se deshace (cambio)", () => {
    const otra = { ...despues, A: { ...despues.A, route_seq: 5 } };
    expect(choquesAlVolver(mov(), "deshacer", filas(otra), { Ana: ["A", "B"] })).toEqual([{ id: "A", motivo: "cambio" }]);
  });

  it("si otra persona editó la orden (su `updated_at` cambió), NO se deshace aunque los campos de ruta coincidan", () => {
    const f = filas(despues);
    f[1] = { ...f[1], updated_at: "t2" };
    expect(choquesAlVolver(mov(), "deshacer", f, { Ana: ["A", "B"] })).toEqual([{ id: "B", motivo: "editada" }]);
  });

  it("si una parada ya no está (borrada o sin permiso), NO se deshace", () => {
    expect(choquesAlVolver(mov(), "deshacer", filas({ A: despues.A }), { Ana: ["A"] })).toEqual([{ id: "B", motivo: "ya_no_esta" }]);
  });

  it("si entró otra parada en la ruta, NO se deshace (su secuencia chocaría con la vuelta)", () => {
    expect(choquesAlVolver(mov(), "deshacer", filas(despues), { Ana: ["A", "B", "Z"] })).toEqual([{ id: "Z", motivo: "entro_otra" }]);
  });

  it("rehacer compara con la foto de ANTES (lo que dejó el deshacer)", () => {
    expect(choquesAlVolver(mov(), "rehacer", filas(antes), { Ana: ["A", "B"] })).toEqual([]);
    expect(choquesAlVolver(mov(), "rehacer", filas(despues), { Ana: ["A", "B"] }).map((c) => c.motivo)).toEqual(["cambio", "cambio"]);
  });

  it("D-443: la recogida (`pickup_seq`) va en la foto — deshacer la devuelve, y si otro la movió, choca", () => {
    const a = { A: { assigned_driver: "Ana", route_seq: 0, load_no: null, pickup_seq: -0.5 } };
    const d = { A: { assigned_driver: "Ana", route_seq: 0, load_no: null, pickup_seq: 0.5 } };
    expect(escriturasHacia(a, d)).toEqual([{ id: "A", parche: { pickup_seq: -0.5 } }]);
    // La base la devuelve `numeric`: -0.5 y "-0.5000" son lo mismo.
    expect(escriturasHacia(a, fotoDeFilas([{ id: "A", assigned_driver: "Ana", route_seq: 0, load_no: null, pickup_seq: "-0.5000" as unknown as number }]))).toEqual([]);
    const m = { etiqueta: { en: "", es: "" }, rutas: ["Ana"], antes: a, despues: d, sellos: null };
    expect(choquesAlVolver(m, "deshacer", [{ id: "A", assigned_driver: "Ana", route_seq: 0, load_no: null, pickup_seq: 0.25 }], { Ana: ["A"] })).toEqual([{ id: "A", motivo: "cambio" }]);
    // Sin la columna (154) ninguna foto la lleva: no se escribe (escribirla fallaría) y no choca.
    const sinColumna = { A: { assigned_driver: "Ana", route_seq: 0, load_no: null } };
    expect(escriturasHacia(sinColumna, { A: { ...sinColumna.A, route_seq: 1 } })).toEqual([{ id: "A", parche: { route_seq: 0 } }]);
    // Y la foto de después de guardar la lleva, si se da.
    expect(fotoTrasReordenar({}, ["X"], { X: null }, 2, { X: 1.5 })).toEqual({ X: { assigned_driver: null, route_seq: 2, load_no: null, pickup_seq: 1.5 } });
  });

  it("deshacer escribe solo lo que difiere, y devuelve la secuencia a `null` si era `null` (reorderStops no podría)", () => {
    expect(escriturasHacia(antes, despues)).toEqual([
      { id: "A", parche: { route_seq: null } },
      { id: "B", parche: { route_seq: null } },
    ]);
    expect(escriturasHacia(antes, antes)).toEqual([]);
  });

  it("devolver una parada a su chofer escribe `assigned_driver`, `route_seq` y `load_no`", () => {
    const a: Foto = { B: { assigned_driver: "Ana", route_seq: 1, load_no: 2 } };
    const d: Foto = { B: { assigned_driver: "Beto", route_seq: 0, load_no: null } };
    expect(escriturasHacia(a, d)).toEqual([{ id: "B", parche: { assigned_driver: "Ana", route_seq: 1, load_no: 2 } }]);
  });

  it("de ida y vuelta: soltar, deshacer y rehacer dejan la base exactamente en cada foto", () => {
    const ana = ruta("Ana", [[p("A", -95.3), p("B", -95.2, { load_no: null })]]);
    const beto = ruta("Beto", [[p("X", -95.25)]]);
    const plan = planDeSoltar([ana, beto], "B", { tipo: "hueco", ruta: "Beto", viaje: 0, puesto: 0 }, INICIO);
    if (!plan.ok) throw new Error("no");
    // Una «base» de mentira: aplicar lo que escribe la pantalla al soltar.
    let base: Foto = fotoDe([...ana.viajes.flat(), ...beto.viajes.flat()]);
    base = { ...base, B: { ...base.B, ...plan.parcheDeLaMovida } };
    base = fotoTrasReordenar(base, plan.ids, plan.loadNoById);
    expect(base).toEqual(plan.despues);
    for (const e of escriturasHacia(plan.antes, base)) base = { ...base, [e.id]: { ...base[e.id], ...e.parche } };
    expect(base).toEqual(plan.antes);
    for (const e of escriturasHacia(plan.despues, base)) base = { ...base, [e.id]: { ...base[e.id], ...e.parche } };
    expect(base).toEqual(plan.despues);
  });

  it("tras deshacer, el movimiento pasa a «rehacer» con los sellos nuevos; tras un choque, sale de su pila", () => {
    const h = anota(HISTORIAL_VACIO, mov());
    const d = trasVolver(h, "deshacer", { A: "t9" });
    expect(d.deshacer).toEqual([]);
    expect(d.rehacer[0].sellos).toEqual({ A: "t9" });
    const r = trasVolver(d, "rehacer", { A: "t10" });
    expect(r.deshacer[0].sellos).toEqual({ A: "t10" });
    expect(r.rehacer).toEqual([]);
    expect(descartaElDeArriba(anota(anota(HISTORIAL_VACIO, mov()), mov({ rutas: ["Beto"] })), "deshacer").deshacer.map((m) => m.rutas)).toEqual([["Ana"]]);
  });

  it("lo leído se convierte en foto y en sellos; sin lectura, sin sellos", () => {
    const f = filas(despues, "t3");
    expect(fotoDeFilas(f)).toEqual(despues);
    expect(sellosDe(f)).toEqual({ A: "t3", B: "t3" });
    expect(sellosDe(null)).toBeNull();
  });

  it("el aviso de choque dice qué parada y que no se escribió nada", () => {
    const a = textoDeChoques([{ id: "A", motivo: "cambio" }, { id: "Z", motivo: "entro_otra" }], (id) => `N${id}`, "deshacer");
    expect(a.es).toContain("No se deshizo: alguien cambió #NA, #NZ");
    expect(a.es).toContain("No se escribió nada");
    expect(textoDeChoques([{ id: "A", motivo: "cambio" }], (id) => id, "rehacer").es).toContain("No se rehízo");
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// La pantalla usa estas funciones (y no otras): se lee el fuente.

const pagina = readFileSync(join(__dirname, "..", "app", "(app)", "routes", "page.tsx"), "utf8").replace(/\r\n/g, "\n");
const gantt = readFileSync(join(__dirname, "..", "components", "GanttTimeline.tsx"), "utf8").replace(/\r\n/g, "\n");
const cuerpoDe = (fuente: string, desde: string, hasta: string) => {
  const i = fuente.indexOf(desde);
  expect(i).toBeGreaterThan(-1);
  const j = fuente.indexOf(hasta, i + desde.length);
  expect(j).toBeGreaterThan(i);
  return fuente.slice(i, j);
};

describe("la pantalla: el Gestor", () => {
  const rutas = cuerpoDe(pagina, "const rutasDelGantt: RutaDelGantt[] = lanes.map((l) => {", "const ganttRows: GanttRow[]");
  const soltar = cuerpoDe(pagina, "const sueltaEnLaLinea = async", "\n  };\n");
  const volver = cuerpoDe(pagina, "const vuelve = async (dir: Direccion) => {", "\n  };\n");
  const flechas = cuerpoDe(pagina, "const guardaLaLista = async (", "\n  };\n");

  it("las rutas del arrastre son la LISTA que pinta la tabla (D-443: sus entregas, como un solo viaje), con su capacidad, lo que cabe y su candado", () => {
    expect(rutas).toContain("const lista = lecturaDe(l.key, stops).paradas;");
    expect(rutas).toContain("viajes: [entregasDeLaLista(lista, stops).map(aParadaDelGantt)], manual: true,");
    expect(rutas).toContain("const capacidad = capacityFor(driverOf(l.key));");
    expect(rutas).toContain("admite: admiteEnLaLista(lista, stops, capacidad), bloqueada: bloqueada(l.key), base: baseDeLaRuta(l.key)");
  });
  it("la línea pinta las barras de `barrasDeLaRuta` con la misma hora de salida que «Mejor lugar»", () => {
    expect(pagina).toContain("barras: barrasDeLaRuta(r.viajes, r.base, DAY_START_MIN), bloqueada: r.bloqueada,");
  });
  it("la vista previa y lo que se escribe salen del MISMO `planDeSoltar`", () => {
    expect(pagina).toContain("const previaDeSoltar = (movida: string, destino: Destino) => planDeSoltar(rutasDelGantt, movida, destino, DAY_START_MIN);");
    expect(soltar).toContain("const plan = previaDeSoltar(movida, destino);");
  });
  it("al soltar escribe lo que las flechas: la parada que cambia de chofer, y la secuencia entera con `reorderStops` — con la posición de cada recogida (D-443)", () => {
    expect(soltar).toContain("const lista = listaConEntregasEn(lecturaDe(plan.destino, suyas).paradas, plan.ids, conLaMovida);");
    expect(soltar).toContain("const recogidas = hayRecogidaGuardada ? escrituraDeLaLista(lista, 0).pickupSeqById : undefined;");
    expect(soltar).toContain("if (!(await updateDelivery(movida, { ...plan.parcheDeLaMovida, ...(recogidas ? { pickup_seq: recogidas[movida] ?? null } : {}) }))) return;");
    expect(soltar).toContain("if (!(await reorderStops(plan.ids, plan.loadNoById, undefined, 0, recogidas))) return;");
    expect(soltar.indexOf("if (plan.origen !== plan.destino) {")).toBeLessThan(soltar.indexOf("updateDelivery(movida"));
  });
  it("al soltar queda en el historial, con las dos rutas si cambió de chofer, y la foto lleva las recogidas", () => {
    expect(soltar).toContain("if (recogidas) for (const id of plan.ids) despues[id] = { ...despues[id], pickup_seq: recogidas[id] ?? null };");
    expect(soltar).toContain("plan.origen === plan.destino ? [plan.destino] : [plan.origen, plan.destino], plan.antes, despues);");
  });
  it("no reoptimiza ni llama a nadie de pago", () => {
    for (const c of [soltar, volver]) {
      expect(c).not.toContain("computeRoute(");
      expect(c).not.toContain("/api/optimize-route");
    }
  });
  it("deshacer LEE lo que hay ahora antes de escribir, y con un choque no escribe", () => {
    const lee = volver.indexOf("const filas = await leeFilasFrescas(ids);");
    const choque = volver.indexOf("const choques = choquesAlVolver(m, dir, filas, miembros);");
    const escribe = volver.indexOf("updateDelivery(");
    expect(lee).toBeGreaterThan(-1);
    expect(choque).toBeGreaterThan(lee);
    expect(escribe).toBeGreaterThan(choque);
    expect(volver.slice(choque, escribe)).toContain("if (choques.length) {");
    expect(volver.slice(choque, escribe)).toContain("return;");
  });
  it("las rutas del choque son las que la pantalla tiene hoy", () => {
    expect(volver).toContain("const miembros = Object.fromEntries(m.rutas.map((r) => [r, (byDriver.get(r) ?? []).map((d) => d.id)]));");
  });
  it("deshacer escribe con `escriturasHacia` y guarda los sellos nuevos", () => {
    expect(volver).toContain("for (const e of escriturasHacia(objetivo, fotoDeFilas(filas))) {");
    expect(volver).toContain("setHistorial((h) => trasVolver(h, dir, sellos));");
  });
  it("con base, lo de ahora se lee de la BASE con su `updated_at` (y la recogida, si la base la guarda: 154)", () => {
    expect(pagina).toContain('.from("deliveries").select(`id, assigned_driver, route_seq, load_no, updated_at${hayRecogidaGuardada ? ", pickup_seq" : ""}`).in("id", ids);');
  });
  it("las flechas también entran en el historial, con la foto de lo que escribieron", () => {
    // D-433: numeradas tras lo ya hecho del chofer (`desde`), y la foto con el mismo `desde` (y las recogidas, D-443).
    expect(flechas).toContain("const ok = await reorderStops(e.ids, e.loadNoById, undefined, desde, recogidas);");
    // D-456: la foto cuenta también las que llegan arrastradas de otra ruta (y lo que queda en la ruta de la que salen).
    expect(flechas).toContain("const antes = fotoDe([...stops, ...quedanEnOrigen].map(aParadaDelGantt));");
    expect(flechas).toContain("const despues = fotoTrasReordenar(antes, e.ids, e.loadNoById, desde, recogidas);");
    expect(flechas).toContain("await anotaMovimiento(etiqueta, [laneKey, ...origenes], antes, despues);");
  });
  it("Ctrl+Z deshace y Ctrl+Y / Ctrl+Mayús+Z rehacen, salvo escribiendo en un campo", () => {
    expect(pagina).toContain('if (k === "z" && !e.shiftKey) { e.preventDefault(); void vuelveRef.current("deshacer"); }');
    expect(pagina).toContain('else if (k === "y" || (k === "z" && e.shiftKey)) { e.preventDefault(); void vuelveRef.current("rehacer"); }');
    expect(pagina).toContain('if (el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))) return;');
  });
  it("hay botones de deshacer y rehacer", () => {
    expect(pagina).toContain('data-deshacer disabled={moviendo || !historial.deshacer.length} onClick={() => void vuelve("deshacer")}');
    expect(pagina).toContain('data-rehacer disabled={moviendo || !historial.rehacer.length} onClick={() => void vuelve("rehacer")}');
  });
  it("el historial es del día que se mira: cambiar de día lo vacía", () => {
    expect(pagina).toContain("useEffect(() => { setHistorial(HISTORIAL_VACIO); }, [date]);");
  });
  it("solo se arrastra viendo UN día (no en «Todas» ni en pendientes)", () => {
    expect(pagina).toContain('arrastre={modo === "dia" ? { inicioMin: DAY_START_MIN, previa: previaDeSoltar, suelta: (id, destino) => void sueltaEnLaLinea(id, destino), ocupado: moviendo } : undefined}');
  });
});

describe("la pantalla: la línea de tiempo", () => {
  it("el hueco bajo el puntero sale de `huecosDeLaFila` SIN la parada arrastrada, y de `huecoMasCercano`", () => {
    expect(gantt).toContain("const h = huecoMasCercano(huecosDeLaFila(r.barras, id, arrastre.inicioMin), min);");
  });
  it("soltar en el nombre es «Mejor lugar»", () => {
    expect(gantt).toContain('const destino: Destino = { tipo: "nombre", ruta: r.key };');
  });
  it("con eventos de puntero (ratón y dedo), capturando el puntero, y con umbral para no confundir un toque", () => {
    expect(gantt).toContain("e.currentTarget.setPointerCapture(e.pointerId);");
    expect(gantt).toContain("onPointerDown={puedeArrastrar ? (e) => alBajar(e, b.id) : undefined}");
    expect(gantt).toContain("Math.hypot(e.clientX - arr.x0, e.clientY - arr.y0) > UMBRAL_PX");
  });
  it("solo suelta si el plan dice que se puede", () => {
    expect(gantt).toContain("if (arr?.activo && objetivo?.plan.ok && arrastre) arrastre.suelta(arr.id, objetivo.destino);");
  });
  it("en el teléfono no se arrastra, y lo dice", () => {
    expect(gantt).toContain('const SOLO_FLECHAS = "(max-width: 760px)";');
    expect(gantt).toContain("const puedeArrastrar = !!arrastre && !estrecho && !arrastre.ocupado;");
    expect(gantt).toContain("data-gantt-solo-flechas");
  });
  it("Escape cancela el arrastre", () => {
    expect(gantt).toContain('if (e.key === "Escape") cancela();');
  });
  it("la vista previa marca en rojo si rompe una ventana", () => {
    expect(gantt).toContain("return { texto: `${cabeza} · ${t(p.en, p.es)}`, mal: o.plan.previa.rotas.length > 0 };");
  });
});
