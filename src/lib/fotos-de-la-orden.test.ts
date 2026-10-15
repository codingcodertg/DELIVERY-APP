import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));

import { filaTraeSusFotos, fotosParaContar, leerFotosDeLaOrden, metaDeFotosAlGuardar, type LectorDeFotos } from "./fotos-de-la-orden";

// D-NEXT (177): la lista ya no trae las fotos; quien las necesita las lee de UNA fila.
const raiz = path.resolve(__dirname, "..", "..");

function lector(fila: unknown, error: { message: string } | null = null) {
  const pedidas: { columnas: string; id: string }[] = [];
  const db: LectorDeFotos = {
    from: () => ({
      select: (columnas) => ({
        eq: (_c, id) => ({
          maybeSingle: async () => { pedidas.push({ columnas, id }); return { data: fila, error }; },
        }),
      }),
    }),
  };
  return { db, pedidas };
}

describe("leerFotosDeLaOrden", () => {
  it("pide solo photos y photo_meta de esa orden", async () => {
    const { db, pedidas } = lector({ photos: ["u1"], photo_meta: { u1: { by: "ana", at: "t0" } } });
    expect(await leerFotosDeLaOrden(db, "o1")).toEqual({ photos: ["u1"], photo_meta: { u1: { by: "ana", at: "t0" } } });
    expect(pedidas).toEqual([{ columnas: "photos, photo_meta", id: "o1" }]);
  });
  it("si falla, null (no se sabe: no se escribe)", async () => {
    expect(await leerFotosDeLaOrden(lector(null, { message: "x" }).db, "o1")).toBeNull();
  });
});

describe("metaDeFotosAlGuardar (el update lee photo_meta fresco)", () => {
  it("conserva el autor de las fotos que ya estaban, leído de la base", async () => {
    const { db, pedidas } = lector({ photos: ["u1"], photo_meta: { u1: { by: "ana", at: "t0" } } });
    const meta = await metaDeFotosAlGuardar(db, "o1", ["u1", "u2"], "beto", "t1");
    expect(meta).toEqual({ u1: { by: "ana", at: "t0" }, u2: { by: "beto", at: "t1" } });
    expect(pedidas).toHaveLength(1);
  });
  it("si no se puede leer, null: no se guarda con los autores perdidos", async () => {
    expect(await metaDeFotosAlGuardar(lector(null, { message: "x" }).db, "o1", ["u1"], "beto", "t1")).toBeNull();
  });
  it("data-provider firma las fotos con esta lectura, no con la fila de la lista", () => {
    const fuente = fs.readFileSync(path.join(raiz, "src", "lib", "data-provider.tsx"), "utf8");
    expect(fuente).toMatch(/const meta = await metaDeFotosAlGuardar\(/);
    expect(fuente).not.toContain("before?.photo_meta");
  });
});

describe("fotosParaContar", () => {
  it("con las fotos cargadas, esas", () => {
    expect(fotosParaContar({ photos: ["a"], photo_meta: null, listas: true }, { photos: null, photo_count: 5 })).toEqual(["a"]);
  });
  it("sin cargar, tantas como dice photo_count (solo para contar)", () => {
    expect(fotosParaContar({ photos: null, photo_meta: null, listas: false }, { photos: null, photo_count: 2 })).toHaveLength(2);
    const { photos: _p, ...fila } = { photos: null, photo_count: 3 };
    expect(fotosParaContar({ photos: null, photo_meta: null, listas: false }, fila as { photos: null; photo_count: number })).toHaveLength(3);
  });
});

describe("filaTraeSusFotos", () => {
  it("distingue la fila de la lista (sin la clave) de la que trae sus fotos", () => {
    expect(filaTraeSusFotos({ id: "x" })).toBe(false);
    expect(filaTraeSusFotos({ id: "x", photos: null })).toBe(true);
  });
});

describe("la ficha (OrderModal) carga las fotos aparte", () => {
  const fuente = fs.readFileSync(path.join(raiz, "src", "components", "OrderModal.tsx"), "utf8");
  it("usa useFotosDeLaOrden y no lee las fotos de la fila de la lista", () => {
    expect(fuente).toContain("const fotosOrden = useFotosDeLaOrden(existing);");
    expect(fuente).not.toMatch(/existing\??\.photos/);
    expect(fuente).not.toMatch(/existing\??\.photo_meta/);
  });
  it("no deja guardar fotos mientras las de la orden no han llegado", () => {
    expect(fuente).toContain("if (!fotosOrden.listas) return;");
    expect(fuente).toContain("disabled={!canDeliver(me) || photoBusy || !fotosOrden.listas}");
    expect(fuente).toContain("if (fotosDeLaEntrega.length && !fotosOrden.listas) {");
  });
});
