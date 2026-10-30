import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  CUBO_DE_FOTOS, SUBIDAS_A_LA_VEZ, blobDeDataUrl, enParaleloConTope, esFotoEmbebida, rutaDeFotoDeEntrega, srcDeFoto,
  subirFotosDeEntrega, urlsDeFotos, type AlmacenDeFotos,
} from "./fotos-en-storage";
import { autoresDeFotos } from "./fotos-de-entrega";

// ============================================================
// D-565 (178): las fotos de entrega van al cubo `delivery-photos`; la fila guarda rutas y `photo_meta` se indexa por
// la ruta, no por el base64 (medido 2026-10-15: `photo_meta` pesaba lo mismo que `photos`, y hoy eso tumbó la instancia).
// ============================================================

const raiz = path.resolve(__dirname, "..", "..");
const leer = (p: string) => fs.readFileSync(path.join(raiz, p), "utf8").replace(/\r\n/g, "\n");

// Un JPEG de mentira: lo que importa es que sea base64 válido y se distinga de otro.
const DATA_A = "data:image/jpeg;base64," + Buffer.from("foto-A").toString("base64");
const DATA_B = "data:image/jpeg;base64," + Buffer.from("foto-B").toString("base64");

function almacen(opts: { fallaEn?: string; sinFirma?: string[] } = {}) {
  const subidas: { cubo: string; ruta: string; bytes: number; opts: unknown }[] = [];
  const firmadas: { cubo: string; rutas: string[]; segundos: number }[] = [];
  const storage: AlmacenDeFotos = {
    from: (cubo) => ({
      upload: async (ruta, cuerpo, o) => {
        if (ruta === opts.fallaEn) return { error: { message: "Bucket not found" } };
        subidas.push({ cubo, ruta, bytes: cuerpo.size, opts: o });
        return { error: null };
      },
      createSignedUrls: async (rutas, segundos) => {
        firmadas.push({ cubo, rutas, segundos });
        return {
          data: rutas.map((p) => (opts.sinFirma?.includes(p) ? { path: p, signedUrl: null } : { path: p, signedUrl: `https://x/sign/${p}?token=t` })),
          error: null,
        };
      },
    }),
  };
  return { storage, subidas, firmadas };
}

describe("la ruta en el cubo", () => {
  it("empieza por el id de la orden (lo que mira la política de la 178), y lleva marca y número", () => {
    expect(rutaDeFotoDeEntrega("o-1", 1700000000000, 2)).toBe("o-1/1700000000000-2.jpg");
    expect(esFotoEmbebida("o-1/1-0.jpg")).toBe(false);
    expect(esFotoEmbebida(DATA_A)).toBe(true);
  });
  it("blobDeDataUrl devuelve los bytes y el tipo; lo que no es base64 lanza", () => {
    const b = blobDeDataUrl(DATA_A);
    expect(b.size).toBe("foto-A".length);
    expect(b.type).toBe("image/jpeg");
    expect(() => blobDeDataUrl("data:text/plain,hola")).toThrow();
    expect(() => blobDeDataUrl("o-1/1-0.jpg")).toThrow();
  });
});

