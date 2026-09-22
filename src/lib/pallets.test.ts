import { describe, expect, it } from "vitest";
import { aLaDecima, palletsDeLaOrden, sumaPallets } from "./pallets";

/** D-362 · Los pallets llevan fracciones y sumarlas deja cola. Los datos de aquí son los que el dueño vio. */
describe("sumar pallets no deja cola de decimales", () => {
  it("el caso de la captura: 4.43, no 4.430000000000001 — y el ORDEN de la suma decide", () => {
    // Medido: la cola depende del orden en que se suma, que es por qué salía en un chofer y no en otro.
    expect(4 + 0.4 + 0.03).toBe(4.430000000000001);
    expect(0.03 + 0.4 + 4).toBe(4.43);
    // La función da lo mismo en los dos órdenes, que es justo lo que se le pide.
    expect(sumaPallets([{ est_pallets: 4 }, { est_pallets: 0.4 }, { est_pallets: 0.03 }] as never)).toBe(4.4);
    expect(sumaPallets([{ est_pallets: 0.03 }, { est_pallets: 0.4 }, { est_pallets: 4 }] as never)).toBe(4.4);
  });
  it("y el de la cabecera del viaje: 12 menos la carga da 7.6, no 7.569999999999999", () => {
    expect(aLaDecima(12 - (4 + 0.4 + 0.03))).toBe(7.6);
  });
  it("los contados MANDAN sobre los estimados, y una orden sin ninguno vale 0", () => {
    expect(palletsDeLaOrden({ actual_pallets: 3, est_pallets: 9 } as never)).toBe(3);
    expect(palletsDeLaOrden({ actual_pallets: null, est_pallets: 9 } as never)).toBe(9);
    expect(palletsDeLaOrden({ actual_pallets: null, est_pallets: null } as never)).toBe(0);
    // Un cero contado no cae al estimado: contado es contado.
    expect(palletsDeLaOrden({ actual_pallets: 0, est_pallets: 9 } as never)).toBe(0);
  });
  it("NO redondea a entero: cuatro órdenes de 0.1 son 0.4, no 0", () => {
    expect(sumaPallets([{ est_pallets: 0.1 }, { est_pallets: 0.1 }, { est_pallets: 0.1 }, { est_pallets: 0.1 }] as never)).toBe(0.4);
    expect(sumaPallets([{ est_pallets: 0.03 }] as never)).toBe(0);      // por debajo de media décima sí baja a 0
    expect(sumaPallets([{ est_pallets: 0.06 }] as never)).toBe(0.1);
  });
  it("una lista vacía suma 0, y un dato roto no contamina la suma", () => {
    expect(sumaPallets([])).toBe(0);
    expect(sumaPallets([{ est_pallets: 2 }, { est_pallets: Number.NaN }, { est_pallets: 1 }] as never)).toBe(3);
    expect(aLaDecima(Number.NaN)).toBe(0);
  });
});
