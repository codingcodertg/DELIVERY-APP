import { describe, expect, it } from "vitest";
import type { AnySupabase } from "@/lib/clockin/supabase/types";
import { canManageEmployee, isPeriodLocked, periodStartOf, type Me } from "./mgrScope";

// T-3 de `docs/AUDIT-2026-10-09.md`: estas dos funciones son las guardias del servidor —sobre
// quién puede actuar un gerente, y si el período de nómina ya lo firmó el dueño— y lo único que
// las nombraba era un grep que comprueba que otros ficheros las MENCIONAN. La decisión no se
// ejecutaba en ninguna prueba.
//
// Aquí se ejecuta, con datos que contradicen: empleados de otra tienda y de otra empresa,
// gerentes sin tienda, períodos abiertos y cerrados, y cierres de otra empresa o de otra semana.

const EMPRESA = "c0000000-0000-0000-0000-00000000000c";
const OTRA_EMPRESA = "c9999999-9999-9999-9999-99999999999c";
const TIENDA_A = "a0000000-0000-0000-0000-00000000000a";
const TIENDA_B = "b0000000-0000-0000-0000-00000000000b";

type Fila = Record<string, unknown>;

/**
 * Una base de mentira con lo justo de la forma de supabase-js que usan las dos funciones:
 * `from(tabla).select(cols).eq(col, val)…maybeSingle()`.
 *
 * **Filtra de verdad y proyecta solo las columnas pedidas.** Eso es a propósito: si una de las dos
 * funciones se dejara un `.eq` o una columna del `select`, una base que devuelve siempre la
 * primera fila entera contestaría bien igual y la prueba no mediría nada.
 */
function baseFalsa(tablas: Record<string, Fila[]>) {
  const llamadas: string[] = [];
  const from = (tabla: string) => {
    const filtros: [string, unknown][] = [];
    let cols: string[] = [];
    const q = {
      select(c: string) { cols = c.split(",").map((x) => x.trim()); return q; },
      eq(col: string, val: unknown) { filtros.push([col, val]); return q; },
      async maybeSingle() {
        llamadas.push(`${tabla} select(${cols.join("|")}) donde ${filtros.map(([c, v]) => `${c}=${String(v)}`).join(" y ")}`);
        const fila = (tablas[tabla] ?? []).find((f) => filtros.every(([c, v]) => f[c] === v));
        if (!fila) return { data: null, error: null };
        return { data: Object.fromEntries(cols.map((c) => [c, fila[c]])), error: null };
      },
    };
    return q;
  };
  return { cliente: { from } as unknown as AnySupabase, llamadas };
}

const gente = (...filas: { id: string; company_id?: string; store_id?: string | null }[]) => ({
  profiles: filas.map((f) => ({ company_id: EMPRESA, store_id: null, ...f })),
});

const DUENO: Me = { role: "owner", company_id: EMPRESA, store_id: null };
const GERENTE_A: Me = { role: "manager", company_id: EMPRESA, store_id: TIENDA_A };

