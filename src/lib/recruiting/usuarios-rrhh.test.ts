import { describe, expect, it } from "vitest";
import { cuentaPorCuenta, expedienteQueSobra, filtraPorCuenta, precargaDeEmpleado } from "./usuarios-rrhh";

const rows = [
  { id: "a", profile_id: "pa" },
  { id: "b", profile_id: null },
  { id: "c", profile_id: "pc" },
];

describe("filtro «User created»", () => {
  it("separa con y sin usuario", () => {
    expect(filtraPorCuenta(rows, "con").map((r) => r.id)).toEqual(["a", "c"]);
    expect(filtraPorCuenta(rows, "sin").map((r) => r.id)).toEqual(["b"]);
    expect(filtraPorCuenta(rows, "todos")).toHaveLength(3);
    expect(cuentaPorCuenta(rows)).toEqual({ todos: 3, con: 2, sin: 1 });
  });
});

describe("precargaDeEmpleado", () => {
  it("prefiere el correo de trabajo y recorta", () => {
    expect(precargaDeEmpleado({ id: "x", full_name: " Ana ", email: "a@w.com", personal_email: "a@p.com", store: " RDZ " }))
      .toEqual({ fileId: "x", full_name: "Ana", email: "a@w.com", store: "RDZ" });
  });
  it("cae al personal, y sin tienda es null", () => {
    expect(precargaDeEmpleado({ id: "x", full_name: "Ana", email: "", personal_email: "a@p.com", store: "" }))
      .toEqual({ fileId: "x", full_name: "Ana", email: "a@p.com", store: null });
  });
});

describe("expedienteQueSobra", () => {
  it("sin otro expediente no borra nada", () => {
    expect(expedienteQueSobra("f", "p", [])).toEqual({ ok: true, borrar: null });
    expect(expedienteQueSobra("f", "p", [{ id: "f", docs: 3 }])).toEqual({ ok: true, borrar: null });
  });
  it("borra el vacío que creó el trigger (id = profile_id)", () => {
    expect(expedienteQueSobra("f", "p", [{ id: "p", docs: 0 }])).toEqual({ ok: true, borrar: "p" });
  });
  it("no borra uno con papeles ni uno de otra persona", () => {
    expect(expedienteQueSobra("f", "p", [{ id: "p", docs: 1 }]).ok).toBe(false);
    expect(expedienteQueSobra("f", "p", [{ id: "otro", docs: 0 }]).ok).toBe(false);
    expect(expedienteQueSobra("f", "p", [{ id: "p", docs: 0 }, { id: "q", docs: 0 }]).ok).toBe(false);
  });
});
