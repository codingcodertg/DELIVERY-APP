import { describe, expect, it } from "vitest";
import { saltoDirectoALista, saltosEnLaFila } from "./etapas-en-la-fila";
import type { OrderTypeRules } from "./required";

/**
 * Reunión del 11 nov (idea de Pablo y Carlos, McAllen): almacén puede saltarse «Preparando» e ir de «Aprobada» directo a
 * «Lista», pero entonces la app le pide la tarifa Y los pallets juntos, y escribe los dos pasos de siempre.
 */
const almacen = { id: "w", role: "warehouse", full_name: "W", permissions: [] } as never;
const ventas = { id: "s", role: "sales", full_name: "S", permissions: [] } as never;
const reglas = {} as OrderTypeRules;

describe("saltarse «Preparando»", () => {
  it("almacén en una aprobada: ofrece «Lista» con tarifa y pallets", () => {
    expect(saltoDirectoALista(almacen, { stage: "approved", order_type: "Customer" } as never)).toEqual({ destino: "ready", confirmacion: "tarifa_y_pallets" });
  });
  it("no se ofrece fuera de «Aprobada» ni a quien no prepara", () => {
    expect(saltoDirectoALista(almacen, { stage: "fulfilling", order_type: "Customer" } as never)).toBeNull();
    expect(saltoDirectoALista(almacen, { stage: "pending", order_type: "Customer" } as never)).toBeNull();
    expect(saltoDirectoALista(ventas, { stage: "approved", order_type: "Customer" } as never)).toBeNull();
  });
  it("en la burbuja va en su lugar: después de «Preparando» y antes de lo que sigue", () => {
    const destinos = saltosEnLaFila(almacen, { stage: "approved", order_type: "Customer" } as never, reglas, true).map((s) => s.destino);
    expect(destinos.indexOf("ready")).toBe(destinos.indexOf("fulfilling") + 1);
  });
  it("el camino normal de dos pasos no cambia: desde «Preparando», «Lista» sigue pidiendo solo los pallets", () => {
    const s = saltosEnLaFila(almacen, { stage: "fulfilling", order_type: "Customer" } as never, reglas, true).find((x) => x.destino === "ready");
    expect(s?.confirmacion).toBe("pallets");
  });
});
