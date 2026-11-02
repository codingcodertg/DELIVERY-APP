import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { nombreParaOrdenar, ordenar, type Lead } from "./reglas";

/** D-804: orden A–Z por constructor / cliente en Leads (Everto Prado, help request con captura del selector «Sort by»). */
const lead = (id: string, owner_name: string | null, tenant_name: string | null = null) =>
  ({ id, tabs_project: id, owner_name, tenant_name, square_footage: null, distance_miles: null, estimated_cost: null, registered_date: null }) as unknown as Lead;

describe("orden A–Z", () => {
  it("por el constructor y, si no hay, por el propietario; sin nombre al final; sin mayúsculas", () => {
    const lista = [lead("1", "Zeta Builders"), lead("2", null, "alfa homes"), lead("3", null), lead("4", "  Beta  ")];
    expect(ordenar(lista, "nombre").map((l) => l.id)).toEqual(["2", "4", "1", "3"]);
    expect(nombreParaOrdenar({ owner_name: " Cantu ", tenant_name: "DHR" })).toBe("cantu");
    expect(nombreParaOrdenar({ owner_name: "", tenant_name: "DHR" })).toBe("dhr");
  });
  it("la pantalla lo ofrece en «Ordenar por»", () => {
    const p = readFileSync(join(process.cwd(), "src/app/leads/Leads.tsx"), "utf8").replace(/\r\n/g, "\n");
    expect(p).toContain('<option value="nombre">');
  });
});
