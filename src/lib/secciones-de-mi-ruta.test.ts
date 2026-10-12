import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { filaHecha, seccionesDeMiRuta } from "@/lib/secciones-de-mi-ruta";
import { paradasDeLaRuta } from "@/lib/gestor/paradas-numeradas";
import type { FilaDeLaRuta } from "@/lib/route-plan/lectura-de-ruta";

/**
 * D-520 · «Mi ruta» en dos secciones: «Pendientes» abierta y «Entregadas» plegada. El dueño: «delivered orders go to do
 * DELIVERED DROPDOWN TO SEE ALL THE DONE ORDERS BY DEFAULT WILL BE CLOSE AND THE PENDIGN ORDERS AS WELL BU TPENDING ON THE
 * DRIVER VIEW».
 */

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const P = (ordenes: string[], lugar = "McAllen", etiqueta = "P1"): FilaDeLaRuta => ({ tipo: "P", ordenes, lugar, etiqueta, cambio: 1, indice: 0 });
const D = (orden: string, etiqueta = "D1"): FilaDeLaRuta => ({ tipo: "D", orden, etiqueta, cambio: -1, indice: 0, otraCarga: false });

describe("filaHecha", () => {
  const etapas: Record<string, string> = { a: "ready", b: "picked_up", c: "delivered", d: "approved" };
  const etapaDe = (id: string) => etapas[id];
  it("una entrega está hecha cuando se entregó; en el camión todavía no", () => {
    expect(filaHecha(D("c"), etapaDe)).toBe(true);
    expect(filaHecha(D("b"), etapaDe)).toBe(false);
  });
  it("una recogida está hecha cuando TODAS sus cargas van en el camión o se entregaron; a medias, pendiente", () => {
    expect(filaHecha(P(["b", "c"]), etapaDe)).toBe(true);
    expect(filaHecha(P(["a", "b"]), etapaDe)).toBe(false);
    expect(filaHecha(P(["d"]), etapaDe)).toBe(false);
  });
  it("una orden que no se encuentra no se da por hecha, ni una recogida vacía", () => {
    expect(filaHecha(D("x"), etapaDe)).toBe(false);
    expect(filaHecha(P(["x"]), etapaDe)).toBe(false);
    expect(filaHecha(P([]), etapaDe)).toBe(false);
  });
});

describe("seccionesDeMiRuta", () => {
  // Tres recogidas seguidas en la misma tienda (UNA parada, la 1) y tres entregas a direcciones distintas (2, 3, 4).
  const ordenes = ["c1", "c2", "c5"].map((id) => ({ id, store: "McAllen", delivery_address: `${id} Main St` }));
  const filas = [P(["c1"], "McAllen", "P1"), P(["c2"], "McAllen", "P2"), P(["c5"], "McAllen", "P3"), D("c1", "D1"), D("c2", "D2"), D("c5", "D3")];
  const numeradas = paradasDeLaRuta(filas, ordenes);

  it("nada hecho: todo en Pendientes, con los números de D-515", () => {
    const s = seccionesDeMiRuta(filas, () => "ready", numeradas.deFila);
    expect(s.pendientes).toEqual([0, 1, 2, 3, 4, 5]);
    expect(s.hechas).toEqual([]);
    expect(s.conNumero).toEqual(numeradas.primera);
    expect(s.paradas).toEqual({ pendientes: 4, hechas: 0 });
  });
  it("lo hecho pasa a Entregadas, en el orden de la ruta, y cada sección numera la primera fila de cada parada", () => {
    const etapas: Record<string, string> = { c1: "ready", c2: "picked_up", c5: "delivered" };
    const s = seccionesDeMiRuta(filas, (id) => etapas[id], numeradas.deFila);
    // Recogidas de c2 y c5 hechas (en el camión, entregada); la entrega de c5, hecha.
    expect(s.pendientes).toEqual([0, 3, 4]);
    expect(s.hechas).toEqual([1, 2, 5]);
    // La parada 1 queda partida: su número en la primera fila de cada sección; la segunda hecha lleva la raya.
    expect(s.conNumero).toEqual([true, true, false, true, true, true]);
    expect(s.paradas).toEqual({ pendientes: 3, hechas: 2 });
  });
  it("todo hecho: Pendientes vacía", () => {
    const s = seccionesDeMiRuta(filas, () => "delivered", numeradas.deFila);
    expect(s.pendientes).toEqual([]);
    expect(s.hechas).toEqual([0, 1, 2, 3, 4, 5]);
    expect(s.paradas).toEqual({ pendientes: 0, hechas: 4 });
  });
});

describe("«Mi ruta» pinta las dos secciones con la función", () => {
  const p = leer("src/app/(app)/my-route/page.tsx");
  it("D-522: un selector arriba con las dos; nace en Pendientes y solo se ve la elegida", () => {
    expect(p).toContain('useState<SeccionDeMiRuta>("pendientes")');
    expect(p).toContain("<div data-seccion={s} hidden={listaElegida !== s}");
    expect(p).toContain("onClick={() => setListaElegida(s)}");
  });
  it("reparte con `seccionesDeMiRuta` sobre la misma lectura y la misma numeración que el resto de la pantalla", () => {
    expect(p).toContain("const secciones = useMemo(() => seccionesDeMiRuta(lectura.filas, (id) => porId.get(id)?.stage, numeradas.deFila), [lectura, porId, numeradas]);");
    expect(p).toContain('{seccion("pendientes", secciones.pendientes,');
    expect(p).toContain('{seccion("hechas", secciones.hechas,');
    expect(p).toContain("({secciones.paradas[s]})");
  });
  it("el número del círculo es el de la sección, no el de la lista entera", () => {
    expect(p).toContain("return secciones.conNumero[fi]");
    expect(p).not.toContain("numeradas.primera[fi]");
  });
});
