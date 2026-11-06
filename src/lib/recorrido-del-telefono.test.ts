import { describe, it, expect } from "vitest";
import { leeRecorridoDelTelefono, limitesDelDiaDeTrabajo, FIXES_POR_DIA } from "./recorrido-del-telefono";

/**
 * Las posiciones del teléfono de un día, ENTERAS (D-909). PostgREST da 1.000 filas por petición como mucho: la base de
 * mentira hace lo mismo, y la prueba es que aun así llegan todas. Medido el 2026-11-06: 3.415 posiciones, se leían 1.000.
 */

type Fila = { id: string; driver_id: string; lat: number; lng: number; accuracy_m: number | null; recorded_at: string };
const TOPE_DE_POSTGREST = 1000;

function base(filas: Fila[], opciones: { falla?: string } = {}) {
  const peticiones: { chofer: string; desde: number; hasta: number; orden: string[] }[] = [];
  const from = (tabla: string) => {
    if (tabla !== "driver_locations") throw new Error(tabla);
    const f: { chofer: string; gte: string; lt: string; orden: string[] } = { chofer: "", gte: "", lt: "", orden: [] };
    const q = {
      select: () => q,
      eq: (_c: string, v: string) => { f.chofer = v; return q; },
      gte: (_c: string, v: string) => { f.gte = v; return q; },
      lt: (_c: string, v: string) => { f.lt = v; return q; },
      order: (c: string) => { f.orden.push(c); return q; },
      range: async (a: number, b: number) => {
        peticiones.push({ chofer: f.chofer, desde: a, hasta: b, orden: f.orden });
        if (opciones.falla === f.chofer) return { data: null, error: { message: "permission denied" } };
        const suyas = filas.filter((x) => x.driver_id === f.chofer && x.recorded_at >= f.gte && x.recorded_at < f.lt)
          .sort((x, y) => x.recorded_at.localeCompare(y.recorded_at) || x.id.localeCompare(y.id));
        return { data: suyas.slice(a, Math.min(b + 1, a + TOPE_DE_POSTGREST)), error: null };
      },
    };
    return q;
  };
  return { from, peticiones };
}

const T0 = Date.parse("2026-11-06T14:00:00Z");
const delChofer = (chofer: string, n: number, cadaMs = 5000): Fila[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${chofer}-${String(i).padStart(6, "0")}`, driver_id: chofer, lat: 26.2 + i * 1e-5, lng: -98.2, accuracy_m: 8, recorded_at: new Date(T0 + i * cadaMs).toISOString() }));

describe("leeRecorridoDelTelefono", () => {
  it("el día de la empresa, en hora de Texas (en noviembre empieza a las 06:00 UTC)", () => {
    expect(limitesDelDiaDeTrabajo("2026-11-06")).toEqual({ from: "2026-11-06T06:00:00.000Z", to: "2026-11-07T06:00:00.000Z" });
  });

  it("el día del 2026-11-06: 475 + 1.054 + 1.882 posiciones, y llegan TODAS (antes, las primeras 1.000 entre los tres)", async () => {
    const db = base([...delChofer("julio", 475), ...delChofer("maximo", 1054), ...delChofer("ernesto", 1882)]);
    const r = await leeRecorridoDelTelefono(db, ["julio", "maximo", "ernesto", "steven"], "2026-11-06");
    expect(r.error).toBeNull();
    expect(r.cortado).toBe(false);
    expect(Object.fromEntries(Object.entries(r.porId).map(([k, v]) => [k, v.length]))).toEqual({ julio: 475, maximo: 1054, ernesto: 1882, steven: 0 });
    // La última de Ernesto es la última del día, no la de las 10:07.
    expect(r.porId.ernesto[1881].at).toBe(new Date(T0 + 1881 * 5000).toISOString());
    expect(r.porId.ernesto[0]).toEqual({ lat: 26.2, lng: -98.2, accuracy_m: 8, at: new Date(T0).toISOString() });
  });

  it("pide de 1.000 en 1.000, por chofer, y con un orden que no deja filas repetidas ni perdidas entre páginas", async () => {
    const db = base(delChofer("ernesto", 2500));
    const r = await leeRecorridoDelTelefono(db, ["ernesto"], "2026-11-06");
    expect(r.porId.ernesto).toHaveLength(2500);
    expect(new Set(r.porId.ernesto.map((f) => f.at)).size).toBe(2500);
    expect(db.peticiones.map((p) => [p.desde, p.hasta])).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
    expect(db.peticiones[0].orden).toEqual(["recorded_at", "id"]);
  });

  it("solo lo de ESE día: lo de ayer y lo de mañana no entran", async () => {
    const ayer = delChofer("julio", 5).map((f, i) => ({ ...f, id: `a${i}`, recorded_at: new Date(Date.parse("2026-11-06T05:00:00Z") + i * 1000).toISOString() }));
    const db = base([...ayer, ...delChofer("julio", 20)]);
    expect((await leeRecorridoDelTelefono(db, ["julio"], "2026-11-06")).porId.julio).toHaveLength(20);
  });

  it("si la lectura de un chofer falla, lo dice y los demás llegan igual", async () => {
    const db = base([...delChofer("julio", 30), ...delChofer("maximo", 40)], { falla: "julio" });
    const r = await leeRecorridoDelTelefono(db, ["julio", "maximo"], "2026-11-06");
    expect(r.error).toBe("permission denied");
    expect(r.porId.julio).toEqual([]);
    expect(r.porId.maximo).toHaveLength(40);
  });

  it("el tope por chofer existe y, si se alcanza, se dice (`cortado`) en vez de dar una línea a medias por buena", async () => {
    const db = base(delChofer("ernesto", FIXES_POR_DIA + 1500, 1000));
    const r = await leeRecorridoDelTelefono(db, ["ernesto"], "2026-11-06");
    expect(r.porId.ernesto).toHaveLength(FIXES_POR_DIA);
    expect(r.cortado).toBe(true);
  });

  it("sin choferes no pregunta nada", async () => {
    const db = base([]);
    expect(await leeRecorridoDelTelefono(db, [], "2026-11-06")).toEqual({ porId: {}, error: null, cortado: false });
    expect(db.peticiones).toHaveLength(0);
  });
});
