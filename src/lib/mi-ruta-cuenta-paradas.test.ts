import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { paradasDeLaRuta } from "./gestor/paradas-numeradas";
import { cuentaDePallets } from "./lista-unica";

// D-601 (2026-10-19) · Ernesto (chofer): «Its not 14 stops, its 14 orders. Its calculating # of stops wrong». El encabezado de
// «Mi ruta» pintaba las FILAS de la cuenta de pallets (una por orden y tramo), no los SITIOS de la ruta.

const P = (ordenes: string[], lugar = "RDZ Pharr") => ({ tipo: "P" as const, ordenes, lugar, etiqueta: ordenes.map((o) => `P${o}`).join("·") });
const D = (orden: string) => ({ tipo: "D" as const, orden, etiqueta: `D${orden}` });

describe("Mi ruta: el encabezado cuenta paradas (sitios), no órdenes", () => {
  it("siete órdenes recogidas en la misma tienda y entregadas en siete sitios son 8 paradas, no 14 filas", () => {
    const ordenes = ["1", "2", "3", "4", "5", "6", "7"].map((id) => ({ id, delivery_address: `${id} Main St` }));
    const filas = [P(ordenes.map((o) => o.id)), ...ordenes.map((o) => D(o.id))];
    const paradas = paradasDeLaRuta(filas, ordenes).paradas.length;
    // La cuenta de pallets sigue teniendo una fila por orden y tramo: 7 recogidas + 7 entregas.
    const filasDeLaCuenta = cuentaDePallets([...ordenes.map(() => 1), ...ordenes.map(() => -1)], 10).totales.paradas;
    expect(filasDeLaCuenta).toBe(14);
    expect(paradas).toBe(8);
  });

  it("puerta: el encabezado usa los sitios numerados (`numeradas.paradas.length`), ya no las filas de la cuenta", () => {
    const pagina = readFileSync(new URL("../app/(app)/my-route/page.tsx", import.meta.url), "utf8");
    expect(pagina).toContain('{numeradas.paradas.length} {t("stops", "paradas")}');
    expect(pagina).not.toContain('{cuenta.totales.paradas} {t("stops", "paradas")}');
  });
});
