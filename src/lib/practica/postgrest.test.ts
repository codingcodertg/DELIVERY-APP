import { describe, expect, it } from "vitest";
import { columnasDelSelect, cumpleConsulta, cumpleFiltro, ordena, partePorComas, proyecta, tablaDeLaRuta } from "./postgrest";

// D-628 (2026-10-21): lo justo de PostgREST para pintar la práctica sobre lo real.

const fila = { id: "a", name: "Ana López", status: "new", n: 5, ok: true, nada: null, tags: ["x", "y"], fecha: "2026-10-21T10:00:00+00:00" };
const q = (s: string) => new URLSearchParams(s);

describe("leer la consulta", () => {
  it("la tabla de la ruta; las funciones y lo demás no son tablas", () => {
    expect(tablaDeLaRuta("https://x.supabase.co/rest/v1/candidates?select=*")).toBe("candidates");
    expect(tablaDeLaRuta("https://x.supabase.co/rest/v1/rpc/adjust_inventory")).toBe(null);
    expect(tablaDeLaRuta("https://x.supabase.co/storage/v1/object/resumes/a.pdf")).toBe(null);
  });

  it("parte por comas de fuera de paréntesis y comillas", () => {
    expect(partePorComas('a.eq.1,and(b.gt.2,c.is.null),d.in.("x,y",z)')).toEqual(["a.eq.1", "and(b.gt.2,c.is.null)", 'd.in.("x,y",z)']);
  });
});

describe("cada filtro", () => {
  it("igual, distinto, mayor y menor: números como números, fechas como fechas", () => {
    expect(cumpleFiltro(fila, "status", "eq.new")).toBe(true);
    expect(cumpleFiltro(fila, "status", "neq.new")).toBe(false);
    expect(cumpleFiltro(fila, "n", "gt.10")).toBe(false); // como número: 5 < 10 (como texto, "5" > "10")
    expect(cumpleFiltro(fila, "n", "lte.5")).toBe(true);
    expect(cumpleFiltro(fila, "fecha", "gte.2026-10-21")).toBe(true);
    expect(cumpleFiltro(fila, "fecha", "lt.2026-10-21T09:00:00Z")).toBe(false);
    expect(cumpleFiltro(fila, "ok", "eq.true")).toBe(true);
  });

  it("is, in, like, ilike, arrays y not", () => {
    expect(cumpleFiltro(fila, "nada", "is.null")).toBe(true);
    expect(cumpleFiltro(fila, "status", "is.null")).toBe(false);
    expect(cumpleFiltro(fila, "ok", "is.true")).toBe(true);
    expect(cumpleFiltro(fila, "status", 'in.(old,"new")')).toBe(true);
    expect(cumpleFiltro(fila, "status", "in.(old,hired)")).toBe(false);
    expect(cumpleFiltro(fila, "name", "like.Ana*")).toBe(true);
    expect(cumpleFiltro(fila, "name", "like.ana*")).toBe(false);
    expect(cumpleFiltro(fila, "name", "ilike.*lópez")).toBe(true);
    expect(cumpleFiltro(fila, "tags", "cs.{x}")).toBe(true);
    expect(cumpleFiltro(fila, "tags", "cs.{x,z}")).toBe(false);
    expect(cumpleFiltro(fila, "status", "not.eq.new")).toBe(false);
    expect(cumpleFiltro(fila, "nada", "not.is.null")).toBe(false);
    expect(cumpleFiltro(fila, "nada", "eq.x")).toBe(false); // null nunca es igual
  });

  it("lo que no sabe leer es null: JSON, una columna que la fila no trae, un operador raro", () => {
    expect(cumpleFiltro(fila, "data->>k", "eq.1")).toBe(null);
    expect(cumpleFiltro(fila, "otra", "eq.1")).toBe(null);
    expect(cumpleFiltro(fila, "name", "fts.ana")).toBe(null);
  });
});

describe("la consulta entera", () => {
  it("todos los filtros a la vez, y or/and anidados", () => {
    expect(cumpleConsulta(fila, q("select=*&status=eq.new&n=gte.5"))).toBe(true);
    expect(cumpleConsulta(fila, q("status=eq.new&n=gt.5"))).toBe(false);
    expect(cumpleConsulta(fila, q("or=(status.eq.old,n.eq.5)"))).toBe(true);
    expect(cumpleConsulta(fila, q("or=(status.eq.old,and(n.eq.5,ok.is.false))"))).toBe(false);
    expect(cumpleConsulta(fila, q("not.or=(status.eq.old,n.eq.6)"))).toBe(true);
    expect(cumpleConsulta(fila, q("order=n.desc&limit=3&offset=0"))).toBe(true);
  });

  it("un filtro que no se sabe leer deja null, salvo que otro ya la descarte", () => {
    expect(cumpleConsulta(fila, q("status=eq.new&data->>k=eq.1"))).toBe(null);
    expect(cumpleConsulta(fila, q("status=eq.old&data->>k=eq.1"))).toBe(false);
  });
});

describe("orden y forma", () => {
  it("ordena por varias columnas, con los nulos donde Postgres", () => {
    const filas = [{ a: 2, b: "x" }, { a: null, b: "y" }, { a: 1, b: "z" }, { a: 2, b: "a" }];
    expect(ordena(filas, "a.asc,b.asc").map((f) => f.b)).toEqual(["z", "a", "x", "y"]);
    expect(ordena(filas, "a.desc,b.desc").map((f) => f.b)).toEqual(["y", "x", "a", "z"]);
    expect(ordena(filas, "a.desc.nullslast,b.asc").map((f) => f.b)).toEqual(["a", "x", "z", "y"]);
    expect(ordena(filas, null)).toBe(filas);
  });

  it("proyecta: columnas, alias, y los anidados vacíos", () => {
    expect(columnasDelSelect("id,nombre:name,contacts(*)")).toEqual({ todas: false, columnas: [{ como: "id", col: "id" }, { como: "nombre", col: "name" }], anidados: ["contacts"] });
    expect(proyecta(fila, "id,nombre:name,contacts(*)")).toEqual({ id: "a", nombre: "Ana López", contacts: [] });
    expect(proyecta({ id: 1 }, null)).toEqual({ id: 1 });
  });
});
