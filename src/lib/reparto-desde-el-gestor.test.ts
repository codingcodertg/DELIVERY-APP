import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ajustesConBaseDelPerfil, choferesParaRepartir, etiquetaDelReparto, forzaLasQueNoCaben, listaDeLasParadas, matrizDelGestor, mensajeDelRepartoHecho, movimientosDelReparto,
  paradasDeLaLista, puntosDelReparto, resumenDelReparto, textoDeNoRepartir, tramoEstimado, type OrdenForzada,
} from "./reparto-desde-el-gestor";
import { proveedorEstimado } from "./route-times/proveedores";
import { claveDePunto } from "./route-times/claves";
import { demoSettings } from "./demo-data";
import { PARAMETROS_POR_DEFECTO, type ChoferEntrada, type Matriz, type OrdenEntrada, type ParadaRef, type PeticionDeReparto, type Plan, type Reparto, type RutaEvaluada, type RutaRepartida, type SinAsignar } from "./route-engine";
import type { DriverSettings } from "./types";

/**
 * «Asignar a…» varios choferes desde el Gestor (D-474): lo que la pantalla pone alrededor de `reparteEntre`, y que la pantalla
 * lo USA (las pruebas se alimentan de quien llama). El dueño, 2026-10-06: «en routes manager quiero que puede select multiple
 * orders y asignarla a los ocnductos que yo elija asi como el autoassign».
 */

const leer = (ruta: string) => readFileSync(join(process.cwd(), ruta), "utf8").split("\r\n").join("\n");
const plano = (s: string) => s.replace(/\s+/g, " ");
const pagina = plano(leer("src/app/(app)/routes/page.tsx"));
const trozo = (desde: string, hasta: string, de = pagina) => {
  const i = de.indexOf(desde);
  expect(i, `no está: ${desde}`).toBeGreaterThan(-1);
  const j = de.indexOf(hasta, i + desde.length);
  expect(j, `no está: ${hasta}`).toBeGreaterThan(i);
  return de.slice(i, j);
};

const fila = (profile_id: string, base_store: string | null, extra: Partial<DriverSettings> = {}): DriverSettings =>
  ({ profile_id, base_store, capacity_pallets: 10, shift_start: "07:00", shift_end: "16:00", returns_to_base: true, routable: true, ...extra });

describe("los choferes, como los ve «Armar rutas» (y con la base del perfil si no tienen la de Ajustes, D-461)", () => {
  it("la fila de Ajustes manda; sin base en ella, la tienda del perfil; sin fila, una de partida con la tienda del perfil; sin nada, sin base", () => {
    const r = ajustesConBaseDelPerfil(
      [fila("a", "Norte"), fila("b", "  "), fila("d", null, { capacity_pallets: 7 })],
      [{ id: "a", store: "Sur" }, { id: "b", store: "Sur" }, { id: "c", store: "Este" }, { id: "d", store: null }],
    );
    expect(r.map((f) => [f.profile_id, f.base_store])).toEqual([["a", "Norte"], ["b", "Sur"], ["c", "Este"], ["d", null]]);
    expect(r[0]).toMatchObject({ capacity_pallets: 10, shift_start: "07:00" });
    expect(r[2]).toEqual({ profile_id: "c", base_store: "Este", capacity_pallets: null, shift_start: "", shift_end: "", returns_to_base: true, routable: true });
    expect(r[3].capacity_pallets).toBe(7);
  });
  it("se puede repartir con los que entran al motor; los de ruta bloqueada 🔒 y los que el motor dejó fuera salen apagados con su porqué; el no disponible sale marcado", () => {
    const dia = {
      entrada: { choferes: [{ id: "a", nombre: "Ana" }, { id: "b", nombre: "Beto" }] },
      choferesFuera: [{ id: "c", nombre: "Ceci", motivo: "base" as const }, { id: "d", nombre: "Dani", motivo: "no_rutea" as const }],
    };
    const r = choferesParaRepartir(dia as never, [
      { id: "d", full_name: "Dani" }, { id: "a", full_name: "Ana" }, { id: "b", full_name: "Beto" }, { id: "c", full_name: "Ceci" }, { id: "x", full_name: "Nadie" },
    ], (nombre) => nombre === "Beto", new Set(["Ana"]));
    expect(r).toEqual([
      { id: "d", nombre: "Dani", puede: false, motivo: "no_rutea", noDisponible: false },
      { id: "a", nombre: "Ana", puede: true, noDisponible: true },
      { id: "b", nombre: "Beto", puede: false, motivo: "ruta_bloqueada", noDisponible: false },
      { id: "c", nombre: "Ceci", puede: false, motivo: "base", noDisponible: false },
    ]);
  });
  it("cada porqué tiene su texto en los dos idiomas", () => {
    for (const m of ["no_rutea", "base", "base_sin_punto", "no_disponible", "ruta_bloqueada"] as const) {
      const t = textoDeNoRepartir(m);
      expect(t.en.length).toBeGreaterThan(0); expect(t.es.length).toBeGreaterThan(0); expect(t.en).not.toBe(t.es);
    }
    expect(textoDeNoRepartir("ruta_bloqueada").es).toContain("🔒");
  });
});

