import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { nombresPorId, orderOwner } from "./utils";

/**
 * La columna «Vendedor» de Órdenes (D-652). Roberto: «Add rep column». El vendedor es `orderOwner` —el asignado o, sin él,
 * quien la creó—, y se pinta con su nombre en Órdenes y en la tabla del plan del Gestor, que hereda las columnas de Órdenes.
 */
const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");

describe("la columna «Vendedor»", () => {
  const nombre = nombresPorId([{ id: "u1", full_name: "  Ana Ruiz " }, { id: "u2", full_name: "Beto Paz" }, { id: "u3", full_name: "" }]);

  it("el vendedor es el asignado, y si no hay, quien la creó", () => {
    expect(nombre(orderOwner({ assigned_sales_rep: "u2", created_by: "u1" }))).toBe("Beto Paz");
    expect(nombre(orderOwner({ assigned_sales_rep: null, created_by: "u1" }))).toBe("Ana Ruiz");
  });

  it("sin la persona en la lista, sin nombre o sin id: null (la celda dice «—»), nunca el id", () => {
    expect(nombre("otro")).toBeNull();
    expect(nombre("u3")).toBeNull();
    expect(nombre(null)).toBeNull();
    expect(nombresPorId(undefined)("u1")).toBeNull();
  });

  it("Órdenes y el Gestor le pasan los nombres a la celda", () => {
    const tabla = leer("src/components/OrdersTable.tsx");
    expect(tabla).toContain('{ key: "rep", en: "Sales Rep", es: "Vendedor", value: (d, ctx) => ctx.nombreDe?.(orderOwner(d)) ?? null, cell: (d, ctx) => ctx.nombreDe?.(orderOwner(d)) || "—" },');
    expect(tabla).toContain("const nombreDe = useMemo(() => nombresPorId(users), [users]);");
    expect(leer("src/app/(app)/routes/page.tsx")).toContain("nombreDe: nombresPorId(users) }), [lang, t, settings, recibidas, marcasDeParada, users]);");
  });
});