describe("subirFotosDeEntrega: la fila guarda rutas y photo_meta se indexa por la ruta, no por el contenido", () => {
  it("sube cada data: al cubo delivery-photos como JPEG y devuelve las rutas en el mismo orden", async () => {
    const { storage, subidas } = almacen();
    const r = await subirFotosDeEntrega(storage, "o-1", [DATA_A, DATA_B], 5);
    expect(r).toEqual({ ok: true, rutas: ["o-1/5-0.jpg", "o-1/5-1.jpg"] });
    expect(subidas.map((s) => [s.cubo, s.ruta, s.bytes])).toEqual([[CUBO_DE_FOTOS, "o-1/5-0.jpg", 6], [CUBO_DE_FOTOS, "o-1/5-1.jpg", 6]]);
    expect(subidas[0].opts).toEqual({ contentType: "image/jpeg", upsert: false });
  });
  it("el photo_meta que se firma con esas rutas no contiene ningún base64 como clave", async () => {
    const { storage } = almacen();
    const r = await subirFotosDeEntrega(storage, "o-1", [DATA_A, DATA_B], 5);
    if (!r.ok) throw new Error("no subió");
    const meta = autoresDeFotos(r.rutas, null, "ana", "t0");
    expect(Object.keys(meta)).toEqual(["o-1/5-0.jpg", "o-1/5-1.jpg"]);
    for (const k of Object.keys(meta)) expect(k.startsWith("data:")).toBe(false);
    // Lo que pesaba: con la clave vieja, el meta repetía la foto entera.
    expect(JSON.stringify(meta)).not.toContain(DATA_A.slice(0, 40));
  });
  it("una foto que ya es ruta pasa tal cual y no se vuelve a subir (idempotente)", async () => {
    const { storage, subidas } = almacen();
    const r = await subirFotosDeEntrega(storage, "o-1", ["o-1/1-0.jpg", DATA_A], 9);
    expect(r).toEqual({ ok: true, rutas: ["o-1/1-0.jpg", "o-1/9-0.jpg"] });
    expect(subidas.map((s) => s.ruta)).toEqual(["o-1/9-0.jpg"]);
  });
  it("sin cubo (la subida falla) devuelve el error, con mensaje, y no devuelve rutas a medias", async () => {
    const { storage, subidas } = almacen({ fallaEn: "o-1/5-1.jpg" });
    const r = await subirFotosDeEntrega(storage, "o-1", [DATA_A, DATA_B], 5);
    expect(r).toEqual({ ok: false, message: "Bucket not found" });
    expect(subidas.length).toBe(1);   // la primera subió; la fila NO se escribe con ella: quien llama no guarda nada
  });
  it("un data: que no es base64 tampoco se guarda", async () => {
    const r = await subirFotosDeEntrega(almacen().storage, "o-1", ["data:image/jpeg,raw"], 5);
    expect(r.ok).toBe(false);
  });
});

