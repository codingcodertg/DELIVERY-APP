import { describe, expect, it } from "vitest";
import { listaParaUrl, MAX_EMPLEADOS_EN_URL, parseaListaDeNomina, pasaFiltroDeNomina } from "./filtro-de-nomina";

describe("parseaListaDeNomina · la URL de tienda y de empleado", () => {
  it("un solo valor sigue valiendo (los enlaces viejos)", () => {
    expect(parseaListaDeNomina("st-1", 50)).toEqual(["st-1"]);
  });

  it("varios valores separados por comas, en su orden", () => {
    expect(parseaListaDeNomina("st-1,st-2,st-3", 50)).toEqual(["st-1", "st-2", "st-3"]);
  });

  it("quita los espacios y descarta los huecos y los vacíos", () => {
    expect(parseaListaDeNomina(" st-1 , ,, st-2 ,", 50)).toEqual(["st-1", "st-2"]);
  });

  it("sin valor, vacío o solo comas: lista vacía (= todos)", () => {
    expect(parseaListaDeNomina(undefined, 50)).toEqual([]);
    expect(parseaListaDeNomina(null, 50)).toEqual([]);
    expect(parseaListaDeNomina("", 50)).toEqual([]);
    expect(parseaListaDeNomina("   ", 50)).toEqual([]);
    expect(parseaListaDeNomina(",,,", 50)).toEqual([]);
  });

  it("sin repetir: el mismo id dos veces cuenta una", () => {
    expect(parseaListaDeNomina("a,b,a,b,a", 50)).toEqual(["a", "b"]);
  });

  it("con tope: no pasa de `maximo` valores", () => {
    const muchos = Array.from({ length: 250 }, (_, i) => `e${i}`).join(",");
    const out = parseaListaDeNomina(muchos, MAX_EMPLEADOS_EN_URL);
    expect(out).toHaveLength(200);
    expect(out[0]).toBe("e0");
    expect(out[199]).toBe("e199");
  });

  it("con permitidos: un id fuera del conjunto se ignora (no se amplía lo que la persona ve)", () => {
    const permitidos = new Set(["st-1", "st-2"]);
    expect(parseaListaDeNomina("st-1,st-9,st-2", 50, permitidos)).toEqual(["st-1", "st-2"]);
    expect(parseaListaDeNomina("st-9", 50, permitidos)).toEqual([]);
  });

  it("caracteres raros se descartan: no entran en la consulta ni en la pantalla", () => {
    expect(parseaListaDeNomina("a';DROP,b c,<script>,ok-1,ok_2", 50)).toEqual(["ok-1", "ok_2"]);
    expect(parseaListaDeNomina("%2e%2e,../x,a\u0000b", 50)).toEqual([]);
  });

  it("un id demasiado largo (más de 64) se descarta", () => {
    const largo = "x".repeat(65);
    expect(parseaListaDeNomina(`${largo},ok`, 50)).toEqual(["ok"]);
  });
});

describe("pasaFiltroDeNomina · tienda Y empleado", () => {
  const ana = { id: "ana", store: "st-1" };
  const luis = { id: "luis", store: "st-2" };
  const sinTienda = { id: "marta", store: null };

  it("sin nada elegido, entra todo el mundo", () => {
    expect([ana, luis, sinTienda].every((p) => pasaFiltroDeNomina(p, [], []))).toBe(true);
  });

  it("con varias tiendas, entra quien está en cualquiera de ellas", () => {
    expect(pasaFiltroDeNomina(ana, ["st-1", "st-2"], [])).toBe(true);
    expect(pasaFiltroDeNomina(luis, ["st-1", "st-2"], [])).toBe(true);
    expect(pasaFiltroDeNomina(luis, ["st-1"], [])).toBe(false);
  });

  it("quien no tiene tienda solo entra si no hay tiendas elegidas", () => {
    expect(pasaFiltroDeNomina(sinTienda, [], [])).toBe(true);
    expect(pasaFiltroDeNomina(sinTienda, ["st-1"], [])).toBe(false);
  });

  it("con varios empleados, entra quien es uno de ellos", () => {
    expect(pasaFiltroDeNomina(ana, [], ["ana", "luis"])).toBe(true);
    expect(pasaFiltroDeNomina(sinTienda, [], ["ana", "luis"])).toBe(false);
  });

  it("las dos condiciones a la vez: tienda Y empleado", () => {
    expect(pasaFiltroDeNomina(ana, ["st-1", "st-2"], ["ana"])).toBe(true);
    expect(pasaFiltroDeNomina(ana, ["st-2"], ["ana"])).toBe(false);
    expect(pasaFiltroDeNomina(ana, ["st-1"], ["luis"])).toBe(false);
  });
});

describe("listaParaUrl · lo que va a la URL", () => {
  it("vacía, sin parámetro; si no, comas sin repetir", () => {
    expect(listaParaUrl([])).toBeNull();
    expect(listaParaUrl(["a"])).toBe("a");
    expect(listaParaUrl(["a", "b", "a", ""])).toBe("a,b");
  });
});
