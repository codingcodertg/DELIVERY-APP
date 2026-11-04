import { describe, expect, it } from "vitest";
import { celda, CAMPOS, clienteDeLaBase, FILTRO_INICIAL, formDe, ordenar, parcheDe, textoDeCampo, type Cliente } from "./reglas";
import { opcionesDeColumna } from "./cabeceras";
import { agrupaEnEmpresas } from "./empresas";
import {
  esTermino, ETIQUETAS_DE_TERMINO, opcionesDeTermino, rangoDeTermino, terminoAceptado, terminoCanonico, terminoDeFicha, terminoLabel, TERMINOS,
} from "./terminos";

const en = (e: string) => e;
const es = (_e: string, s: string) => s;
const fila = (id: number, terms: string | null, extra: Record<string, unknown> = {}): Cliente =>
  clienteDeLaBase({ id, store: "MCA", account: `CUENTA ${id}`, terms, ...extra });

describe("los términos de pago: tres opciones", () => {
  it("se guardan como el texto más común de la base, y se leen con la etiqueta del dueño", () => {
    expect(TERMINOS).toEqual(["Due on receipt", "Net 15", "Net 30"]);
    expect(TERMINOS.map((k) => terminoLabel(k, en))).toEqual(["Due on receipt", "15 days", "30 days"]);
    expect(TERMINOS.map((k) => terminoLabel(k, es))).toEqual(["Al recibir", "15 días", "30 días"]);
    expect(Object.keys(ETIQUETAS_DE_TERMINO)).toEqual([...TERMINOS]);
  });

  it("los sinónimos obvios se leen como su opción", () => {
    for (const v of ["Net 30", "NET 30", "net30", "NET30", "30", "30 days", "30 Days", "N30", "Net 30 days", "net-30", "30 días"]) expect(terminoCanonico(v), v).toBe("Net 30");
    for (const v of ["Net 15", "NET 15", "15", "15 Days", "net15", "15 días"]) expect(terminoCanonico(v), v).toBe("Net 15");
    for (const v of ["Due on receipt", "DUE ON RECEIPT", "Due upon receipt", "Upon receipt", "COD", "C.O.D.", "Cash on delivery", "Al recibir"]) expect(terminoCanonico(v), v).toBe("Due on receipt");
  });

  it("lo que no es ninguna de las tres no se fuerza a una (los valores viejos medidos en producción)", () => {
    for (const v of ["25 Days", "NET 6", "net 7", "CASH", "CREDIT", "45 days.", "Net 60", "NET 60 DAYS", "300", "Net 150", "", "  ", null, undefined]) expect(terminoCanonico(v), String(v)).toBeNull();
  });

  it("terminoDeFicha: la opción, o lo guardado recortado; nunca se tira", () => {
    expect(terminoDeFicha("NET 30")).toBe("Net 30");
    expect(terminoDeFicha(" 25 Days ")).toBe("25 Days");
    expect(terminoDeFicha(null)).toBe("");
  });

  it("la etiqueta: un valor viejo se enseña tal cual; vacío, «—»", () => {
    expect(terminoLabel("DUE ON RECEIPT", es)).toBe("Al recibir");
    expect(terminoLabel("25 Days", es)).toBe("25 Days");
    expect(terminoLabel(null, en)).toBe("—");
  });

  it("el desplegable: vacío y las tres; un valor viejo sale como cuarta opción apagada", () => {
    expect(opcionesDeTermino("", en)).toEqual([
      { value: "", label: "—" }, { value: "Due on receipt", label: "Due on receipt" }, { value: "Net 15", label: "15 days" }, { value: "Net 30", label: "30 days" },
    ]);
    expect(opcionesDeTermino("Net 30", en)).toHaveLength(4);
    const viejo = opcionesDeTermino("Net 45", en);
    expect(viejo).toHaveLength(5);
    expect(viejo[4]).toEqual({ value: "Net 45", label: "Net 45 (old value)", disabled: true });
    expect(opcionesDeTermino("Net 45", es)[4].label).toBe("Net 45 (valor anterior)");
  });

  it("al guardar vale una de las tres, el vacío, o el valor viejo sin cambiar", () => {
    expect(terminoAceptado("Net 15", "25 Days")).toBe(true);
    expect(terminoAceptado("", "25 Days")).toBe(true);
    expect(terminoAceptado("25 Days", "25 Days")).toBe(true);
    expect(terminoAceptado("NET 30", null)).toBe(true);
    expect(terminoAceptado("Net 45", "25 Days")).toBe(false);
    expect(terminoAceptado("Net 45", null)).toBe(false);
    expect(esTermino("Net 30")).toBe(true);
    expect(esTermino("NET 30")).toBe(false);
  });

  it("el orden: al recibir, 15, 30, luego los viejos", () => {
    expect(["25 Days", "Net 30", "COD", "NET 15"].sort((a, b) => rangoDeTermino(a) - rangoDeTermino(b))).toEqual(["COD", "NET 15", "Net 30", "25 Days"]);
  });
});

