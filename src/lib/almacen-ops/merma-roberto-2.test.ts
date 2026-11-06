import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PASOS, etiquetaDeOpcion, pasoCompleto, pasosVisibles, primerHueco, respuestasParaGuardar } from "./pasos";
import { perdida, piezasTotales, repartoAjustado, repartoAlCambiar, repartoDeReporte, repartoValido, tipoDeReparto } from "./perdida";
import { DEMO_REPORTES, mermaParaEnviar } from "./datos";

const SQL = readFileSync(join(process.cwd(), "supabase/migrations/254_merma_reparto_y_crma.sql"), "utf8").replace(/\r\n/g, "\n");

const producto = { id: 7, sku: "S", name: "N", cost: 2.5, pieces_per_box: 4 };
const qty = { boxes: 2, piecesPerBox: 4, loosePieces: 0 }; // 8 piezas
const base = { product: producto, qty, split: { damaged: 6, sample: 2 }, return_type: "internal", reason: "fell" };
const pasoQty = PASOS.scrap.find((p) => p.id === "qty")!;

describe("faa07047: primero el total, luego cuántas dañadas y cuántas de muestra", () => {
  it("la pregunta es por el total de piezas, ya no «dañado o muestra»", () => {
    expect(pasoQty.en).toBe("How many pieces?");
    expect(PASOS.scrap.some((p) => p.id === "scrap_type")).toBe(false);
  });
  it("dañadas + muestra = total, enteros y sin negativos", () => {
    expect(repartoValido(8, { damaged: 6, sample: 2 })).toBe(true);
    expect(repartoValido(8, { damaged: 8, sample: 0 })).toBe(true);
    expect(repartoValido(8, { damaged: 0, sample: 8 })).toBe(true);
    expect(repartoValido(8, { damaged: 6, sample: 1 })).toBe(false);
    expect(repartoValido(8, { damaged: 9, sample: -1 })).toBe(false);
    expect(repartoValido(8, { damaged: 6.5, sample: 1.5 })).toBe(false);
    expect(repartoValido(8, { damaged: Number.NaN, sample: 2 })).toBe(false);
    expect(repartoValido(8, undefined)).toBe(false);
    expect(repartoValido(0, { damaged: 0, sample: 0 })).toBe(false);
  });
  it("el paso no avanza si no cuadra, y el resumen lo marca como hueco", () => {
    expect(pasoCompleto(pasoQty, { qty })).toBe(false);
    expect(pasoCompleto(pasoQty, { qty, scrap_type: "sample" })).toBe(false);
    expect(pasoCompleto(pasoQty, { qty, split: { damaged: 6, sample: 2 } })).toBe(true);
    expect(pasoCompleto(pasoQty, { qty, split: { damaged: 6, sample: 3 } })).toBe(false);
    expect(primerHueco("scrap", base)).toBe(-1);
    expect(primerHueco("scrap", { ...base, qty: { ...qty, boxes: 3 } })).toBe(1);
  });
  it("al escribir uno, el otro se llena con lo que falta", () => {
    expect(repartoAlCambiar(8, "sample", 2)).toEqual({ damaged: 6, sample: 2 });
    expect(repartoAlCambiar(8, "damaged", 5)).toEqual({ damaged: 5, sample: 3 });
    expect(repartoAlCambiar(8, "damaged", 0)).toEqual({ damaged: 0, sample: 8 });
    // Se pasa del total o no es número: se deja lo escrito y el paso no avanza.
    expect(repartoValido(8, repartoAlCambiar(8, "sample", 9))).toBe(false);
    expect(repartoValido(8, repartoAlCambiar(8, "damaged", Number.NaN))).toBe(false);
  });
  it("al cambiar el total se conserva la muestra (hasta el total); por defecto todo dañado", () => {
    expect(repartoAjustado(8)).toEqual({ damaged: 8, sample: 0 });
    expect(repartoAjustado(12, { damaged: 6, sample: 2 })).toEqual({ damaged: 10, sample: 2 });
    expect(repartoAjustado(1, { damaged: 6, sample: 2 })).toEqual({ damaged: 0, sample: 1 });
    // Un borrador viejo solo traía la opción única.
    expect(repartoAjustado(8, undefined, "sample")).toEqual({ damaged: 0, sample: 8 });
    expect(repartoAjustado(8, undefined, "damaged")).toEqual({ damaged: 8, sample: 0 });
    // Un borrador con un número roto (NaN se guarda como null).
    expect(repartoAjustado(8, { damaged: null as unknown as number, sample: 3 })).toEqual({ damaged: 5, sample: 3 });
  });
  it("lo que se envía: las dos cuentas y el resumen en scrap_type", () => {
    expect(tipoDeReparto({ damaged: 8, sample: 0 })).toBe("damaged");
    expect(tipoDeReparto({ damaged: 0, sample: 8 })).toBe("sample");
    expect(tipoDeReparto({ damaged: 6, sample: 2 })).toBe("mixed");
    expect(mermaParaEnviar(base)).toEqual({
      scrap_type: "mixed", damaged_pieces: 6, sample_pieces: 2, boxes: 2, pieces_per_box: 4, loose_pieces: 0,
      return_type: "internal", reason: "fell", broken_by: [], crma: null,
    });
    // Desde 714584e6 el origen ya no es una pregunta: no viaja en answers (va fijo en el cuerpo de la merma).
    expect(respuestasParaGuardar("scrap", base)).toEqual({ reason: "fell" });
  });
  it("la 254 dejó la pérdida en costo × todas las piezas; la 259 la cambió a solo dañadas (ver merma-roberto-3)", () => {
    expect(perdida(producto.cost, piezasTotales(qty))).toBe(20);
    expect(SQL).toContain("round(prod.cost * v_total, 2)");
    const r4 = DEMO_REPORTES.find((r) => r.id === "r4")!; // todo muestra: desde 0c2fb392 no es pérdida
    expect(r4.total_loss).toBe(0);
  });
  it("los reportes viejos (una sola opción) se siguen leyendo; los nuevos traen las dos cuentas", () => {
    expect(repartoDeReporte({ scrap_type: "damaged", total_pieces: 7 })).toEqual({ damaged: 7, sample: 0 });
    expect(repartoDeReporte({ scrap_type: "sample", total_pieces: 6, damaged_pieces: null, sample_pieces: null })).toEqual({ damaged: 0, sample: 6 });
    expect(repartoDeReporte({ scrap_type: "mixed", total_pieces: 7, damaged_pieces: 5, sample_pieces: 2 })).toEqual({ damaged: 5, sample: 2 });
    expect(etiquetaDeOpcion("scrap", "scrap_type", "sample", "en")).toBe("Sample");
    expect(etiquetaDeOpcion("scrap", "scrap_type", "damaged", "es")).toBe("Dañado");
    expect(etiquetaDeOpcion("scrap", "scrap_type", "mixed", "en")).toBe("Damaged and sample");
  });
});

