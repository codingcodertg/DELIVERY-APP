import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mkDelivery } from "@/lib/__fixtures";
import type { Delivery, NamedLocation } from "@/lib/types";
import type { OrderTypeRules } from "@/lib/required";
import { alPartir } from "./intertienda-cliente";

const leer = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
const veces = (codigo: string, palabra: string) => codigo.split(palabra).length - 1;

const TIENDAS: NamedLocation[] = [
  { name: "RDZ McAllen", address: "1 Main St, McAllen, TX", lat: 26.2, lng: -98.23 },
  { name: "RDZ Pharr", address: "4 Cage Blvd, Pharr, TX" },
  { name: "RDZ Weslaco", address: "2 Texas Blvd, Weslaco, TX" },
];

const REGLAS: OrderTypeRules = {
  Customer: { storeToStore: false, docRef: "invoice" },
  Transfer: { storeToStore: true, docRef: "none" },
  Intertienda: { storeToStore: true, homeIsDestination: true, docRef: "any" },
};

describe("Intertienda Customer en los dos proveedores de datos", () => {
  it("los dos importan la regla de src/lib/intertienda-cliente", () => {
    for (const f of ["src/lib/data-provider.tsx", "src/lib/local-data-provider.tsx"]) {
      expect(leer(f)).toContain(`from "./intertienda-cliente"`);
    }
  });

  it("el real llama a la función de la 346 y traduce sus dos códigos de «no existe»", () => {
    const codigo = leer("src/lib/data-provider.tsx");
    expect(codigo).toContain(`rpc("activar_intertienda_cliente"`);
    expect(codigo).toContain("PGRST202");
    expect(codigo).toContain("42883");
  });

  it("el demo parte con alPartir en memoria", () => {
    expect(leer("src/lib/local-data-provider.tsx")).toContain("alPartir(");
  });

  it("cada proveedor llama a su ayudante en las tres escrituras (alta, etapa, edición): definición + 3 llamadas", () => {
    const real = leer("src/lib/data-provider.tsx");
    expect(veces(real, "parteSiPasaPorLaTienda") + veces(real, "partirRef.current?.(")).toBeGreaterThanOrEqual(4);
    const demo = leer("src/lib/local-data-provider.tsx");
    expect(veces(demo, "conLaPartidaDeLaTienda")).toBeGreaterThanOrEqual(4);
  });
});

describe("el flujo puro al aprobarse", () => {
  it("una orden de cliente aprobada, vendida en Pharr y recogida en McAllen: paso a acaba en Pharr, paso b sale de Pharr", () => {
    const madre = mkDelivery({
      id: "madre", order_no: 3333, order_code: "FV333", order_type: "Customer", stage: "approved",
      store: "RDZ Pharr", pickup_name: "RDZ McAllen", pickup_address: "1 Main St, McAllen, TX",
      delivery_name: "Ana Cliente", delivery_address: "55 Oak Rd, Edinburg, TX",
      delivery_date: "2026-11-20", delivery_fee: 40, relay_step: null, order_suffix: null,
    } as Partial<Delivery>);
    const r = alPartir(madre, REGLAS, TIENDAS, { id: "paso-b", ahora: "2026-11-18T15:00:00.000Z", creador: null, hoy: "2026-11-18" });
    expect(r).not.toBeNull();
    expect(r!.madre.delivery_name).toBe("RDZ Pharr");
    expect(r!.paso.id).toBe("paso-b");
    expect(r!.paso.pickup_name).toBe("RDZ Pharr");
    expect(r!.paso.delivery_name).toBe("Ana Cliente");
  });
});
