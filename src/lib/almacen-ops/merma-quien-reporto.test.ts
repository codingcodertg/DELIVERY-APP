import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PASOS, PASO_CUANDO_Y_QUIEN, PASO_QUIEN_REPORTO, camposVisibles, pasoCompleto, pasosPlanos, primerHueco, respuestasIniciales, respuestasParaGuardar } from "./pasos";
import { elegidosAlCambiarDeTienda, nombreOTexto } from "./personas";

/**
 * Pedido de Roberto (D-915, tras la primera merma de Baudelio con el formulario nuevo): «It asks who broke it but it
 * should also ask who reported it because maybe another associate told the supervisor that his coworker broke it».
 * Tres personas distintas: quién lo rompió (broken_by, columna), quién lo reportó (answers.reported_by) y quién lo
 * llenó (author_id, que puede ser la cuenta compartida del almacén).
 */
const lee = (ruta: string) => readFileSync(join(process.cwd(), ruta), "utf8").replace(/\r\n/g, "\n");
const ASISTENTE = lee("src/app/operaciones/Asistente.tsx");
const LISTA = lee("src/app/operaciones/ListaDeReportes.tsx");

const producto = { id: 7, sku: "S", name: "N", cost: 1, pieces_per_box: 10 };
const completo = {
  product: producto, qty: { boxes: 1, piecesPerBox: 10, loosePieces: 0 }, split: { damaged: 10, sample: 0 },
  return_type: "internal", reason: "fell", broken_on: "2020-01-01", photo: ["data:image/jpeg;base64,/9j/"],
};
const gente = [{ id: "11111111-1111-4111-8111-111111111111", full_name: "Ana García" }];

describe("«¿Quién lo reportó?» en la merma", () => {
  const paso = pasosPlanos("scrap").find((p) => p.id === PASO_QUIEN_REPORTO)!;

  it("va justo después de «¿quién lo rompió?», en la misma pantalla que la fecha (D-NEXT, pedido fb02f65a), la última antes del resumen", () => {
    const grupo = PASOS.scrap.find((p) => p.id === PASO_CUANDO_Y_QUIEN)!;
    expect(grupo.tipo).toBe("grupo");
    const ids = grupo.tipo === "grupo" ? grupo.campos.map((p) => p.id) : [];
    expect(ids).toEqual(["broken_on", "broken_by", "reported_by"]);
    expect(PASOS.scrap[PASOS.scrap.length - 1].id).toBe(PASO_CUANDO_Y_QUIEN);
    expect(PASO_QUIEN_REPORTO).toBe("reported_by");
  });

  it("es el mismo tipo de pregunta que «¿quién lo rompió?» (gente del almacén), con nombre a mano permitido y su línea de ayuda", () => {
    expect(paso.tipo).toBe("personas");
    expect(paso).toMatchObject({
      opcional: true, libre: true, en: "Who reported it? (optional)", es: "¿Quién lo reportó? (opcional)",
      ayuda: { en: "If someone else told you about it, put their name", es: "Si otra persona te avisó, pon su nombre" },
    });
    expect(pasosPlanos("scrap").find((p) => p.id === "broken_by")).not.toHaveProperty("libre");
  });

  it("es opcional: «Siguiente» funciona vacío y no deja hueco en el resumen", () => {
    expect(pasoCompleto(paso, {})).toBe(true);
    expect(pasoCompleto(paso, { reported_by: [] })).toBe(true);
    expect(primerHueco("scrap", completo, "2026-11-07")).toBe(-1);
    expect(camposVisibles("scrap", completo).map((p) => p.id)).toContain("reported_by");
  });

  it("no se rellena solo al empezar un reporte", () => {
    expect(respuestasIniciales("scrap")).not.toHaveProperty("reported_by");
    expect(respuestasIniciales("scrap", { broken_by: ["x"] })).not.toHaveProperty("reported_by");
  });

  it("viaja dentro de answers.reported_by (ids o nombres a mano), y el asistente no lo borra como a broken_by / crma", () => {
    const r = { ...completo, broken_by: [gente[0].id], reported_by: [gente[0].id, "Pedro (temporal)"] };
    expect(respuestasParaGuardar("scrap", r).reported_by).toEqual([gente[0].id, "Pedro (temporal)"]);
    expect(respuestasParaGuardar("scrap", completo)).not.toHaveProperty("reported_by");
    expect(ASISTENTE).toContain("if (e.scrap) { delete e.answers.broken_by; delete e.answers.crma; }");
    expect(ASISTENTE).not.toContain("delete e.answers.reported_by");
  });

  it("se enseña por nombre: un id conocido sale con su nombre, un nombre a mano tal cual, un id perdido como «—»", () => {
    expect(nombreOTexto(gente, gente[0].id)).toBe("Ana García");
    expect(nombreOTexto(gente, "Pedro (temporal)")).toBe("Pedro (temporal)");
    expect(nombreOTexto(gente, "22222222-2222-4222-8222-222222222222")).toBe("—");
  });

  it("cambiar de tienda quita a la gente de otro almacén pero conserva los nombres a mano", () => {
    const conocidos = new Set(["a", "b"]);
    expect(elegidosAlCambiarDeTienda(["a", "b", "Pedro"], new Set(["a"]), conocidos)).toEqual(["a", "Pedro"]);
  });

  it("la pantalla: ayuda bajo la pregunta, botón «Usar «…»» en el selector, y la tarjeta lo enseña junto a «Lo rompió» sin tocar «Lo llenó»", () => {
    expect(ASISTENTE).toContain("data-ayuda-del-paso");
    expect(ASISTENTE).toContain('data-accion="persona-libre"');
    expect(ASISTENTE).toContain("libre={paso.tipo === \"personas\" && !!paso.libre}");
    const rompio = LISTA.indexOf('t("Broken by", "Lo rompió")');
    const reporto = LISTA.indexOf('t("Reported by", "Lo reportó")');
    expect(rompio).toBeGreaterThan(0);
    expect(reporto).toBeGreaterThan(rompio);
    expect(LISTA).toContain("data-reportado-por");
    expect(LISTA).toContain('t("filed by", "lo llenó")');
    expect(LISTA).toContain('t("Filed by", "Lo llenó")');
  });
});
