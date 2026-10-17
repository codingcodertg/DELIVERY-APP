import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { escribeComenzar, escribeListo, escrituraAlMarcarListo, palletsPropuestas, type SetStage } from "./pasos-de-bodega";
import { escrituraAlComenzar } from "./confirmar-tarifa";

/**
 * Lo que escriben los dos pasos de bodega, una sola vez para la ficha y la fila de Almacén (D-551).
 *
 * Nota D-573 (2026-10-16): aquí se probaba también qué pasos ofrecía la columna «Siguiente paso» (`pasosDeBodega`) y
 * dónde iba la columna (`columnaExtraTras`). La columna se quitó —la burbuja de Etapa es el selector, con todas las
 * etapas— y esa parte vive en `etapas-en-la-fila.test.ts`. Se IMPORTAN las funciones que escriben; el fuente solo se
 * lee al final, para ver que la ficha y la fila pasan por ellas.
 */

describe("los pallets de «Marcar listo»", () => {
  it("el campo abre con el real si lo hay, si no con el estimado, si no vacío", () => {
    expect(palletsPropuestas({ actual_pallets: 4, est_pallets: 6 })).toBe("4");
    expect(palletsPropuestas({ actual_pallets: null, est_pallets: 6 })).toBe("6");
    expect(palletsPropuestas({ actual_pallets: null, est_pallets: null })).toBe("");
  });
  it("marcar listo escribe solo el real, con «Pallets confirmed: N»", () => {
    const e = escrituraAlMarcarListo("5");
    expect(e).toEqual({
      pallets: 5,
      extra: { actual_pallets: 5 },
      nota: { en: "Pallets confirmed: 5", es: "Pallets confirmadas: 5" },
      aviso: { en: "Ready — 5 pallets confirmed", es: "Listo — 5 pallets confirmadas" },
    });
    expect(Object.keys(e!.extra)).toEqual(["actual_pallets"]);
  });
  it("acepta decimales, y no acepta vacío, cero, negativo ni texto", () => {
    expect(escrituraAlMarcarListo("2.5")?.pallets).toBe(2.5);
    expect(["", "0", "-2", "abc"].map(escrituraAlMarcarListo)).toEqual([null, null, null, null]);
  });
});

describe("lo que escriben: la ficha y la fila llaman a esto", () => {
  const graba = () => {
    const llamadas: unknown[][] = [];
    const setStage: SetStage = async (...a) => { llamadas.push(a); return true; };
    return { llamadas, setStage };
  };
  const en = (e: string) => e;

  it("«Comenzar» sin confirmación mueve la etapa sin nota ni tarifa (lo que hacía `move(\"fulfilling\")`)", async () => {
    const { llamadas, setStage } = graba();
    expect(await escribeComenzar(setStage, "o-1", null, en)).toBe(true);
    expect(llamadas).toEqual([["o-1", "fulfilling"]]);
  });
  it("«Comenzar» confirmando el monto: la nota «Fee confirmed», sin tocar la tarifa", async () => {
    const { llamadas, setStage } = graba();
    await escribeComenzar(setStage, "o-1", escrituraAlComenzar(100, 100), en);
    expect(llamadas).toEqual([["o-1", "fulfilling", "Fee confirmed $100.00", undefined]]);
  });
  it("«Comenzar» corrigiendo: la tarifa nueva en la MISMA escritura, con el rastro de D-372", async () => {
    const { llamadas, setStage } = graba();
    await escribeComenzar(setStage, "o-1", escrituraAlComenzar(126, 80), en);
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0][1]).toBe("fulfilling");
    expect(llamadas[0][2]).toContain("Fee corrected");
    expect(llamadas[0][2]).toContain("126 → 80");
    expect(llamadas[0][3]).toEqual({ delivery_fee: 80 });
  });
  it("«Comenzar» sin tarifa: no escribe tarifa, y lo anota", async () => {
    const { llamadas, setStage } = graba();
    await escribeComenzar(setStage, "o-1", escrituraAlComenzar(null, null, true), en);
    expect(llamadas).toEqual([["o-1", "fulfilling", "No fee — started without a delivery fee charged", undefined]]);
  });
  it("«Marcar listo»: la etapa y `actual_pallets` en una escritura, con la nota en el idioma de quien la da", async () => {
    const { llamadas, setStage } = graba();
    await escribeListo(setStage, "o-2", escrituraAlMarcarListo("5")!, (_en, es) => es);
    expect(llamadas).toEqual([["o-2", "ready", "Pallets confirmadas: 5", { actual_pallets: 5 }]]);
  });
});

describe("la fila y la ficha pasan por aquí", () => {
  const leer = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8").replace(/\s+/g, " ");
  const fila = leer("src/components/EtapaEnLaFila.tsx");
  const ficha = leer("src/components/OrderModal.tsx");

  it("los diálogos de la fila son los de la ficha, y escriben con las mismas funciones", () => {
    expect(fila).toContain("<ConfirmarTarifaAlComenzar");
    expect(fila).toContain("escribeComenzar(setStage, pedido.id, escritura, t)");
    expect(fila).toContain("escribeComenzar(setStage, pedido.id, null, t)");
    expect(fila).toContain("<ConfirmarPallets");
    // El campo de pallets abre con el número de `palletsPropuestas`, como abría en la ficha.
    expect(leer("src/components/ConfirmarPallets.tsx")).toContain("useState(() => palletsPropuestas(pedido))");
    expect(fila).toContain("escribeListo(setStage, pedido.id, escritura, t)");
    expect(ficha).toContain("<ConfirmarTarifaAlComenzar pedido={existing}");
    expect(ficha).toContain("<ConfirmarPallets pedido={existing}");
    expect(ficha).toContain("escribeComenzar(setStage, existing.id, escritura, t)");
    expect(ficha).toContain("escribeListo(setStage, existing.id, escritura, t)");
  });
});
