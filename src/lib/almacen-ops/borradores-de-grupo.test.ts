import { describe, expect, it } from "vitest";
import type { Reporte } from "./datos";
import {
  borrarBorradorDeGrupo, crearBorradorDeGrupo, depuraBorrador, esBorradorDeGrupo, leerBorradorDeGrupo, listarBorradoresDeGrupo,
} from "./borradores-de-grupo";

const almacen = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };
const rep = (id: string, extra: Partial<Reporte> = {}) => ({ id, kind: "scrap", store: "RDZ Pharr", stage: "photographed", photos: ["x"], ...extra }) as unknown as Reporte;

describe("grupos en borrador (no se crean en la base hasta Guardar)", () => {
  it("crear, leer, listar por persona y descartar", () => {
    const a = almacen();
    const id = crearBorradorDeGrupo("u1", "Nov 11 10:00 AM", [rep("r1"), rep("r2")], a);
    expect(esBorradorDeGrupo(id)).toBe(true);
    expect(leerBorradorDeGrupo("u1", id, a)?.reportes).toEqual(["r1", "r2"]);
    expect(listarBorradoresDeGrupo("u2", a)).toHaveLength(0);
    borrarBorradorDeGrupo("u1", id, a);
    expect(listarBorradoresDeGrupo("u1", a)).toHaveLength(0);
  });
  it("al reabrir se quitan las que ya están en un grupo o ya no están fotografiadas", () => {
    const a = almacen();
    const id = crearBorradorDeGrupo("u1", "n", [rep("r1"), rep("r2"), rep("r3"), rep("r4")], a);
    const b = leerBorradorDeGrupo("u1", id, a)!;
    const ahora = [rep("r1"), rep("r2", { scrap_group_id: "g1" }), rep("r3", { stage: "approved" } as Partial<Reporte>)];
    const d = depuraBorrador(b, ahora);
    expect(d.elegibles.map((r) => r.id)).toEqual(["r1"]);
    expect(d.quitadas).toBe(3);
  });
  it("sin almacenamiento no truena", () => {
    expect(listarBorradoresDeGrupo("u1", null)).toEqual([]);
  });
});