describe("los términos en la ficha y la lista", () => {
  const campo = CAMPOS.find((c) => c.key === "terms")!;

  it("el campo es un desplegable de términos, en «Crédito y términos» (el vendedor no lo ve, como hasta hoy)", () => {
    expect(campo.tipo).toBe("terminos");
    expect(campo.grupo).toBe("credito");
  });

  it("abrir y guardar sin tocar: ni un sinónimo ni un valor viejo cuentan como cambio", () => {
    for (const v of ["NET 30", "25 Days", "Due on receipt", null]) {
      const original = formDe(fila(1, v));
      expect(parcheDe({ ...original }, original), String(v)).toEqual({ parche: {}, errores: [] });
    }
    expect(formDe(fila(1, "NET 30")).terms).toBe("Net 30");
    expect(formDe(fila(1, "25 Days")).terms).toBe("25 Days");
  });

  it("guardar otra opción escribe el valor estable; vaciarlo escribe null; un texto libre nuevo es un error", () => {
    const original = formDe(fila(1, "25 Days"));
    expect(parcheDe({ ...original, terms: "Net 15" }, original).parche).toEqual({ terms: "Net 15" });
    expect(parcheDe({ ...original, terms: "" }, original).parche).toEqual({ terms: null });
    expect(parcheDe({ ...original, terms: "net 30" }, original).parche).toEqual({ terms: "Net 30" });
    expect(parcheDe({ ...original, terms: "Net 45" }, original)).toEqual({ parche: {}, errores: ["terms"] });
    // Un alta: lo mismo, desde vacío.
    const alta = { ...formDe(null), account: "NUEVA", store: "MCA" };
    expect(parcheDe({ ...alta, terms: "Due on receipt" }, formDe(null), true).parche.terms).toBe("Due on receipt");
    expect(parcheDe({ ...alta, terms: "Net 45" }, formDe(null), true).errores).toContain("terms");
  });

  it("la ficha, la celda y el filtro enseñan la etiqueta; los sinónimos son una sola casilla", () => {
    expect(textoDeCampo(fila(1, "NET 15"), campo, es)).toBe("15 días");
    expect(celda(fila(1, "DUE ON RECEIPT"), "terms", en)).toBe("Due on receipt");
    expect(celda(fila(1, "25 Days"), "terms", en)).toBe("25 Days");
    const lista = [fila(1, "Net 30"), fila(2, "NET 30", { account: "OTRA" }), fila(3, "25 Days", { account: "TERCERA" }), fila(4, null, { account: "CUARTA" })];
    const opciones = opcionesDeColumna(agrupaEnEmpresas(lista, FILTRO_INICIAL), {}, "terms", es).map((o) => o.label);
    expect(opciones.filter((l) => l === "30 días")).toHaveLength(1);
    expect(opciones).toEqual(expect.arrayContaining(["30 días", "25 Days", "—"]));
  });

  it("ordenar por términos: al recibir, 15, 30, los viejos, y los vacíos al final", () => {
    const lista = [fila(1, null), fila(2, "25 Days"), fila(3, "NET 30"), fila(4, "Net 15"), fila(5, "COD")];
    expect(ordenar(lista, { por: "terms", desc: false }).map((c) => c.id)).toEqual([5, 4, 3, 2, 1]);
  });
});