describe("D-637: las fotos suben de tres en tres, no una a una", () => {
  // Un cubo que tarda: cada subida espera a que la suelte la prueba, y cuenta cuántas van a la vez.
  function cuboLento(opts: { fallaEn?: string } = {}) {
    const empezadas: string[] = [];
    const esperando: (() => void)[] = [];
    let aLaVez = 0;
    let maximo = 0;
    const storage: AlmacenDeFotos = {
      from: () => ({
        upload: async (ruta) => {
          empezadas.push(ruta);
          aLaVez++;
          maximo = Math.max(maximo, aLaVez);
          await new Promise<void>((r) => esperando.push(r));
          aLaVez--;
          return { error: ruta === opts.fallaEn ? { message: "Bucket not found" } : null };
        },
        createSignedUrls: async () => ({ data: [], error: null }),
      }),
    };
    // Suelta las que esperan, de la ÚLTIMA a la primera (terminan al revés de como empezaron), hasta que no quede ninguna.
    const soltarTodo = async () => {
      for (let vuelta = 0; vuelta < 50; vuelta++) {
        await new Promise((r) => setTimeout(r, 0));
        if (!esperando.length) continue;
        esperando.splice(0).reverse().forEach((r) => r());
      }
    };
    return { storage, empezadas, maximo: () => maximo, soltarTodo };
  }
  const SIETE = Array.from({ length: 7 }, (_, i) => "data:image/jpeg;base64," + Buffer.from(`foto-${i}`).toString("base64"));

  it("con siete fotos, tres a la vez como mucho (y más de una)", async () => {
    expect(SUBIDAS_A_LA_VEZ).toBe(3);
    const c = cuboLento();
    const p = subirFotosDeEntrega(c.storage, "o-1", SIETE, 5);
    await c.soltarTodo();
    const r = await p;
    expect(c.maximo()).toBe(3);
    expect(c.empezadas).toHaveLength(7);
    // Las rutas, en el orden de la lista y con su número por sitio, aunque terminen al revés.
    expect(r).toEqual({ ok: true, rutas: SIETE.map((_, i) => `o-1/5-${i}.jpg`) });
  });
  it("las que ya son rutas no cuentan ni gastan número", async () => {
    const c = cuboLento();
    const p = subirFotosDeEntrega(c.storage, "o-1", ["o-1/1-0.jpg", SIETE[0], "o-1/1-1.jpg", SIETE[1]], 9);
    await c.soltarTodo();
    expect(await p).toEqual({ ok: true, rutas: ["o-1/1-0.jpg", "o-1/9-0.jpg", "o-1/1-1.jpg", "o-1/9-1.jpg"] });
    expect(c.empezadas).toEqual(["o-1/9-0.jpg", "o-1/9-1.jpg"]);
  });
  it("si una falla: error, sin rutas, y no se empiezan más", async () => {
    const c = cuboLento({ fallaEn: "o-1/5-0.jpg" });
    const p = subirFotosDeEntrega(c.storage, "o-1", SIETE, 5);
    await c.soltarTodo();
    expect(await p).toEqual({ ok: false, message: "Bucket not found" });
    expect(c.empezadas.length).toBeLessThan(7);
  });
  it("un data: que no es base64 se rechaza ANTES de subir ninguna", async () => {
    const c = cuboLento();
    const p = subirFotosDeEntrega(c.storage, "o-1", [SIETE[0], "data:image/jpeg,raw"], 5);
    await c.soltarTodo();
    expect((await p).ok).toBe(false);
    expect(c.empezadas).toEqual([]);
  });
  it("enParaleloConTope: resultados en el orden de entrada, con una sola o con ninguna", async () => {
    expect(await enParaleloConTope([3, 1, 2], 3, async (x) => { await new Promise((r) => setTimeout(r, x * 3)); return x * 10; })).toEqual([30, 10, 20]);
    expect(await enParaleloConTope([4], 3, async (x) => x + 1)).toEqual([5]);
    expect(await enParaleloConTope([], 3, async (x: number) => x)).toEqual([]);
  });
});

describe("enseñar: una foto vieja `data:` se sigue mostrando; una ruta, por su URL firmada", () => {
  it("urlsDeFotos no toca el data: y firma solo las rutas, una vez cada una, en el cubo", async () => {
    const { storage, firmadas } = almacen();
    const u = await urlsDeFotos(storage, [DATA_A, "o-1/1-0.jpg", "o-1/1-0.jpg", "o-1/1-1.jpg"]);
    expect(u[DATA_A]).toBe(DATA_A);
    expect(u["o-1/1-0.jpg"]).toBe("https://x/sign/o-1/1-0.jpg?token=t");
    expect(u["o-1/1-1.jpg"]).toBe("https://x/sign/o-1/1-1.jpg?token=t");
    expect(firmadas).toEqual([{ cubo: CUBO_DE_FOTOS, rutas: ["o-1/1-0.jpg", "o-1/1-1.jpg"], segundos: 3600 }]);
  });
  it("sin rutas no se pide ninguna firma", async () => {
    const { storage, firmadas } = almacen();
    expect(await urlsDeFotos(storage, [DATA_A])).toEqual({ [DATA_A]: DATA_A });
    expect(firmadas).toEqual([]);
  });
  it("srcDeFoto: data: tal cual; ruta con firma, la firma; ruta sin firma, en blanco (nunca la ruta a pelo)", () => {
    expect(srcDeFoto(DATA_A, undefined)).toBe(DATA_A);
    expect(srcDeFoto("o-1/1-0.jpg", { "o-1/1-0.jpg": "https://x/s" })).toBe("https://x/s");
    expect(srcDeFoto("o-1/1-0.jpg", {})).toBe("");
    expect(srcDeFoto("o-1/1-0.jpg", undefined)).toBe("");
  });
  it("la rejilla y el visor pintan con srcDeFoto, no con la foto a pelo", () => {
    const grid = leer("src/components/PhotoUpload.tsx");
    const lb = leer("src/components/PhotoLightbox.tsx");
    expect(grid).toContain("<img src={srcDeFoto(src, urls)}");
    expect(lb).toContain("const src = srcDeFoto(foto, urls);");
    expect(lb).toContain("credits?.[foto]");   // el autor se busca por la clave (la ruta), no por la URL firmada
  });
});

