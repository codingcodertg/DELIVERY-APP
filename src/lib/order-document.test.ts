import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { documentoPrincipal, filaFacturaOEstimacion } from "./order-document";
import type { OrderTypeRule } from "./types";

/**
 * El número de documento resaltado al ver una orden (D-NEXT). Las reglas son las de producción,
 * medidas por el orquestador en `settings.order_type_rules`; los números, inventados.
 */

const REGLAS: Record<string, OrderTypeRule> = {
  Customer: { docRef: "invoice", storeToStore: false },
  Intertienda: { docRef: "po", storeToStore: true, homeIsDestination: true },
  Transfer: { docRef: "estimate", storeToStore: true },
  // Los otros dos valores que admite Ajustes → Datos.
  Cualquiera: { docRef: "any", storeToStore: true },
  Ninguno: { docRef: "none", storeToStore: true },
};

// Una orden con los cuatro números puestos: cada tipo tiene que elegir el suyo, no el primero que vea.
const TODOS = { invoice_num: " INV-100 ", po2: "PO-200", estimate_num: "EST-300", so_num: "SO-400" };
const campo = (order_type: string, extra: object = TODOS) => documentoPrincipal({ order_type, ...extra }, REGLAS);

describe("qué documento se resalta, según el tipo", () => {
  it("Customer: la factura, sin espacios, con su etiqueta corta", () => {
    expect(campo("Customer")).toEqual({ campo: "invoice_num", corto: "INV", en: "Invoice #", es: "Factura #", numero: "INV-100" });
  });

  it("Intertienda: el PO, aunque tenga factura", () => {
    expect(campo("Intertienda")?.campo).toBe("po2");
    expect(campo("Intertienda")?.numero).toBe("PO-200");
  });

  it("Transfer: la estimación", () => {
    expect(campo("Transfer")).toMatchObject({ campo: "estimate_num", corto: "EST", numero: "EST-300" });
  });

  it("el documento que el tipo exige sale aunque falte, vacío", () => {
    expect(campo("Intertienda", { invoice_num: "INV-100" })).toMatchObject({ campo: "po2", numero: "" });
  });

  it("«cualquiera»: el primero que tenga, en el orden de missingFields (PO, factura, SO)", () => {
    expect(campo("Cualquiera", { invoice_num: "INV-100", so_num: "SO-400" })?.campo).toBe("invoice_num");
    expect(campo("Cualquiera", { so_num: "SO-400" })?.campo).toBe("so_num");
    expect(campo("Cualquiera", TODOS)?.campo).toBe("po2");
    expect(campo("Cualquiera", {})).toMatchObject({ campo: "po2", numero: "" });
  });

  it("«ninguno»: la factura si la hay; si no, nada", () => {
    expect(campo("Ninguno", { invoice_num: "INV-100" })?.campo).toBe("invoice_num");
    expect(campo("Ninguno", { po2: "PO-200" })).toBeNull();
  });
});

describe("la fila «Factura / Estimación #» del resumen", () => {
  it("no repite lo que ya está resaltado", () => {
    const d = { order_type: "Customer", invoice_num: "INV-100" };
    expect(filaFacturaOEstimacion(d, documentoPrincipal(d, REGLAS))).toBeNull();
  });

  it("sigue a la vista cuando el resaltado es otro: la factura de una Intertienda", () => {
    const d = { order_type: "Intertienda", invoice_num: "INV-100", po2: "PO-200" };
    expect(filaFacturaOEstimacion(d, documentoPrincipal(d, REGLAS))).toBe("INV-100");
  });

  it("sin factura ni estimación, no hay fila", () => {
    const d = { order_type: "Intertienda", po2: "PO-200" };
    expect(filaFacturaOEstimacion(d, documentoPrincipal(d, REGLAS))).toBeNull();
  });
});

describe("el modal lo usa al ver la orden", () => {
  const modal = readFileSync("src/components/OrderModal.tsx", "utf8").split("\r\n").join("\n");

  it("sale de la orden guardada y de las reglas de Ajustes", () => {
    expect(modal).toContain("const documento = existing ? documentoPrincipal(existing, settings.order_type_rules) : null;");
  });

  it("el chip de cabecera enseña ese documento, no siempre la factura", () => {
    expect(modal).toContain("{documento.corto} {documento.numero}");
    expect(modal).not.toContain("INV {existing.invoice_num}");
  });

  it("arriba del resumen, grande y con botón de copiar", () => {
    const resumen = modal.slice(modal.indexOf("// Compact preview"), modal.indexOf("{/* Role-targeted notes"));
    expect(resumen).toContain('<div className="doc-destacado">');
    expect(resumen).toContain("{documento.numero || \"—\"}");
    expect(resumen).toContain("onClick={() => copiaDocumento(documento.numero)}");
    expect(resumen).toContain("filaFacturaOEstimacion(existing, documento)");
    // El resaltado va antes de la rejilla de detalles.
    expect(resumen.indexOf("doc-destacado")).toBeLessThan(resumen.indexOf('<div className="detail-grid">'));
  });

  it("copiar no rompe si el navegador lo niega", () => {
    const copia = modal.slice(modal.indexOf("const copiaDocumento = async"), modal.indexOf("const copiaDocumento = async") + 400);
    expect(copia).toMatch(/try \{\n\s*await navigator\.clipboard\.writeText\(numero\);/);
    expect(copia).toContain("} catch {");
  });
});
