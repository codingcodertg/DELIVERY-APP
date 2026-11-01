import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { COLUMNAS_DE_LA_FICHA, COLUMNAS_DE_LA_FICHA_AL_VER, columnasDeLaFicha, GRUPOS } from "./reglas";

/**
 * La ficha de cliente en tres columnas fijas, cada tarjeta con su alto (D-766, 2026-10-30, la hoja del dueño). Sustituye a
 * las columnas que fluían de D-745: con ellas, qué tarjeta caía debajo de cuál dependía del alto de la de al lado.
 */

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("las columnas de la ficha", () => {
  it("son las de la hoja: Cuenta + Estado / Contacto / Crédito + Otros; cada grupo sale en una y solo una", () => {
    expect(COLUMNAS_DE_LA_FICHA).toEqual([["cuenta", "estado"], ["contacto"], ["credito", "otros"]]);
    expect([...COLUMNAS_DE_LA_FICHA.flat()].sort()).toEqual(GRUPOS.map((g) => g.key).sort());
  });
  it("D-786: al VER, «Otros» baja debajo de «Contacto»; al crear o editar, sigue a la derecha", () => {
    expect(COLUMNAS_DE_LA_FICHA_AL_VER).toEqual([["cuenta", "estado"], ["contacto", "otros"], ["credito"]]);
    expect([...COLUMNAS_DE_LA_FICHA_AL_VER.flat()].sort()).toEqual(GRUPOS.map((g) => g.key).sort());
    expect(columnasDeLaFicha(false)).toBe(COLUMNAS_DE_LA_FICHA_AL_VER);
    expect(columnasDeLaFicha(true)).toBe(COLUMNAS_DE_LA_FICHA);
  });
  it("D-786: al VER, «Otros» baja debajo de «Contacto»; al crear o editar, sigue a la derecha", () => {
    expect(COLUMNAS_DE_LA_FICHA_AL_VER).toEqual([["cuenta", "estado"], ["contacto", "otros"], ["credito"]]);
    expect([...COLUMNAS_DE_LA_FICHA_AL_VER.flat()].sort()).toEqual(GRUPOS.map((g) => g.key).sort());
    expect(columnasDeLaFicha(false)).toBe(COLUMNAS_DE_LA_FICHA_AL_VER);
    expect(columnasDeLaFicha(true)).toBe(COLUMNAS_DE_LA_FICHA);
  });
  const ficha = sinComentarios(leer("src/app/customers/FichaDeCliente.tsx"));
  it("una rejilla de tres columnas que no estira (items-start), no columnas que fluyen", () => {
    expect(ficha).toContain('<div className="grid gap-4 items-start md:grid-cols-3" data-tarjetas-de-la-ficha>');
    expect(ficha).toContain('{columnasDeLaFicha(editando).map((claves, i) => (');
    expect(ficha).toContain("claves.includes(grupo.key)");
    expect(ficha).not.toContain("columns-2");
    expect(ficha).not.toContain("break-inside-avoid");
  });
  it("«Campos ocultos» y «Archivos» van al pie de la última columna", () => {
    expect(ficha).toContain("{!esVendedor && i === columnasDeLaFicha(editando).length - 1 && (");
    const desde = ficha.indexOf("data-tarjetas-de-la-ficha");
    expect(ficha.slice(desde, ficha.indexOf("data-solo-no-vendedor"))).toContain("filasPorGrupo()");
  });
});
