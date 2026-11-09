import { describe, it, expect } from "vitest";
import { escaparCsv, filasACsv, nombreCsv } from "./csv";

describe("escaparCsv", () => {
  it("deja el texto simple como está", () => {
    expect(escaparCsv("Julio")).toBe("Julio");
    expect(escaparCsv(5)).toBe("5");
    expect(escaparCsv(null)).toBe("");
    expect(escaparCsv(undefined)).toBe("");
  });

  it("entrecomilla cuando hay coma, comilla o salto de línea", () => {
    expect(escaparCsv("McAllen, TX")).toBe('"McAllen, TX"');
    expect(escaparCsv('dice "hola"')).toBe('"dice ""hola"""');
    expect(escaparCsv("línea1\nlínea2")).toBe('"línea1\nlínea2"');
  });

  it("neutraliza la inyección de fórmulas de Excel", () => {
    // Una celda que empieza por =,+,-,@ no debe ejecutarse al abrir el CSV.
    expect(escaparCsv("=SUM(A1:A2)")).toBe("'=SUM(A1:A2)");
    expect(escaparCsv("+1")).toBe("'+1");
    expect(escaparCsv("-1+2")).toBe("'-1+2");
    expect(escaparCsv("@cmd")).toBe("'@cmd");
  });
});

describe("filasACsv", () => {
  it("une cabeceras y filas con CRLF y escapa cada celda", () => {
    const csv = filasACsv(["Persona", "Tienda"], [["Julio", "McAllen, TX"], ["Ana", "Weslaco"]]);
    expect(csv).toBe('Persona,Tienda\r\nJulio,"McAllen, TX"\r\nAna,Weslaco');
  });
});

describe("nombreCsv", () => {
  it("arma el nombre con la fecha", () => {
    expect(nombreCsv("seguridad-usuarios", "2026-11-09")).toBe("seguridad-usuarios-2026-11-09.csv");
  });
});
