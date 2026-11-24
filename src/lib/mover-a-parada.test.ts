import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { ParadaDeLaLista } from "./lista-unica";
import { gruposParaMarcar, llevaOrdenesAntesDe, mueveAParada, rangosDeParada, traeLaEntrega, velocidadDeAutoScroll } from "./mover-a-parada";

const P = (...ordenes: string[]): ParadaDeLaLista => ({ tipo: "P", ordenes, tienda: "RDZ Pharr" });
const D = (orden: string): ParadaDeLaLista => ({ tipo: "D", orden });
const ver = (l: readonly ParadaDeLaLista[]) => l.map((p) => (p.tipo === "P" ? `P${p.ordenes.join("+")}` : `D${p.orden}`)).join(" ");

// Seis filas, una parada por fila salvo la 1 (dos recogidas en la misma tienda): P a, P b | D a | D b | P c | D c
const LISTA = [P("a"), P("b"), D("a"), D("b"), P("c"), D("c")];
const FILAS = LISTA.map((_, indice) => ({ indice }));
const RANGOS = rangosDeParada(FILAS, [1, 1, 2, 3, 4, 5]);

describe("rangosDeParada", () => {
  it("varias filas en el mismo sitio comparten número: su rango va de la primera a la última", () => {
    expect(RANGOS.get(1)).toEqual({ desde: 0, hasta: 1 });
    expect(RANGOS.get(4)).toEqual({ desde: 4, hasta: 4 });
  });
  it("una fila que no se mueve (sin índice) no cuenta", () => {
    const r = rangosDeParada([{ indice: null }, { indice: 0 }], [1, 2]);
    expect([...r.keys()]).toEqual([2]);
  });
  it("con lo ya hecho arriba, los números pendientes no empiezan en 1", () => {
    const r = rangosDeParada([{ indice: 0 }, { indice: 1 }], [4, 5]);
    expect([...r.keys()]).toEqual([4, 5]);
  });
});

describe("mueveAParada: SOLO la fila", () => {
  it("subir la recogida de c a la parada 1: queda la primera de esa parada", () => {
    const r = mueveAParada(LISTA, RANGOS, 4, 1);
    expect(r.ok && ver(r.paradas)).toBe("Pc Pa Pb Da Db Dc");
  });
  it("bajar la entrega de a a la parada 5: queda la última", () => {
    const r = mueveAParada(LISTA, RANGOS, 2, 5);
    expect(r.ok && ver(r.paradas)).toBe("Pa Pb Db Pc Dc Da");
  });
  it("una entrega no sube por delante de su recogida: no se mueve y dice cuál", () => {
    expect(mueveAParada(LISTA, RANGOS, 5, 1)).toEqual({ ok: false, motivo: "precedencia", orden: "c" });
  });
  it("ya está en esa parada: borde", () => {
    expect(mueveAParada(LISTA, RANGOS, 1, 1)).toEqual({ ok: false, motivo: "borde" });
  });
  it("un número que no es de una parada pendiente: dice de cuál a cuál sí", () => {
    expect(mueveAParada(LISTA, RANGOS, 4, 9)).toEqual({ ok: false, motivo: "no_existe", min: 1, max: 5 });
  });
});

describe("mueveAParada: la orden ENTERA y las marcadas", () => {
  it("la orden c entera a la parada 1: su recogida y, pegada, su entrega", () => {
    const r = mueveAParada(LISTA, RANGOS, 4, 1, ["c"]);
    expect(r.ok && ver(r.paradas)).toBe("Pc Dc Pa Pb Da Db");
  });
  it("desde la fila de la ENTREGA también va la orden entera", () => {
    const r = mueveAParada(LISTA, RANGOS, 5, 2, ["c"]);
    expect(r.ok && ver(r.paradas)).toBe("Pa Pb Pc Dc Da Db");
  });
  it("bajar la orden a entera a la parada 5: detrás de esa parada", () => {
    const r = mueveAParada(LISTA, RANGOS, 0, 5, ["a"]);
    expect(r.ok && ver(r.paradas)).toBe("Pb Db Pc Dc Pa Da");
  });
  it("dos marcadas van juntas, en su orden de lista", () => {
    const lista = [P("x"), D("x"), P("a"), D("a"), P("b"), D("b")];
    const rangos = rangosDeParada(lista.map((_, indice) => ({ indice })), [1, 2, 3, 4, 5, 6]);
    const r = mueveAParada(lista, rangos, 4, 1, ["a", "b"]);
    expect(r.ok && ver(r.paradas)).toBe("Pa Da Pb Db Px Dx");
  });
  it("el paso b de un relevo no se adelanta a la entrega de su paso a", () => {
    const lista = [P("a"), D("a"), P("b"), D("b")];
    const rangos = rangosDeParada(lista.map((_, indice) => ({ indice })), [1, 2, 3, 4]);
    expect(mueveAParada(lista, rangos, 2, 1, ["b"], { relevos: new Map([["b", "a"]]) })).toEqual({ ok: false, motivo: "relevo", orden: "b" });
  });
});

