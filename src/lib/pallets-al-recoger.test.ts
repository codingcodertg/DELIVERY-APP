import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { leePalletsAlRecoger, MAXIMO_PALLETS_AL_RECOGER, palletsPorDefecto } from "./pallets-al-recoger";
import { escrituraRecogida } from "./one-tap-stop";
import type { Delivery } from "./types";

// D-547 · El dueño, 2026-10-14: «Also when they are picking up it's not asking them how many pallets are they loading
// drivers». «Recogido» (de un toque desde D-533) pregunta ahora el número, con el de la orden ya puesto.

vi.mock("@/lib/prefs", () => ({ usePrefs: () => ({ t: (en: string) => en, lang: "en" }) }));

describe("el número que trae puesto", () => {
  it("los confirmados (actual_pallets) antes que los estimados; vacío si no hay ninguno o es 0", () => {
    expect(palletsPorDefecto({ actual_pallets: 3, est_pallets: 5 })).toBe("3");
    expect(palletsPorDefecto({ actual_pallets: null, est_pallets: 5 })).toBe("5");
    expect(palletsPorDefecto({ actual_pallets: null, est_pallets: null })).toBe("");
    expect(palletsPorDefecto({ actual_pallets: 0, est_pallets: 4 })).toBe("");
    expect(palletsPorDefecto({ est_pallets: 2.25 })).toBe("2.3");
  });
});

describe("lo que escribe el chofer", () => {
  it("un número mayor que 0, a la décima, con coma o punto", () => {
    expect(leePalletsAlRecoger("4")).toBe(4);
    expect(leePalletsAlRecoger(" 1,5 ")).toBe(1.5);
    expect(leePalletsAlRecoger("2.04")).toBe(2);
  });
  it("vacío, letras, 0, negativo o más del tope: no vale", () => {
    expect(leePalletsAlRecoger("")).toBeNull();
    expect(leePalletsAlRecoger(null)).toBeNull();
    expect(leePalletsAlRecoger("abc")).toBeNull();
    expect(leePalletsAlRecoger("0")).toBeNull();
    expect(leePalletsAlRecoger("-2")).toBeNull();
    expect(leePalletsAlRecoger(String(MAXIMO_PALLETS_AL_RECOGER))).toBe(MAXIMO_PALLETS_AL_RECOGER);
    expect(leePalletsAlRecoger(String(MAXIMO_PALLETS_AL_RECOGER + 1))).toBeNull();
  });
});

describe("dónde se guarda: actual_pallets, en la misma escritura que la recogida", () => {
  it("el número del chofer gana al de la orden, en la nota y en actual_pallets", () => {
    const e = escrituraRecogida({ pedido: { actual_pallets: null, est_pallets: 5, assigned_driver: "Carlos R." }, me: { role: "driver", full_name: "Carlos R." }, gps: null, t: (en) => en, pallets: 7 });
    expect(e.extra.actual_pallets).toBe(7);
    expect(e.note).toBe("Loaded: 7 pallets");
  });
  it("el guard (169) deja al chofer el salto ready → picked_up sin mirar columnas: por eso va en ESA escritura", () => {
    const sql = readFileSync("supabase/migrations/169_fotos_del_chofer.sql", "utf8");
    expect(sql).toContain("or (r = 'driver' and old_stage = 'ready'     and new_stage = 'picked_up')");
  });
});

describe("el cuadro", () => {
  const pedido = (extra: Partial<Delivery>) => ({ id: "x", order_no: 7, invoice_num: "INV-7", stage: "ready", ...extra }) as unknown as Delivery;
  const pinta = async (extra: Partial<Delivery>) => {
    const { PalletsAlRecoger } = await import("@/components/PalletsAlRecoger");
    return renderToStaticMarkup(createElement(PalletsAlRecoger, { pedido: pedido(extra), onCancelar: () => {}, onConfirmar: () => {} }));
  };
  it("pregunta cuántos, con el número de la orden ya puesto y «Confirm pickup» encendido", async () => {
    const html = await pinta({ actual_pallets: 3, est_pallets: 5 });
    expect(html).toContain("How many pallets are you loading?");
    expect(html).toMatch(/data-pallets="" type="number"[^>]*value="3"/);
    expect(html).toMatch(/<button type="submit" data-confirmar-pallets=""[^>]*>Confirm pickup/);
    expect(html).not.toMatch(/data-confirmar-pallets=""[^>]*disabled=""/);
  });
  it("sin pallets en la orden: vacío y «Confirm pickup» apagado hasta que escriba un número", async () => {
    const html = await pinta({ actual_pallets: null, est_pallets: null });
    expect(html).toMatch(/data-pallets="" type="number"[^>]*value=""/);
    expect(html).toMatch(/data-confirmar-pallets=""[^>]*disabled=""/);
  });
});