describe("nada se guarda a medias (fuente: OrderModal y PhotoUpload)", () => {
  const modal = leer("src/components/OrderModal.tsx");
  const grid = leer("src/components/PhotoUpload.tsx");

  it("la entrega sube las fotos de la cámara ANTES de escribir la etapa, y si no suben, vuelve sin entregar", () => {
    const a = modal.indexOf("const deliverWithPod = async () => {");
    const b = modal.indexOf("const fotos = fotosSubidas.length", a);
    expect(a).toBeGreaterThan(-1);
    expect(b).toBeGreaterThan(a);
    const tramo = modal.slice(a, b);
    expect(tramo).toContain("const subida = await subirFotos(fotosDeLaEntrega);");
    expect(tramo).toMatch(/if \(!subida\.ok\) \{[\s\S]*?setBusy\(false\);\s*return;\s*\}/);
    // Lo que se guarda son las rutas que devolvió la subida, no los data: de la cámara.
    expect(modal).toContain("fotosSubidas = subida.rutas;");
    expect(modal.slice(b)).toMatch(/const fotos = fotosSubidas\.length \? fotosAlEntregar\(fotosOrden\.photos, fotosSubidas\)/);
    // Y la escritura de la etapa viene DESPUÉS de todo eso.
    expect(modal.indexOf("setStage(", b)).toBeGreaterThan(b);
  });
  it("la rejilla de «Fotos del material» recibe `subir` y `urls`, y en modo enseñanza no sube", () => {
    expect(modal).toMatch(/<PhotoUpload\s+photos=\{fotosOrden\.photos \?\? \[\]\}[\s\S]*?urls=\{urlsDeLasFotos\}\s+subir=\{subirFotos\}/);
    expect(modal).toContain("existing && !teaching\n      ? subirFotosDeEntrega(createClient().storage");
  });
  it("PhotoUpload: si `subir` falla, avisa y NO llama a onChange", () => {
    const a = grid.indexOf("if (subir) {");
    const b = grid.indexOf("onChange([...photos, ...nuevas]);", a);
    expect(a).toBeGreaterThan(-1);
    expect(b).toBeGreaterThan(a);
    expect(grid.slice(a, b)).toMatch(/if \(!r\.ok\) \{\s*setErr\([\s\S]*?\);\s*return;\s*\}/);
    expect(grid.slice(a, b)).toContain("nuevas = r.rutas;");
  });
});

describe("migración 178", () => {
  const sql = leer("supabase/migrations/178_fotos_en_storage.sql");
  const sinComentarios = sql.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
  it("crea el cubo privado y dos políticas (leer y subir) que miran la orden por la primera carpeta", () => {
    expect(sinComentarios).toContain("values ('delivery-photos', 'delivery-photos', false");
    expect(sinComentarios.match(/create policy "delivery photos (read|upload)"/g)).toHaveLength(2);
    expect(sinComentarios.match(/d\.id::text = \(storage\.foldername\(name\)\)\[1\]/g)).toHaveLength(2);
    expect(sinComentarios).not.toMatch(/for delete/);
  });
  it("sin begin/commit propios, con registro y checksum del cuerpo", () => {
    expect(sinComentarios).not.toMatch(/^\s*(begin|commit)\s*;/im);
    expect(sql).toContain("-- @ledger-below\ninsert into public.schema_migrations (name, checksum) values ('178_fotos_en_storage.sql', '");
  });
});
