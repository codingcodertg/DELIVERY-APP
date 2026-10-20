import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ETAPAS_SIN_LISTO, MOTIVOS_SIN_LISTO, abreElCuadroSinListo, notaDelMotivoSinListo } from "./recoger-sin-listo-pantalla";
import { esRecogidaSinListo, notaDeRecogidaSinListo } from "./recogida-del-chofer";

// D-603 (2026-10-19) · Ernesto (chofer): «lets just have a screen that says Not marked ready by Warehouse / Why are you picking
// up / Dropdown: It is Ready, Im taking Partial, Other with text box … After they confirm pickup, now it can open up the order».

describe("«Recogido» sin «listo»: un cuadro pequeño con motivo, no la ficha entera", () => {
  it("los tres motivos del chofer, en ese orden; el cuadro sale SOLO en aprobada / preparando (listo recoge de un toque; sin aprobar, apagado)", () => {
    expect(MOTIVOS_SIN_LISTO.map((m) => m.clave)).toEqual(["lista", "parcial", "otro"]);
    expect(MOTIVOS_SIN_LISTO.map((m) => m.en)).toEqual(["It is ready", "I'm taking a partial load", "Other"]);
    expect([...ETAPAS_SIN_LISTO].sort()).toEqual(["approved", "fulfilling"]);
    expect(abreElCuadroSinListo("approved")).toBe(true);
    expect(abreElCuadroSinListo("fulfilling")).toBe(true);
    expect(abreElCuadroSinListo("ready")).toBe(false);
    expect(abreElCuadroSinListo("pending")).toBe(false);
    expect(abreElCuadroSinListo(null)).toBe(false);
  });

  it("la nota: el motivo en el idioma de quien recoge; «Otro» exige texto (el mínimo de la ficha); sin motivo, nada", () => {
    expect(notaDelMotivoSinListo("lista", "", "en")).toBe("It is ready");
    expect(notaDelMotivoSinListo("parcial", "lo que sea", "es")).toBe("Me llevo una parte");
    expect(notaDelMotivoSinListo("otro", "  el cliente  la necesita ", "es")).toBe("el cliente la necesita");
    expect(notaDelMotivoSinListo("otro", "ok", "es")).toBeNull();
    expect(notaDelMotivoSinListo("otro", "", "en")).toBeNull();
    expect(notaDelMotivoSinListo(null, "texto largo", "en")).toBeNull();
  });

  it("la nota entra en la MISMA escritura que la ficha: el historial la reconoce como recogida sin estar lista", () => {
    const nota = notaDeRecogidaSinListo(notaDelMotivoSinListo("lista", "", "es")!, "2 pallets", "es");
    expect(nota).toBe("Recogida sin estar lista: Sí está lista · 2 pallets");
    expect(esRecogidaSinListo(nota)).toBe(true);
  });

  it("puerta: Mi ruta abre el cuadro con la librería y, al confirmar, recoge con la escritura de la ficha y abre la ficha; el aviso de «se avisa a…» ya no está", () => {
    const pagina = readFileSync(new URL("../app/(app)/my-route/page.tsx", import.meta.url), "utf8");
    expect(pagina).toContain('from "@/lib/recoger-sin-listo-pantalla"');
    expect(pagina).toContain('if (accion === "recoger" && abreElCuadroSinListo(d.stage)) { setSinListoDe(d); return; }');
    expect(pagina).toContain("<RecogerSinListo pedido={sinListoDe}");
    expect(pagina).toContain("notaDeRecogidaSinListo(nota, escritura.note, lang)");
    expect(pagina).toContain("pushNotifs(avisosDeRecogidaSinListo(");
    // Tras confirmar, la ficha (para ver los detalles), sin paso abierto.
    expect(pagina).toMatch(/notify\(t\("Picked up — the warehouse and logistics were notified"[^\n]*\n\s*abrirOrden\(d\);/);
    const ficha = readFileSync(new URL("../components/OrderModal.tsx", import.meta.url), "utf8");
    expect(ficha).not.toContain("and logistics will be notified in the app.");
    expect(ficha).not.toContain("Logistics will be notified in the app.");
  });
});