describe("los tiempos", () => {
  const puntos = { "tienda:n": { lat: 26.3, lng: -98.2 }, "orden:a": { lat: 26.31, lng: -98.21 }, "orden:b": { lat: 26.32, lng: -98.19 }, "orden:c": { lat: 26.3, lng: -98.2 } };
  it("los puntos que entran: las bases de los elegidos y la tienda y el pin de cada orden; sin punto, o sin coordenadas, no", () => {
    const r = puntosDelReparto({
      // La base de Beto («tienda:s») no es la tienda de ninguna orden: entra solo por ser base de un elegido.
      choferes: [{ base: "tienda:n" }, { base: "tienda:s" }, { base: "tienda:sin-coords" }] as never,
      ordenes: [{ origen: "tienda:n", destino: "orden:a" }, { origen: null, destino: "orden:b" }, { origen: "tienda:n", destino: null }] as never,
    }, { ...puntos, "tienda:s": { lat: 26.1, lng: -98.2 }, "orden:z": { lat: 1, lng: 1 } });
    expect(Object.keys(r).sort()).toEqual(["orden:a", "orden:b", "tienda:n", "tienda:s"]);
  });
  it("la matriz del motor sale de los tiempos por calles, por la clave lat,lng de cada punto; lo que falta se estima en línea recta como el motor, y se cuenta", async () => {
    const kn = claveDePunto(puntos["tienda:n"]), ka = claveDePunto(puntos["orden:a"]);
    const r = matrizDelGestor(puntos, { [kn]: { [ka]: { minutos: 7, millas: 2.5 } } });
    expect(r.matriz["tienda:n"]["orden:a"]).toEqual({ minutos: 7, millas: 2.5 });
    const est = await proveedorEstimado().tramo(puntos["orden:a"], puntos["tienda:n"]);
    expect(r.matriz["orden:a"]["tienda:n"]).toEqual(est);
    expect(r.matriz["orden:a"]["tienda:n"]).toEqual(tramoEstimado(puntos["orden:a"], puntos["tienda:n"]));
    // Dos puntos en el MISMO sitio (orden:c cae en la tienda): cero, y no cuentan como par.
    expect(r.matriz["tienda:n"]["orden:c"]).toEqual({ minutos: 0, millas: 0 });
    // 4 puntos → 12 pares, menos los 2 del mismo sitio = 10; por calles vinieron DOS (tienda→a, y c→a: c comparte clave con la tienda).
    expect(r.matriz["orden:c"]["orden:a"]).toEqual({ minutos: 7, millas: 2.5 });
    expect(r.pares).toBe(10);
    expect(r.estimados).toBe(8);
  });
  it("sin respuesta del servidor, todo estimado", () => {
    const r = matrizDelGestor(puntos, null);
    expect(r.estimados).toBe(r.pares);
    expect(r.matriz["orden:a"]["orden:b"].millas).toBeGreaterThan(0);
  });
});

describe("de la lista del Gestor al motor y de vuelta", () => {
  it("una fila P con varias órdenes son varias P del motor; una D, una D", () => {
    expect(paradasDeLaLista([{ tipo: "P", ordenes: ["a", "b"], tienda: "N" }, { tipo: "D", orden: "a" }, { tipo: "D", orden: "b" }]))
      .toEqual([{ orden: "a", tipo: "P" }, { orden: "b", tipo: "P" }, { orden: "a", tipo: "D" }, { orden: "b", tipo: "D" }]);
  });
  it("las paradas del motor vuelven como lista: cada recogida en su fila con su tienda; y lo obligatorio que el motor no vio, al final, sin repetir", () => {
    const lista = listaDeLasParadas([{ orden: "a", tipo: "P" }, { orden: "a", tipo: "D" }], (o) => (o === "a" ? "Norte" : "Sur"), ["a", "z"]);
    expect(lista).toEqual([{ tipo: "P", ordenes: ["a"], tienda: "Norte" }, { tipo: "D", orden: "a" }, { tipo: "P", ordenes: ["z"], tienda: "Sur" }, { tipo: "D", orden: "z" }]);
  });
  it("qué se mueve de ruta: solo lo que cambia de chofer, con de dónde sale («null» = sin asignar)", () => {
    const r = { rutas: [{ nombre: "Ana", nuevas: ["a", "b"] }, { nombre: "Beto", nuevas: ["c"] }] } as unknown as Reparto;
    const rutaDe = (o: string) => ({ a: "Ana", b: null, c: "Ceci" } as Record<string, string | null>)[o];
    expect(movimientosDelReparto(r, rutaDe)).toEqual([{ orden: "b", de: null, a: "Ana" }, { orden: "c", de: "Ceci", a: "Beto" }]);
  });
});

