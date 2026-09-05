import { describe, it, expect } from "vitest";
import { bumpSort, sortByIds, type SortPatch } from "./sort-plan";

// G-19 (D-NEXT). Criterio del orquestador: "mismo resultado que los bucles, verificado con datos
// sintéticos". Aquí están los bucles VIEJOS tal cual (una escritura por fila, en serie), como
// referencia, y se exige que las funciones puras produzcan exactamente las mismas escrituras:
// mismos ids, mismos sort, y NADA más (solo se toca la columna sort, como antes).

type Row = { id: string; sort: number; text: string; set_id: string | null };
const row = (id: string, sort: number, set_id = "A"): Row => ({ id, sort, text: `t-${id}`, set_id });

// --- referencia: lo que hacían los bucles ---------------------------------------------------
function viejoDuplicar(questions: Row[], original: Row): SortPatch[] {
  const writes: SortPatch[] = [];
  const toBump = questions.filter((q) => q.set_id === original.set_id && q.sort > original.sort);
  for (const q of toBump) writes.push({ id: q.id, sort: q.sort + 1 });
  return writes;
}
function viejoReordenar(ids: string[]): SortPatch[] {
  const writes: SortPatch[] = [];
  for (let i = 0; i < ids.length; i++) writes.push({ id: ids[i], sort: i });
  return writes;
}
function viejoAnadirEtapa(stages: Row[], newSort: number): SortPatch[] {
  const writes: SortPatch[] = [];
  const toShift = stages.filter((x) => x.sort >= newSort);
  for (const st of toShift) writes.push({ id: st.id, sort: st.sort + 1 });
  return writes;
}

describe("duplicar pregunta: hacer sitio detrás de la original", () => {
  const qs = [row("a", 0), row("b", 1), row("c", 2), row("x", 1, "B"), row("d", 3)];
  it("mismas escrituras que el bucle: solo las del mismo set con sort > original, +1", () => {
    const original = qs[1];
    const mismoSet = qs.filter((q) => q.set_id === original.set_id);
    expect(bumpSort(mismoSet, original.sort, { inclusive: false })).toEqual(viejoDuplicar(qs, original));
    expect(bumpSort(mismoSet, original.sort, { inclusive: false })).toEqual([{ id: "c", sort: 3 }, { id: "d", sort: 4 }]);
  });
  it("la original y las de antes no se tocan; un parche solo lleva id y sort", () => {
    const out = bumpSort(qs.filter((q) => q.set_id === "A"), 3, { inclusive: false });
    expect(out).toEqual([]);
    for (const p of bumpSort(qs, 0, { inclusive: false })) expect(Object.keys(p).sort()).toEqual(["id", "sort"]);
  });
});

describe("reordenar preguntas: la posición es el sort", () => {
  it("mismas escrituras que el bucle, en el mismo orden", () => {
    const ids = ["c", "a", "b"];
    expect(sortByIds(ids)).toEqual(viejoReordenar(ids));
    expect(sortByIds(ids)).toEqual([{ id: "c", sort: 0 }, { id: "a", sort: 1 }, { id: "b", sort: 2 }]);
    expect(sortByIds([])).toEqual([]);
  });
});

describe("añadir etapa: desplazar desde el hueco, inclusive", () => {
  const st = [row("s0", 0), row("s1", 1), row("s2", 2), row("won", 3), row("lost", 4)];
  it("mismas escrituras que el bucle: sort >= newSort, +1", () => {
    expect(bumpSort(st, 3, { inclusive: true })).toEqual(viejoAnadirEtapa(st, 3));
    expect(bumpSort(st, 3, { inclusive: true })).toEqual([{ id: "won", sort: 4 }, { id: "lost", sort: 5 }]);
  });
  it("con el hueco más allá del final, nada que desplazar", () => {
    expect(bumpSort(st, 9, { inclusive: true })).toEqual([]);
  });
});
