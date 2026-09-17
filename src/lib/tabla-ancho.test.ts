import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { ROLE_DEFAULT_COLUMNS } from "./constants";

/**
 * La tabla ocupa el ancho con cualquier número de columnas (D-NEXT).
 *
 * El dueño: «only sales people gets the table cropped». Con `table-layout: fixed` y `width: auto`, el
 * ancho de la tabla es la SUMA de sus columnas; un vendedor ve seis y acababa a media pantalla. Lo que
 * decide esto es CSS, así que se lee la regla del CSS, que es lo que corre.
 */

const css = readFileSync("src/app/globals.css", "utf8").split("\r\n").join("\n");
const regla = (selector: string) => {
  const ini = css.indexOf(selector + " {");
  expect(ini, selector).toBeGreaterThan(0);
  return css.slice(ini, css.indexOf("}", ini) + 1);
};

describe("la regla de ancho", () => {
  it("la tabla se estira hasta el marco cuando sus columnas no llegan", () => {
    const tabla = regla("table.tbl-resize");
    expect(tabla).toContain("min-width: 100%");
    expect(tabla).not.toContain("min-width: 0");
  });

  it("y sigue siendo la suma de sus columnas cuando se pasan, que es lo que deja el desplazamiento", () => {
    const tabla = regla("table.tbl-resize");
    expect(tabla).toContain("width: auto");
    expect(tabla).toContain("table-layout: fixed");
  });

  it("el marco ya no se encoge al contenido (D-232): con `max-content` el estirado no ocurriría", () => {
    const marco = regla(".tbl-scroll.tbl-fit");
    expect(marco).not.toContain("max-content");
    expect(marco).toContain("max-width: 100%");
  });

  it("en el teléfono manda la tabla de tarjetas, que se pone al 100% y sin mínimo", () => {
    const telefono = regla("table.orders-responsive");
    expect(telefono).toContain("width: 100% !important");
    expect(telefono).toContain("min-width: 0 !important");
  });
});

describe("a quién le pasaba y quién se beneficia", () => {
  it("ventas ve menos columnas que los demás roles: por eso se le notaba", () => {
    const ventas = ROLE_DEFAULT_COLUMNS.sales!.length;
    expect(ventas).toBe(6);
    for (const rol of ["driver", "warehouse"] as const) {
      expect(ROLE_DEFAULT_COLUMNS[rol]!.length, rol).toBeGreaterThan(ventas);
    }
  });

  it("las cinco tablas redimensionables piden el marco, y todas ganan lo mismo", () => {
    const tsx: string[] = [];
    const recorre = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) recorre(p);
        else if (f.endsWith(".tsx")) tsx.push(p.split("\\").join("/"));
      }
    };
    recorre("src");
    let marcos = 0;
    for (const p of tsx) marcos += (readFileSync(p, "utf8").match(/tbl-scroll tbl-fit/g) ?? []).length;
    expect(tsx.length).toBeGreaterThanOrEqual(200); // control: el barrido ve la app entera
    expect(marcos).toBe(5);
  });
});
