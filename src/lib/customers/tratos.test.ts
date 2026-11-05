import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  claveDeCuenta, claveDeTienda, clienteDeLaCuenta, mezclaTratos, patronExacto, SUFIJOS_DE_EMPRESA, tratoDeCotizacion, tratoDeOrden,
  type FilaParaUnir,
} from "./tratos";
import { CLASE_DE_HISTORIAL, historialDeLaBase, nombraVendedores, textoDeCambios, vendedoresDelHistorial } from "./edicion-como-solicitud";
import { borradorDeFila } from "@/lib/estimator/almacen";

const SQL = readFileSync(join(process.cwd(), "supabase/migrations/245_historial_del_cliente.sql"), "utf8");

describe("claveDeCuenta (gemela de erp.clave_de_cuenta)", () => {
  it("quita mayúsculas, puntuación, acentos y sufijos de empresa", () => {
    expect(claveDeCuenta("AIDEN JETT CONSTRUCTION, LLC")).toBe(claveDeCuenta("Aiden  Jett Construction"));
    expect(claveDeCuenta("MatMar Construction LLC")).toBe(claveDeCuenta("MATMAR CONSTRUCTION LLC"));
    expect(claveDeCuenta("Zuñiga Construction")).toBe("zuniga construction");
    expect(claveDeCuenta("Peña & Co.")).toBe("pena and");
    expect(claveDeCuenta("H&O HOMES INC.")).toBe("h and o homes");
  });
  it("en blanco no es ninguna cuenta", () => {
    expect(claveDeCuenta("")).toBe("");
    expect(claveDeCuenta("  , LLC ")).toBe("");
    expect(claveDeCuenta(null)).toBe("");
  });
  it("la migración usa los mismos sufijos y el mismo ejemplo", () => {
    expect(SQL).toContain(`array[${SUFIJOS_DE_EMPRESA.map((s) => `'${s}'`).join(", ")}]`);
    expect(SQL).toContain("erp.clave_de_cuenta('Peña & Co.') <> 'pena and'");
  });
});

describe("claveDeTienda", () => {
  it("nombre de Entregas y código de Clientes dan lo mismo", () => {
    expect(claveDeTienda("RDZ Brownsville")).toBe("BRO");
    expect(claveDeTienda(" bro ")).toBe("BRO");
    expect(claveDeTienda("RDZ  Mission")).toBe("MIS");
    expect(claveDeTienda(null)).toBe("");
  });
});

describe("clienteDeLaCuenta: solo lo exacto", () => {
  const f = (id: number, account: string, store: string, archived_at: string | null = null): FilaParaUnir => ({ id, account, store, archived_at });
  const filas = [
    f(1418, "AIDEN JETT CONSTRUCTION, LLC", "PHR"), f(1419, "AIDEN JETT CONSTRUCTION, LLC", "MCA"),
    f(2098, "LA CANTERA STONES", "EDG"),
    f(2656, "VILLANUEVA CONSTRUCTION", "PHR"), f(2657, "VILLANUEVA CONSTRUCTION", "MCA"),
    f(1884, "H&A RGV CONSTRUCTION", "BRO", "2026-01-01"),
    f(7, "DOBLE", "BRO"), f(8, "Doble LLC", "BRO"),
  ];
  it("la de la misma tienda", () => expect(clienteDeLaCuenta(filas, "AIDEN JETT CONSTRUCTION", "RDZ Pharr")).toBe(1418));
  it("sin fila en esa tienda, la única que hay", () => expect(clienteDeLaCuenta(filas, "La Cantera Stones", "RDZ Pharr")).toBe(2098));
  it("sin fila en esa tienda y varias en otras: nada", () => expect(clienteDeLaCuenta(filas, "VILLANUEVA CONSTRUCTION", "RDZ Mission")).toBeNull());
  it("dos en la misma tienda: nada", () => expect(clienteDeLaCuenta(filas, "doble", "RDZ Brownsville")).toBeNull());
  it("archivada: nunca", () => expect(clienteDeLaCuenta(filas, "H&A RGV CONSTRUCTION", "RDZ Brownsville")).toBeNull());
  it("en blanco o sin parecido: nada", () => {
    expect(clienteDeLaCuenta(filas, "", "RDZ Pharr")).toBeNull();
    expect(clienteDeLaCuenta(filas, "AIDEN JET", "RDZ Pharr")).toBeNull();
  });
});

