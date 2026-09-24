import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { pastillasDeOrdenes, PASTILLA_TODAS } from "./pastillas-de-ordenes";
import { PESTANA_DOCUMENTO_PENDIENTE } from "./documento-pendiente";

/**
 * La pastilla «Todas» de Órdenes (D-313).
 *
 * El dueño: *«el filtro de invoices también falta el filtro de all en órdenes para que lo agregues»*.
 * Antes, volver a ver todas era **volver a pulsar la pastilla encendida**, y eso no se descubre.
 */

const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");
const pagina = leer("src/app/(app)/page.tsx");

const ETAPAS = ["draft", "pending", "approved", "ready", "delivered"];
const CUENTAS = { all: 42, draft: 3, pending: 5, approved: 10, ready: 4, delivered: 20, [PESTANA_DOCUMENTO_PENDIENTE]: 7 };
const claves = (p: { key: string }[]) => p.map((x) => x.key);

describe("qué pastillas salen y en qué orden", () => {
  const fila = pastillasDeOrdenes({ etapas: ETAPAS, todasAprueban: false, cuentas: CUENTAS, filtro: PASTILLA_TODAS });

  it("«Todas» va la primera, antes de cualquier etapa", () => {
    expect(claves(fila)[0]).toBe(PASTILLA_TODAS);
  });

  it("después las etapas del rol, en su orden, y la de factura pendiente al final", () => {
    expect(claves(fila)).toEqual([PASTILLA_TODAS, ...ETAPAS, PESTANA_DOCUMENTO_PENDIENTE]);
  });

  it("y si este rol ve menos etapas, salen menos: la fila es la suya", () => {
    const corta = pastillasDeOrdenes({ etapas: ["approved", "ready"], todasAprueban: false, cuentas: CUENTAS, filtro: PASTILLA_TODAS });
    expect(claves(corta)).toEqual([PASTILLA_TODAS, "approved", "ready", PESTANA_DOCUMENTO_PENDIENTE]);
  });
});

describe("cuándo está encendida «Todas»", () => {
  const con = (filtro: string) => pastillasDeOrdenes({ etapas: ETAPAS, todasAprueban: false, cuentas: CUENTAS, filtro });

  it("sin etapa elegida, sí", () => {
    expect(con(PASTILLA_TODAS).find((p) => p.key === PASTILLA_TODAS)?.activa).toBe(true);
  });

  it("con una etapa elegida, no — y la encendida es esa", () => {
    const fila = con("approved");
    expect(fila.find((p) => p.key === PASTILLA_TODAS)?.activa).toBe(false);
    expect(fila.filter((p) => p.activa).map((p) => p.key)).toEqual(["approved"]);
  });

  it("y dentro de «Factura pendiente» tampoco: esa fila también es un filtro", () => {
    const fila = con(PESTANA_DOCUMENTO_PENDIENTE);
    expect(fila.find((p) => p.key === PASTILLA_TODAS)?.activa).toBe(false);
    expect(fila.filter((p) => p.activa).map((p) => p.key)).toEqual([PESTANA_DOCUMENTO_PENDIENTE]);
  });

  it("nunca hay dos encendidas", () => {
    for (const filtro of [PASTILLA_TODAS, ...ETAPAS, PESTANA_DOCUMENTO_PENDIENTE]) {
      expect(con(filtro).filter((p) => p.activa).length, filtro).toBe(1);
    }
  });
});

describe("la cuenta de «Todas»", () => {
  it("es la de todo lo que la persona ve, con sus demás filtros ya aplicados", () => {
    // Mismo criterio que las de etapa: las dos salen de `counts`, que se calcula sobre `visible`.
    const fila = pastillasDeOrdenes({ etapas: ETAPAS, todasAprueban: false, cuentas: CUENTAS, filtro: PASTILLA_TODAS });
    expect(fila.find((p) => p.key === PASTILLA_TODAS)?.cuenta).toBe(42);
  });

  it("y sin cuenta ninguna es cero, no un hueco", () => {
    const fila = pastillasDeOrdenes({ etapas: ["approved"], todasAprueban: false, cuentas: {}, filtro: PASTILLA_TODAS });
    expect(fila.map((p) => p.cuenta)).toEqual([0, 0]);
  });
});

