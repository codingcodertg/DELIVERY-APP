import { describe, expect, it } from "vitest";
import { VENTANA_DE_CHOQUE_MIN, avisoDeChoque, choquesDeHorario } from "./choque-de-horario";
import type { Candidate } from "./types";

/* El dueño (2026-10-21): «no me dejes schedule candidates a la misma hora. Dame un warning … o estás seguro». */

type C = Parameters<typeof choquesDeHorario>[0][number];
const cand = (p: Partial<C> & { id: string }): C => ({
  name: p.id, status: "inperson", archived: false, phone_date: null, inperson_date: null,
  assigned_recruiter: "andres", interview: null, location: "Pharr", ...p,
});
const terminales = new Set(["hired", "discarded"]);
// 3:30 p.m. en Brownsville el 21 de octubre (CDT) = 20:30Z.
const A_LAS_330 = "2026-10-21T20:30:00.000Z";
const min = (n: number) => new Date(Date.parse(A_LAS_330) + n * 60_000).toISOString();
const entrevista = { date: "2026-10-20T15:00:00Z" } as unknown as Candidate["interview"];

describe("choque de horario al agendar (D-632)", () => {
  it("el caso medido en producción: dos presenciales a la misma hora en Pharr → aviso con el nombre de la otra", () => {
    const yaAgendada = cand({ id: "karina", name: "Karina Tijerina", inperson_date: A_LAS_330 });
    const ch = choquesDeHorario([yaAgendada, cand({ id: "cristy", name: "Cristy Caballero" })], { id: "cristy", tipo: "presencial", iso: A_LAS_330 }, terminales);
    expect(ch).toEqual([{ id: "karina", nombre: "Karina Tijerina", cuando: A_LAS_330, lugar: "Pharr" }]);
    expect(avisoDeChoque(ch, "presencial", "es")).toBe("⚠️ Ya hay Karina Tijerina agendado a esa hora (3:30 p.m. · Pharr). ¿Agendar de todos modos?");
    expect(avisoDeChoque(ch, "presencial", "en")).toBe("⚠️ Karina Tijerina is already scheduled at that time (3:30 PM · Pharr). Schedule anyway?");
  });

  it("la ventana es de 30 minutos, sin incluir el borde: 15 min choca, 29 choca, 30 no, por delante y por detrás", () => {
    expect(VENTANA_DE_CHOQUE_MIN).toBe(30);
    const pedido = { id: "yo", tipo: "presencial" as const, iso: A_LAS_330 };
    const con = (m: number) => choquesDeHorario([cand({ id: "otro", inperson_date: min(m) })], pedido, terminales).length;
    expect(con(0)).toBe(1);
    expect(con(15)).toBe(1);
    expect(con(-15)).toBe(1);
    expect(con(29)).toBe(1);
    expect(con(-29)).toBe(1);
    expect(con(30)).toBe(0);
    expect(con(-30)).toBe(0);
    expect(con(90)).toBe(0);
  });

  it("presencial: choca en CUALQUIER sede y con cualquier reclutador; no choca con la llamada de otro a esa hora", () => {
    const pedido = { id: "yo", tipo: "presencial" as const, iso: A_LAS_330 };
    expect(choquesDeHorario([cand({ id: "mc", location: "McAllen", assigned_recruiter: "otro", inperson_date: A_LAS_330 })], pedido, terminales)).toHaveLength(1);
    expect(choquesDeHorario([cand({ id: "tel", phone_date: A_LAS_330 })], pedido, terminales)).toEqual([]);
  });

  it("llamada: solo choca con otra llamada del MISMO reclutador que aún no se hizo; no con una presencial", () => {
    const pedido = { id: "yo", tipo: "llamada" as const, iso: A_LAS_330, reclutador: "andres" };
    expect(choquesDeHorario([cand({ id: "mia", phone_date: min(10) })], pedido, terminales)).toHaveLength(1);
    expect(choquesDeHorario([cand({ id: "de-otro", assigned_recruiter: "roberto", phone_date: min(10) })], pedido, terminales)).toEqual([]);
    expect(choquesDeHorario([cand({ id: "hecha", interview: entrevista, phone_date: min(10) })], pedido, terminales)).toEqual([]);
    expect(choquesDeHorario([cand({ id: "pres", inperson_date: A_LAS_330 })], pedido, terminales)).toEqual([]);
    // Sin reclutador asignado cuenta como uno más: dos sin asignar chocan entre sí, y no con los de Andrés.
    const sinAsignar = { ...pedido, reclutador: null };
    expect(choquesDeHorario([cand({ id: "x", assigned_recruiter: null, phone_date: A_LAS_330 })], sinAsignar, terminales)).toHaveLength(1);
    expect(choquesDeHorario([cand({ id: "x", phone_date: A_LAS_330 })], sinAsignar, terminales)).toEqual([]);
  });

  it("no cuentan el propio candidato (al cambiar su hora), los archivados ni los contratados o descartados", () => {
    const pedido = { id: "yo", tipo: "presencial" as const, iso: A_LAS_330 };
    expect(choquesDeHorario([cand({ id: "yo", inperson_date: A_LAS_330 })], pedido, terminales)).toEqual([]);
    expect(choquesDeHorario([cand({ id: "a", archived: true, inperson_date: A_LAS_330 })], pedido, terminales)).toEqual([]);
    expect(choquesDeHorario([cand({ id: "h", status: "hired", inperson_date: A_LAS_330 })], pedido, terminales)).toEqual([]);
    expect(choquesDeHorario([cand({ id: "d", status: "discarded", inperson_date: A_LAS_330 })], pedido, terminales)).toEqual([]);
    // El alta (aún sin id) sí choca con todos.
    expect(choquesDeHorario([cand({ id: "yo", phone_date: A_LAS_330 })], { id: null, tipo: "llamada", iso: A_LAS_330, reclutador: "andres" }, terminales)).toHaveLength(1);
  });

  it("varios a la vez: ordenados por hora (aunque lleguen al revés), con la hora de Brownsville y sin sede en las llamadas", () => {
    const otros = [cand({ id: "b", name: "Beto", phone_date: min(20) }), cand({ id: "a", name: "Ana", phone_date: min(-10) })];
    const ch = choquesDeHorario(otros, { id: "yo", tipo: "llamada", iso: A_LAS_330, reclutador: "andres" }, terminales);
    expect(ch.map((c) => c.nombre)).toEqual(["Ana", "Beto"]);
    expect(avisoDeChoque(ch, "llamada", "es")).toBe("⚠️ Ya hay 2 agendados a esa hora: Ana (3:20 p.m.), Beto (3:50 p.m.). ¿Agendar de todos modos?");
    expect(avisoDeChoque(ch, "llamada", "en")).toBe("⚠️ 2 people are already scheduled at that time: Ana (3:20 PM), Beto (3:50 PM). Schedule anyway?");
  });

  it("sin choques no hay aviso; una fecha ilegible no inventa choques", () => {
    expect(avisoDeChoque([], "presencial", "es")).toBe("");
    expect(choquesDeHorario([cand({ id: "o", inperson_date: A_LAS_330 })], { id: "yo", tipo: "presencial", iso: "basura" }, terminales)).toEqual([]);
    expect(choquesDeHorario([cand({ id: "o", inperson_date: "basura" })], { id: "yo", tipo: "presencial", iso: A_LAS_330 }, terminales)).toEqual([]);
  });
});
