import { describe, expect, it } from "vitest";
import { puedeVerEstadisticas } from "./reglas";
import { almacenDemo, PERSONAS_DEMO } from "./demo";
import { periodoDeDias } from "./estadisticas";

describe("quién ve las estadísticas de uso: el admin y el gerente, nadie más", () => {
  it("el admin sí", () => {
    expect(puedeVerEstadisticas({ admin: true, role: "admin" })).toBe(true);
  });
  it("el gerente («manager») sí, tenga o no la casilla de otras tiendas", () => {
    expect(puedeVerEstadisticas({ admin: false, role: "manager" })).toBe(true);
  });
  it("un vendedor no, ni con el rol escrito a mano en otra forma", () => {
    expect(puedeVerEstadisticas({ admin: false, role: "sales" })).toBe(false);
    expect(puedeVerEstadisticas({ admin: false, role: "Manager" })).toBe(false);
    expect(puedeVerEstadisticas({ admin: false })).toBe(false);
  });
});

describe("el demo aplica la misma regla al leer las llamadas por vendedor", () => {
  const periodo = periodoDeDias(30, new Date());

  it("un vendedor recibe «sin permiso»", async () => {
    const alm = almacenDemo(() => PERSONAS_DEMO[0]);
    const r = await alm.llamadasPorVendedor(periodo);
    expect(r.ok).toBe(false);
  });
  it("el admin del demo recibe el conteo, y cada llamada tiene un vendedor del demo", async () => {
    const alm = almacenDemo(() => PERSONAS_DEMO[2]);
    const r = await alm.llamadasPorVendedor(periodo);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valor.total).toBeGreaterThan(0);
    const nombres = r.valor.porVendedor.map((x) => x.rep_name);
    expect(nombres.every((n) => n === PERSONAS_DEMO[0].name || n === PERSONAS_DEMO[1].name)).toBe(true);
  });
});
