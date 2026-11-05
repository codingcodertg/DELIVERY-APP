import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { avisoDelBuscador } from "./asociaciones";
import { almacenDemoNuevo } from "./demo";

// Bug de producción (Customers 0.56.0): una vendedora no podía usar el buscador de asociaciones. El cuadro no se
// bloquea nunca, y lo que no se puede buscar se dice (sin tiendas, fallo de la base, nada en mis tiendas).
const componente = readFileSync(join(__dirname, "../../app/customers/AsociacionesDelCliente.tsx"), "utf8");
const buscador = componente.slice(componente.indexOf("data-busca-asociado") - 600, componente.indexOf("data-busca-asociado") + 40);

describe("buscador de asociaciones: se escribe siempre y avisa", () => {
  it("el cuadro no lleva disabled ni readOnly", () => {
    expect(buscador).toContain('type="search"');
    expect(buscador).not.toMatch(/disabled=|readOnly/);
  });
  it("sin tiendas, el no admin ve el aviso aunque no haya escrito nada", () => {
    expect(avisoDelBuscador({ esAdmin: false, misTiendas: [], q: "", error: false, hay: false })).toBe("sinTiendas");
    expect(avisoDelBuscador({ esAdmin: false, misTiendas: [" "], q: "ab", error: false, hay: false })).toBe("sinTiendas");
  });
  it("el admin no depende de sus tiendas", () => {
    expect(avisoDelBuscador({ esAdmin: true, misTiendas: [], q: "ab", error: false, hay: false })).toBe("nada");
  });
  it("sin saber aún las tiendas (null) no se adelanta el aviso", () => {
    expect(avisoDelBuscador({ esAdmin: false, misTiendas: null, q: "a", error: false, hay: false })).toBeNull();
  });
  it("un fallo de la base se dice, no se traga como «sin resultados»", () => {
    expect(avisoDelBuscador({ esAdmin: false, misTiendas: ["BRO"], q: "ab", error: true, hay: false })).toBe("error");
    expect(componente).toContain("setErrorDeBusqueda(!r.ok)");
  });
  it("sin coincidencias, el no admin sabe que solo busca en sus tiendas", () => {
    expect(avisoDelBuscador({ esAdmin: false, misTiendas: ["BRO"], q: "ab", error: false, hay: false })).toBe("nadaEnMisTiendas");
    expect(avisoDelBuscador({ esAdmin: false, misTiendas: ["BRO"], q: "ab", error: false, hay: true })).toBeNull();
  });
  it("la demo devuelve las tiendas de quien la usa", async () => {
    const r = await almacenDemoNuevo([], { esAdmin: false, misTiendas: ["BRO"] }).misTiendasParaAsociar!();
    expect(r).toEqual({ ok: true, valor: ["BRO"] });
  });
});
