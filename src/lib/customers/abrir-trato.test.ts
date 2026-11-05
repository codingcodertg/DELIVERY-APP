import { describe, expect, it } from "vitest";
import { queHaceEsc, comoAbrirTrato, esDeLaOrden, ordenDeLaTarjeta, pideEnUnaOrden, tieneAccesoAlCotizador } from "./abrir-trato";

const orden = { clase: "orden" as const, href: "/?order=o1" };
const coti = { clase: "cotizacion" as const, href: "/estimator?quote=q1" };

describe("comoAbrirTrato (D-NEXT: el historial abre en una tarjeta)", () => {
  it("con Entregas, la orden abre la ficha de verdad y deja el enlace secundario", () => {
    expect(comoAbrirTrato(orden, { role: "sales", module_access: ["deliveries", "customers"] })).toEqual({ modo: "orden", enlace: "/?order=o1" });
    expect(comoAbrirTrato(orden, { role: "admin" })).toEqual({ modo: "orden", enlace: "/?order=o1" });
  });
  it("sin Entregas, la orden es de solo lectura y sin enlace a una app a la que no puede entrar", () => {
    expect(comoAbrirTrato(orden, { role: "sales", module_access: ["customers"] })).toEqual({ modo: "orden-solo-lectura", enlace: null });
  });
  it("la cotización siempre abre la hoja; el enlace solo con el Quote Builder", () => {
    expect(comoAbrirTrato(coti, { role: "sales", module_access: ["estimator"] })).toEqual({ modo: "cotizacion", enlace: "/estimator?quote=q1" });
    expect(comoAbrirTrato(coti, { role: "sales", module_access: ["customers"] })).toEqual({ modo: "cotizacion", enlace: null });
  });
  it("el Quote Builder: admin o el módulo", () => {
    expect(tieneAccesoAlCotizador({ role: "admin", module_access: null })).toBe(true);
    expect(tieneAccesoAlCotizador({ role: "manager", module_access: [] })).toBe(false);
  });
});

describe("la carga de UNA orden", () => {
  it("solo lo que la ficha lee", () => {
    expect(["settings", "profiles", "deliveries", "order_events"].every(pideEnUnaOrden)).toBe(true);
    expect(["notifications", "driver_shifts", "driver_availability", "driver_incidents", "driver_locations"].some(pideEnUnaOrden)).toBe(false);
  });
  it("lo que llega por realtime de otra orden no entra", () => {
    expect(esDeLaOrden("o1", { id: "o1" })).toBe(true);
    expect(esDeLaOrden("o1", { id: "o2" })).toBe(false);
    expect(esDeLaOrden("o1", { id: "e9", delivery_id: "o1" })).toBe(true);
    expect(esDeLaOrden("o1", { id: "o1", delivery_id: "o2" })).toBe(false);
  });
  it("la orden de la tarjeta: la exacta; en el demo, la de muestra cae en la primera", () => {
    const l = [{ id: "a" }, { id: "b" }];
    expect(ordenDeLaTarjeta(l, "b")).toEqual({ id: "b" });
    expect(ordenDeLaTarjeta(l, "z")).toBeNull();
    expect(ordenDeLaTarjeta(l, "demo-o-3")).toBeNull();
    expect(ordenDeLaTarjeta(l, "demo-o-3", true)).toEqual({ id: "a" });
    expect(ordenDeLaTarjeta([], "demo-o-3", true)).toBeNull();
  });
});

describe("Esc con la tarjeta abierta", () => {
  it("cierra solo la capa de arriba y retiene el Esc para que la ficha del cliente no se cierre", () => {
    expect(queHaceEsc("Escape", true)).toBe("cerrar");
    expect(queHaceEsc("Escape", false)).toBe("solo-retener");
    expect(queHaceEsc("Enter", true)).toBe("nada");
  });
  it("la ficha del cliente respeta un Esc ya atendido y la tarjeta escucha en captura", async () => {
    const { readFileSync } = await import("node:fs");
    expect(readFileSync("src/app/customers/FichaDeCliente.tsx", "utf8")).toMatch(/!e\.defaultPrevented && cierraLaFicha/);
    const tarjeta = readFileSync("src/app/customers/TarjetaDeTrato.tsx", "utf8");
    expect(tarjeta).toMatch(/addEventListener\("keydown", alPulsar, true\)/);
    expect(tarjeta).toContain("e.preventDefault()");
  });
});