describe("el historial principal", () => {
  const o = tratoDeOrden({ id: "abc", order_code: "FA100", order_suffix: "a", invoice_num: "INV-1", stage: "delivered", store: "RDZ Pharr", assigned_driver: "Ana", delivery_fee: "85.5", est_pallets: 3, actual_pallets: 4, delivery_date: "2026-10-20", created_at: "2026-10-01T00:00:00Z" });
  const q = tratoDeCotizacion({ id: "q1", estimate_num: "E-1", store: "RDZ Pharr", lines: [], printed_at: "2026-10-22T10:00:00Z", created_at: "2026-10-21T10:00:00Z" });
  const q2 = tratoDeCotizacion({ id: "q2", estimate_num: "E-2", lines: "roto", created_at: "2026-09-01T10:00:00Z" });
  it("una orden: número, factura, etapa, chofer, monto, tarimas (las del almacén mandan) y enlace", () => {
    expect(o).toMatchObject({ clase: "orden", numero: "FA100a", factura: "INV-1", estado: "delivered", chofer: "Ana", monto: 85.5, tarimas: 4, fecha: "2026-10-20", href: "/?order=abc" });
  });
  it("una cotización: número, impresa o borrador, enlace; un `lines` roto no revienta", () => {
    expect(q).toMatchObject({ clase: "cotizacion", numero: "E-1", estado: "printed", href: "/estimator?quote=q1", monto: null });
    expect(q2).toMatchObject({ estado: "draft", monto: null });
  });
  it("juntas, lo más nuevo primero, y el filtro por tipo", () => {
    expect(mezclaTratos([o], [q, q2]).map((x) => x.id)).toEqual(["q1", "abc", "q2"]);
    expect(mezclaTratos([o], [q, q2], "orden").map((x) => x.id)).toEqual(["abc"]);
    expect(mezclaTratos([o], [q, q2], "cotizacion").map((x) => x.id)).toEqual(["q1", "q2"]);
  });
  it("el patrón del nombre no deja comodines", () => {
    expect(patronExacto(" 100% Homes_LLC ")).toBe("100\\% Homes\\_LLC");
  });
});

describe("la actividad: clases nuevas, vendedor con nombre, texto del cambio", () => {
  it("merge, review, corrected y rep se leen (no caen a 'edit')", () => {
    for (const k of ["merge", "review", "corrected", "rep"] as const) {
      expect(CLASE_DE_HISTORIAL[k]).toBeTruthy();
      expect(historialDeLaBase({ id: 1, customer_id: 2, at: "2026-11-05T00:00:00Z", kind: k }).kind).toBe(k);
      expect(SQL).toContain(`'${k}'`);
    }
  });
  it("el uuid del vendedor se cambia por su nombre", () => {
    const h = { before: { rep_id: "u1" }, after: { rep_id: "u2" } };
    expect(vendedoresDelHistorial(h)).toEqual(["u1", "u2"]);
    nombraVendedores(h, (id) => (id === "u1" ? "Ana" : null));
    expect(h).toEqual({ before: { rep_id: "Ana" }, after: { rep_id: "u2" } });
  });
  it("antes → después, y en un alta solo el valor", () => {
    expect(textoDeCambios({ kind: "edit", before: { phone: "1" }, after: { phone: "2" } }, "en")[0]).toMatch(/: 1 → 2$/);
    expect(textoDeCambios({ kind: "create", before: null, after: { account: "Acme" } }, "es")[0]).toMatch(/: Acme$/);
    expect(textoDeCambios({ kind: "create", before: null, after: null }, "es")).toEqual([]);
  });
});

describe("Quote Builder: el cliente elegido viaja en la cotización", () => {
  it("borradorDeFila conserva customer_id si lo hay, y no lo inventa si no", () => {
    expect(borradorDeFila({ customer: { full_name: "A", company: "B", phone: "", customer_id: 1418 } }).customer.customer_id).toBe(1418);
    expect("customer_id" in borradorDeFila({ customer: { full_name: "A" } }).customer).toBe(false);
  });
});

describe("diaDeTexas", () => {
  it("una fecha se queda; una hora UTC de madrugada es el día anterior en Texas", async () => {
    const { diaDeTexas } = await import("./tratos");
    expect(diaDeTexas("2026-10-20")).toBe("2026-10-20");
    expect(diaDeTexas("2026-10-21T03:00:00Z")).toBe("2026-10-20");
    expect(diaDeTexas("")).toBe("");
  });
});
