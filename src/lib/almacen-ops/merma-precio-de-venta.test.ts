import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { MOTIVOS_DE_MERMA, etiquetaDeOpcion } from "./pasos";
import { COLUMNAS_EXCEL } from "./tabla-de-merma";

/**
 * Migración 272. Roberto (gerente de almacén, 2026-11-08): «Cost should be sales price, most employees should not know
 * of product costs from supplier.» La merma congela ahora erp.products.price (precio de venta) en unit_cost, y la
 * pantalla lo llama «Price» / «Precio». Y el motivo `strap` pasa a «Strapped too tight» (lo rompieron por flejar de más),
 * con el mismo valor para que los reportes viejos sigan con etiqueta.
 */
const lee = (ruta: string) => readFileSync(join(process.cwd(), ruta), "utf8").replace(/\r\n/g, "\n");
const SQL = lee("supabase/migrations/272_merma_precio_de_venta.sql");
const ASISTENTE = lee("src/app/operaciones/Asistente.tsx");
const LISTA = lee("src/app/operaciones/ListaDeReportes.tsx");

describe("272: la merma toma el precio de venta, no el costo del proveedor", () => {
  it("las tres funciones que leen el catálogo copian pp.price (en la columna `cost`, misma firma)", () => {
    expect(SQL).toContain("create or replace function public.warehouse_ops_search_products(q text)");
    expect(SQL).toContain("select p.id, p.sku, p.name, p.price as cost, p.pieces_per_box");
    expect(SQL).toContain("create or replace function public.warehouse_ops_file_report(");
    expect(SQL).toContain("select pp.id, pp.sku, pp.name, pp.price as cost into prod from erp.products pp where pp.id = (p_scrap->>'product_id')::bigint;");
    expect(SQL).toContain("create or replace function public.warehouse_ops_edit_scrap_product(");
    expect(SQL).toContain("select pp.id, pp.sku, pp.name, pp.price as cost into prod from erp.products pp where pp.id = p_product_id;");
    expect(SQL).not.toContain("pp.name, pp.cost");
    expect(SQL).not.toContain("p.name, p.cost,");
  });

  it("la pérdida sigue siendo la cuenta de la 259 y la 263 (solo dañadas; devolución sin CRMA = 0)", () => {
    expect(SQL).toContain("prod.cost, public.warehouse_ops_scrap_loss(prod.cost, v_dan, v_origen, v_crma),");
    expect(SQL).toContain("unit_cost = prod.cost, total_loss = public.warehouse_ops_scrap_loss(prod.cost, coalesce(damaged_pieces, case when scrap_type = 'sample' then 0 else total_pieces end), return_type, crma),");
    expect(SQL).not.toContain("* total_pieces");
  });

  it("recalcula solo las mermas vinculadas al catálogo; las de fuera de catálogo no se tocan", () => {
    const update = SQL.slice(SQL.indexOf("update public.warehouse_reports r"), SQL.indexOf("-- 5. Comprobaciones"));
    expect(update).toContain("set unit_cost  = pp.price,");
    expect(update).toContain("total_loss = public.warehouse_ops_scrap_loss(pp.price, coalesce(r.damaged_pieces, case when r.scrap_type = 'sample' then 0 else r.total_pieces end), r.return_type, r.crma)");
    expect(update).toContain("where r.kind = 'scrap' and r.product_id = pp.id and coalesce(r.product_not_in_catalog, false) = false");
  });

  it("registro: cabecera en español, marcador y checksum del cuerpo", () => {
    expect(SQL.startsWith("-- 272: Merma: el monto por pieza es el PRECIO DE VENTA")).toBe(true);
    const [cuerpo, registro] = SQL.split("-- @ledger-below");
    const sha = createHash("sha256").update(cuerpo, "utf8").digest("hex");
    expect(registro).toContain(`values ('272_merma_precio_de_venta.sql', '${sha}')`);
  });

  it("la pantalla habla de precio, no de costo", () => {
    expect(ASISTENTE).toContain('t("No price", "Sin precio")');
    expect(ASISTENTE).toContain("This product has no price in the catalog; the loss is saved without a $ amount.");
    expect(ASISTENTE).toContain('t("Sales price per piece (optional)", "Precio de venta por pieza (opcional)")');
    expect(LISTA).toContain('t("Price per piece (when reported)", "Precio por pieza (al reportar)")');
    expect(LISTA).toContain('t("Sales price per piece", "Precio de venta por pieza")');
    // (La explicación de los totales se quitó de la pantalla: dueño, 10 nov, «quita todo ese texto».)
    for (const s of [ASISTENTE, LISTA]) {
      // Ningún texto de pantalla dice «cost» (el campo `p.cost` del código sí puede aparecer dentro de un ${...}).
      expect(s).not.toMatch(/t\("[^"]*(?<!\.)\b[Cc]ost\b[^"]*",/);
      expect(s).not.toMatch(/t\(`[^`]*(?<!\.)\b[Cc]ost\b[^`]*`,/);
    }
    expect(COLUMNAS_EXCEL.find((c) => c.id === "costo")).toMatchObject({ en: "$ loss", es: "Pérdida $" });
  });
});

describe("Roberto: el fleje no se rompió, lo apretaron de más", () => {
  it("`strap` cambia de etiqueta y conserva el valor (los reportes viejos siguen con nombre)", () => {
    expect(MOTIVOS_DE_MERMA.find((o) => o.v === "strap")).toEqual({ v: "strap", en: "Strapped too tight", es: "Flejado demasiado apretado" });
    expect(etiquetaDeOpcion("scrap", "reason", "strap", "en")).toBe("Strapped too tight");
    expect(etiquetaDeOpcion("scrap", "reason", "strap", "es")).toBe("Flejado demasiado apretado");
    expect(MOTIVOS_DE_MERMA.map((o) => o.v)).toContain("strap");
  });
});