describe("87254659 → 714584e6: el CRMA era obligatorio en devolución; ahora la merma es siempre interna", () => {
  it("ya no se pregunta el CRMA, ni con un borrador viejo de devolución, y no estorba para enviar", () => {
    expect(pasosVisibles("scrap", { ...base }).some((p) => p.id === "crma")).toBe(false);
    expect(primerHueco("scrap", base)).toBe(-1);
    const dev = { ...base, return_type: "customer_return" };
    expect(pasosVisibles("scrap", dev).some((p) => p.id === "crma")).toBe(false);
    expect(primerHueco("scrap", dev)).toBe(-1);
  });
  it("no viaja nunca: ni escrito en un borrador viejo", () => {
    expect(mermaParaEnviar({ ...base, return_type: "customer_return", crma: " CR-1 " }).crma).toBeNull();
    expect(mermaParaEnviar({ ...base, return_type: "internal", crma: "CR-1" }).crma).toBeNull();
    expect(respuestasParaGuardar("scrap", { ...base, crma: "CR-1" }).crma).toBeUndefined();
  });
  it("los otros textos cortos siguen pidiendo 3 letras", () => {
    const otro = PASOS.maintenance.find((p) => p.id === "equipment_other")!;
    expect(pasoCompleto(otro, { equipment_other: "ab" })).toBe(false);
    expect(pasoCompleto(otro, { equipment_other: "abc" })).toBe(true);
  });
});

describe("la 254 hace cumplir lo mismo en la base", () => {
  it("guarda las dos cuentas, exige que sumen el total y acepta mixed", () => {
    expect(SQL).toContain("add column if not exists damaged_pieces integer");
    expect(SQL).toContain("add column if not exists sample_pieces integer");
    expect(SQL).toContain("check (scrap_type in ('damaged', 'sample', 'mixed'))");
    expect(SQL).toContain("damaged_pieces + sample_pieces = total_pieces");
    expect(SQL).toContain("if v_dan < 0 or v_mue < 0 or v_dan + v_mue <> v_total then");
    expect(SQL).toContain("v_tipo := case when v_mue = 0 then 'damaged' when v_dan = 0 then 'sample' else 'mixed' end;");
  });
  it("rellena las filas viejas con lo que ya decían y sigue aceptando la pantalla vieja", () => {
    expect(SQL).toContain("set damaged_pieces = case when scrap_type = 'sample' then 0 else total_pieces end");
    expect(SQL).toContain("elsif p_scrap->>'scrap_type' = 'sample' then");
  });
  it("el CRMA: obligatorio en devolución, descartado en interno", () => {
    expect(SQL).toContain("if v_origen = 'customer_return' and v_crma is null then");
    expect(SQL).toContain("if v_origen <> 'customer_return' then v_crma := null; end if;");
  });
  it("conserva lo de la 252 y las reglas del registro", () => {
    expect(SQL).toContain("p_scrap->>'free_name'");
    expect(SQL).toContain("has_warehouse_ops_access()");
    expect(SQL).toContain("recruiting.hr_history");
    expect(SQL).toContain("-- @ledger-below");
    expect(SQL).toMatch(/values \('254_merma_reparto_y_crma\.sql', '[0-9a-f]{64}'\)/);
    expect(SQL).not.toContain("D-894");
    expect(SQL).not.toMatch(/create policy [^;]*on public\.warehouse_reports/);
  });
});
