import { describe, expect, it } from "vitest";
import { PARAMETROS_POR_DEFECTO, planifica, type ChoferEntrada, type Entrada, type Matriz, type OrdenEntrada } from "@/lib/route-engine";
import { CAMPOS_DE_LA_HOJA, casaConOrdenes, celdasDeTexto, columnasDeLaHoja, fechaDeHoja, filasDeLaHoja, hojaUtilizable, type FilaDeHoja } from "./hoja";
import { comparaConLaHoja, planDeLaHoja, type AsignacionDeHoja } from "./hoja-plan";

/** La hoja del despachador (D-326). Todas las hojas de aquí son INVENTADAS: en el repo no entra ninguna de verdad. */

const CABECERA = ["Order Type", "Store (Sold From)", "PO #", "SO #", "Invoice #", "Input Date", "Input Military Time", "Delivery Date", "Pickup Name", "Pickup Address",
  "Est. Pallets", "Assigned Driver (optional)", "Delivery Address", "Delivery Military Time Windows", "Account"];
const renglon = (x: Partial<Record<string, string>>) => CABECERA.map((c) => x[c] ?? "");
const csv = (filas: string[][]) => filas.map((f) => f.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\r\n");

describe("leer la hoja", () => {
  it("son QUINCE columnas, y las cabeceras del dueño se reconocen todas — con otras mayúsculas, espacios y sin «#» también", () => {
    expect(CAMPOS_DE_LA_HOJA).toHaveLength(15);
    expect(columnasDeLaHoja(CABECERA)).toEqual({
      mapa: { orderType: 0, store: 1, po: 2, so: 3, invoice: 4, inputDate: 5, inputTime: 6, deliveryDate: 7, pickupName: 8, carga: 9, pallets: 10, chofer: 11, deliveryAddress: 12, ventana: 13, account: 14 },
      faltan: [], sobran: [],
    });
    const raras = columnasDeLaHoja(["  invoice  ", "ASSIGNED DRIVER", "pickup   address", "Notas del despachador", ""]);
    expect(raras.mapa).toEqual({ invoice: 0, chofer: 1, carga: 2 });
    expect(raras.sobran).toEqual([{ indice: 3, cabecera: "Notas del despachador" }]);
    expect(raras.faltan).toHaveLength(12);
  });

  it("una cabecera repetida: gana la primera columna, y la otra queda a la vista para elegirla a mano", () => {
    const r = columnasDeLaHoja(["Store", "Store"]);
    expect([r.mapa, r.sobran]).toEqual([{ store: 0 }, [{ indice: 1, cabecera: "Store" }]]);
  });

  it("para casar hacen falta un identificador, el chofer y la carga", () => {
    expect(hojaUtilizable({ invoice: 0, chofer: 1, carga: 2 })).toBe(true);
    expect(hojaUtilizable({ so: 0, chofer: 1, carga: 2 })).toBe(true);
    expect(hojaUtilizable({ chofer: 1, carga: 2 })).toBe(false);
    expect(hojaUtilizable({ po: 0, carga: 2 })).toBe(false);
    expect(hojaUtilizable({ po: 0, chofer: 1 })).toBe(false);
  });

  it("CSV con comillas, comas y saltos dentro de una celda, con la marca de Excel delante; y lo pegado con tabuladores", () => {
    const marca = String.fromCharCode(0xfeff);
    expect(celdasDeTexto(`${marca}a,b\r\n"1, con coma","dice ""hola""\nen dos líneas"\r\n\r\n , \r\nx,`)).toEqual([["a", "b"], ["1, con coma", 'dice "hola"\nen dos líneas'], ["x", ""]]);
    expect(celdasDeTexto("a\tb, con coma\n1\t2")).toEqual([["a", "b, con coma"], ["1", "2"]]);
    expect(celdasDeTexto("")).toEqual([]);
    // La marca delante de una cabecera ENTRE COMILLAS: sin quitarla, las comillas no se reconocen como tales.
    expect(celdasDeTexto(`${marca}"Invoice #",b
1,2`)[0]).toEqual(["Invoice #", "b"]);
  });

  it("cada fila: el número de carga TAL CUAL (empieza en 0), y lo que no es un número entero no se inventa", () => {
    const filas = filasDeLaHoja(celdasDeTexto(csv([CABECERA,
      renglon({ "Invoice #": "F-100", "Pickup Address": "0", "Assigned Driver (optional)": " Chofer Uno ", "Est. Pallets": "2.5", "Delivery Date": "3/4/2026", "Delivery Military Time Windows": "0830-1000" }),
      renglon({ "PO #": "P-7", "Pickup Address": "calle falsa 123", "Assigned Driver (optional)": "Chofer Dos", "Est. Pallets": "muchos" }),
      renglon({ "SO #": "S-1", "Pickup Address": "1.5" }), renglon({ "SO #": "S-2", "Pickup Address": "-1" }),
      renglon({ "Account": "solo una nota suelta" }),
    ])), columnasDeLaHoja(CABECERA).mapa);
    expect(filas.map((f) => [f.renglon, f.invoice || f.po || f.so, f.carga, f.chofer, f.pallets, f.deliveryDate])).toEqual([
      [2, "F-100", 0, "Chofer Uno", 2.5, "2026-03-04"], [3, "P-7", null, "Chofer Dos", null, null], [4, "S-1", null, "", null, null], [5, "S-2", null, "", null, null],
    ]);
    expect(filas[0].ventana).toBe("0830-1000");
  });

  it("las fechas: ISO y mes/día como se escribe en EE. UU.; una fecha imposible o rara es null", () => {
    expect(["2026-03-04", "3/4/2026", "03/04/26", "2026-3-4 00:00"].map(fechaDeHoja)).toEqual(["2026-03-04", "2026-03-04", "2026-03-04", "2026-03-04"]);
    expect(["", "mañana", "2/30/2026", "13/1/2026", "2026-02-30", "4.3.2026"].map(fechaDeHoja)).toEqual([null, null, null, null, null, null]);
  });
});

describe("casar filas con órdenes: nada se adivina", () => {
  const fila = (renglonN: number, x: Partial<FilaDeHoja>): FilaDeHoja => ({
    renglon: renglonN, po: "", so: "", invoice: "", deliveryDate: null, chofer: "Chofer Uno", carga: 0, pallets: 1, ventana: "", account: "", orderType: "", store: "", pickupName: "", deliveryAddress: "", ...x,
  });
  const ordenes = [
    { id: "o1", invoice_num: "F-100", po2: "P-1", so_num: null }, { id: "o2", invoice_num: "f-200", po2: "P-2", so_num: "S-2" },
    { id: "o3", invoice_num: null, po2: "P-REPE", so_num: null }, { id: "o4", invoice_num: null, po2: "P-REPE", so_num: "S-4" }, { id: "o5", invoice_num: "F-500", po2: null, so_num: null },
  ];

  it("por factura, por PO o por SO — sin mirar mayúsculas, espacios ni un «#» delante", () => {
    const r = casaConOrdenes([fila(2, { invoice: " #f-100 " }), fila(3, { po: "p-2" }), fila(4, { so: "S-4" })], ordenes, "2026-03-04");
    expect(r.casadas.map((c) => [c.fila.renglon, c.ordenId, c.por])).toEqual([[2, "o1", "invoice"], [3, "o2", "po"], [4, "o4", "so"]]);
    expect(r.sinCasar).toEqual([]);
    expect(r.soloEnLaApp).toEqual(["o3", "o5"]);
  });

  it("cada forma de NO casar, con su motivo", () => {
    const r = casaConOrdenes([
      fila(2, {}), fila(3, { invoice: "F-999" }), fila(4, { po: "P-REPE" }), fila(5, { invoice: "F-100", so: "S-2" }),
      fila(6, { invoice: "F-500", deliveryDate: "2026-03-05" }), fila(7, { invoice: "F-500" }), fila(8, { invoice: "F-500" }),
    ], ordenes, "2026-03-04");
    expect(r.sinCasar.map((s) => [s.fila.renglon, s.motivo])).toEqual([
      [2, "sin_identificador"], [3, "no_esta_en_la_app"], [4, "varias_ordenes"], [5, "identificadores_en_conflicto"], [6, "otra_fecha"], [8, "repetida_en_la_hoja"],
    ]);
    expect(r.casadas.map((c) => [c.fila.renglon, c.ordenId])).toEqual([[7, "o5"]]);
  });

  it("un identificador que no está pero otro que sí: casa por el que está", () => {
    expect(casaConOrdenes([fila(2, { invoice: "F-NUEVA", po: "P-1" })], ordenes, "2026-03-04").casadas.map((c) => [c.ordenId, c.por])).toEqual([["o1", "po"]]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
const punto = (x: number) => `${x},0`;
function matrizDe(puntos: string[]): Matriz {
  const m: Matriz = {};
  for (const a of puntos) { m[a] = {}; for (const b of puntos) if (a !== b) { const d = Math.abs(Number(a.split(",")[0]) - Number(b.split(",")[0])); m[a][b] = { minutos: d, millas: d * 0.6 }; } }
  return m;
}
const orden = (id: string, destino: number, extra: Partial<OrdenEntrada> = {}): OrdenEntrada =>
  ({ id, codigo: id, entrada: "2026-01-05 0800", origen: punto(0), destino: punto(destino), pallets: 2, ventana: null, servicioRecogidaMin: 5, servicioEntregaMin: 10, ...extra });
const chofer = (id: string, extra: Partial<ChoferEntrada> = {}): ChoferEntrada => ({ id, nombre: id, base: punto(0), capacidad: 10, entrada: 480, salida: 1050, vuelveABase: true, ...extra });
const entradaDe = (ordenes: OrdenEntrada[], choferes: ChoferEntrada[]): Entrada => {
  const puntos = new Set<string>([...ordenes.flatMap((o) => [o.origen!, o.destino!]), ...choferes.map((c) => c.base)]);
  return { ordenes, choferes, matriz: matrizDe([...puntos]) };
};
const a = (ordenId: string, choferId: string, carga: number, renglonN = 2): AsignacionDeHoja => ({ ordenId, choferId, carga, renglon: renglonN });

describe("el plan del despachador, completado de la única forma honesta", () => {
  const e = entradaDe([orden("lejos", 40), orden("cerca", 5), orden("medio", 20)], [chofer("c1"), chofer("c2")]);

  it("respeta sus choferes y el ORDEN de sus cargas; las entregas, donde mejor caen sin tocar ese orden", () => {
    const p = planDeLaHoja(e, PARAMETROS_POR_DEFECTO, [a("lejos", "c1", 0), a("cerca", "c1", 1, 3), a("medio", "c2", 0, 4)]);
    expect(p.secuencias.c1.filter((x) => x.tipo === "P").map((x) => x.orden)).toEqual(["lejos", "cerca"]);
    expect(p.secuencias.c2.map((x) => `${x.tipo}:${x.orden}`)).toEqual(["P:medio", "D:medio"]);
    // Las dos se recogen en la tienda; entregar primero la de cerca es lo mejor que ese orden de cargas permite.
    expect(p.secuencias.c1.map((x) => `${x.tipo}:${x.orden}`)).toEqual(["P:lejos", "P:cerca", "D:cerca", "D:lejos"]);
    expect([p.evaluado.violaciones, p.delMotor, p.sinAsignar, p.convergio]).toEqual([[], [], [], true]);
  });

  it("el número de carga manda sobre el renglón; a igual carga, el renglón", () => {
    const p = planDeLaHoja(e, PARAMETROS_POR_DEFECTO, [a("cerca", "c1", 1, 2), a("medio", "c1", 0, 9), a("lejos", "c1", 0, 3)]);
    expect(p.secuencias.c1.filter((x) => x.tipo === "P").map((x) => x.orden)).toEqual(["lejos", "medio", "cerca"]);
  });

  it("si el despachador sobrecarga un camión, SE VE: la ruta manual también enseña sus violaciones", () => {
    const pesadas = entradaDe([orden("x", 10, { pallets: 6 }), orden("y", 12, { pallets: 6 })], [chofer("c1"), chofer("c2")]);
    // Dos recogidas seguidas en la tienda, 12 pallets en un camión de 10 — y el orden de cargas no deja entregar entre medias… salvo que sí deja.
    const p = planDeLaHoja(pesadas, PARAMETROS_POR_DEFECTO, [a("x", "c1", 0), a("y", "c1", 1, 3)]);
    expect(p.secuencias.c1.map((s) => `${s.tipo}:${s.orden}`)).toEqual(["P:x", "D:x", "P:y", "D:y"]);
    expect(p.evaluado.violaciones).toEqual([]);
    // Misma carga = misma parada física: ahí no hay hueco, y la violación sale.
    const juntas = planDeLaHoja(pesadas, PARAMETROS_POR_DEFECTO, [a("x", "c1", 0), a("y", "c1", 0, 3)]);
    expect(juntas.secuencias.c1.slice(0, 2).map((s) => `${s.tipo}:${s.orden}`)).toEqual(["P:x", "P:y"]);
    expect(juntas.evaluado.violaciones.map((v) => v.tipo)).toContain("capacidad");
  });

  it("lo que la hoja no asigna lo pone el motor SIN mover lo del despachador, y se dice cuáles fueron", () => {
    const p = planDeLaHoja(e, PARAMETROS_POR_DEFECTO, [a("lejos", "c2", 0)]);
    expect(p.delMotor).toEqual(["cerca", "medio"]);
    expect(p.secuencias.c2.filter((x) => x.orden === "lejos").map((x) => x.tipo)).toEqual(["P", "D"]);
    const todas = Object.values(p.secuencias).flat().filter((x) => x.tipo === "D").map((x) => x.orden).sort();
    expect(todas).toEqual(["cerca", "lejos", "medio"]);
  });

  it("es determinista: la misma hoja, en otro orden de filas, da el mismo plan", () => {
    const hoja = [a("lejos", "c1", 0, 2), a("cerca", "c1", 1, 3), a("medio", "c2", 0, 4)];
    expect(planDeLaHoja(e, PARAMETROS_POR_DEFECTO, [...hoja].reverse())).toEqual(planDeLaHoja(e, PARAMETROS_POR_DEFECTO, hoja));
  });

  it("cuarenta paradas se puntúan en un tiempo que se puede esperar delante de la pantalla", () => {
    const veinte = Array.from({ length: 20 }, (_, k) => orden(`o${String(k).padStart(2, "0")}`, 3 + ((k * 7) % 40)));
    const grande = entradaDe(veinte, [chofer("c1", { capacidad: 12 }), chofer("c2", { capacidad: 12 })]);
    const t0 = performance.now();
    const p = planDeLaHoja(grande, PARAMETROS_POR_DEFECTO, veinte.map((o, k) => a(o.id, k % 2 ? "c2" : "c1", Math.floor(k / 4), k + 2)));
    const ms = performance.now() - t0;
    expect(Object.values(p.secuencias).flat()).toHaveLength(40);
    expect(ms).toBeLessThan(5000);
  });
});

describe("la comparación, término a término", () => {
  // c2 sale de lejos de la tienda (en 60): llevarlo todo con él es peor DE VERDAD (con base en 30 empataba: 80 min los dos).
  const e = entradaDe([orden("lejos", 40), orden("cerca", 5), orden("medio", 20)], [chofer("c1"), chofer("c2", { base: punto(60) })]);
  const motor = planifica(e, PARAMETROS_POR_DEFECTO);

  it("la misma hoja que el motor: todo coincide y la diferencia es cero", () => {
    const comoElMotor: AsignacionDeHoja[] = [];
    for (const r of motor.rutas) { let n = -1; for (const p of r.paradas) if (p.tipo === "P") { n++; comoElMotor.push(a(p.orden, r.chofer, 0 * n, comoElMotor.length + 2)); } }
    const hoja = planDeLaHoja(e, PARAMETROS_POR_DEFECTO, comoElMotor);
    const c = comparaConLaHoja(hoja.evaluado, motor, comoElMotor, motor.explicaciones, e.choferes);
    expect(c.cuenta).toEqual({ comparadas: 3, mismoChofer: 3, mismaCarga: 3 });
    // En la tabla por chofer solo sale quien lleva algo en alguno de los dos planes.
    expect(c.porChofer.map((x) => x.choferId)).toEqual([...new Set(motor.rutas.filter((r) => r.paradas.length).map((r) => r.chofer))]);
    expect(c.porChofer.length).toBeLessThan(e.choferes.length);
    expect(c.total.diferencia.total).toBe(0);
    expect(c.ordenes.every((o) => o.comoEnLaHoja === null)).toBe(true);
  });

  it("el despachador manda todo con el chofer de lejos: se ve en qué órdenes difiere, cuánto costaría, y la hoja sale PEOR en el total", () => {
    const chMotor = new Map(motor.rutas.flatMap((r) => r.paradas.map((p) => [p.orden, r.chofer] as const)));
    const todoAlUno = [a("lejos", "c2", 0, 2), a("medio", "c2", 1, 3), a("cerca", "c2", 2, 4)];
    const hoja = planDeLaHoja(e, PARAMETROS_POR_DEFECTO, todoAlUno);
    const c = comparaConLaHoja(hoja.evaluado, motor, todoAlUno, motor.explicaciones, e.choferes);
    expect(c.ordenes.map((o) => o.orden)).toEqual(["cerca", "lejos", "medio"]);
    for (const o of c.ordenes) {
      expect([o.choferHoja, o.choferMotor, o.mismoChofer]).toEqual(["c2", chMotor.get(o.orden), chMotor.get(o.orden) === "c2"]);
      if (!o.mismoChofer) { expect(o.comoEnLaHoja).not.toBeNull(); expect(o.mismaCarga).toBeNull(); expect(o.comoEnLaHoja!.diferencia!.total).toBeGreaterThanOrEqual(0); }
    }
    expect(c.cuenta.mismoChofer).toBeLessThan(3);
    expect(c.total.diferencia.total).toBeGreaterThan(0);
    expect(c.total.diferencia.total).toBe(c.total.hoja.total - c.total.motor.total);
    expect(c.porChofer.map((x) => [x.choferId, x.hoja.ordenes])).toEqual([["c1", 0], ["c2", 3]]);
    expect(c.ordenes.map((o) => [o.orden, o.cargaHoja, o.etiquetaHoja])).toEqual([["cerca", 2, "P3"], ["lejos", 0, "P1"], ["medio", 1, "P2"]]);
  });

  it("la hoja numera sus cargas como quiere: lo que se compara es el PUESTO, y cargas iguales son una parada física", () => {
    const solo = entradaDe([orden("p", 10), orden("q", 12), orden("r", 14, { origen: punto(50) })], [chofer("c1", { capacidad: 20 })]);
    const m = planifica(solo, PARAMETROS_POR_DEFECTO);
    const ordenDelMotor = m.rutas[0].paradas.filter((p) => p.tipo === "P").map((p) => p.orden);
    // p y q se recogen en la misma tienda; r en otra. En la hoja: 0, 0 y 7.
    const hoja = [a("p", "c1", 0, 2), a("q", "c1", 0, 3), a("r", "c1", 7, 4)];
    const c = comparaConLaHoja(planDeLaHoja(solo, PARAMETROS_POR_DEFECTO, hoja).evaluado, m, hoja, m.explicaciones, solo.choferes);
    expect(c.ordenes.map((o) => o.etiquetaHoja)).toEqual(["P1", "P1", "P2"]);
    if (ordenDelMotor.indexOf("r") === 2) expect(c.ordenes.map((o) => o.mismaCarga)).toEqual([true, true, true]);
    else expect(c.ordenes.some((o) => o.mismaCarga === false)).toBe(true);
  });
});

describe("las celdas de un XLSX", () => {
  it("fechas a ISO, fórmulas por su resultado, texto enriquecido por su texto; lo que no se entiende, vacío", async () => {
    const { textoDeCelda, filaParaEnviar } = await import("./hoja");
    expect([" F-100 ", 0, 2.5, true, new Date(Date.UTC(2026, 2, 4)), { result: 7 }, { text: " enlace " }, { richText: [{ text: "Chofer " }, { text: "Uno" }] }].map(textoDeCelda))
      .toEqual(["F-100", "0", "2.5", "true", "2026-03-04", "7", "enlace", "Chofer Uno"]);
    expect([null, undefined, new Date("nada"), {}, { richText: [{}] }, () => 1].map(textoDeCelda)).toEqual(["", "", "", "", "", ""]);
    // Y lo que viaja al servidor de cada fila: siete campos, ni uno más.
    const entera = { renglon: 2, po: "P", so: "S", invoice: "F", deliveryDate: "2026-03-04", chofer: "Chofer Uno", carga: 0, pallets: 3, ventana: "0830-1000", account: "Cuenta", orderType: "Cliente", store: "Tienda", pickupName: "T", deliveryAddress: "Calle 1" };
    expect(filaParaEnviar(entera)).toEqual({ renglon: 2, po: "P", so: "S", invoice: "F", chofer: "Chofer Uno", carga: 0, deliveryDate: "2026-03-04" });
  });
});