describe("llevaOrdenesAntesDe y traeLaEntrega", () => {
  it("al final de la lista", () => {
    const r = llevaOrdenesAntesDe(LISTA, ["a"], LISTA.length);
    expect(r.ok && ver(r.paradas)).toBe("Pb Db Pc Dc Pa Da");
  });
  it("si no cambia nada, borde", () => {
    expect(llevaOrdenesAntesDe([P("a"), D("a"), P("b"), D("b")], ["a"], 0)).toEqual({ ok: false, motivo: "borde" });
  });
  it("traer la entrega: queda justo detrás de su recogida, que no se mueve", () => {
    const r = traeLaEntrega(LISTA, 0);
    expect(r.ok && ver(r.paradas)).toBe("Pa Da Pb Db Pc Dc");
  });
  it("traer la entrega de la que ya la tiene detrás, o desde una entrega: borde", () => {
    expect(traeLaEntrega(LISTA, 4)).toEqual({ ok: false, motivo: "borde" });
    expect(traeLaEntrega(LISTA, 2)).toEqual({ ok: false, motivo: "borde" });
  });
});

describe("velocidadDeAutoScroll", () => {
  it("en medio de la caja no se mueve", () => {
    expect(velocidadDeAutoScroll(400, 100, 700)).toBe(0);
  });
  it("cerca del borde de arriba sube, más rápido cuanto más cerca; fuera, al máximo", () => {
    const lejos = velocidadDeAutoScroll(170, 100, 700), cerca = velocidadDeAutoScroll(110, 100, 700);
    expect(lejos).toBeLessThan(0);
    expect(cerca).toBeLessThan(lejos);
    expect(velocidadDeAutoScroll(40, 100, 700)).toBe(-26);
  });
  it("cerca del borde de abajo baja", () => {
    expect(velocidadDeAutoScroll(690, 100, 700)).toBeGreaterThan(0);
    expect(velocidadDeAutoScroll(900, 100, 700)).toBe(26);
  });
  it("una caja muy baja no se queda sin zona quieta en medio", () => {
    expect(velocidadDeAutoScroll(150, 100, 200)).toBe(0);
  });
});

describe("gruposParaMarcar", () => {
  const ordenes = [
    { id: "1", pickup_name: "RDZ Pharr", ciudad: "Edinburg" },
    { id: "2", pickup_name: "RDZ Pharr", ciudad: "Edinburg" },
    { id: "3", pickup_name: "RDZ McAllen", ciudad: "Donna" },
    { id: "4", pickup_name: null, store: "RDZ Pharr", ciudad: null },
  ];
  const g = gruposParaMarcar(ordenes, (o) => o.ciudad);
  it("por ciudad de entrega y por tienda de recogida, lo más numeroso primero", () => {
    expect(g.filter((x) => x.tipo === "ciudad").map((x) => [x.nombre, x.ids])).toEqual([["Edinburg", ["1", "2"]], ["Donna", ["3"]]]);
    expect(g.filter((x) => x.tipo === "tienda").map((x) => [x.nombre, x.ids])).toEqual([["RDZ Pharr", ["1", "2", "4"]], ["RDZ McAllen", ["3"]]]);
  });
  it("las claves no chocan entre una ciudad y una tienda con el mismo nombre", () => {
    expect(new Set(g.map((x) => x.clave)).size).toBe(g.length);
  });
});

describe("el Gestor de Rutas usa estas reglas (D-1145)", () => {
  const pagina = readFileSync("src/app/(app)/routes/page.tsx", "utf8").replace(/\r\n/g, "\n");
  const proveedor = readFileSync("src/lib/data-provider.tsx", "utf8").replace(/\r\n/g, "\n");
  const relevo = readFileSync("src/components/RelevoDeLaOrden.tsx", "utf8").replace(/\r\n/g, "\n");
  it("las flechas, el arrastre, «Pasar a…» y los botones nuevos van EN FILA: uno no pisa al anterior ni se rechaza", () => {
    for (const gesto of ["flecha", "suelta", "pasaA", "aParada", "traeEntrega"]) expect(pagina).toContain(`enFila(() => gestosDeLaLista.current!.${gesto}(`);
    // Soltar una parada ya no se rechaza con «el movimiento anterior se sigue guardando».
    const soltar = pagina.slice(pagina.indexOf("const sueltaParadaYa = async"), pagina.indexOf("// ---- «🧭 Optimizar» una ruta"));
    expect(soltar).not.toContain("avisaSiGuarda()");
  });
  it("la pantalla tiene el botón «#», el de traer la entrega, el diálogo y el desplazamiento solo", () => {
    expect(pagina).toContain("data-mover-a-parada");
    expect(pagina).toContain("data-trae-la-entrega");
    expect(pagina).toContain("data-dialogo-mover-a-parada");
    expect(pagina).toContain("velocidadDeAutoScroll(");
    expect(pagina).toContain("data-marcar-por");
  });
  it("una ruta reordenada se escribe de 6 en 6, no fila a fila", () => {
    expect(proveedor).toContain("export const ESCRITURAS_A_LA_VEZ = 6;");
    expect(proveedor).toContain("for (let i = 0; i < cambian.length; i += ESCRITURAS_A_LA_VEZ) {");
  });
  it("«Deshacer relevo» se decide con los pasos que dice la base si la pantalla tiene menos", () => {
    expect(relevo).toContain("pasos.length > familia.length ? pasos : familia");
    expect(relevo).toContain("{puede && sePuedeDeshacer(pasosParaDecidir) && (");
  });
});