describe("lo que ya decidía esta fila y no cambia", () => {
  it("si todas las tiendas aprueban solas, la pastilla de «pendiente» no sale", () => {
    const fila = pastillasDeOrdenes({ etapas: ETAPAS, todasAprueban: true, cuentas: CUENTAS, filtro: PASTILLA_TODAS });
    expect(claves(fila)).not.toContain("pending");
    expect(claves(fila)[0]).toBe(PASTILLA_TODAS);
  });

  it("la de «Factura pendiente» solo sale si hay algo pendiente (D-310)", () => {
    const sinNada = { ...CUENTAS, [PESTANA_DOCUMENTO_PENDIENTE]: 0 };
    expect(claves(pastillasDeOrdenes({ etapas: ETAPAS, todasAprueban: false, cuentas: sinNada, filtro: PASTILLA_TODAS })))
      .not.toContain(PESTANA_DOCUMENTO_PENDIENTE);
  });

  it("…o si se está dentro de ella, para que no desaparezca bajo el dedo al vaciarse", () => {
    const sinNada = { ...CUENTAS, [PESTANA_DOCUMENTO_PENDIENTE]: 0 };
    const fila = pastillasDeOrdenes({ etapas: ETAPAS, todasAprueban: false, cuentas: sinNada, filtro: PESTANA_DOCUMENTO_PENDIENTE });
    expect(claves(fila)).toContain(PESTANA_DOCUMENTO_PENDIENTE);
    expect(fila.find((p) => p.key === PESTANA_DOCUMENTO_PENDIENTE)?.cuenta).toBe(0);
  });

  it("y se sigue pintando distinta de las demás", () => {
    const fila = pastillasDeOrdenes({ etapas: ETAPAS, todasAprueban: false, cuentas: CUENTAS, filtro: PASTILLA_TODAS });
    expect(fila.find((p) => p.key === PESTANA_DOCUMENTO_PENDIENTE)?.clase).toBe("chip-pend");
    expect(fila.filter((p) => p.clase).length).toBe(1);
  });
});

describe("la pantalla", () => {
  it("pinta la fila con la función, y no con una lista escrita a mano", () => {
    expect(pagina).toContain("}).map((p) => (");
    expect(pagina).toContain("pastillasDeOrdenes({");
  });

  it("pulsar la encendida vuelve a «todas», y pulsar «Todas» estando en ella no rompe nada", () => {
    // El mismo manejador para las tres clases de pastilla: si está encendida, se vuelve a «todas»
    // —que para «Todas» significa quedarse—, y si no, se elige.
    // D-NEXT lo abrió a varias líneas porque el chip de FECHA también se mueve al entrar en la
    // pestaña de factura pendiente. Lo que esta prueba defiende no cambia: la clave que queda
    // puesta sale del mismo ternario, y es UNA sola, que es lo que la comparte entre las tres
    // clases de pastilla.
    expect(pagina.replace(/\s+/g, " ")).toContain("const queda = p.activa ? PASTILLA_TODAS : p.key; setFilter(queda);");
  });

  it("solo se pinta en la vista de tabla: el tablero ya enseña cada etapa en su columna", () => {
    const i = pagina.indexOf('{view === "table" && (');
    expect(i).toBeGreaterThan(-1);
    expect(pagina.indexOf("pastillasDeOrdenes({")).toBeGreaterThan(i);
  });

  it("«Limpiar filtros» sigue sin tocar esta fila (D-297)", () => {
    // Esa es la de las columnas de la tabla, y vive en otro componente con su propio estado.
    const tabla = leer("src/components/OrdersTable.tsx");
    expect(tabla).toContain("onClick={() => setFilters({})}");
    expect(tabla).not.toContain("setFilter(");
  });
});
