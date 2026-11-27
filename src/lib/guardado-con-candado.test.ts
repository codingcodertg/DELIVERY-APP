import { describe, expect, it } from "vitest";
import { escritorDeOrdenes, guardaOrdenConCandado, uneFotos } from "./guardado-con-candado";

// Cliente de Supabase falso: tabla `deliveries` en memoria, con `updated_at` que avanza en cada UPDATE
// (como el trigger deliveries_touch) y RLS simulada (`permiso: false` deja en cero filas los UPDATE).
type Fila = { id: string; updated_at: string | null; photos: string[] | null; photo_meta: unknown; stage?: string };
type Tabla = { filas: Map<string, Fila>; reloj: number; permiso: boolean };

function falso(tabla: Tabla) {
  const tick = () => `t${++tabla.reloj}`;
  type Op = { tipo: "select" } | { tipo: "update"; patch: Record<string, unknown> };
  function consulta(op: Op, filtros: ((f: Fila) => boolean)[], unica: boolean): unknown {
    const correr = () => {
      let filas = [...tabla.filas.values()].filter((f) => filtros.every((g) => g(f)));
      if (op.tipo === "update") {
        if (!tabla.permiso) filas = [];   // la RLS deja la fila fuera: el UPDATE no toca nada y no da error
        for (const f of filas) Object.assign(f, op.patch, { updated_at: tick() });
        return { data: filas.map((f) => ({ id: f.id, updated_at: f.updated_at })), error: null };
      }
      if (unica) return { data: filas[0] ?? null, error: null };
      return { data: filas, error: null };
    };
    return {
      eq: (col: string, v: unknown) => consulta(op, [...filtros, (f) => (f as unknown as Record<string, unknown>)[col] === v], unica),
      is: (col: string, v: null) => consulta(op, [...filtros, (f) => (f as unknown as Record<string, unknown>)[col] === v], unica),
      select: () => consulta(op, filtros, unica),
      maybeSingle: () => consulta(op, filtros, true),
      then: (ok: (r: unknown) => unknown, fail?: (e: unknown) => unknown) => Promise.resolve().then(correr).then(ok, fail),
    };
  }
  return {
    from: () => ({
      select: (_c: string) => consulta({ tipo: "select" }, [], false),
      update: (patch: Record<string, unknown>) => consulta({ tipo: "update", patch }, [], false),
    }),
  };
}

function tablaCon(filas: Fila[], permiso = true): Tabla {
  return { filas: new Map(filas.map((f) => [f.id, { ...f }])), reloj: 100, permiso };
}

describe("uneFotos", () => {
  it("quita solo las que quien guarda quitó y añade las nuevas, sin duplicar", () => {
    // la base tiene A, B (subida por otro) y C; la pantalla tenía A y B y quita A
    expect(uneFotos(["A", "B", "C"], ["A", "B"], ["B"])).toEqual(["B", "C"]);
    // sube D sin tocar lo demás; D ya estaba en la base una vez: no se duplica
    expect(uneFotos(["A", "D"], ["A"], ["A", "D"])).toEqual(["A", "D"]);
  });

  it("no resucita una foto que otra persona quitó de la base", () => {
    // la pantalla tenía A y la sigue teniendo, pero otro la quitó de la base: no se vuelve a añadir
    expect(uneFotos(["B"], ["A", "B"], ["A", "B"])).toEqual(["B"]);
  });

  it("base vacía o nula: solo quedan las nuevas", () => {
    expect(uneFotos(null, [], ["X"])).toEqual(["X"]);
  });
});

describe("guardaOrdenConCandado", () => {
  it("0 filas por permiso es un fallo, no un guardado", async () => {
    const t = tablaCon([{ id: "o1", updated_at: "t1", photos: null, photo_meta: null, stage: "approved" }], false);
    const r = await guardaOrdenConCandado(escritorDeOrdenes(falso(t)), "o1", { stage: "picked_up" });
    expect(r).toEqual({ ok: false, motivo: "sin_filas" });
    expect(t.filas.get("o1")!.stage).toBe("approved");
  });

  it("guarda con la versión correcta y devuelve el updated_at nuevo", async () => {
    const t = tablaCon([{ id: "o1", updated_at: "t1", photos: null, photo_meta: null, stage: "approved" }]);
    const r = await guardaOrdenConCandado(escritorDeOrdenes(falso(t)), "o1", { stage: "fulfilling" }, { versionEsperada: "t1" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.updated_at).not.toBe("t1");
    expect(t.filas.get("o1")!.stage).toBe("fulfilling");
  });

  it("conflicto: si otra persona cambió la orden, no pisa y lo dice con su versión actual", async () => {
    const t = tablaCon([{ id: "o1", updated_at: "t1", photos: null, photo_meta: null, stage: "approved" }]);
    const esc = escritorDeOrdenes(falso(t));
    // otra persona la cambia (la versión sube) mientras esta ventana tiene t1
    await guardaOrdenConCandado(esc, "o1", { stage: "fulfilling" });
    const antes = { ...t.filas.get("o1")! };
    const r = await guardaOrdenConCandado(esc, "o1", { stage: "canceled" }, { versionEsperada: "t1" });
    expect(r.ok).toBe(false);
    if (!r.ok && r.motivo === "conflicto") expect(r.updated_at).toBe(antes.updated_at);
    else throw new Error("debía ser conflicto");
    expect(t.filas.get("o1")!.stage).toBe("fulfilling");   // no se pisó
  });

  it("fotos de dos personas a la vez: se conservan las dos", async () => {
    const t = tablaCon([{ id: "o1", updated_at: "t1", photos: ["A"], photo_meta: null }]);
    const esc = escritorDeOrdenes(falso(t));
    const [r1, r2] = await Promise.all([
      guardaOrdenConCandado(esc, "o1", { photos: ["A", "B"] }, { fotosAntes: ["A"], autor: { quien: "u1", ahora: "x" } }),
      guardaOrdenConCandado(esc, "o1", { photos: ["A", "C"] }, { fotosAntes: ["A"], autor: { quien: "u2", ahora: "x" } }),
    ]);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(t.filas.get("o1")!.photos).toEqual(["A", "B", "C"]);
  });

  it("fotos: quitar una foto no borra la que subió otra persona", async () => {
    const t = tablaCon([{ id: "o1", updated_at: "t1", photos: ["A", "B", "C"], photo_meta: null }]);
    const r = await guardaOrdenConCandado(escritorDeOrdenes(falso(t)), "o1", { photos: ["B"] }, { fotosAntes: ["A", "B"] });
    expect(r.ok).toBe(true);
    expect(t.filas.get("o1")!.photos).toEqual(["B", "C"]);
  });

  it("fotos: si la orden no se puede leer, no se escribe nada", async () => {
    const t = tablaCon([]);
    const r = await guardaOrdenConCandado(escritorDeOrdenes(falso(t)), "nope", { photos: ["X"] }, { fotosAntes: [] });
    expect(r).toEqual({ ok: false, motivo: "no_leida" });
  });
});
