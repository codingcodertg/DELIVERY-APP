import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// La hoja semanal (2026-11-24): Nómina → Hojas de tiempo la enseña por defecto, con la tabla de siempre al lado.
// Se mira el FUENTE, igual que las demás pruebas de Nómina: el componente tiene que estar montado, los dos
// valores de la vista tienen que existir y los tokens de color tienen que estar declarados en la hoja de estilos.
const leer = (ruta: string) => readFileSync(join(process.cwd(), ruta), "utf8");

describe("Hojas de tiempo de Nómina: la hoja de Excel y la tabla", () => {
  const nomina = leer("src/components/timetracker/PayrollTimesheets.tsx");

  it("monta HojaSemanal", () => {
    expect(nomina).toContain("<HojaSemanal");
  });

  it("tiene la vista «hoja» y la vista «tabla», cada una con su botón", () => {
    expect(nomina).toContain('data-vista-de-horas="hoja"');
    expect(nomina).toContain('data-vista-de-horas="tabla"');
  });

  it("la tabla de siempre sigue montada al lado de la hoja", () => {
    expect(nomina).toContain("<TablaReducida");
  });
});

describe("timetracker.css declara los tokens de la hoja, en claro y en oscuro", () => {
  const css = leer("src/app/timetracker/timetracker.css");
  const tokens = ["cabecera", "grupo", "trabajo", "fuera", "crema", "nombre", "sobre", "domingo"];

  it("cada token tiene su valor por defecto (oscuro) y su valor en claro", () => {
    for (const t of tokens) {
      expect(css, `--tt-hoja-${t} oscuro`).toMatch(new RegExp(`\\.timetracker-module\\{[^}]*--tt-hoja-${t}:`));
      expect(css, `--tt-hoja-${t} claro`).toMatch(new RegExp(`:root\\[data-theme="light"\\] \\.timetracker-module\\{[^}]*--tt-hoja-${t}:`));
    }
  });
});
