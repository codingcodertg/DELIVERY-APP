import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { BarraDeSeleccion } from "@/app/customers/BarraDeSeleccion";
import { almacenDeLaBase } from "./almacen";
import { almacenDemoNuevo, VENDEDORES_DEMO } from "./demo";
import { alternaEmpresa, empresasElegidas, estaMarcada, marcaTodas } from "./seleccion";

/* D-685. El dueño, 2026-10-26: «que uno pueda elegir múltiple y así, y ahí asignar a tal persona». */
const t = (_en: string, es: string) => es;
const leer = (p: string) => readFileSync(p, "utf8");

describe("elegir varios", () => {
  const a = { filas: [{ id: 1 }, { id: 2 }] }, b = { filas: [{ id: 3 }] };
  it("marcar una empresa elige todas sus filas; otra vez, las quita; a medias no sale marcada", () => {
    const s1 = alternaEmpresa(new Set(), [1, 2]);
    expect([...s1].sort()).toEqual([1, 2]);
    expect(estaMarcada(s1, [1, 2])).toBe(true);
    expect([...alternaEmpresa(s1, [1, 2])]).toEqual([]);
    expect(estaMarcada(new Set([1]), [1, 2])).toBe(false);
    expect([...alternaEmpresa(new Set([1]), [1, 2])].sort()).toEqual([1, 2]);
    expect(estaMarcada(new Set(), [])).toBe(false);
  });
  it("elegir todas las visibles suma; y la barra cuenta empresas, no filas", () => {
    const s = marcaTodas(new Set([9]), [a, b]);
    expect([...s].sort()).toEqual([1, 2, 3, 9]);
    expect(empresasElegidas(new Set([1, 3]), [a, b])).toBe(2);
    expect(empresasElegidas(new Set([2]), [a, b])).toBe(1);
  });
  it("guardarVarios: el demo aplica el parche y pone el nombre del vendedor", async () => {
    const alm = almacenDemoNuevo();
    const r = await alm.guardarVarios([1, 2], { rep_id: "demo-beto" });
    expect(r.ok && r.valor).toBe(2);
    const l = await alm.leer();
    expect(l.ok && l.valor.filter((c) => c.id === 1 || c.id === 2).map((c) => c.rep_name)).toEqual(["Beto Demo", "Beto Demo"]);
  });
  it("guardarVarios en la base: el parche tal cual, por tandas de 200", async () => {
    const llamadas: unknown[][] = [];
    const cadena: Record<string, unknown> = {};
    Object.assign(cadena, {
      update: (x: unknown) => { llamadas.push(["update", x]); return cadena; },
      in: (_k: string, ids: number[]) => { llamadas.push(["in", ids.length]); return cadena; },
      select: () => Promise.resolve({ data: [{ id: 1 }], error: null }),
    });
    const r = await almacenDeLaBase({ from: () => cadena } as any).guardarVarios(Array.from({ length: 201 }, (_, i) => i), { archived_reason: "sin nombre" });
    expect(llamadas.filter((x) => x[0] === "in").map((x) => x[1])).toEqual([200, 1]);
    expect(llamadas[0]).toEqual(["update", { archived_reason: "sin nombre" }]);
    expect(r.ok && r.valor).toBe(2);
  });
  it("la barra: cuántos, elegir todas, el desplegable de vendedores, asignar y archivar", () => {
    const html = renderToStaticMarkup(createElement(BarraDeSeleccion, {
      ids: [1, 2, 3], empresas: 2, totalVisibles: 10, vendedores: VENDEDORES_DEMO, almacen: almacenDemoNuevo(),
      onGuardados: () => {}, onTodas: () => {}, onLimpia: () => {}, t,
    }));
    expect(html).toContain('data-elegidas="2"');
    expect(html).toContain("2 clientes elegidos");
    expect(html).toContain("Elegir los 10 visibles");
    expect(html).toContain('<option value="demo-ana">Ana Demo</option>');
    expect(html).toContain("data-asignar-en-lote");
    expect(html).toContain("data-archivar-en-lote");
  });
  it("puerta: la casilla y la barra son del admin; el clic en la casilla no abre la ficha", () => {
    const c = leer("src/app/customers/Clientes.tsx");
    expect(c).toContain("{estado.tipo === \"listo\" && esAdmin && elegidos.size > 0 && (");
    expect(c).toMatch(/\{esAdmin && \(\s*<input type="checkbox"/);
    expect(c).toContain("onClick={(e) => e.stopPropagation()} onChange={() => setElegidos((s) => alternaEmpresa(s, filas.map((f) => f.id)))}");
  });
});
