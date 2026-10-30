import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { formateadorDeFecha, formateadorDeNumero, formateadoresEnCache } from "./formateador";
import { fmtDateShort, isoInTZ, nowHHMM, todayISO } from "./utils";

/** Formateadores cacheados y el tablero sin trabajo repetido (D-744, 2026-10-29). */

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const ficheros = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? ficheros(p) : [p]; });

describe("el formateador se crea una vez", () => {
  it("misma combinación, mismo objeto; otra combinación, otro", () => {
    const antes = formateadoresEnCache();
    const a = formateadorDeFecha("en-CA", { timeZone: "America/Chicago", year: "numeric" });
    const b = formateadorDeFecha("en-CA", { timeZone: "America/Chicago", year: "numeric" });
    const c = formateadorDeFecha("es-MX", { timeZone: "America/Chicago", year: "numeric" });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(formateadorDeNumero("en-US", { style: "currency", currency: "USD" })).toBe(formateadorDeNumero("en-US", { style: "currency", currency: "USD" }));
    expect(formateadoresEnCache() - antes).toBe(3);
  });
  it("y formatea igual que antes", () => {
    expect(isoInTZ(new Date("2026-10-29T23:30:00Z"))).toBe("2026-10-29");
    expect(todayISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(fmtDateShort("2026-08-13", "en")).toBe("Aug 13");
    expect(fmtDateShort("2026-08-13", "es")).toMatch(/13 ago/);
    expect(nowHHMM()).toMatch(/^\d{2}:\d{2}$/);
  });
  it("es rápido: 5.000 días en bastante menos de lo que costaba construir el formateador cada vez", () => {
    const d = new Date();
    const t0 = performance.now();
    for (let i = 0; i < 5000; i++) isoInTZ(d);
    expect(performance.now() - t0).toBeLessThan(150);
  });
});

describe("no queda ningún `new Intl.DateTimeFormat` suelto en src/lib ni en el tablero", () => {
  it("todos pasan por el formateador cacheado (salvo el propio módulo y la caché de RRHH, que ya tenía la suya)", () => {
    const permitidos = new Set(["src/lib/formateador.ts", "src/lib/recruiting/hora-de-brownsville.ts"]);
    const sueltos = ficheros(join(process.cwd(), "src/lib"))
      .filter((p) => /\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p))
      .map((p) => p.slice(process.cwd().length + 1).split("\\").join("/"))
      .filter((r) => !permitidos.has(r) && sinComentarios(leer(r)).includes("new Intl.DateTimeFormat("));
    expect(sueltos).toEqual([]);
  });
});

describe("el tablero de Órdenes", () => {
  const pagina = sinComentarios(leer("src/app/(app)/page.tsx"));
  const tabla = sinComentarios(leer("src/components/OrdersTable.tsx"));
  it("la búsqueda se difiere: teclear no refiltra la empresa entera en cada pulsación", () => {
    expect(pagina).toContain("const qDiferida = useDeferredValue(q);");
    expect(pagina).toContain("busqueda: qDiferida,");
    expect(pagina).not.toContain("busqueda: q,");
  });
  it("`isUrgent` es estable (useCallback), no una función nueva por render", () => {
    expect(pagina).toContain("isUrgent={esUrgente}");
    expect(pagina).toContain("const esUrgente = useCallback((d: Delivery) => {");
  });
  it("ordenar calcula el valor de cada fila UNA vez (no dos por comparación) y las opciones del menú se memoizan", () => {
    expect(tabla).toContain("const valores = filteredRows.map((d) => ({ d, v: col.value(d, ctx) }));");
    expect(tabla).not.toContain("comparaCeldas(col.value(a, ctx), col.value(b, ctx))");
    expect(tabla).toContain("const opcionesDelMenu = useMemo(");
    expect(tabla).toContain("options={opcionesDelMenu}");
  });
  it("recolocar el menú al hacer scroll va por requestAnimationFrame", () => {
    expect(tabla).toContain("requestAnimationFrame(() => {");
  });
  it("el valor del contexto de datos se memoiza", () => {
    expect(sinComentarios(leer("src/lib/data-provider.tsx"))).toContain("const value: DataState = useMemo(() => ({");
  });
});
