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

describe("la hoja semanal usa la tabla estándar, un bloque por persona y semana", () => {
  const hoja = leer("src/components/timetracker/HojaSemanal.tsx");

  it("las filas son un TablaEstandar con id compartido por todos los bloques", () => {
    expect(hoja).toContain("<TablaEstandar");
    expect(hoja).toContain('export const ID_DE_LA_HOJA = "tt-hoja-semanal";');
    expect(hoja).toContain("id={ID_DE_LA_HOJA}");
  });

  it("no tiene una <table> hecha a mano", () => {
    expect(hoja).not.toMatch(/<table[\s>]/);
    expect(hoja).not.toMatch(/<thead|<tbody|<tfoot/);
  });

  it("el orden por defecto es por fecha, y las celdas y la fila de hoy tienen su clase", () => {
    expect(hoja).toContain('ordenInicial={{ clave: "dia", direccion: "asc" }}');
    expect(hoja).toContain('claseTabla="tt-hoja"');
    expect(hoja).toContain('"num tt-hoja-trabajo"');
    expect(hoja).toContain('"num tt-hoja-fuera"');
    expect(hoja).toContain('"tt-hoja-celda"');
    expect(hoja).toContain('"tt-hoja-hoy"');
  });

  it("cabecera con el nombre y la semana, y pie con OVER o AT OR BELOW, TOT HRS y el total", () => {
    expect(hoja).toContain('className="tt-hoja-nombre tt-nombre-de-trabajo"');
    expect(hoja).toContain('className="tt-hoja-total"');
    expect(hoja).toContain('t("hoja.over")');
    expect(hoja).toContain('t("hoja.atOrBelow")');
    expect(hoja).toContain('t("hoja.totHrs")');
  });

  it("los rótulos son los del Excel, con su grupo dentro del nombre de columna", () => {
    for (const clave of ["hoja.c.inicioEntrada", "hoja.c.inicioSalida", "hoja.c.inicioTrabajado", "hoja.c.comidaRegreso", "hoja.c.comidaFuera", "hoja.c.finSalida", "hoja.c.finTrabajado", "hoja.c.total"]) {
      expect(hoja, clave).toContain(clave);
    }
  });
});

describe("timetracker.css declara los tokens de la hoja desde la paleta del hub (sin bloque claro propio)", () => {
  const css = leer("src/app/timetracker/timetracker.css");
  const tokens = ["grupo", "trabajo", "fuera", "crema", "nombre", "sobre"];

  it("cada token está declarado en el bloque del módulo, y no hay bloque claro aparte", () => {
    for (const t of tokens) {
      expect(css, `--tt-hoja-${t}`).toMatch(new RegExp(`\\.timetracker-module\\{[^}]*--tt-hoja-${t}:`));
    }
    expect(css).not.toContain(':root[data-theme="light"] .timetracker-module{');
  });
});