describe("el resumen antes de confirmar", () => {
  const ruta = (millas: number, duracionMin: number, tardeMin = 0): RutaEvaluada => ({ chofer: "", paradas: [], inicio: 480, fin: 480 + duracionMin, duracionMin, manejoMin: 0, millas, tardeMin, builderMin: 0, violaciones: [] });
  const r: Pick<Reparto, "rutas" | "sinAsignar" | "ignoradas"> & { forzadas: OrdenForzada[] } = {
    rutas: [
      { chofer: "a", nombre: "Ana", paradas: [{ orden: "x", tipo: "P" }, { orden: "x", tipo: "D" }, { orden: "a", tipo: "P" }, { orden: "a", tipo: "D" }, { orden: "b", tipo: "P" }, { orden: "b", tipo: "D" }], nuevas: ["a", "b"], ruta: ruta(52.34, 250) },
      // «d» no cabe en el turno de Beto con lo demás: el motor la dejó fuera, y se asigna igual, al final de su lista.
      { chofer: "b", nombre: "Beto", paradas: [{ orden: "c", tipo: "P" }, { orden: "c", tipo: "D" }, { orden: "d", tipo: "P" }, { orden: "d", tipo: "D" }], nuevas: ["c", "d"], ruta: ruta(20, 75, 12) },
    ],
    sinAsignar: [{ orden: "e", motivo: "falta_requisito", faltan: ["liftgate"] }],
    ignoradas: ["f"],
    forzadas: [{ orden: "d", chofer: "b", nombre: "Beto", motivo: "supera_capacidad" }],
  };
  const nombreDe = (o: string) => `#${o}`;
  it("cuántas a cada quien y cómo queda su ruta (órdenes, millas, horas, retraso); lo que se mueve de otra ruta; lo que pasa el límite con su porqué; lo que no cabe; y con qué se midió", () => {
    const s = resumenDelReparto({ r, nombreDe, movimientos: [{ orden: "a", de: null, a: "Ana" }, { orden: "c", de: "Ceci", a: "Beto" }], medida: { estimados: 3, pares: 20 }, totalSeleccionadas: 6 });
    expect(s.es).toBe([
      "🧭 ¿Repartir 4 órdenes entre 2 choferes? Cada una va en el mejor lugar de la ruta de ese chofer:",
      "• Ana: 2 nuevas, 3 órdenes en total · 52.3 mi · 4 h 10 min",
      "• Beto: 2 nuevas, 2 órdenes en total · 20.0 mi · 1 h 15 min · ⚠ 12 min tarde",
      "Se mueven de otra ruta: #c (Ceci → Beto).",
      "⚠ 1 asignada pasando el límite (revisa la ruta): #d (mayor que el camión).",
      "⚠ 2 no caben y se quedan donde están: #e (el camión no tiene lo que pide), #f (no está en la lista de este día).",
      "⚠ Medido en línea recta (estimado): 3 de 20 tramos sin tiempos por calles.",
    ].join("\n"));
    expect(s.en).toContain("• Ana: 2 new, 3 orders in total · 52.3 mi · 4 h 10 min");
    expect(s.en.startsWith("🧭 Assign 4 orders among 2 drivers? Each one goes in the best place of that driver's route:")).toBe(true);
    // D-1139: con UN solo chofer la cabecera lo nombra («Three orders, one driver» no se entendía).
    const uno = resumenDelReparto({ r: { rutas: [r.rutas[0]], sinAsignar: [], ignoradas: [], forzadas: [] }, nombreDe, movimientos: [], medida: { estimados: 0, pares: 20 }, totalSeleccionadas: 2 });
    expect(uno.en.split("\n")[0]).toBe("🧭 Assign 2 orders to Ana? Each one goes in the best place of its route:");
    expect(uno.es.split("\n")[0]).toBe("🧭 ¿Asignar 2 órdenes a Ana? Cada una va en el mejor lugar de su ruta:");
    expect(s.en).toContain("Moved from another route: #c (Ceci → Beto).");
    expect(s.en).toContain("1 assigned over the limit (check the route): #d (larger than the truck).");
    expect(s.en).toContain("2 don't fit and stay where they are");
    expect(s.en).toContain("Measured in a straight line");
  });
  it("sin movidas, sin fuera y con todo por calles, solo las líneas de los choferes", () => {
    const s = resumenDelReparto({ r: { ...r, sinAsignar: [], ignoradas: [], forzadas: [] }, nombreDe, movimientos: [{ orden: "a", de: null, a: "Ana" }], medida: { estimados: 0, pares: 20 }, totalSeleccionadas: 3 });
    expect(s.es.split("\n")).toHaveLength(3);
    expect(s.es).not.toContain("⚠ Medido");
    expect(s.es).not.toContain("Se mueven");
  });
  it("si nada se puede asignar, la cabecera lo dice", () => {
    const s = resumenDelReparto({ r: { rutas: [{ ...r.rutas[0], nuevas: [] }], sinAsignar: [{ orden: "a", motivo: "sin_punto" }], ignoradas: [], forzadas: [] }, nombreDe, movimientos: [], medida: { estimados: 0, pares: 0 }, totalSeleccionadas: 1 });
    expect(s.es.startsWith("🧭 Ninguna de las 1 orden(es) seleccionadas se puede asignar.")).toBe(true);
    expect(s.es).toContain("#a (sin punto en el mapa)");
  });
  it("si lo seleccionado ya está con su chofer y nada se mueve, la cabecera no dice «ninguna»", () => {
    const s = resumenDelReparto({ r: { rutas: [{ ...r.rutas[0], nuevas: [] }], sinAsignar: [], ignoradas: [], forzadas: [] }, nombreDe, movimientos: [], medida: { estimados: 0, pares: 0 }, totalSeleccionadas: 2 });
    expect(s.en.startsWith("🧭 Nothing moves: 2 orders already with their driver.")).toBe(true);
    expect(s.en).not.toContain("None");
  });
  it("la etiqueta de deshacer es UNA para el lote", () => {
    expect(etiquetaDelReparto(4, ["Ana", "Beto"])).toEqual({ en: "Assign 4 order(s) to Ana, Beto", es: "Asignar 4 orden(es) a Ana, Beto" });
  });
});

