import { describe, expect, it } from "vitest";
import { numeracionDeLasParadas, type FilaDelPlanParaParada } from "./paradas-del-plan";

const P = (orden: string, tienda: string | null): FilaDelPlanParaParada => ({ tipo: "P", orden, tienda, direccion: null });
const D = (orden: string, direccion: string | null): FilaDelPlanParaParada => ({ tipo: "D", orden, tienda: null, direccion });
const numeros = (filas: FilaDelPlanParaParada[]) => numeracionDeLasParadas(filas).map((x) => x.numero);

describe("la numeración de paradas de la tabla del plan", () => {
  it("una fila sola es su parada; las seguidas en el mismo sitio son una sola, con el círculo en la primera", () => {
    const filas = [P("a", "RDZ"), P("b", "RDZ"), P("c", "Walmart"), D("a", "1 Main"), D("b", "2 Oak"), D("c", "3 Elm")];
    expect(numeracionDeLasParadas(filas).map((x) => [x.numero, x.primera])).toEqual([
      [1, true], [1, false], [2, true], [3, true], [4, true], [5, true],
    ]);
  });

  it("las entregas seguidas en la misma dirección son una parada; la misma dirección más adelante es otra", () => {
    expect(numeros([D("a", "Calle 9"), D("b", "calle 9  "), P("c", "Tienda"), D("c", "Calle 9")])).toEqual([1, 1, 2, 3]);
  });

  it("una recogida y una entrega nunca son el mismo sitio aunque digan lo mismo", () => {
    expect(numeros([P("a", "Calle 9"), D("b", "Calle 9")])).toEqual([1, 2]);
  });

  it("sin nada que agrupar, cada una es su parada; la lista vacía no da filas", () => {
    expect(numeracionDeLasParadas([])).toEqual([]);
    expect(numeros([P("a", null), P("b", null)])).toEqual([1, 2]);
  });
});

describe("el tono de las recogidas seguidas en la misma tienda", () => {
  it("marca el grupo y su inicio, solo en las recogidas", () => {
    const filas = [P("a", "RDZ"), P("b", "RDZ"), P("c", "Walmart"), D("a", "1 Main")];
    const [a, b, c, d] = numeracionDeLasParadas(filas);
    expect([a.enGrupoDeRecogidas, a.inicioDeGrupo]).toEqual([true, true]);
    expect([b.enGrupoDeRecogidas, b.inicioDeGrupo]).toEqual([true, false]);
    expect([c.enGrupoDeRecogidas, c.inicioDeGrupo]).toEqual([false, false]);
    expect([d.enGrupoDeRecogidas, d.inicioDeGrupo]).toEqual([false, false]);
  });

  it("las entregas seguidas en la misma dirección son grupo, pero sin tono (como en el Gestor, D-698)", () => {
    const [a, b] = numeracionDeLasParadas([D("a", "Calle 9"), D("b", "Calle 9")]);
    expect(a.enGrupoDeRecogidas).toBe(false);
    expect(b.numero).toBe(1);
  });
});
