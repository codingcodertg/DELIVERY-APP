import { describe, expect, it } from "vitest";
import { ROLES_LISTA_DE_SU_TIENDA, alcanceDeLaLista } from "./ordenes-visibles";
import type { NamedLocation } from "./types";

/** Entregas: oficina (accounting) ve solo su tienda, como gerente y ventas (D-751, 2026-10-29). */

const TIENDAS: NamedLocation[] = [{ name: "Tienda Norte", address: "1" }, { name: "Tienda Sur", address: "2" }];
const ctx = (role: string, store: string | null, busqueda = "") =>
  ({ me: { id: "u", role, store } as never, teaching: false, tiendas: TIENDAS, busqueda });

describe("quién va cortado por su tienda en la lista de Órdenes", () => {
  it("gerente, ventas y oficina; no logística ni admin", () => {
    expect([...ROLES_LISTA_DE_SU_TIENDA].sort()).toEqual(["accounting", "manager", "sales"]);
  });
  it("oficina con tienda: su tienda, busque o no; sin tienda: nada", () => {
    expect(alcanceDeLaLista(ctx("accounting", "Tienda Norte"))).toMatchObject({ tipo: "tiendas", normalizadas: ["tienda norte"] });
    expect(alcanceDeLaLista(ctx("accounting", "Tienda Norte", "INV"))).toMatchObject({ tipo: "tiendas" });
    expect(alcanceDeLaLista(ctx("accounting", null))).toEqual({ tipo: "sin-tienda" });
  });
  it("control: logística y admin, todas", () => {
    expect(alcanceDeLaLista(ctx("logistics", null))).toEqual({ tipo: "todas" });
    expect(alcanceDeLaLista(ctx("admin", "Tienda Norte"))).toEqual({ tipo: "todas" });
  });
});