describe("lo que el motor deja fuera y se asigna igual (2026-11-25)", () => {
  const nodos = ["tienda:n", "tienda:s", "orden:a", "orden:b", "orden:c", "orden:d"];
  const matriz: Matriz = Object.fromEntries(nodos.map((x) => [x, Object.fromEntries(nodos.filter((y) => y !== x).map((y) => [y, { minutos: 10, millas: 1 }]))]));
  const orden = (id: string, extra: Partial<OrdenEntrada> = {}): OrdenEntrada => ({
    id, codigo: id, entrada: "2026-11-25 0800", origen: "tienda:n", destino: `orden:${id}`, pallets: 1, ventana: null,
    servicioRecogidaMin: 5, servicioEntregaMin: 10, choferFijado: null, ...extra,
  });
  const chofer = (id: string, extra: Partial<ChoferEntrada> = {}): ChoferEntrada => ({ id, nombre: id.toUpperCase(), base: "tienda:n", capacidad: 10, entrada: 480, salida: 1050, vuelveABase: true, ...extra });
  const P = (o: string): ParadaRef => ({ orden: o, tipo: "P" });
  const D = (o: string): ParadaRef => ({ orden: o, tipo: "D" });
  const peticion = (over: Partial<PeticionDeReparto> = {}): PeticionDeReparto => ({
    entrada: { ordenes: [orden("a"), orden("b"), orden("c")], choferes: [chofer("ana"), chofer("beto")], matriz },
    parametros: PARAMETROS_POR_DEFECTO, seleccionadas: ["a", "b", "c"], elegidos: ["ana", "beto"], yaLlevan: {}, ...over,
  });
  const rutaCon = (chofer: string, duracionMin: number, paradas: ParadaRef[], nuevas: string[] = []): RutaRepartida => ({
    chofer, nombre: chofer.toUpperCase(), paradas, nuevas,
    ruta: { chofer, paradas: [], inicio: 480, fin: 480 + duracionMin, duracionMin, manejoMin: 0, millas: 0, tardeMin: 0, builderMin: 0, violaciones: [] },
  });
  const reparto = (rutas: RutaRepartida[], sinAsignar: SinAsignar[], ignoradas: string[] = []): Reparto => ({ rutas, sinAsignar, ignoradas, completo: false, plan: {} as Plan });

  it("sin nada que cumplir: va al elegido con menos minutos de ruta, al FINAL de su lista (recogida y entrega), y cuenta como asignada", () => {
    const f = forzaLasQueNoCaben(
      reparto([rutaCon("ana", 100, [P("c"), D("c")], []), rutaCon("beto", 0, [])], [{ orden: "a", motivo: "fuera_de_turno" }]),
      peticion({ seleccionadas: ["a"] }),
    );
    expect(f.forzadas).toEqual([{ orden: "a", chofer: "beto", nombre: "BETO", motivo: "fuera_de_turno" }]);
    expect(f.rutas.find((x) => x.chofer === "beto")).toMatchObject({ paradas: [P("a"), D("a")], nuevas: ["a"] });
    expect(f.rutas.find((x) => x.chofer === "ana")!.paradas).toEqual([P("c"), D("c")]);
    expect(f.sinAsignar).toEqual([]);
    expect(f.completo).toBe(true);
  });
  it("una orden que ya está con uno de los elegidos se queda con él, donde estaba (tras la parada que la precedía), y no cuenta como movida", () => {
    const sinPrecedente = forzaLasQueNoCaben(
      reparto([rutaCon("ana", 50, [P("c"), D("c")])], [{ orden: "b", motivo: "no_cabe_con_el_resto" }]),
      peticion({ seleccionadas: ["b", "c"], yaLlevan: { ana: [P("b"), D("b"), P("c"), D("c")] } }),
    );
    expect(sinPrecedente.rutas[0]).toMatchObject({ paradas: [P("b"), D("b"), P("c"), D("c")], nuevas: [] });
    expect(sinPrecedente.forzadas).toEqual([{ orden: "b", chofer: "ana", nombre: "ANA", motivo: "no_cabe_con_el_resto" }]);
    const conPrecedente = forzaLasQueNoCaben(
      reparto([rutaCon("ana", 50, [P("c"), D("c")])], [{ orden: "b", motivo: "no_cabe_con_el_resto" }]),
      peticion({ seleccionadas: ["b", "c"], yaLlevan: { ana: [P("c"), D("c"), P("b"), D("b")] } }),
    );
    expect(conPrecedente.rutas[0].paradas).toEqual([P("c"), D("c"), P("b"), D("b")]);
  });
  it("con varios elegidos, lo fuerza al que ya la lleva; si no la lleva ninguno, al de menos carga (en empate, el primero)", () => {
    const conLaSuya = forzaLasQueNoCaben(
      reparto([rutaCon("ana", 300, []), rutaCon("beto", 0, [])], [{ orden: "c", motivo: "supera_capacidad" }]),
      peticion({ seleccionadas: ["c"], yaLlevan: { ana: [P("c"), D("c")] } }),
    );
    expect(conLaSuya.forzadas[0]).toMatchObject({ chofer: "ana" });
    const empate = forzaLasQueNoCaben(
      reparto([rutaCon("ana", 40, []), rutaCon("beto", 40, [])], [{ orden: "a", motivo: "ventana_imposible" }]),
      peticion({ seleccionadas: ["a"] }),
    );
    expect(empate.forzadas[0]).toMatchObject({ chofer: "ana", motivo: "ventana_imposible" });
  });
  it("cada orden forzada suma a la carga de su chofer: la siguiente busca de nuevo al de menos", () => {
    const f = forzaLasQueNoCaben(
      reparto([rutaCon("ana", 0, []), rutaCon("beto", 0, [])], [{ orden: "a", motivo: "fuera_de_turno" }, { orden: "b", motivo: "fuera_de_turno" }]),
      peticion({ seleccionadas: ["a", "b"] }),
    );
    expect(f.forzadas.map((x) => x.chofer)).toEqual(["ana", "beto"]);
  });
  it("NO se fuerza a un chofer cuyo camión no tiene lo que pide la orden: va al que sí lo tiene, o queda fuera con el requisito que falta", () => {
    const pideLiftgate = (extra: Partial<ChoferEntrada>) => peticion({
      seleccionadas: ["a"],
      entrada: { ordenes: [orden("a", { requisitos: ["Liftgate"] })], choferes: [chofer("ana"), chofer("beto", extra)], matriz },
    });
    const conElQueLoTiene = forzaLasQueNoCaben(reparto([rutaCon("ana", 0, []), rutaCon("beto", 90, [])], [{ orden: "a", motivo: "no_cabe_con_el_resto" }]), pideLiftgate({ habilidades: ["liftgate"] }));
    expect(conElQueLoTiene.forzadas).toEqual([{ orden: "a", chofer: "beto", nombre: "BETO", motivo: "no_cabe_con_el_resto" }]);
    const nadie = forzaLasQueNoCaben(reparto([rutaCon("ana", 0, []), rutaCon("beto", 0, [])], [{ orden: "a", motivo: "no_cabe_con_el_resto" }]), pideLiftgate({}));
    expect(nadie.forzadas).toEqual([]);
    expect(nadie.sinAsignar).toEqual([{ orden: "a", motivo: "falta_requisito", faltan: ["Liftgate"] }]);
    expect(nadie.completo).toBe(false);
  });
  it("sin elegidos, nada se fuerza; lo de la lista de este día que no entró (ignoradas) se queda igual y no vuelve a «completo»", () => {
    const sinNadie = forzaLasQueNoCaben(reparto([], [{ orden: "a", motivo: "fuera_de_turno" }], ["zz"]), peticion({ seleccionadas: ["a"] }));
    expect(sinNadie.forzadas).toEqual([]);
    expect(sinNadie.sinAsignar).toEqual([{ orden: "a", motivo: "fuera_de_turno" }]);
    const soloIgnoradas = forzaLasQueNoCaben(reparto([rutaCon("ana", 0, [])], [], ["zz"]), peticion({ seleccionadas: ["zz"] }));
    expect(soloIgnoradas.ignoradas).toEqual(["zz"]);
    expect(soloIgnoradas.completo).toBe(false);
  });
});

