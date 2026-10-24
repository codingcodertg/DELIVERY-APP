import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ANCHO_POR_DEFECTO, ANCHOS_DE_PARTIDA, anchoDePartida, claveDeAncho, llaveDeAnchos, tiendasDeLaCelda } from "./anchos";
import { COLUMNAS } from "./reglas";
import { COLUMN_WIDTHS } from "@/lib/use-col-widths";

/* D-673. Roberto, 2026-10-24, con la lista de Clientes: «Instead of showing all, show store+3 or +2 so it doesnt take up
 * more space», «Columns should be adjustable to see info» y «Lets not wrap text so that it doesn't go down and make the row
 * thicker». Medido en el demo (1440 y 390 px): todas las filas de 39 px, «RDZ McAllen +1», y arrastrar 120 px el asa de
 * «Cuenta» la lleva de 260 a 380 y lo recuerda. */
describe("anchos de la lista de Clientes", () => {
  it("cada columna elegible tiene su ancho de partida, y las claves no chocan con las de Órdenes", () => {
    for (const c of COLUMNAS) expect(ANCHOS_DE_PARTIDA[c.key], c.key).toBeGreaterThan(0);
    expect(anchoDePartida("account")).toBe(260);
    expect(anchoDePartida("no_existe")).toBe(ANCHO_POR_DEFECTO);
    // «account» existe también en Órdenes, con otro ancho: con el prefijo, el de Órdenes no manda aquí.
    expect(COLUMN_WIDTHS.account).toBeDefined();
    expect(COLUMN_WIDTHS[claveDeAncho("account")]).toBeUndefined();
    expect(llaveDeAnchos("u1")).toBe("rtg_customers_colw_u1");
  });
  it("la celda «Tienda»: la de la fila que se enseña y las demás aparte, para «+N»", () => {
    const filas = [{ id: 1, store: "BRO" }, { id: 2, store: "MCA" }, { id: 3, store: "PHR" }];
    expect(tiendasDeLaCelda(filas, filas[1])).toEqual({ principal: filas[1], otras: [filas[0], filas[2]] });
    expect(tiendasDeLaCelda([filas[0]], filas[0]).otras).toEqual([]);
  });
  it("la tabla es de anchos fijos que se arrastran (como Órdenes) y la tienda va con «+N», no todas las pastillas", () => {
    const lista = readFileSync("src/app/customers/Clientes.tsx", "utf8").split("\r\n").join("\n");
    expect(lista).toContain('<table className="tbl-resize text-sm" style={anchoDeTabla(colsVisibles.map((c) => ancho(c.key)))} data-tabla-de-clientes>');
    expect(lista).toContain("onMouseDown={colw.startResize(claveDeAncho(c.key), anchoDePartida(c.key))}");
    expect(lista).toContain("const { principal: p, otras } = tiendasDeLaCelda(filas, c);");
    expect(lista).toContain("+{otras.length}</span>");
    expect(lista).not.toContain("{filas.map((f) => (");
    // `tbl-resize`: ni las celdas ni las cabeceras saltan de línea; lo que no cabe, «…».
    const css = readFileSync("src/app/globals.css", "utf8");
    expect(css).toContain("table.tbl-resize td { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }");
  });
});
