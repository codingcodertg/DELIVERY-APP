import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tiendasQueVe, todasLasMiasAutoAprueban } from "./auto-aprueban-las-mias";

/** D-NEXT: el chip de entrada de Órdenes mira las tiendas que ve quien entra, no todas las de Ajustes. */
const stores = [
  { name: "Tienda A", auto_approve: true },
  { name: "Tienda B", auto_approve: false },
  { name: "Tienda C", auto_approve: true },
];

describe("todasLasMiasAutoAprueban", () => {
  it("un vendedor de una tienda que auto-aprueba: sí, aunque otra tienda no", () => {
    expect(todasLasMiasAutoAprueban(stores, { role: "sales", store: "Tienda A", visible_stores: ["Tienda A"] })).toBe(true);
    expect(todasLasMiasAutoAprueban(stores, { role: "sales", store: "tienda a", visible_stores: null })).toBe(true);
  });
  it("si ve una que no auto-aprueba: no", () => {
    expect(todasLasMiasAutoAprueban(stores, { role: "sales", store: "Tienda B" })).toBe(false);
    expect(todasLasMiasAutoAprueban(stores, { role: "manager", store: "Tienda A", visible_stores: ["Tienda A", "Tienda B"] })).toBe(false);
  });
  it("admin, chofer, almacén o sin perfil: todas las de Ajustes, como antes", () => {
    expect(todasLasMiasAutoAprueban(stores, { role: "admin" })).toBe(false);
    expect(todasLasMiasAutoAprueban(stores, null)).toBe(false);
    expect(todasLasMiasAutoAprueban(stores.filter((s) => s.auto_approve), { role: "admin" })).toBe(true);
  });
  it("sin tiendas en Ajustes, false; una tienda del perfil que no existe en Ajustes cae a todas", () => {
    expect(todasLasMiasAutoAprueban([], { role: "sales", store: "Tienda A" })).toBe(false);
    expect(todasLasMiasAutoAprueban(stores, { role: "sales", store: "Otra" })).toBe(false);
  });
  it("tiendasQueVe: visibles, o la propia, o todas", () => {
    expect(tiendasQueVe({ role: "sales", store: "X", visible_stores: [" Tienda A ", ""] })).toEqual(["tienda a"]);
    expect(tiendasQueVe({ role: "sales", store: "Tienda B" })).toEqual(["tienda b"]);
    expect(tiendasQueVe({ role: "sales", store: "" })).toBeNull();
    expect(tiendasQueVe({ role: "warehouse", store: "Tienda B" })).toBeNull();
  });
});

describe("la pantalla", () => {
  it("Órdenes decide el chip de entrada y el chip «Pendiente» con las tiendas de quien mira", () => {
    const p = readFileSync(join(process.cwd(), "src/app/(app)/page.tsx"), "utf8").replace(/\r\n/g, "\n");
    expect(p).toContain("const autoApproveAll = todasLasMiasAutoAprueban(settings.stores, me);");
    expect(p).not.toContain("settings.stores.every((s) => s.auto_approve)");
  });
});