describe("el aviso tras asignar: lo asignado; aparte lo que pasó el límite, con su porqué; lo imposible se queda donde está", () => {
  const ruta = (chofer: string, nombre: string, nuevas: string[]): RutaRepartida => ({ chofer, nombre, paradas: [], nuevas, ruta: { chofer, paradas: [], inicio: 480, fin: 480, duracionMin: 0, manejoMin: 0, millas: 0, tardeMin: 0, builderMin: 0, violaciones: [] } });
  const nombreDe = (o: string) => `#${o}`;
  it("con algo que pasa el límite y algo imposible: las tres partes, en una línea", () => {
    const m = mensajeDelRepartoHecho({
      rutas: [ruta("ana", "Ana", ["a", "b"]), ruta("beto", "Beto", ["c"])],
      forzadas: [{ orden: "b", chofer: "ana", nombre: "Ana", motivo: "no_cabe_con_el_resto" }],
      sinAsignar: [{ orden: "d", motivo: "sin_punto" }], ignoradas: [], nombreDe,
    });
    expect(m.en).toBe("🧭 3 order(s) assigned to Ana (+2), Beto (+1). Ctrl+Z undoes it. · ⚠ 1 assigned over the limit (check the route): #b (no room with the rest). · ⚠ 1 doesn't fit and stays where it is: #d (no map point).");
    expect(m.es).toBe("🧭 3 orden(es) asignadas a Ana (+2), Beto (+1). Ctrl+Z lo deshace. · ⚠ 1 asignada pasando el límite (revisa la ruta): #b (no cabe con lo demás). · ⚠ 1 no cabe y se queda donde está: #d (sin punto en el mapa).");
  });
  it("con varias pasando el límite, el plural; y sin nada pasado ni imposible, solo lo asignado (nunca «ninguna» si algo se asignó)", () => {
    const varias = mensajeDelRepartoHecho({
      rutas: [ruta("ana", "Ana", ["a", "b"])],
      forzadas: [{ orden: "a", chofer: "ana", nombre: "Ana", motivo: "supera_capacidad" }, { orden: "b", chofer: "ana", nombre: "Ana", motivo: "ventana_imposible" }],
      sinAsignar: [{ orden: "d", motivo: "sin_punto" }, { orden: "e", motivo: "sin_punto" }], ignoradas: ["f"], nombreDe,
    });
    expect(varias.en).toContain("2 assigned over the limit (check the route): #a (larger than the truck), #b (hard window can't be met).");
    expect(varias.en).toContain("3 don't fit and stay where they are: #d (no map point), #e (no map point), #f (not on this day's list).");
    const limpio = mensajeDelRepartoHecho({ rutas: [ruta("ana", "Ana", ["a"])], forzadas: [], sinAsignar: [], ignoradas: [], nombreDe });
    expect(limpio.en).toBe("🧭 1 order(s) assigned to Ana (+1). Ctrl+Z undoes it.");
    expect(limpio.en).not.toMatch(/none|ninguna/i);
  });
});

