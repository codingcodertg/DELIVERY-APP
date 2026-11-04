import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { condicionesDe, cumpleCondicion, filtraFilas, filtroDeCondiciones, numeroDeCelda, O_LOGICO, textoDeCondiciones } from "@/lib/orden-y-filtro";
import { cuentaDeVotos, votosDelProducto, type DecisionConAutor } from "./votos";

/**
 * D-840 (Roberto Rodriguez Jr, admin, en Promos): «allow me to filter like excel (greater than 100 for example, less
 * than 50, etc)» y «would like to be able to click and see who voted what».
 */
const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");

describe("filtro de número como Excel", () => {
  const filas = [{ qoh: 5 }, { qoh: 50 }, { qoh: 100 }, { qoh: 250 }, { qoh: null }];
  const valor = (_k: string, f: { qoh: number | null }) => f.qoh;
  const pasa = (s: Set<string>) => filtraFilas(filas, { qoh: s }, valor).map((f) => f.qoh);

  it("mayor que, menor que, entre dos (Y) y fuera de un rango (O); sin número no pasa", () => {
    expect(pasa(filtroDeCondiciones([{ op: "gt", valor: 100 }]))).toEqual([250]);
    expect(pasa(filtroDeCondiciones([{ op: "lt", valor: 50 }]))).toEqual([5]);
    expect(pasa(filtroDeCondiciones([{ op: "gte", valor: 50 }, { op: "lte", valor: 100 }]))).toEqual([50, 100]);
    expect(pasa(filtroDeCondiciones([{ op: "lt", valor: 50 }, { op: "gt", valor: 100 }], true))).toEqual([5, 250]);
    expect(pasa(filtroDeCondiciones([{ op: "ne", valor: 50 }]))).toEqual([5, 100, 250]);
  });
  it("la lista de valores marcados sigue igual cuando no hay condición", () => {
    expect(pasa(new Set(["50", "250"]))).toEqual([50, 250]);
  });
  it("las claves de condición van y vuelven, y se leen como texto", () => {
    const s = filtroDeCondiciones([{ op: "gte", valor: 10.5 }, { op: "lt", valor: 20 }], true);
    expect(condicionesDe(s)).toEqual([{ op: "gte", valor: 10.5 }, { op: "lt", valor: 20 }]);
    expect(s.has(O_LOGICO)).toBe(true);
    expect(textoDeCondiciones(s, "and", "or")).toBe("≥ 10.5 or < 20");
    expect(numeroDeCelda("1,250")).toBe(1250);
    expect(numeroDeCelda("abc")).toBeNull();
    expect(cumpleCondicion("300", { op: "gt", valor: 100 })).toBe(true);
  });
  it("Promos marca sus columnas de número y el menú las enseña", () => {
    expect(leer("src/app/promos/[id]/TablaDeRonda.tsx")).toContain("numerico: !!c.numero");
    expect(leer("src/components/CabeceraConMenu.tsx")).toContain("numerico={col.numerico}");
    expect(leer("src/components/OrdersTable.tsx")).toContain("const aplicar = () => onApply(condiciones.length ? filtroDeCondiciones(condiciones, conO) : draft);");
  });
});

describe("quién votó qué", () => {
  const d = (group_code: string, status: DecisionConAutor["status"], decided_by: string | null, code = "A1"): DecisionConAutor =>
    ({ round_id: "r", code, group_code, status, note: null, price: null, decided_by, decided_at: "2026-11-04T15:00:00Z" });

  it("todos los grupos del libro, con quién y cuándo; los que no decidieron, pendientes", () => {
    const votos = votosDelProducto("A1", [d("MCA", "approved", "u1"), d("BRO", "rejected", "u2"), d("MCA", "rejected", "u2", "B2")], ["BRO", "MCA", "HAR"], { u1: "Ana", u2: "Beto" });
    expect(votos.map((v) => [v.grupo, v.estado, v.quien])).toEqual([["BRO", "rejected", "Beto"], ["HAR", "pending", null], ["MCA", "approved", "Ana"]]);
    expect(votos.find((v) => v.grupo === "HAR")?.cuando).toBeNull();
    expect(cuentaDeVotos(votos)).toEqual({ pending: 1, approved: 1, rejected: 1 });
  });
  it("un grupo con decisión que ya no está en el libro también sale", () => {
    expect(votosDelProducto("A1", [d("VIEJO", "approved", "u1")], ["MCA"], {}).map((v) => v.grupo)).toEqual(["MCA", "VIEJO"]);
  });
  it("la página lee quién y cuándo, sin llave de servicio; la pastilla abre el panel", () => {
    const p = leer("src/app/promos/[id]/page.tsx");
    expect(p).toContain('const veVotos = rol === "admin" || esDecisor;');
    expect(p).toContain('await supabase.from("profiles").select("id, full_name").in("id", ids);');
    expect(leer("src/app/promos/[id]/TablaDeRonda.tsx")).toContain("onClick={(e) => { e.stopPropagation(); setVotosDe(fila.code); }}");
  });
});
