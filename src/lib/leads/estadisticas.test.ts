import { describe, expect, it } from "vitest";
import { estadisticasDeUso, normalizaNombre, periodoDeDias, periodoPersonalizado, type Periodo } from "./estadisticas";
import type { EventoLead } from "./reglas";

// Hora local a propósito: los periodos se miden en días locales.
const AHORA = new Date(2026, 10, 19, 15, 30);
const dia = (d: number, h = 12) => new Date(2026, 10, d, h).toISOString();

const PERIODO: Periodo = periodoDeDias(7, AHORA);

function evento(o: Partial<EventoLead> & Pick<EventoLead, "kind" | "lead_id" | "at">): EventoLead {
  return {
    id: Math.floor(Math.random() * 1e9), outcome: null, note: null, action: null,
    actor: "ana", actor_name: "Ana Demo", subject: null, subject_name: null, ...o,
  };
}

describe("periodos", () => {
  it("los últimos 7 días, hoy incluido: del día 13 00:00 al día 20 00:00 (local)", () => {
    expect(PERIODO.desde).toEqual(new Date(2026, 10, 13, 0, 0));
    expect(PERIODO.hasta).toEqual(new Date(2026, 10, 20, 0, 0));
  });
  it("un rango a mano incluye los dos días; el fin es el día siguiente a las 00:00", () => {
    const p = periodoPersonalizado("2026-11-10", "2026-11-12");
    expect(p?.desde).toEqual(new Date(2026, 10, 10, 0, 0));
    expect(p?.hasta).toEqual(new Date(2026, 10, 13, 0, 0));
  });
  it("un solo día vale; un inicio después del fin, o una fecha que no existe, no", () => {
    expect(periodoPersonalizado("2026-11-10", "2026-11-10")).not.toBeNull();
    expect(periodoPersonalizado("2026-11-12", "2026-11-10")).toBeNull();
    expect(periodoPersonalizado("2026-02-30", "2026-03-02")).toBeNull();
    expect(periodoPersonalizado("", "2026-11-10")).toBeNull();
  });
});

describe("normalizaNombre: para emparejar el nombre de RingCentral con el de la app", () => {
  it("sin acentos, sin mayúsculas y con los espacios juntos", () => {
    expect(normalizaNombre("  Ana   Demó ")).toBe("ana demo");
    expect(normalizaNombre("JOSÉ  Pérez")).toBe("jose perez");
  });
  it("vacío es null", () => {
    expect(normalizaNombre("  ")).toBeNull();
    expect(normalizaNombre(null)).toBeNull();
  });
});

describe("estadisticasDeUso: lo que hace cada vendedor en el rango", () => {
  const eventos: EventoLead[] = [
    // Ana, dentro del rango.
    evento({ kind: "progress", lead_id: "L1", at: dia(14), note: "llamé" }),
    evento({ kind: "progress", lead_id: "L1", at: dia(15), action: "made_contact" }),
    evento({ kind: "progress", lead_id: "L1", at: dia(18), action: "quote" }),
    evento({ kind: "closed", outcome: "sale", lead_id: "L2", at: dia(18) }),
    evento({ kind: "phone", lead_id: "L3", at: dia(16) }),
    evento({ kind: "taken", lead_id: "L4", at: dia(17) }),
    // Ana, fuera del rango (antes del día 13): no cuenta.
    evento({ kind: "progress", lead_id: "L9", at: dia(2), action: "quote" }),
    // Beto, dentro del rango.
    evento({ kind: "progress", lead_id: "L1", at: dia(16), action: "appointment", actor: "beto", actor_name: "Beto Demo" }),
    // Sin actor (la carga del Excel): no es de nadie.
    evento({ kind: "imported", lead_id: "L5", at: dia(15), actor: null, actor_name: null }),
  ];
  const llamadas = [
    { rep_name: "ana demo", llamadas: 5 },
    { rep_name: "Otro Vendedor", llamadas: 2 },
  ];

  it("cuenta por persona: leads, notas, cambios de etapa, cotizaciones y ventas", () => {
    const r = estadisticasDeUso(eventos, PERIODO, llamadas, 7);
    const ana = r.filas.find((f) => f.id === "ana");
    expect(ana).toMatchObject({ nombre: "Ana Demo", leads: 4, notas: 3, cambiosDeEtapa: 2, cotizaciones: 1, ventas: 1 });
    const beto = r.filas.find((f) => f.id === "beto");
    expect(beto).toMatchObject({ nombre: "Beto Demo", leads: 1, notas: 1, cambiosDeEtapa: 1, cotizaciones: 0, ventas: 0 });
  });

  it("el evento de antes del rango y el que no tiene actor no cuentan", () => {
    const r = estadisticasDeUso(eventos, PERIODO, llamadas, 7);
    expect(r.filas).toHaveLength(2);
    expect(r.filas.find((f) => f.id === "ana")?.cotizaciones).toBe(1);
  });

  it("la última actividad es la más reciente del rango", () => {
    const r = estadisticasDeUso(eventos, PERIODO, llamadas, 7);
    expect(r.filas.find((f) => f.id === "ana")?.ultima).toBe(dia(18));
  });

  it("las llamadas se atribuyen por nombre; lo que no casa va a «sin vendedor»", () => {
    const r = estadisticasDeUso(eventos, PERIODO, llamadas, 7);
    expect(r.filas.find((f) => f.id === "ana")?.llamadas).toBe(5);
    expect(r.filas.find((f) => f.id === "beto")?.llamadas).toBe(0);
    expect(r.llamadasSinVendedor).toBe(2);
  });

  it("el total cuenta cada lead una sola vez aunque lo trabajen dos", () => {
    const r = estadisticasDeUso(eventos, PERIODO, llamadas, 7);
    expect(r.totales.leads).toBe(4);
    expect(r.totales.notas).toBe(4);
    expect(r.totales.cotizaciones).toBe(1);
    expect(r.totales.ventas).toBe(1);
    expect(r.totales.llamadas).toBe(5);
    expect(r.totales.ultima).toBe(dia(18));
  });

  it("ordena por lo que más se usa: notas más llamadas, y luego nombre", () => {
    const r = estadisticasDeUso(eventos, PERIODO, llamadas, 7);
    expect(r.filas.map((f) => f.id)).toEqual(["ana", "beto"]);
  });

  it("sin nada en el rango: sin filas, y todas las llamadas quedan sin vendedor", () => {
    const r = estadisticasDeUso([], PERIODO, [], 4);
    expect(r.filas).toEqual([]);
    expect(r.totales).toMatchObject({ leads: 0, notas: 0, llamadas: 0, ultima: null });
    expect(r.llamadasSinVendedor).toBe(4);
  });
});
