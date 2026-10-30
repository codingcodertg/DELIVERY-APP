import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { recogidaLibre, sinRecogidaDeTienda } from "./recogida-libre";
import { aplicaTipo, type ContextoDelUsuario } from "./order-sites";
import type { NamedLocation, OrderTypeRule } from "./types";

/** Recogida libre en «Otro» y «Proveedor»: se teclea, no se elige entre nuestras tiendas (D-NEXT, 2026-10-29). */

const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const TIENDAS: NamedLocation[] = [{ name: "Tienda Norte", address: "100 Norte Ave" }, { name: "Tienda Sur", address: "200 Sur Blvd" }];
// Las reglas de producción, leídas el 2026-10-29.
const REGLAS: Record<string, OrderTypeRule> = {
  Other: { docRef: "none", anyOrigin: true },
  Proveedor: { docRef: "hidden", hasCustomer: false, storeToStore: false },
  Customer: { docRef: "invoice", storeToStore: false },
  Intertienda: { docRef: "po", storeToStore: true, homeIsDestination: true },
  Transfer: { docRef: "estimate", storeToStore: true },
};

describe("qué tipos recogen donde sea", () => {
  it("Otro (origen libre) y Proveedor (sin cliente); Customer, Intertienda y Transfer no", () => {
    expect(recogidaLibre(REGLAS.Other)).toBe(true);
    expect(recogidaLibre(REGLAS.Proveedor)).toBe(true);
    expect(recogidaLibre(REGLAS.Customer)).toBe(false);
    expect(recogidaLibre(REGLAS.Intertienda)).toBe(false);
    expect(recogidaLibre(REGLAS.Transfer)).toBe(false);
    expect(recogidaLibre({})).toBe(false);
  });
});

describe("la recogida al cambiar de tipo", () => {
  const c: ContextoDelUsuario = { rol: "sales", miTienda: "Tienda Norte", tipos: Object.keys(REGLAS), tiendas: TIENDAS, reglas: REGLAS };
  it("una recogida que es una de nuestras tiendas se vacía; una tecleada se respeta", () => {
    expect(sinRecogidaDeTienda({ pickup_name: " tienda norte ", pickup_address: "100 Norte Ave" }, TIENDAS)).toEqual({ pickup_name: "", pickup_address: "" });
    expect(sinRecogidaDeTienda({ pickup_name: "Dal-Tile Pharr", pickup_address: "1 Industrial Dr" }, TIENDAS)).toEqual({ pickup_name: "Dal-Tile Pharr", pickup_address: "1 Industrial Dr" });
    expect(sinRecogidaDeTienda({ pickup_name: "", pickup_address: "" }, TIENDAS)).toEqual({ pickup_name: "", pickup_address: "" });
  });
  it("de Customer (recogida = la tienda) a Proveedor u Otro: la recogida queda vacía para teclearla; «Vendido desde» se queda", () => {
    const cliente = { order_type: "Customer", store: "Tienda Norte", pickup_name: "Tienda Norte", pickup_address: "100 Norte Ave" };
    for (const tipo of ["Proveedor", "Other"]) {
      const d = aplicaTipo(cliente, tipo, c);
      expect(d.store).toBe("Tienda Norte");
      expect(d.pickup_name).toBe("");
      expect(d.pickup_address).toBe("");
    }
  });
  it("control: a Customer no se le toca la recogida", () => {
    const d = aplicaTipo({ order_type: "Other", store: "Tienda Norte", pickup_name: "Tienda Norte", pickup_address: "100 Norte Ave" }, "Customer", c);
    expect(d.pickup_name).toBe("Tienda Norte");
  });
});

describe("la ficha", () => {
  const modal = sinComentarios(leer("src/components/OrderModal.tsx"));
  const combo = sinComentarios(leer("src/components/LocationCombo.tsx"));
  it("con recogida libre, el control abre en modo escribir y «Vendido desde» no pisa la recogida", () => {
    expect(modal).toContain("const recogidaLibreDelTipo = recogidaLibre(reglaDelTipo);");
    expect(modal).toContain("escribirPorDefecto={recogidaLibreDelTipo}");
    expect(modal.split("recogidaLibreDelTipo ? { ...p, store: v } : eligeOrigen(p, v, settings.stores)").length - 1).toBe(2);
    expect(modal).not.toContain("on={(v) => setD((p) => eligeOrigen(p, v, settings.stores))}");
  });
  it("el control: `escribirPorDefecto` abre en modo escribir cuando el nombre no es uno guardado", () => {
    expect(combo).toContain("escribirPorDefecto?: boolean;");
    expect(combo).toContain("const [manual, setManual] = useState(escribirPorDefecto ? !known : !!name && !known);");
  });
});