describe("1 · canManageEmployee: sobre quién puede actuar un gerente", () => {
  it("el dueño, sobre cualquiera de su empresa, esté en la tienda que esté", async () => {
    const { cliente } = baseFalsa(gente({ id: "e1", store_id: TIENDA_B }, { id: "e2", store_id: null }));
    expect(await canManageEmployee(cliente, DUENO, "e1")).toBe(true);
    expect(await canManageEmployee(cliente, DUENO, "e2")).toBe(true);
  });

  it("pero NI el dueño sobre alguien de otra empresa", async () => {
    const { cliente } = baseFalsa(gente({ id: "e1", company_id: OTRA_EMPRESA, store_id: TIENDA_A }));
    expect(await canManageEmployee(cliente, DUENO, "e1")).toBe(false);
    expect(await canManageEmployee(cliente, GERENTE_A, "e1")).toBe(false);
  });

  it("un gerente, sobre los de SU tienda sí y sobre los de otra no", async () => {
    const { cliente } = baseFalsa(gente({ id: "mia", store_id: TIENDA_A }, { id: "suya", store_id: TIENDA_B }));
    expect(await canManageEmployee(cliente, GERENTE_A, "mia")).toBe(true);
    expect(await canManageEmployee(cliente, GERENTE_A, "suya")).toBe(false);
  });

  it("y sobre los de las tiendas que se le hayan CONCEDIDO (089)", async () => {
    const { cliente } = baseFalsa(gente({ id: "suya", store_id: TIENDA_B }));
    const conExtra: Me = { ...GERENTE_A, extra_store_ids: [TIENDA_B] };
    expect(await canManageEmployee(cliente, conExtra, "suya")).toBe(true);
    // Sin la concesión, la misma persona y la misma tienda dan lo contrario.
    expect(await canManageEmployee(cliente, GERENTE_A, "suya")).toBe(false);
  });

  it("un gerente SIN tienda no puede con nadie, ni con los de su propia empresa (D-237)", async () => {
    const { cliente } = baseFalsa(gente({ id: "e1", store_id: TIENDA_A }, { id: "e2", store_id: null }));
    const sinTienda: Me = { role: "manager", company_id: EMPRESA, store_id: null };
    expect(await canManageEmployee(cliente, sinTienda, "e1")).toBe(false);
    expect(await canManageEmployee(cliente, sinTienda, "e2")).toBe(false);
  });

  it("alguien sin tienda asignada no es de la tienda de nadie: el gerente no puede", async () => {
    const { cliente } = baseFalsa(gente({ id: "e1", store_id: null }));
    expect(await canManageEmployee(cliente, GERENTE_A, "e1")).toBe(false);
  });

  it("un empleado que no existe deniega, no se cae ni pasa por válido", async () => {
    const { cliente } = baseFalsa(gente({ id: "e1", store_id: TIENDA_A }));
    expect(await canManageEmployee(cliente, DUENO, "fantasma")).toBe(false);
    expect(await canManageEmployee(cliente, GERENTE_A, "fantasma")).toBe(false);
  });

  it("y lo pregunta por el id de ESA persona, con su empresa y su tienda", async () => {
    const { cliente, llamadas } = baseFalsa(gente({ id: "e1", store_id: TIENDA_A }));
    await canManageEmployee(cliente, GERENTE_A, "e1");
    expect(llamadas).toEqual(["profiles select(company_id|store_id) donde id=e1"]);
  });
});

describe("2 · isPeriodLocked: si el dueño ya firmó ese período", () => {
  const firmas = (...filas: { company_id: string; period_start: string }[]) => ({ pay_period_signoffs: filas });

  it("con la firma puesta, cerrado; sin ella, abierto", async () => {
    const { cliente } = baseFalsa(firmas({ company_id: EMPRESA, period_start: "2026-10-02" }));
    expect(await isPeriodLocked(cliente, EMPRESA, "2026-10-02")).toBe(true);
    expect(await isPeriodLocked(cliente, EMPRESA, "2026-10-09")).toBe(false);
  });

  it("sin ninguna firma, ningún período está cerrado", async () => {
    const { cliente } = baseFalsa(firmas());
    expect(await isPeriodLocked(cliente, EMPRESA, "2026-10-02")).toBe(false);
  });

  it("la firma de OTRA empresa no cierra la mía", async () => {
    const { cliente } = baseFalsa(firmas({ company_id: OTRA_EMPRESA, period_start: "2026-10-02" }));
    expect(await isPeriodLocked(cliente, EMPRESA, "2026-10-02")).toBe(false);
  });

  it("y pregunta por las dos cosas a la vez, empresa y período", async () => {
    const { cliente, llamadas } = baseFalsa(firmas({ company_id: EMPRESA, period_start: "2026-10-02" }));
    await isPeriodLocked(cliente, EMPRESA, "2026-10-02");
    expect(llamadas).toEqual([
      `pay_period_signoffs select(period_start) donde company_id=${EMPRESA} y period_start=2026-10-02`,
    ]);
  });
});

describe("3 · periodStartOf: en qué período cae un fichaje", () => {
  it("la semana de pago va de viernes a jueves, y devuelve su viernes", async () => {
    // 2026-10-09 es viernes en Central; el fichaje del jueves siguiente es del MISMO período,
    // que es lo que decide si una edición cae en una semana ya firmada.
    expect(periodStartOf("2026-10-09T14:00:00Z")).toBe("2026-10-09");
    expect(periodStartOf("2026-10-15T14:00:00Z")).toBe("2026-10-09");
    expect(periodStartOf("2026-10-16T14:00:00Z")).toBe("2026-10-16");
  });
});