describe("la pantalla usa cada pieza (se alimenta de quien llama)", () => {
  const reparte = trozo("const reparte = async () => {", "const seccionDeReparto = ");
  const guarda = trozo("const guardaElReparto = async (r: Reparto): Promise<boolean> => {", "/** «🧭 Asignar N entre…»");
  const seccion = trozo("const seccionDeReparto = (sola: boolean) => {", "const recuadroDeReparto = ");

  it("lo que se reparte es lo marcado en cualquier tabla (`selectedOrders` ∪ `marcadas`), pendiente y de ESTE día", () => {
    expect(pagina).toContain("const [marcadas, setMarcadas] = useState<Set<string>>(new Set());");
    // D-998: lo marcado es cualquier fila; repartir toma solo lo de ESTE día en etapa de ruta (`lasRepartibles`).
    expect(pagina).toContain("() => lasRepartibles(lasMarcadas(dayOrders, selectedOrders, marcadas), date, ROUTE_STAGES),");
    expect(pagina).toContain("const seleccionMarcada = useMemo(() => lasMarcadas(deliveries, selectedOrders, marcadas)");
  });
  it("el día entra al motor por `entradaDelDia` —las mismas reglas que «Armar rutas»— con las seleccionadas libres y los choferes con la base del perfil si no tienen la de Ajustes", () => {
    expect(pagina).toContain("import { entradaDelDia } from \"@/lib/route-plan/entrada\";");
    // **Puesto al día por la base del día (166, 2026-10-11)**: entra también lo elegido para ese día (`basesDelDia`), y la memoria lo mira.
    const dia = trozo("const diaParaElMotor = useMemo(() => {", "}, [deliveries, date, seleccionDelReparto, drivers, ajustesDeChofer, settings, basesDelDia.bases]);");
    expect(dia).toContain("basesDelDia: basesDelDia.bases,");
    expect(dia).toContain("ordenes: deliveries.filter((d) => d.delivery_date === date && ROUTE_STAGES.includes(d.stage)).map((d) => (sel.has(d.id) ? { ...d, assigned_driver: null } : d)),");
    expect(dia).toContain("choferes: drivers, ajustesDeChofer: ajustesConBaseDelPerfil(ajustesDeChofer, drivers), settings,");
    expect(pagina).toContain("const ajustesDeChofer = useAjustesDeChofer();");
    expect(pagina).toContain("const choferesDelReparto = choferesParaRepartir(diaParaElMotor, drivers, bloqueada, unavailableToday);");
  });
  it("el hook lee las MISMAS columnas de `driver_settings` que el servidor, y en el demo no lee nada", () => {
    const hook = leer("src/lib/usa-ajustes-de-chofer.ts");
    expect(hook).toContain("leeConOpcionales((columnas) => createClient().from(\"driver_settings\").select(columnas), COLUMNAS_DE_CHOFER, COLUMNAS_OPCIONALES_DE_CHOFER)");
    expect(hook).toContain("if (LOCAL_MODE) return;");
  });
  it("al repartir: lo que cada elegido ya lleva es su lista de la tarjeta; los tiempos, UNA petición a /api/route-matrix con la memoria de Optimizar; la matriz, con lo que falte estimado; y el motor, `reparteEntre` con los parámetros del día", () => {
    expect(reparte).toContain("const yaLlevan = Object.fromEntries(elegidos.map((c) => [c.id, paradasDeLaLista(lecturaDe(c.nombre, byDriver.get(c.nombre) ?? []).paradas)]));");
    expect(reparte).toContain("const puntos = puntosDelReparto(entradaDelReparto(peticion).entrada, diaParaElMotor.puntos);");
    expect(reparte).toContain("const tiempos = await tiemposDeLaRuta(Object.values(puntos), tiemposPedidos.current, (pts) => fetch(\"/api/route-matrix\",");
    expect(reparte).toContain("const medida = matrizDelGestor(puntos, tiempos?.tiempos ?? null);");
    // D-994: con la espera del relevo (`conRecogidaDesde`), y una segunda pasada si el paso a también se repartió aquí.
    expect(reparte).toContain("const pet = { ...peticion, entrada: { ...diaParaElMotor.entrada, ordenes: conRecogidaDesde(diaParaElMotor.entrada.ordenes, desde), matriz: medida.matriz }, parametros: diaParaElMotor.parametros }; return forzaLasQueNoCaben(reparteEntre(pet), pet);");
    expect(reparte).toContain("if (cambio) r = repartir(desde);");
  });
  it("antes de escribir, el resumen: se confirma con él delante; si nada se puede asignar, solo se avisa y no se escribe", () => {
    expect(reparte).toContain("const resumen = resumenDelReparto({ r, nombreDe, movimientos, medida, totalSeleccionadas: seleccionadas.length });");
    expect(reparte).toContain("if (!r.rutas.some((x) => x.nuevas.length)) { await confirmAction(t(resumen.en, resumen.es), { alertOnly: true }); return; }");
    expect(reparte).toContain("if (!(await confirmAction(t(resumen.en, resumen.es), { confirmLabel: t(\"Assign\", \"Asignar\") }))) return;");
    expect(reparte.indexOf("confirmAction(")).toBeLessThan(reparte.indexOf("guardaElReparto(r)"));
    expect(reparte).toContain("if (!(await guardaElReparto(r))) return;");
    expect(reparte).toContain("setMarcadas(new Set()); clearSelection(); setElegidosDelReparto(new Set());");
  });
  it("tras guardar, el aviso dice lo asignado, lo que pasó el límite y lo imposible (una línea, sin «ninguna» si algo se asignó)", () => {
    expect(reparte).toContain("const hecho = mensajeDelRepartoHecho({ rutas: r.rutas, forzadas: r.forzadas, sinAsignar: r.sinAsignar, ignoradas: r.ignoradas, nombreDe });");
    expect(reparte).toContain("notify(t(hecho.en, hecho.es), { ms: 9000 });");
  });
  it("se guarda por el camino de siempre: el chofer y el puesto de las que llegan, la lista ENTERA con `reorderStops` (recogidas si la base las guarda), y UNA anotación en deshacer con todas las rutas tocadas", () => {
    expect(guarda).toContain("const lista = listaDeLasParadas(x.paradas, (id) => porId.get(id)?.store ?? null, suyas.map((d) => d.id));");
    expect(guarda).toContain("const desde = inicioDeLaRuta(laneKey, stops);");
    expect(guarda).toContain("const e = escrituraDeLaLista(lista, desde);");
    expect(guarda).toContain("const recogidas = hayRecogidaGuardada ? e.pickupSeqById : undefined;");
    expect(guarda).toContain("if (!(await updateDelivery(d.id, { assigned_driver: laneKey, route_seq: puestoEn(desde, e.ids.indexOf(d.id)), load_no: null, ...(recogidas ? { pickup_seq: recogidas[d.id] ?? null } : {}) }))) return false;");
    expect(guarda).toContain("if (!(await reorderStops(e.ids, e.loadNoById, undefined, desde, recogidas))) return false;");
    expect(guarda).toContain("despues = fotoTrasReordenar(despues, e.ids, e.loadNoById, desde, recogidas);");
    expect(guarda).toContain("if (origen && origen !== laneKey) { tocadas.add(origen); clearRouteFor(origen); }");
    expect(guarda).toContain("await anotaMovimiento(etiquetaDelReparto(rutas.reduce((n, x) => n + x.nuevas.length, 0), rutas.map((x) => x.nombre)), [...tocadas], antes, despues);");
    expect(guarda.split("anotaMovimiento(").length - 1).toBe(1);
    // La foto de antes se toma de TODAS las afectadas antes de la primera escritura.
    expect(guarda.indexOf("const antes: Foto = fotoDe(")).toBeLessThan(guarda.indexOf("await updateDelivery("));
  });
  it("las casillas: en cada fila D de la tarjeta (la orden), sin que el clic aísle la parada ni limpie la tarjeta; y «marcar todas» en la cabecera de la ruta", () => {
    expect(pagina).toContain("<input type=\"checkbox\" data-marca-orden={d.id} checked={marcadas.has(d.id)} onChange={() => alternaMarca(d.id)} onClick={(e) => e.stopPropagation()}");
    expect(pagina).toContain("<input type=\"checkbox\" data-marca-todas={u.key} checked={stops.length > 0 && stops.every((d) => marcadas.has(d.id))} disabled={stops.length === 0}");
    // Las de «Sin asignar» y «Todas» siguen siendo las de siempre (`toggleOrder`), y entran por `selectedOrders`.
    expect(pagina).toContain("onClick={hecha ? undefined : () => toggleOrder(d.id)}");
  });
  it("la sección: la cuenta «N seleccionadas», un chofer por casilla (apagado si no puede, con su porqué; 🔒 si está bloqueado) y el botón solo con elegidos", () => {
    expect(seccion).toContain("<b data-cuenta-seleccionadas");
    expect(seccion).toContain("t(`${n} selected`, `${n} seleccionadas`)");
    expect(seccion).toContain("<input type=\"checkbox\" data-elige-para-repartir={c.id} disabled={!c.puede || repartiendo} checked={c.puede && elegidosDelReparto.has(c.id)}");
    expect(seccion).toContain("const porque = c.motivo ? textoDeNoRepartir(c.motivo) : null;");
    expect(seccion).toContain("{c.nombre}{c.motivo === \"ruta_bloqueada\" ? \" 🔒\" : \"\"}");
    expect(seccion).toContain("<button className=\"btn btn-primary\" data-reparte disabled={!elegidos.length || nRepartir === 0 || repartiendo || moviendo} onClick={() => void reparte()}");
    expect(seccion).toContain("const elegidos = choferesDelReparto.filter((c) => c.puede && elegidosDelReparto.has(c.id));");
  });
  it("dónde sale: dentro del recuadro «Elige conductor» (plegada), sola cuando no hay nada sin asignar marcado, y en «Rutas» con algo marcado; nunca una barra arriba (D-459)", () => {
    // Puesto al día por D-481: nada de esto en «Ruta de hoy» (solo lectura).
    const recuadro = trozo("{!soloLectura && poolSelectedCount > 0 && ( <div className=\"card\" data-elige-conductor", "{!soloLectura && poolSelectedCount === 0 && seleccionMarcada.length > 0 && recuadroDeReparto()}");
    expect(recuadro).toContain("{seleccionMarcada.length > 0 && seccionDeReparto(false)}");
    expect(recuadro.indexOf("data-nueva-ruta-del-recuadro")).toBeLessThan(recuadro.indexOf("seccionDeReparto(false)"));
    expect(pagina).toContain("{!soloLectura && tab === \"routes\" && seleccionMarcada.length > 0 && recuadroDeReparto()}");
    expect(pagina).toContain("<div className=\"card\" data-recuadro-de-reparto role=\"group\"");
    expect(pagina).toContain("style={{ position: \"sticky\", bottom: 8, zIndex: 6, margin: \"10px 0 0\", padding: \"12px 14px\", border: \"2px solid var(--accent)\", background: \"var(--accent-soft)\", maxWidth: \"100%\", boxSizing: \"border-box\" }}> {seccionDeReparto(true)}");
    expect(seccion).toContain(": <button className=\"btn btn-ghost btn-sm\" data-abre-reparto aria-expanded={abierto} onClick={() => setRepartoAbierto((v) => !v)}");
  });
  it("cambiar de día olvida las marcas y los elegidos", () => {
    expect(pagina).toContain("useEffect(() => { setMarcadas(new Set()); setElegidosDelReparto(new Set()); }, [date]);");
  });
  it("el demo rutea: sus tiendas tienen punto en el mapa (sin él ningún chofer entra al motor)", () => {
    for (const s of demoSettings().stores) { expect(s.lat, s.name).toBeTypeOf("number"); expect(s.lng, s.name).toBeTypeOf("number"); }
  });
});
