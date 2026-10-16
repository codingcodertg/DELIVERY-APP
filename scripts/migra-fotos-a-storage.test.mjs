import { describe, expect, it } from "vitest";
import { migra, planDeFila } from "./migra-fotos-a-storage.mjs";

// D-565 (178): el script que saca las fotos embebidas de `deliveries.photos` al cubo. En seco por defecto.

const DATA_A = "data:image/jpeg;base64," + Buffer.from("foto-A").toString("base64");
const DATA_B = "data:image/jpeg;base64," + Buffer.from("foto-B").toString("base64");

function doble(filas, opts = {}) {
  const subidas = [];
  const updates = [];
  const base = {
    from: (tabla) => ({
      select: () => ({ not: async () => ({ data: filas, error: null }) }),
      update: (patch) => ({
        eq: (_c, id) => ({
          select: async () => { updates.push({ tabla, id, patch }); return { data: [{ id }], error: null }; },
        }),
      }),
    }),
    storage: {
      from: (cubo) => ({
        upload: async (ruta, bytes, o) => {
          if (ruta === opts.fallaEn) return { error: { message: "Bucket not found" } };
          subidas.push({ cubo, ruta, bytes: bytes.length, o });
          return { error: null };
        },
      }),
    },
  };
  return { base, subidas, updates };
}

const fila = {
  id: "o-1", order_no: 1234,
  photos: [DATA_A, "o-1/1-0.jpg", DATA_B],
  photo_meta: { [DATA_A]: { by: "ana", at: "t0" }, "o-1/1-0.jpg": { by: "beto", at: "t1" }, [DATA_B]: { by: "ana", at: "t2" } },
};

describe("planDeFila", () => {
  it("sube solo las embebidas, deja las rutas donde estaban, y el photo_meta queda indexado por la RUTA con la misma entrada", () => {
    const p = planDeFila(fila, 7);
    expect(p.subidas.map((s) => s.ruta)).toEqual(["o-1/7-0.jpg", "o-1/7-1.jpg"]);
    expect(p.photos).toEqual(["o-1/7-0.jpg", "o-1/1-0.jpg", "o-1/7-1.jpg"]);
    expect(p.photo_meta).toEqual({
      "o-1/7-0.jpg": { by: "ana", at: "t0" },
      "o-1/1-0.jpg": { by: "beto", at: "t1" },
      "o-1/7-1.jpg": { by: "ana", at: "t2" },
    });
    for (const k of Object.keys(p.photo_meta)) expect(k.startsWith("data:")).toBe(false);
    expect(p.kb).toBe(0);   // 6 bytes redondean a 0 KB; lo que se mide es que sume
  });
  it("una fila ya convertida no tiene nada que subir y queda igual (idempotente)", () => {
    const p = planDeFila({ id: "o-2", photos: ["o-2/1-0.jpg"], photo_meta: { "o-2/1-0.jpg": { by: "x", at: "t" } } }, 7);
    expect(p.subidas).toEqual([]);
    expect(p.photos).toEqual(["o-2/1-0.jpg"]);
    expect(p.photo_meta).toEqual({ "o-2/1-0.jpg": { by: "x", at: "t" } });
  });
  it("sin photo_meta, se queda null", () => {
    expect(planDeFila({ id: "o-3", photos: [DATA_A], photo_meta: null }, 1).photo_meta).toBeNull();
  });
});

describe("migra", () => {
  it("sin --escribe cuenta órdenes, fotos y KB, y NO sube ni escribe nada", async () => {
    const { base, subidas, updates } = doble([fila, { id: "o-2", photos: ["o-2/1-0.jpg"], photo_meta: null }]);
    const lineas = [];
    const total = await migra({ base, log: (l) => lineas.push(l), ahora: () => 7 });
    expect(total).toMatchObject({ ordenes: 1, fotos: 2, escritas: 0, fallidas: 0 });
    expect(subidas).toEqual([]);
    expect(updates).toEqual([]);
    expect(lineas.join("\n")).toContain("EN SECO");
  });
  it("con --escribe sube cada foto al cubo y reescribe photos y photo_meta con rutas", async () => {
    const { base, subidas, updates } = doble([fila]);
    const total = await migra({ base, escribe: true, log: () => {}, ahora: () => 7 });
    expect(total).toMatchObject({ ordenes: 1, fotos: 2, escritas: 1, fallidas: 0 });
    expect(subidas.map((s) => [s.cubo, s.ruta, s.bytes, s.o.contentType])).toEqual([
      ["delivery-photos", "o-1/7-0.jpg", 6, "image/jpeg"],
      ["delivery-photos", "o-1/7-1.jpg", 6, "image/jpeg"],
    ]);
    expect(updates).toEqual([{
      tabla: "deliveries", id: "o-1",
      patch: {
        photos: ["o-1/7-0.jpg", "o-1/1-0.jpg", "o-1/7-1.jpg"],
        photo_meta: { "o-1/7-0.jpg": { by: "ana", at: "t0" }, "o-1/1-0.jpg": { by: "beto", at: "t1" }, "o-1/7-1.jpg": { by: "ana", at: "t2" } },
      },
    }]);
  });
  it("si una subida falla, esa fila NO se reescribe (la siguiente pasada la retoma)", async () => {
    const { base, updates } = doble([fila], { fallaEn: "o-1/7-1.jpg" });
    const total = await migra({ base, escribe: true, log: () => {}, ahora: () => 7 });
    expect(total).toMatchObject({ escritas: 0, fallidas: 1 });
    expect(updates).toEqual([]);
  });
});
