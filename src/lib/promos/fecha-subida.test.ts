import { describe, expect, it } from "vitest";
import { fechaDeSubida, lineaDeSubida, tooltipDeQoh } from "./fecha-subida";

// 14 nov 2026 a las 15:05 en Chicago (CST, UTC-6, ya sin horario de verano) = 21:05 UTC.
const ISO = "2026-11-14T21:05:00.000Z";

describe("fecha de subida de una ronda de promos", () => {
  it("sale en hora de Chicago, no en la del aparato", () => {
    expect(fechaDeSubida(ISO, "en")).toContain("3:05");
    expect(fechaDeSubida(ISO, "en")).toContain("PM");
    expect(fechaDeSubida(ISO, "en")).toContain("Nov 14, 2026");
  });

  it("en español usa la misma zona y el formato de es-MX", () => {
    const es = fechaDeSubida(ISO, "es");
    expect(es).toContain("2026");
    expect(es).toContain("3:05");
    expect(es).toContain("p.m.");
  });

  it("el selector pide solo la fecha, sin hora", () => {
    expect(fechaDeSubida(ISO, "en", false)).not.toMatch(/\d:\d\d/);
  });

  it("la línea del encabezado nombra a quien subió", () => {
    expect(lineaDeSubida({ iso: ISO, lang: "en", nombre: "Ana" })).toBe(`Uploaded ${fechaDeSubida(ISO, "en")} by Ana`);
    expect(lineaDeSubida({ iso: ISO, lang: "es", nombre: "Ana" })).toBe(`Subido el ${fechaDeSubida(ISO, "es")} por Ana`);
  });

  it("sin nombre legible dice «alguien», y sin usuario solo dice la fecha", () => {
    expect(lineaDeSubida({ iso: ISO, lang: "es", nombre: "" })).toMatch(/ por alguien$/);
    expect(lineaDeSubida({ iso: ISO, lang: "en", nombre: "" })).toMatch(/ by someone$/);
    expect(lineaDeSubida({ iso: ISO, lang: "en", nombre: null })).toBe(`Uploaded ${fechaDeSubida(ISO, "en")}`);
    expect(lineaDeSubida({ iso: ISO, lang: "es", nombre: null })).toBe(`Subido el ${fechaDeSubida(ISO, "es")}`);
  });

  it("el tooltip de QOH lleva el «as of» y la advertencia de que no es en vivo", () => {
    expect(tooltipDeQoh(ISO, "en")).toBe(`QOH as of ${fechaDeSubida(ISO, "en")} (uploaded file; not live)`);
    expect(tooltipDeQoh(ISO, "es")).toBe(`Existencias al ${fechaDeSubida(ISO, "es")} (archivo subido; no se actualizan)`);
  });
});
